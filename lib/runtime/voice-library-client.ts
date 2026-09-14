import type {
  TtsProviderDescriptor,
  VoiceProviderStatus,
} from "@/lib/voice/types";

// Browser client for Kana's persistent voice library (server SQLite +
// data/voices). Clones survive service cache wipes because the reference
// audio and metadata live on the Kana side, not inside the Qwen service.

export type LibraryVoice = {
  id: string;
  name: string;
  registered: boolean;
  serviceVoiceId: string | null;
  isDefault: boolean;
};

export type VoiceLibrarySnapshot = {
  voices: LibraryVoice[];
  engine?: { state?: string };
  provider?: TtsProviderDescriptor;
  providerStatus?: VoiceProviderStatus;
  supportsVoiceLibrary?: boolean;
};

export async function listKanaVoices(): Promise<VoiceLibrarySnapshot> {
  const response = await fetch("/api/kana/voices", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not load the voice library.");
  return (await response.json()) as VoiceLibrarySnapshot;
}

/** Why a saved voice is not usable yet; the UI localizes it. */
export type VoicePendingReason = "loading" | "stopped" | "error" | "registration_failed";

export type UploadedVoice = { voice: LibraryVoice; pending?: VoicePendingReason };

/** A voice-library failure with an optional stable code for localization. */
export class VoiceLibraryError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "VoiceLibraryError";
  }
}

export async function uploadKanaVoice(
  name: string,
  audio: File,
  consent: boolean,
): Promise<UploadedVoice> {
  const form = new FormData();
  form.set("name", name);
  form.set("audio", audio);
  form.set("consent", consent ? "1" : "0");
  const response = await fetch("/api/kana/voices", {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  const value = (await response.json().catch(() => ({}))) as UploadedVoice & { error?: string; code?: string };
  if (!response.ok) throw new VoiceLibraryError(value.error || "Voice clone failed.", value.code);
  return value;
}

export async function deleteKanaVoice(id: string): Promise<void> {
  const response = await fetch(`/api/kana/voices?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok) {
    const value = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new VoiceLibraryError(value?.error || "Could not delete the voice.", value?.code);
  }
}
