import type {
  TtsProviderDescriptor,
  VoiceProviderStatus,
} from "@/lib/voice/types";

// Browser client for Kana's persistent voice library (server SQLite +
// data/voices). Each voice is a reference WAV the local engine reads directly.

export type LibraryVoice = {
  id: string;
  name: string;
  /** "model": the engine's own voice; "bundled": Kana's reference; "reference": user-added. */
  kind: "model" | "bundled" | "reference";
  isDefault: boolean;
};

export type VoiceLibrarySnapshot = {
  voices: LibraryVoice[];
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

export type UploadedVoice = { voice: LibraryVoice };

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
