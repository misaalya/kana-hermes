"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteKanaVoice,
  listKanaVoices,
  uploadKanaVoice,
  type LibraryVoice,
} from "@/lib/runtime/voice-library-client";
import { convertToWav } from "@/lib/voice/audio-to-wav";
import { btnGhost, btnPrimary, inputBase } from "./ui";

type VoicePanelProps = {
  selectedVoiceId: string;
  onVoiceSelect(serviceVoiceId: string): void;
};

type EngineState = "ready" | "loading" | "error" | "stopped";

// Per-voice accent dot colors. The default "Kana" voice is white; new clones
// cycle through the remaining palette so every radio is visually distinct.
const VOICE_DOTS = ["bg-white", "bg-rose-400", "bg-amber-400", "bg-emerald-400", "bg-sky-400", "bg-violet-400"];

function voiceDotColor(voice: LibraryVoice, index: number): string {
  if (voice.isDefault) return VOICE_DOTS[0];
  return VOICE_DOTS[1 + (index % (VOICE_DOTS.length - 1))];
}

const ENGINE_LINES: Record<EngineState, string> = {
  ready: "",
  loading: "Mesin suara sedang menyiapkan model — suara terdaftar otomatis begitu siap.",
  error: "Mesin suara gagal dimuat (kemungkinan cache model hilang/rusak). Perbaiki lewat panel mesin suara di bawah.",
  stopped: "Mesin suara belum menyala. Suara terdaftar otomatis saat pertama dibutuhkan.",
};

const ENGINE_HINT_PENDING = "menunggu mesin suara siap…";

function VoiceRadio({
  active,
  dotColor,
  label,
  hint,
  selectable,
  deletable,
  onSelect,
  onDelete,
}: {
  active: boolean;
  dotColor: string;
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
      tabIndex={selectable ? 0 : -1}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && selectable) {
          event.preventDefault();
          onSelect();
        }
      }}
      onClick={() => {
        if (selectable) onSelect();
      }}
      className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 transition-all duration-150 ${
        active
          ? "border-accent/70 bg-white/8 shadow-[0_0_0_1px_rgba(255,255,255,0.15)]"
          : "border-line bg-surface hover:border-line-strong hover:bg-white/5"
      } ${selectable ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span
          className={`grid size-[22px] shrink-0 place-items-center rounded-full border-2 transition-all duration-150 ${
            active ? "scale-110 border-white/80" : "border-line-strong"
          }`}
        >
          <span className={`size-3 rounded-full transition-all duration-150 ${active ? "scale-100" : "scale-0"} ${dotColor}`} />
        </span>
        <span className="min-w-0">
          <span className={`block truncate text-sm font-medium transition-colors ${active ? "text-ink" : "text-ink-dim"}`}>
            {label}
          </span>
          {hint ? <span className="block truncate text-[10px] text-faint">{hint}</span> : null}
        </span>
      </span>
      {deletable ? (
        <button
          type="button"
          className="shrink-0 text-[11px] font-medium text-faint transition-colors hover:text-danger"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          Hapus
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
      setNotice("Isi nama, pilih audio referensi, dan centang persetujuan dulu.");
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
      setNotice(result.warning ?? `Suara "${result.voice.name}" tersimpan.`);
      setCloneName("");
      setCloneAudio(null);
      setCloneConsent(false);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Voice clone gagal.");
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
      setNotice(error instanceof Error ? error.message : "Hapus suara gagal.");
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
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5" role="radiogroup" aria-label="Pilih suara Kana">
        <div className="mb-1 flex items-center justify-between">
          <legend className="text-[11px] font-bold tracking-wider text-ink-dim uppercase">Voice</legend>
          <button type="button" className={btnGhost} onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {loadingVoices && voices.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[11px] text-muted">Memuat suara…</p>
        ) : voices.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[11px] text-muted">
            Belum ada suara. Clone suaramu lewat formulir di bawah.
          </p>
        ) : (
          voices.map((voice, index) => (
            <VoiceRadio
              key={voice.id}
              active={Boolean(voice.registered && voice.serviceVoiceId === effectiveSelected)}
              dotColor={voiceDotColor(voice, index)}
              label={voice.name + (voice.isDefault ? " (bawaan)" : "")}
              hint={voice.registered ? null : ENGINE_HINT_PENDING}
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
        <p className={`text-[10px] leading-relaxed ${engineState === "error" ? "text-danger" : "text-faint"}`}>
          {ENGINE_LINES[engineState]}
        </p>
      ) : null}

      <details className="rounded-xl border border-line px-3 py-2.5">
        <summary className="cursor-pointer text-[11px] font-bold text-ink-dim marker:content-none [&::-webkit-details-marker]:hidden">
          Clone suara baru
        </summary>
        <div className="mt-2.5 flex flex-col gap-2">
          <input
            type="text"
            className={inputBase}
            placeholder="Nama suara (mis. misa-voice)"
            value={cloneName}
            onChange={(event) => setCloneName(event.target.value)}
          />
          <input
            type="file"
            accept="audio/*"
            className="block w-full text-[11px] text-muted file:mr-2 file:rounded-lg file:border file:border-line file:bg-bg file:px-2 file:py-1 file:text-[11px]"
            onChange={(event) => setCloneAudio(event.target.files?.[0] ?? null)}
          />
          <label className="flex items-center gap-2 text-[10px] text-faint">
            <input
              type="checkbox"
              checked={cloneConsent}
              onChange={(event) => setCloneConsent(event.target.checked)}
            />
            Audio ini adalah suaraku / aku punya izin untuk menggunakannya.
          </label>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void upload()}>
            {busy ? "Menyimpan…" : "Clone"}
          </button>
        </div>
      </details>
      <p className="min-h-4 text-[11px] text-muted">{notice ?? ""}</p>
    </div>
  );
}
