"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteKanaVoice,
  listKanaVoices,
  uploadKanaVoice,
  type LibraryVoice,
} from "@/lib/runtime/voice-library-client";
import { convertToWav } from "@/lib/voice/audio-to-wav";
import { btnGhost, btnPrimary, btnSecondary, inputBase } from "./ui";
import { getCopy, type Copy, type UiLocale } from "@/lib/ui/copy";
import type { VoiceProviderStatus } from "@/lib/voice/types";

type VoicePanelProps = {
  selectedVoiceId: string;
  onVoiceSelect(serviceVoiceId: string): void;
  locale: UiLocale;
};

type EngineState =
  | "ready"
  | "loading"
  | "error"
  | "stopped"
  | "unavailable"
  | "external";

function VoiceChoice({
  active,
  label,
  hint,
  selectable,
  deletable,
  onSelect,
  onDelete,
  copy,
}: {
  active: boolean;
  label: string;
  hint: string | null;
  selectable: boolean;
  deletable: boolean;
  onSelect(): void;
  onDelete(): void;
  copy: Copy["voiceLibrary"];
}) {
  return (
    <div
      role="radio"
      aria-checked={active}
      aria-disabled={!selectable}
      className={`flex min-h-20 items-stretch overflow-hidden rounded-xl border-2 transition-colors ${
        active
          ? "border-accent bg-surface-strong"
          : "border-line bg-surface-strong"
      } ${selectable ? "" : "opacity-60"}`}
    >
      <button
        type="button"
        disabled={!selectable}
        onClick={onSelect}
        className="kana-focus flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left disabled:cursor-not-allowed"
      >
        <span className="min-w-0">
          <span className={`block truncate text-sm font-semibold ${active ? "text-ink" : "text-ink-dim"}`}>
            {label}
          </span>
          {hint ? <span className="block truncate text-[10px] text-faint">{hint}</span> : null}
        </span>
        <span className={`shrink-0 text-[10px] font-bold ${active ? "text-accent" : "text-faint"}`}>
          {active ? copy.selected : selectable ? copy.choose : copy.pending}
        </span>
      </button>
      {deletable ? (
        <button
          type="button"
          className="kana-focus shrink-0 border-l-2 border-line px-3 text-[10px] font-semibold text-faint transition-colors hover:bg-danger/10 hover:text-danger"
          onClick={onDelete}
        >
          {copy.remove}
        </button>
      ) : null}
    </div>
  );
}

// Voice management backed by Kana's persistent library (data/voices +
// SQLite). The shipped default voice is always present, so the radio group
// is never empty; pending rows stay visible with an honest hint while the
// engine registers them.

