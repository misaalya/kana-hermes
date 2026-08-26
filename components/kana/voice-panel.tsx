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

type VoicePanelProps = {
  selectedVoiceId: string;
  onVoiceSelect(serviceVoiceId: string): void;
};

type EngineState = "ready" | "loading" | "error" | "stopped";

const ENGINE_LINES: Record<EngineState, string> = {
  ready: "",
  loading: "The voice engine is getting ready. Your voices will appear automatically when it finishes.",
  error: "The voice engine could not start. Open Connection to check it.",
  stopped: "The voice engine is asleep. Kana will start it when voice is needed.",
};

const ENGINE_HINT_PENDING = "Waiting for the voice engine…";

function VoiceChoice({
  active,
  label,
  hint,
  selectable,
  deletable,
  onSelect,
  onDelete,
}: {
  active: boolean;
  label: string;
  hint: string | null;
  selectable: boolean;
  deletable: boolean;
  onSelect(): void;
  onDelete(): void;
}) {
  return (
    <div
      role="radio"
      aria-checked={active}
      aria-disabled={!selectable}
      className={`flex min-h-20 items-stretch overflow-hidden rounded-xl border transition-colors ${
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
          {active ? "Selected" : selectable ? "Choose" : "Pending"}
        </span>
      </button>
      {deletable ? (
        <button
          type="button"
          className="kana-focus shrink-0 border-l border-line px-3 text-[10px] font-semibold text-faint transition-colors hover:bg-danger/10 hover:text-danger"
          onClick={onDelete}
        >
          Remove
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
}: VoicePanelProps) {
  const [voices, setVoices] = useState<LibraryVoice[]>([]);
  const [engineState, setEngineState] = useState<EngineState>("stopped");
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneAudio, setCloneAudio] = useState<File | null>(null);
  const [cloneConsent, setCloneConsent] = useState(false);
  const [addingVoice, setAddingVoice] = useState(false);
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    setLoadingVoices(true);
    try {
      const value = await listKanaVoices();
      setVoices(value.voices);
      setEngineState((value.engine?.state as EngineState) ?? "stopped");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Voice check failed.");
    } finally {
      setLoadingVoices(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void listKanaVoices()
      .then((value) => {
        if (!active) return;
        setVoices(value.voices);
        setEngineState((value.engine?.state as EngineState) ?? "stopped");
        setLoadingVoices(false);
      })
      .catch((error) => {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : "Voice check failed.");
        setLoadingVoices(false);
      });
    return () => {
      active = false;
    };
  }, []);

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
      setNotice("Add a name, choose a voice sample, and confirm you have permission to use it.");
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
      setNotice(result.warning ?? `Voice "${result.voice.name}" is ready.`);
      setCloneName("");
      setCloneAudio(null);
      setCloneConsent(false);
      setAddingVoice(false);
      if (audioInputRef.current) audioInputRef.current.value = "";
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The voice could not be added.");
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
      setNotice(error instanceof Error ? error.message : "The voice could not be removed.");
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

  return (
    <div>
      <div className="mb-3">
        <h4 className="text-xs font-bold text-ink">Voice library</h4>
        <p className="mt-1 text-[10px] leading-relaxed text-muted">
          Choose a ready voice. Kana uses it for every new Japanese reply.
        </p>
      </div>

      <fieldset className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Choose Kana's voice">
        <legend className="sr-only">Available voices</legend>
        {loadingVoices && voices.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface-strong px-4 py-5 text-[11px] text-muted sm:col-span-2">Loading voices…</p>
        ) : voices.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface-strong px-4 py-5 text-[11px] text-muted sm:col-span-2">
            No voices yet. Add a voice sample below.
          </p>
        ) : (
          voices.map((voice) => (
            <VoiceChoice
              key={voice.id}
              active={Boolean(voice.registered && voice.serviceVoiceId === effectiveSelected)}
              label={voice.name}
              hint={voice.registered ? (voice.isDefault ? "Included with Kana" : "Your voice") : ENGINE_HINT_PENDING}
              selectable={voice.registered}
              deletable={!voice.isDefault}
              onSelect={() => {
                if (voice.registered && voice.serviceVoiceId) onVoiceSelect(voice.serviceVoiceId);
              }}
              onDelete={() => void remove(voice.id)}
            />
          ))
        )}
      </fieldset>

      {engineState !== "ready" ? (
        <p className={`mt-3 text-[10px] leading-relaxed ${engineState === "error" ? "text-danger" : "text-faint"}`}>
          {ENGINE_LINES[engineState]}
        </p>
      ) : null}

      {!addingVoice ? (
        <button
          type="button"
          className="kana-focus mt-4 flex w-full items-center justify-between rounded-xl border border-line bg-surface-strong px-4 py-3 text-left transition-colors hover:border-accent/45"
          onClick={() => setAddingVoice(true)}
        >
          <span>
            <span className="block text-xs font-bold text-ink">Add your own voice</span>
            <span className="mt-0.5 block text-[10px] text-muted">Use one clear audio sample that you have permission to use.</span>
          </span>
          <span className="text-[10px] font-bold text-accent">Add sample</span>
        </button>
      ) : (
        <section className="mt-4 rounded-xl border border-accent/35 bg-surface-strong p-4" aria-label="Add a voice sample">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h4 className="text-xs font-bold text-ink">Add your voice</h4>
              <p className="mt-1 text-[10px] leading-relaxed text-muted">A clean sample with one speaker gives the best result.</p>
            </div>
            <button type="button" className={btnGhost} onClick={() => setAddingVoice(false)}>Cancel</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-[10px] font-bold text-muted">Voice name</span>
              <input
                type="text"
                className={inputBase}
                placeholder="For example: My voice"
                value={cloneName}
                onChange={(event) => setCloneName(event.target.value)}
              />
            </label>
            <div className="grid gap-1.5">
              <span className="text-[10px] font-bold text-muted">Audio sample</span>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                className="sr-only"
                onChange={(event) => setCloneAudio(event.target.files?.[0] ?? null)}
              />
              <button type="button" className={`${btnSecondary} justify-start overflow-hidden`} onClick={() => audioInputRef.current?.click()}>
                <span className="truncate">{cloneAudio?.name ?? "Choose audio file"}</span>
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
            This is my voice, or I have permission to use it.
          </label>
          <div className="mt-4 flex justify-end">
            <button type="button" className={btnPrimary} disabled={busy || !cloneAudio || !cloneName.trim() || !cloneConsent} onClick={() => void upload()}>
              {busy ? "Preparing voice…" : "Add to library"}
            </button>
          </div>
        </section>
      )}
      <p className="min-h-4 text-[11px] text-muted">{notice ?? ""}</p>
    </div>
  );
}
