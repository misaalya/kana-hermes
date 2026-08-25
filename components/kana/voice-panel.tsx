"use client";

import { useCallback, useEffect, useState } from "react";
import type { VoiceProviderStatus } from "@/lib/voice/types";
import {
  deleteKanaVoice,
  listKanaVoices,
  uploadKanaVoice,
  type LibraryVoice,
} from "@/lib/runtime/voice-library-client";
import { btnGhost, btnPrimary, inputBase } from "./ui";

type VoicePanelProps = {
  selectedVoiceId: string;
  onVoiceSelect(serviceVoiceId: string): void;
  /** Service health line under the list (probe-only, never spawns). */
  onInspectService(): Promise<VoiceProviderStatus>;
};

// Per-voice accent dot colors. The default "Kana" voice is white; new clones
// cycle through the remaining palette so every radio is visually distinct.
const VOICE_DOTS = ["bg-white", "bg-rose-400", "bg-amber-400", "bg-emerald-400", "bg-sky-400", "bg-violet-400"];

function voiceDotColor(voice: LibraryVoice, index: number): string {
  if (voice.isDefault) return VOICE_DOTS[0];
  return VOICE_DOTS[1 + (index % (VOICE_DOTS.length - 1))];
}

function VoiceRadio({
  active,
  dotColor,
  label,
  hint,
  deletable,
  onSelect,
  onDelete,
  disabled,
}: {
  active: boolean;
  dotColor: string;
  label: string;
  hint: string | null;
  deletable: boolean;
  onSelect(): void;
  onDelete(): void;
  disabled: boolean;
}) {
  return (
    <div
      role="radio"
      aria-checked={active}
      aria-disabled={disabled || !deletable ? undefined : undefined}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!disabled) onSelect();
        }
      }}
      onClick={() => {
        if (!disabled) onSelect();
      }}
      className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-3 transition-all duration-150 ${
        active
          ? "border-accent/70 bg-white/8 shadow-[0_0_0_1px_rgba(255,255,255,0.15)]"
          : "border-line bg-surface hover:border-line-strong hover:bg-white/5"
      } ${disabled ? "opacity-60" : ""}`}
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
          disabled={disabled}
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
// is never empty; user clones survive service cache wipes because the
// reference audio lives on the Kana side.

export function VoicePanel({
  selectedVoiceId,
  onVoiceSelect,
  onInspectService,
}: VoicePanelProps) {
  const [voices, setVoices] = useState<LibraryVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [serviceStatus, setServiceStatus] = useState<VoiceProviderStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneAudio, setCloneAudio] = useState<File | null>(null);
  const [cloneConsent, setCloneConsent] = useState(false);

  const refresh = useCallback(async () => {
    setLoadingVoices(true);
    try {
      setVoices(await listKanaVoices());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Voice check failed.");
    } finally {
      setLoadingVoices(false);
    }
    try {
      setServiceStatus(await onInspectService());
    } catch {
      // Service line is informational only.
    }
  }, [onInspectService]);

  useEffect(() => {
    let active = true;
    void listKanaVoices()
      .then((next) => {
        if (!active) return;
        setVoices(next);
        setLoadingVoices(false);
      })
      .catch((error) => {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : "Voice check failed.");
        setLoadingVoices(false);
      });
    void onInspectService()
      .then((next) => {
        if (active) setServiceStatus(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Register pending voices in the background while the panel is open.
  useEffect(() => {
    if (!voices.some((voice) => !voice.registered)) return;
    const timer = setInterval(() => {
      void listKanaVoices().then(setVoices).catch(() => undefined);
    }, 10_000);
    return () => clearInterval(timer);
  }, [voices]);

  const upload = async () => {
    if (!cloneAudio || !cloneName.trim() || !cloneConsent) {
      setNotice("Isi nama, pilih audio referensi, dan centang persetujuan dulu.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await uploadKanaVoice(cloneName.trim(), cloneAudio, cloneConsent);
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

  const registered = voices.filter((voice) => voice.registered && voice.serviceVoiceId);
  const effectiveSelected =
    selectedVoiceId && registered.some((voice) => voice.serviceVoiceId === selectedVoiceId)
      ? selectedVoiceId
      : (registered[0]?.serviceVoiceId ?? "");

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5" role="radiogroup" aria-label="Pilih suara Kana">
        <legend className="mb-1 text-[11px] font-bold tracking-wider text-ink-dim uppercase">Voice</legend>
        {loadingVoices && voices.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[11px] text-muted">Memuat suara…</p>
        ) : registered.length === 0 ? (
          <p className="rounded-xl border border-danger/40 bg-danger/5 px-3.5 py-2.5 text-[11px] leading-relaxed text-danger">
            Suara bawaan masih didaftarkan ke mesin suara. Tunggu sebentar lalu tekan Refresh.
          </p>
        ) : (
          voices.map((voice, index) => (
            <VoiceRadio
              key={voice.id}
              active={Boolean(voice.registered && voice.serviceVoiceId === effectiveSelected)}
              dotColor={voiceDotColor(voice, index)}
              label={voice.name}
              hint={voice.registered ? null : "menunggu pendaftaran ke mesin suara…"}
              deletable={!voice.isDefault}
              onSelect={() => {
                if (voice.registered && voice.serviceVoiceId) onVoiceSelect(voice.serviceVoiceId);
              }}
              onDelete={() => void remove(voice.id)}
              disabled={busy || !voice.registered}
            />
          ))
        )}
      </fieldset>

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
          <div className="flex items-center gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void upload()}>
              {busy ? "Memproses…" : "Clone"}
            </button>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
        </div>
      </details>

      {serviceStatus?.state !== "ready" && serviceStatus ? (
        <p className="text-[10px] text-faint">Layanan TTS: {serviceStatus.message}</p>
      ) : null}
      <p className="min-h-4 text-[11px] text-muted">{notice ?? ""}</p>
    </div>
  );
}
