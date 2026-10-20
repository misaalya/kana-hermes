"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteKanaVoice,
  listKanaVoices,
  uploadKanaVoice,
  VoiceLibraryError,
  type LibraryVoice,
} from "@/lib/runtime/voice-library-client";
import { AudioConversionError, convertToWav } from "@/lib/voice/audio-to-wav";
import { MAX_VOICE_REFERENCE_BYTES } from "@/lib/limits";
import { CheckIcon, WaveformIcon } from "./icons";
import { AddCard, WardrobeGrid } from "./settings-avatar-cards";
import { fieldLabel } from "./ui";
import {
  settingsButton,
  settingsButtonAccent,
  settingsInput,
  SettingsGroup,
  SettingsRow,
  SettingsRows,
  StatusPill,
} from "./settings-layout";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import type { VoiceProviderStatus } from "@/lib/voice/types";

type VoicePanelProps = {
  selectedVoiceId: string;
  onVoiceSelect(voiceId: string): void;
  locale: UiLocale;
};

const MAX_VOICE_REFERENCE_MIB = MAX_VOICE_REFERENCE_BYTES / (1024 * 1024);
const DEFAULT_VOICE_ID = "kc-default";

// Voice management backed by Kana's persistent library (data/voices +
// SQLite). The bundled Kana voice and the model's own voice are always
// present, so the list is never empty.

