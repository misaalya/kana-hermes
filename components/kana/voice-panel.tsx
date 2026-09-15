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
import { btnGhost, btnPrimary, btnSecondary } from "./ui";
import { settingsButton, settingsInput, SettingsRow } from "./settings-layout";
import { getCopy, type Copy, type UiLocale } from "@/lib/ui/copy";
import type { VoiceProviderStatus } from "@/lib/voice/types";

type VoicePanelProps = {
  selectedVoiceId: string;
  onVoiceSelect(voiceId: string): void;
  locale: UiLocale;
};

const MAX_VOICE_REFERENCE_MIB = MAX_VOICE_REFERENCE_BYTES / (1024 * 1024);
const DEFAULT_VOICE_ID = "kc-default";

function VoiceChoice({
  active,
  label,
  hint,
  deletable,
  onSelect,
  onDelete,
  copy,
}: {
  active: boolean;
  label: string;
  hint: string | null;
  deletable: boolean;
  onSelect(): void;
  onDelete(): void;
  copy: Copy["voiceLibrary"];
}) {
  return (
    <div
      role="radio"
      aria-checked={active}
      className={`flex min-h-16 items-stretch overflow-hidden rounded-xl border transition-colors ${
        active
          ? "border-accent bg-accent/8"
          : "border-line-strong hover:bg-surface-strong/60"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="kana-focus flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left disabled:cursor-not-allowed"
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-ink">
            {label}
          </span>
          {hint ? <span className="mt-0.5 block truncate text-[11px] text-muted">{hint}</span> : null}
        </span>
        <span className={`shrink-0 text-[11px] font-semibold ${active ? "text-accent-strong" : "text-faint"}`}>
          {active ? copy.selected : copy.choose}
        </span>
      </button>
      {deletable ? (
        <button
          type="button"
          className="kana-focus shrink-0 border-l border-line px-3 text-[11px] font-semibold text-muted transition-colors hover:bg-danger/10 hover:text-danger"
          onClick={onDelete}
        >
          {copy.remove}
        </button>
      ) : null}
    </div>
  );
}

// Voice management backed by Kana's persistent library (data/voices +
// SQLite). The bundled Kana voice and the model's own voice are always
// present, so the radio group is never empty.

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
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    setLoadingVoices(true);
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

  const upload = async () => {
    if (!cloneAudio || !cloneName.trim() || !cloneConsent) {
      setNotice(copy.validation);
      return;
    }
    setBusy(true);
    setNotice(null);
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
      <div className="rounded-xl border-2 border-line bg-surface-strong px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-xs font-bold text-ink">{copy.title}</h4>
            <p className="mt-1 text-[10px] leading-relaxed text-muted">
              {copy.externalProvider(providerName || "External TTS")}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold ${
              providerReady
                ? "bg-accent text-white"
                : "bg-danger text-white"
            }`}
          >
            {providerChecking
              ? copy.externalChecking
              : providerReady
                ? copy.externalReady
                : copy.externalUnavailable}
          </span>
        </div>
        {providerStatus?.message ? (
          <p
            className={`mt-3 rounded-lg bg-raised px-3 py-2 text-[10px] leading-relaxed ${
              providerReady ? "text-muted" : "text-danger"
            }`}
          >
            {providerStatus.message}
          </p>
        ) : null}
        <button
          type="button"
          className={`${btnSecondary} mt-3`}
          disabled={loadingVoices}
          onClick={() => void refresh()}
        >
          {loadingVoices ? copy.externalChecking : copy.externalRefresh}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-[15px] font-bold text-ink">{copy.title}</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
          {copy.body}
        </p>
      </div>

      <fieldset className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={copy.chooseAria}>
        <legend className="sr-only">{copy.available}</legend>
        {loadingVoices && voices.length === 0 ? (
          <p className="rounded-xl border border-line px-4 py-5 text-[11.5px] text-muted sm:col-span-2">{copy.loading}</p>
        ) : voices.length === 0 ? (
          <p className="rounded-xl border border-line px-4 py-5 text-[11.5px] text-muted sm:col-span-2">
            {copy.empty}
          </p>
        ) : (
          voices.map((voice) => (
            <VoiceChoice
              key={voice.id}
              active={voice.id === effectiveSelected}
              label={voice.name}
              hint={voice.kind === "model" ? copy.modelVoice : voice.kind === "bundled" ? copy.included : copy.yours}
              deletable={voice.kind === "reference"}
              onSelect={() => onVoiceSelect(voice.id)}
              onDelete={() => void remove(voice.id)}
              copy={copy}
            />
          ))
        )}
      </fieldset>


      {!addingVoice ? (
        <div className="mt-4 border-t border-line">
          <SettingsRow label={copy.addTitle} description={copy.addBody}>
            <button type="button" className={settingsButton} onClick={() => setAddingVoice(true)}>
              {copy.addSample}
            </button>
          </SettingsRow>
        </div>
      ) : (
        <section className="mt-4 rounded-xl border border-line-strong p-4" aria-label={copy.formAria}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h4 className="text-[13px] font-semibold text-ink">{copy.formTitle}</h4>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{copy.formBody}</p>
            </div>
            <button type="button" className={btnGhost} onClick={() => setAddingVoice(false)}>{copy.cancel}</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-[11.5px] text-muted">{copy.name}</span>
              <input
                type="text"
                className={settingsInput}
                placeholder={copy.namePlaceholder}
                value={cloneName}
                onChange={(event) => setCloneName(event.target.value)}
              />
            </label>
            <div className="grid gap-1.5">
              <span className="text-[11.5px] text-muted">{copy.audio}</span>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                className="sr-only"
                onChange={(event) => setCloneAudio(event.target.files?.[0] ?? null)}
              />
              <button type="button" className={`${settingsButton} min-h-9 justify-start overflow-hidden`} onClick={() => audioInputRef.current?.click()}>
                <span className="truncate">{cloneAudio?.name ?? copy.chooseFile}</span>
              </button>
            </div>
          </div>
          <label className="mt-3 flex items-start gap-2 text-[11.5px] leading-relaxed text-muted">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--accent)]"
              checked={cloneConsent}
              onChange={(event) => setCloneConsent(event.target.checked)}
            />
            {copy.consent}
          </label>
          <div className="mt-4 flex justify-end">
            <button type="button" className={btnPrimary} disabled={busy || !cloneAudio || !cloneName.trim() || !cloneConsent} onClick={() => void upload()}>
              {busy ? copy.preparing : copy.addLibrary}
            </button>
          </div>
        </section>
      )}
      <p className="min-h-4 text-[11px] text-muted">{notice ?? ""}</p>
    </div>
  );
}