export function VoicePanel({
  selectedVoiceId,
  onVoiceSelect,
  locale,
}: VoicePanelProps) {
  const copy = getCopy(locale).voiceLibrary;
  const engineLines: Record<EngineState, string> = {
    ready: "",
    loading: copy.engineLoading,
    error: copy.engineError,
    stopped: copy.engineStopped,
    unavailable: copy.externalUnavailable,
    external: "",
  };
  const [voices, setVoices] = useState<LibraryVoice[]>([]);
  const [engineState, setEngineState] = useState<EngineState>("stopped");
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
      setEngineState((value.engine?.state as EngineState) ?? "stopped");
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
        setEngineState((value.engine?.state as EngineState) ?? "stopped");
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

  // Retry registration while something is pending and the panel is open.
  const hasPending = voices.some((voice) => !voice.registered) && engineState !== "error";
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => {
      void refresh();
    }, 15_000);
    return () => clearInterval(timer);
  }, [hasPending, refresh]);

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
      if (result.voice.registered && result.voice.serviceVoiceId) {
        onVoiceSelect(result.voice.serviceVoiceId);
      }
      setNotice(result.warning ?? copy.added(result.voice.name));
      setCloneName("");
      setCloneAudio(null);
      setCloneConsent(false);
      setAddingVoice(false);
      if (audioInputRef.current) audioInputRef.current.value = "";
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : copy.addFailed);
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
      setNotice(error instanceof Error ? error.message : copy.removeFailed);
    } finally {
      setBusy(false);
    }
  };

  const registeredIds = new Set(
    voices.filter((voice) => voice.registered && voice.serviceVoiceId).map((voice) => voice.serviceVoiceId),
  );
  const effectiveSelected =
    selectedVoiceId && registeredIds.has(selectedVoiceId)
      ? selectedVoiceId
      : (voices.find((voice) => voice.registered)?.serviceVoiceId ?? "");

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
        <h4 className="text-xs font-bold text-ink">{copy.title}</h4>
        <p className="mt-1 text-[10px] leading-relaxed text-muted">
          {copy.body}
        </p>
      </div>

      <fieldset className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={copy.chooseAria}>
        <legend className="sr-only">{copy.available}</legend>
        {loadingVoices && voices.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface-strong px-4 py-5 text-[11px] text-muted sm:col-span-2">{copy.loading}</p>
        ) : voices.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface-strong px-4 py-5 text-[11px] text-muted sm:col-span-2">
            {copy.empty}
          </p>
        ) : (
          voices.map((voice) => (
            <VoiceChoice
              key={voice.id}
              active={Boolean(voice.registered && voice.serviceVoiceId === effectiveSelected)}
              label={voice.name}
              hint={voice.registered ? (voice.isDefault ? copy.included : copy.yours) : copy.waiting}
              selectable={voice.registered}
              deletable={!voice.isDefault}
              onSelect={() => {
                if (voice.registered && voice.serviceVoiceId) onVoiceSelect(voice.serviceVoiceId);
              }}
              onDelete={() => void remove(voice.id)}
              copy={copy}
            />
          ))
        )}
      </fieldset>

      {engineState !== "ready" ? (
        <p className={`mt-3 text-[10px] leading-relaxed ${engineState === "error" ? "text-danger" : "text-faint"}`}>
          {engineLines[engineState]}
        </p>
      ) : null}

      {!addingVoice ? (
        <button
          type="button"
          className="kana-focus mt-4 flex w-full items-center justify-between rounded-xl border border-line bg-surface-strong px-4 py-3 text-left transition-colors hover:border-accent/45"
          onClick={() => setAddingVoice(true)}
        >
          <span>
            <span className="block text-xs font-bold text-ink">{copy.addTitle}</span>
            <span className="mt-0.5 block text-[10px] text-muted">{copy.addBody}</span>
          </span>
          <span className="text-[10px] font-bold text-accent">{copy.addSample}</span>
        </button>
      ) : (
        <section className="mt-4 rounded-xl border border-accent/35 bg-surface-strong p-4" aria-label={copy.formAria}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h4 className="text-xs font-bold text-ink">{copy.formTitle}</h4>
              <p className="mt-1 text-[10px] leading-relaxed text-muted">{copy.formBody}</p>
            </div>
            <button type="button" className={btnGhost} onClick={() => setAddingVoice(false)}>{copy.cancel}</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-[10px] font-bold text-muted">{copy.name}</span>
              <input
                type="text"
                className={inputBase}
                placeholder={copy.namePlaceholder}
                value={cloneName}
                onChange={(event) => setCloneName(event.target.value)}
              />
            </label>
            <div className="grid gap-1.5">
              <span className="text-[10px] font-bold text-muted">{copy.audio}</span>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                className="sr-only"
                onChange={(event) => setCloneAudio(event.target.files?.[0] ?? null)}
              />
              <button type="button" className={`${btnSecondary} justify-start overflow-hidden`} onClick={() => audioInputRef.current?.click()}>
                <span className="truncate">{cloneAudio?.name ?? copy.chooseFile}</span>
              </button>
            </div>
          </div>
          <label className="mt-3 flex items-start gap-2 text-[10px] leading-relaxed text-muted">
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