export function VoicePanel({
  selectedVoiceId,
  onVoiceSelect,
  locale,
}: VoicePanelProps) {
  const copy = getCopy(locale).voiceLibrary;
  const [voices, setVoices] = useState<LibraryVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneAudio, setCloneAudio] = useState<File | null>(null);
  const [cloneConsent, setCloneConsent] = useState(false);
  const [addingVoice, setAddingVoice] = useState(false);
  const [supportsVoiceLibrary, setSupportsVoiceLibrary] = useState(true);
  const [providerName, setProviderName] = useState("");
  const [providerStatus, setProviderStatus] = useState<VoiceProviderStatus | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    setLoadingVoices(true);
    setConfirmDelete(null);
    try {
      const value = await listKanaVoices();
      setVoices(value.voices);
      setSupportsVoiceLibrary(value.supportsVoiceLibrary !== false);
      setProviderName(value.provider?.name ?? "");
      setProviderStatus(value.providerStatus ?? null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : copy.checkFailed);
    } finally {
      setLoadingVoices(false);
    }
  }, [copy.checkFailed]);

  useEffect(() => {
    let active = true;
    void listKanaVoices()
      .then((value) => {
        if (!active) return;
        setVoices(value.voices);
        setSupportsVoiceLibrary(value.supportsVoiceLibrary !== false);
        setProviderName(value.provider?.name ?? "");
        setProviderStatus(value.providerStatus ?? null);
        setLoadingVoices(false);
      })
      .catch((error) => {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : copy.checkFailed);
        setLoadingVoices(false);
      });
    return () => {
      active = false;
    };
  }, [copy.checkFailed]);

  const voiceErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof AudioConversionError) {
      return error.code === "unsupported" ? copy.audioUnsupported : copy.audioUnreadable;
    }
    if (error instanceof VoiceLibraryError) {
      if (error.code === "voice_too_large") return copy.tooLarge(MAX_VOICE_REFERENCE_MIB);
      if (error.code === "default_voice_protected") return copy.defaultProtected;
      if (error.code === "audio_not_wav") return copy.notWav;
    }
    return error instanceof Error ? error.message : fallback;
  };

  const selectVoice = (id: string) => {
    setConfirmDelete(null);
    onVoiceSelect(id);
  };

  const upload = async () => {
    if (!cloneAudio || !cloneName.trim() || !cloneConsent) {
      setNotice(copy.validation);
      return;
    }
    setBusy(true);
    setNotice(null);
    setConfirmDelete(null);
    try {
      const wav = await convertToWav(cloneAudio);
      const result = await uploadKanaVoice(cloneName.trim(), wav, cloneConsent);
      onVoiceSelect(result.voice.id);
      setNotice(copy.added(result.voice.name));
      setCloneName("");
      setCloneAudio(null);
      setCloneConsent(false);
      setAddingVoice(false);
      if (audioInputRef.current) audioInputRef.current.value = "";
      await refresh();
    } catch (error) {
      setNotice(voiceErrorMessage(error, copy.addFailed));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setConfirmDelete(null);
    setNotice(null);
    setBusy(true);
    try {
      await deleteKanaVoice(id);
      await refresh();
    } catch (error) {
      setNotice(voiceErrorMessage(error, copy.removeFailed));
    } finally {
      setBusy(false);
    }
  };

  // A deleted or unknown selection speaks with the bundled voice server-side too.
  const effectiveSelected = voices.some((voice) => voice.id === selectedVoiceId)
    ? selectedVoiceId
    : DEFAULT_VOICE_ID;

  if (!supportsVoiceLibrary) {
    const providerReady = providerStatus?.state === "ready";
    const providerChecking = loadingVoices || providerStatus?.state === "loading";
    return (
      <SettingsGroup title={copy.providerTitle}>
        <SettingsRows>
          <SettingsRow
            label={providerName || copy.externalFallback}
            description={providerStatus?.message ? (
              <span className={providerReady ? undefined : "text-danger"}>
                {providerStatus.message}
              </span>
            ) : undefined}
          >
            <StatusPill
              tone={providerReady ? "ok" : providerChecking ? "idle" : "error"}
              capitalize={false}
            >
              {providerChecking
                ? copy.externalChecking
                : providerReady
                  ? copy.externalReady
                  : copy.externalUnavailable}
            </StatusPill>
            <button
              type="button"
              className={settingsButton}
              disabled={loadingVoices}
              onClick={() => {
                setNotice(null);
                void refresh();
              }}
            >
              {copy.externalRefresh}
            </button>
          </SettingsRow>
        </SettingsRows>
        {notice ? (
          <p role="status" className="mt-2 text-[11.5px] font-semibold text-muted">{notice}</p>
        ) : null}
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup ariaLabel={copy.title}>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">{copy.title}</p>
      {loadingVoices && voices.length === 0 ? (
        <p className="mt-3 text-[11.5px] text-muted">{copy.loading}</p>
      ) : (
        <>
          {voices.length === 0 ? (
            <p className="mt-3 text-[11.5px] text-muted">{copy.empty}</p>
          ) : null}
          <WardrobeGrid label={copy.chooseAria}>
            {voices.map((voice) => {
              const active = voice.id === effectiveSelected;
              return (
                <div
                  key={voice.id}
                  className={`kana-choice kana-wardrobe-card flex flex-col rounded-[26px] ${active ? "is-selected" : ""}`}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={voice.name}
                    className="kana-focus flex w-full flex-1 flex-col items-center gap-2 rounded-[23px] px-2 pb-3 pt-4"
                    onClick={() => selectVoice(voice.id)}
                  >
                    <span className="kana-portrait" aria-hidden="true">
                      <WaveformIcon className="size-[46%]" />
                    </span>
                    <span
                      className="max-w-full truncate px-1 text-[12.5px] font-extrabold text-ink"
                      title={voice.name}
                    >
                      {voice.name}
                    </span>
                  </button>
                  {voice.kind === "reference" ? (
                    <div className="flex justify-center pb-2.5">
                      <button
                        type="button"
                        className={`kana-focus rounded-full px-2.5 py-1 text-[10.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          confirmDelete === voice.id
                            ? "text-danger"
                            : "text-muted hover:text-danger"
                        }`}
                        disabled={busy}
                        aria-label={confirmDelete === voice.id
                          ? copy.confirmRemoveAria(voice.name)
                          : copy.removeAria(voice.name)}
                        onClick={() => (confirmDelete === voice.id
                          ? void remove(voice.id)
                          : setConfirmDelete(voice.id))}
                      >
                        {confirmDelete === voice.id ? copy.confirmRemove : copy.remove}
                      </button>
                    </div>
                  ) : null}
                  {active ? (
                    <span className="kana-check" aria-hidden="true">
                      <CheckIcon className="size-3.5" />
                    </span>
                  ) : null}
                </div>
              );
            })}
            {!addingVoice ? (
              <AddCard
                label={copy.addSample}
                onClick={() => {
                  setConfirmDelete(null);
                  setAddingVoice(true);
                }}
              />
            ) : null}
          </WardrobeGrid>
        </>
      )}
      {addingVoice ? (
        <div
          role="group"
          aria-label={copy.formAria}
          className="mt-4 grid max-w-md gap-3 rounded-[22px] border-2 border-line bg-raised px-4 py-4"
        >
          <p className="text-[13px] font-extrabold text-ink">{copy.formTitle}</p>
          <label className="grid gap-1.5">
            <span className={fieldLabel}>{copy.name}</span>
            <input
              type="text"
              className={settingsInput}
              placeholder={copy.namePlaceholder}
              value={cloneName}
              onChange={(event) => setCloneName(event.target.value)}
            />
          </label>
          <div className="grid gap-1.5">
            <span className={fieldLabel}>{copy.audio}</span>
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              className="sr-only"
              aria-label={copy.audio}
              onChange={(event) => setCloneAudio(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className={`${settingsButton} justify-start overflow-hidden`}
              onClick={() => audioInputRef.current?.click()}
            >
              <span className="truncate">{cloneAudio?.name ?? copy.chooseFile}</span>
            </button>
          </div>
          <label className="flex items-start gap-2 text-[11.5px] leading-relaxed text-muted">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--accent)]"
              checked={cloneConsent}
              onChange={(event) => setCloneConsent(event.target.checked)}
            />
            {copy.consent}
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={settingsButtonAccent}
              disabled={busy || !cloneAudio || !cloneName.trim() || !cloneConsent}
              onClick={() => void upload()}
            >
              {busy ? copy.preparing : copy.addLibrary}
            </button>
            <button
              type="button"
              className={settingsButton}
              onClick={() => setAddingVoice(false)}
            >
              {copy.cancel}
            </button>
          </div>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="mt-3 text-[11.5px] font-semibold text-muted">{notice}</p>
      ) : null}
    </SettingsGroup>
  );
}
