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

export type UploadedVoice = { voice: LibraryVoice; warning?: string };

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
  const value = (await response.json()) as UploadedVoice & { error?: string };
  if (!response.ok) throw new Error(value.error || "Voice clone failed.");
  return value;
}

export async function deleteKanaVoice(id: string): Promise<void> {
  const response = await fetch(`/api/kana/voices?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok) {
    const value = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(value?.error || "Could not delete the voice.");
  }
}
