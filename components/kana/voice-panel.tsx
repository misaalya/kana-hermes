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

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1.5 text-[11px] font-bold text-ink-dim uppercase">Selected voice</p>
        {!selectedVoiceId ? (
          <p className="rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-[11px] text-danger">
            Belum ada suara dipilih — Kana akan tetap diam sampai satu suara dipilih.
          </p>
        ) : (
          <span className="inline-block rounded-full border border-accent/50 px-2.5 py-0.5 text-[11px] font-bold text-accent-strong">
            {voices.find((voice) => voice.id === selectedVoiceId)?.name ?? selectedVoiceId}
          </span>
        )}
      </div>

      {cloned.length > 0 && (
        <ul className="flex flex-col gap-1">
          {cloned.map((voice) => (
            <li
              key={voice.id}
              className="flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2"
            >
              <button
                type="button"
                className={`min-w-0 flex-1 truncate text-left text-xs ${selectedVoiceId === voice.id ? "font-bold text-accent-strong" : "text-ink-dim"}`}
                onClick={() => onVoiceSelect(voice.id)}
              >
                {voice.name ?? voice.id}
                <span className="ml-1.5 text-[10px] text-faint">
                  {voice.durationSeconds ? `${Math.round(voice.durationSeconds)}s ref` : ""}
                </span>
              </button>
              <button
                type="button"
                className="text-[11px] text-faint transition-colors hover:text-danger"
                disabled={busy}
                onClick={() => void remove(voice.id)}
              >
                Hapus
              </button>
            </li>
          ))}
        </ul>
      )}

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
