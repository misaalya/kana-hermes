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

export const MAX_TTS_AUDIO_BYTES = 64 * 1024 * 1024;
export const MAX_TTS_TEXT_CHARACTERS = 20_000;
const MAX_TTS_ERROR_BYTES = 32 * 1024;

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

const RESPONSE_FORMAT_CONTENT_TYPE = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
} as const;

export function normalizedAudioContentType(
  value: string,
  expectedFormat?: keyof typeof RESPONSE_FORMAT_CONTENT_TYPE,
): string | null {
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("audio/")) return normalized;
  if (
    expectedFormat &&
    (normalized === "application/octet-stream" ||
      (expectedFormat === "opus" && normalized === "application/ogg"))
  ) {
    return RESPONSE_FORMAT_CONTENT_TYPE[expectedFormat];
  }
  return null;
}

function checkedContentLength(value?: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new TtsProviderError("The voice provider returned an invalid audio length.");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new TtsProviderError("The voice provider returned an empty or invalid audio body.");
  }
  if (length > MAX_TTS_AUDIO_BYTES) {
    throw new TtsProviderError(
      `The voice provider returned more than ${MAX_TTS_AUDIO_BYTES / 1024 / 1024} MB of audio.`,
      413,
    );
  }
  return length;
}

/**
 * Bound every provider response before it reaches browser memory. Known-size
 * responses fail before streaming; chunked responses are counted while they
 * flow and cancellation is propagated to the upstream reader.
 */
export async function boundedAudioResult(
  audio: TtsAudioResult,
): Promise<TtsAudioResult> {
  const declaredLength = checkedContentLength(audio.contentLength);
  if (audio.body instanceof ArrayBuffer) {
    const length = audio.body.byteLength;
    if (length <= 0) {
      throw new TtsProviderError("The voice provider returned an empty audio body.");
    }
    if (length > MAX_TTS_AUDIO_BYTES) {
      throw new TtsProviderError(
        `The voice provider returned more than ${MAX_TTS_AUDIO_BYTES / 1024 / 1024} MB of audio.`,
        413,
      );
    }
    if (declaredLength !== undefined && declaredLength !== length) {
      throw new TtsProviderError("The voice provider returned an inconsistent audio length.");
    }
    return { ...audio, contentLength: String(length) };
  }

  const reader = audio.body.getReader();
  let received = 0;
  const first = await reader.read();
  if (first.done || !first.value || first.value.byteLength === 0) {
    await reader.cancel("empty audio response").catch(() => undefined);
    throw new TtsProviderError("The voice provider returned an empty audio body.");
  }
  received = first.value.byteLength;
  if (received > MAX_TTS_AUDIO_BYTES) {
    await reader.cancel("audio response exceeded the limit").catch(() => undefined);
    throw new TtsProviderError(
      `The voice provider returned more than ${MAX_TTS_AUDIO_BYTES / 1024 / 1024} MB of audio.`,
      413,
    );
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first.value);
    },
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          if (declaredLength !== undefined && declaredLength !== received) {
            controller.error(new Error("The voice provider returned a truncated audio body."));
          } else {
            controller.close();
          }
          return;
        }
        received += next.value.byteLength;
        if (received > MAX_TTS_AUDIO_BYTES) {
          await reader.cancel("audio response exceeded the limit").catch(() => undefined);
          controller.error(new Error("The voice provider audio response exceeded Kana's limit."));
          return;
        }
        controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return {
    ...audio,
    body,
    contentLength: declaredLength === undefined ? undefined : String(declaredLength),
  };
}

export async function upstreamErrorMessage(
  response: Response,
  providerName: string,
): Promise<string> {
  let detail = "";
  try {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_TTS_ERROR_BYTES) {
      await response.body?.cancel("provider error response exceeded Kana's limit");
      return `${providerName} returned HTTP ${response.status}.`;
    }
    const reader = response.body?.getReader();
    if (!reader) return `${providerName} returned HTTP ${response.status}.`;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total <= MAX_TTS_ERROR_BYTES) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = MAX_TTS_ERROR_BYTES - total;
      if (next.value.byteLength > remaining) {
        if (remaining > 0) chunks.push(next.value.subarray(0, remaining));
        total = MAX_TTS_ERROR_BYTES + 1;
        await reader.cancel("provider error response exceeded Kana's limit");
        break;
      }
      chunks.push(next.value);
      total += next.value.byteLength;
    }
    if (total > MAX_TTS_ERROR_BYTES) {
      return `${providerName} returned HTTP ${response.status}.`;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(new TextDecoder().decode(bytes)) as {
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
    // Some compatible providers answer with plain text, HTML, or malformed
    // JSON. Do not reflect that untrusted body into Kana's UI or logs.
  }
  const suffix = detail ? ` ${detail.replaceAll(/\s+/g, " ").slice(0, 500)}` : "";
  return `${providerName} returned HTTP ${response.status}.${suffix}`;
}
