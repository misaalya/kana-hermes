import { useCallback, useEffect, useState } from "react";
import type { VoiceDescriptor, VoiceProviderStatus } from "@/lib/voice/types";
import type { CreateVoiceCloneInput } from "@/lib/voice/qwen3-tts-contract";
import { btnGhost, btnPrimary, inputBase } from "./ui";

type VoicePanelProps = {
  selectedVoiceId: string;
  onVoiceSelect(voiceId: string): void;
  onInspect(): Promise<VoiceProviderStatus>;
  onClone(input: CreateVoiceCloneInput): Promise<VoiceDescriptor>;
  onDeleteCloned(voiceId: string): Promise<VoiceProviderStatus>;
};

// Per-voice accent dot colors. The first clone ("Kana") is white; new clones
// cycle through the remaining palette so every radio is visually distinct.
const VOICE_DOTS = ["bg-white", "bg-rose-400", "bg-amber-400", "bg-emerald-400", "bg-sky-400", "bg-violet-400"];

function voiceDotColor(voiceId: string, index: number): string {
  if (voiceId.endsWith("b2176303f2264f8ba3fdbd3a375d66ef")) return VOICE_DOTS[0];
  return VOICE_DOTS[1 + (index % (VOICE_DOTS.length - 1))];
}

// Voice management for the Qwen3-TTS Base model: it only speaks through a
// cloned voice profile, so one must exist and be selected or Kana stays
// silent. Restores the UI removed in the VN-style redesign (c95faa7).

export function VoicePanel({
  selectedVoiceId,
  onVoiceSelect,
  onInspect,
  onClone,
  onDeleteCloned,
}: VoicePanelProps) {
  const [status, setStatus] = useState<VoiceProviderStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneAudio, setCloneAudio] = useState<File | null>(null);
  const [cloneConsent, setCloneConsent] = useState(false);

  const refresh = useCallback(() => {
    return onInspect()
      .then((next) => {
        setStatus(next);
        return next;
      })
      .catch((error) => {
        setNotice(error instanceof Error ? error.message : "Voice check failed.");
        return null;
      });
  }, [onInspect]);

  useEffect(() => {
    let active = true;
    void refresh().then((next) => {
      if (!active && next) return;
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clone = async () => {
    if (!cloneAudio || !cloneName.trim() || !cloneConsent) {
      setNotice("Isi nama, pilih audio referensi, dan centang persetujuan dulu.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const voice = await onClone({
        name: cloneName.trim(),
        audio: cloneAudio,
        xVectorOnly: true,
        consent: true,
      });
      onVoiceSelect(voice.id);
      setNotice(`Suara "${voice.name}" tersimpan dan langsung dipilih.`);
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

  const remove = async (voiceId: string) => {
    setBusy(true);
    try {
      await onDeleteCloned(voiceId);
      if (selectedVoiceId === voiceId) onVoiceSelect("");
      setNotice("Suara kloningan dihapus.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Hapus suara gagal.");
    } finally {
      setBusy(false);
    }
  };

  const voices = status?.voices ?? [];
  const cloned = voices.filter((voice) => voice.kind === "cloned");
  // Radio-group semantics: exactly one voice is always active. When nothing
  // has been chosen yet (or the chosen voice was deleted), the first clone
  // takes over automatically — the group can never be fully "off".
  const effectiveSelected =
    selectedVoiceId && cloned.some((voice) => voice.id === selectedVoiceId)
      ? selectedVoiceId
      : (cloned[0]?.id ?? "");

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1" role="radiogroup" aria-label="Kana voice">
        <legend className="mb-1.5 text-[11px] font-bold text-ink-dim uppercase">Voice</legend>
        {cloned.length === 0 ? (
          <p className="rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-[11px] text-danger">
            Belum ada suara kloningan — clone satu suara dulu agar Kana bisa bicara.
          </p>
        ) : (
          cloned.map((voice, index) => {
            const active = voice.id === effectiveSelected;
            return (
              <label
                key={voice.id}
                role="radio"
                aria-checked={active}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onVoiceSelect(voice.id);
                  }
                }}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 transition-colors ${
                  active ? "border-accent/60 bg-accent/10" : "border-line bg-surface hover:border-line-strong"
                }`}
                onClick={() => onVoiceSelect(voice.id)}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`grid size-4 shrink-0 place-items-center rounded-full border ${
                      active ? "border-white/70" : "border-line-strong"
                    }`}
                  >
                    <span className={`size-2 rounded-full ${voiceDotColor(voice.id, index)} ${active ? "" : "opacity-40"}`} />
                  </span>
                  <span className={`truncate text-xs ${active ? "font-bold text-ink" : "text-ink-dim"}`}>
                    {voice.name ?? voice.id}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-[11px] text-faint transition-colors hover:text-danger"
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    void remove(voice.id);
                  }}
                >
                  Hapus
                </button>
              </label>
            );
          })
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
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void clone()}>
              {busy ? "Memproses…" : "Clone"}
            </button>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
        </div>
      </details>

      {status?.state !== "ready" && (
        <p className="text-[10px] text-faint">
          Layanan TTS: {status?.message ?? "memeriksa…"}
        </p>
      )}
      <p className="min-h-4 text-[11px] text-muted">{notice ?? ""}</p>
    </div>
  );
}
