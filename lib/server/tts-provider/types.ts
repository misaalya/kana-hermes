import type { Emotion } from "@/lib/presentation/types";
import type { TtsProviderDescriptor, VoiceProviderStatus } from "@/lib/voice/types";

export type TtsProviderCapabilities = TtsProviderDescriptor["capabilities"];
export type { TtsProviderDescriptor };

export type TtsSynthesisInput = {
  text: string;
  language?: string;
  emotion?: Emotion;
  /** Used only by providers that support a browser-selectable voice library. */
  voiceId?: string;
  /** Lets a local provider cancel expensive work after the HTTP request aborts. */
  requestId?: string;
  /** Future per-request override; current UI uses the configured default. */
  instruction?: string;
};

export type TtsAudioResult = {
  body: ReadableStream<Uint8Array> | ArrayBuffer;
  contentType: string;
  contentLength?: string;
};

export class TtsProviderError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "TtsProviderError";
  }
}

export interface ServerTtsProvider {
  readonly descriptor: TtsProviderDescriptor;
  inspect(): Promise<VoiceProviderStatus>;
  synthesize(
    input: TtsSynthesisInput,
    signal: AbortSignal,
  ): Promise<TtsAudioResult>;
  cancel?(requestId: string, signal: AbortSignal): Promise<boolean>;
}

export function isAudioContentType(value: string): boolean {
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return normalized.startsWith("audio/") || normalized === "application/octet-stream";
}

export async function upstreamErrorMessage(
  response: Response,
  providerName: string,
): Promise<string> {
  let detail = "";
  try {
    const value = (await response.clone().json()) as {
      detail?: unknown;
      error?: unknown;
    };
    if (typeof value.detail === "string") detail = value.detail;
    if (typeof value.error === "string") detail = value.error;
    if (
      typeof value.error === "object" &&
      value.error !== null &&
      "message" in value.error &&
      typeof value.error.message === "string"
    ) {
      detail = value.error.message;
    }
  } catch {
    // Some compatible providers answer with plain text or an HTML proxy page.
  }
  const suffix = detail ? ` ${detail.replaceAll(/\s+/g, " ").slice(0, 500)}` : "";
  return `${providerName} returned HTTP ${response.status}.${suffix}`;
}
