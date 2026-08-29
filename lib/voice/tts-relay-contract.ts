import type { TtsProviderDescriptor, VoiceProviderStatus } from "./types";

export type TtsProviderInspection = {
  provider: TtsProviderDescriptor;
  status: VoiceProviderStatus;
};

export function ttsRelayUrl(pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `/api/voice/tts${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function inspectConfiguredTtsProvider(
  timeoutMs = 5_000,
): Promise<TtsProviderInspection> {
  try {
    const response = await fetch(ttsRelayUrl("/provider"), {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const message = isRecord(value) && typeof value.error === "string"
        ? value.error
        : `TTS provider check returned HTTP ${response.status}.`;
      throw new Error(message);
    }
    if (!isRecord(value) || !isRecord(value.provider) || !isRecord(value.status)) {
      throw new Error("Kana returned an incompatible TTS provider status.");
    }
    return value as TtsProviderInspection;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Could not inspect the configured TTS provider.");
  }
}
