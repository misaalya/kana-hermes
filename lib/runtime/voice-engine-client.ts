import type { TtsProviderDescriptor } from "@/lib/voice/types";

// Browser client for the local voice engine install relay. The server owns
// downloads and file locations; the browser only sees progress and sizes.

export type VoiceEngineInstall = {
  state: "unsupported" | "not_installed" | "installing" | "ready" | "failed";
  engineInstalled: boolean;
  modelInstalled: boolean;
  modelSource: "download" | "huggingface-cache" | "config" | null;
  step: "engine" | "assets" | "model" | null;
  phase: "downloading" | "verifying" | "extracting" | null;
  completedBytes: number;
  totalBytes: number;
  downloadBytes: number;
  requiredDiskBytes: number;
  freeDiskBytes: number | null;
  /** Unfinished downloads that Remove can reclaim. */
  partialDownloadBytes: number;
  int8: boolean;
  message: string;
};

export type VoiceEngineSnapshot = {
  provider?: TtsProviderDescriptor;
  /** Null when the configured provider runs outside Kana. */
  install: VoiceEngineInstall | null;
};

async function parse(response: Response): Promise<VoiceEngineSnapshot> {
  const value = (await response.json().catch(() => ({}))) as VoiceEngineSnapshot & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `Voice engine request returned HTTP ${response.status}.`);
  return value;
}

export function inspectVoiceEngine(): Promise<VoiceEngineSnapshot> {
  return fetch("/api/voice/tts/engine", {
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
  }).then(parse);
}

export function controlVoiceEngine(action: "install" | "cancel" | "remove"): Promise<VoiceEngineSnapshot> {
  return fetch("/api/voice/tts/engine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action }),
  }).then(parse);
}
