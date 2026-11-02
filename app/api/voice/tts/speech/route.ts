import { NO_STORE, withSession } from "@/lib/server/api-response";
import { trackTtsRequest } from "@/lib/server/tts-provider/active-requests";
import { readJsonObject, RequestBodyError } from "@/lib/server/request-body";
import {
  getConfiguredTtsProvider,
  TtsProviderError,
} from "@/lib/server/tts-provider";
import {
  boundedAudioResult,
  MAX_TTS_TEXT_CHARACTERS,
  type ServerTtsProvider,
  type TtsAudioResult,
} from "@/lib/server/tts-provider/types";
import { EMOTIONS, type Emotion } from "@/lib/presentation/types";
import { readKanaUserConfig } from "@/lib/server/user-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_SECONDS = 900;
const MAX_LANGUAGE_LENGTH = 32;
const MAX_VOICE_ID_LENGTH = 500;
/** Short enough for a tunnel's header deadline, long enough to keep fast failures as HTTP errors. */
const EARLY_HEAD_GRACE_MS = 250;
const WAV_REPAIR_HEADER = "X-Kana-Wav-Repair";

function parseEmotion(value: unknown): Emotion | undefined {
  return typeof value === "string" && (EMOTIONS as readonly string[]).includes(value)
    ? value as Emotion
    : undefined;
}

function safeRequestId(value: string | null): string | undefined {
  if (!value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    return undefined;
  }
  return value;
}

/**
 * Keep the request cancellable until the last audio byte is delivered: the
 * tracker is released when the stream finishes or the browser cancels it,
 * not when the response headers are sent.
 */
function releaseWhenDelivered(
  body: ReadableStream<Uint8Array> | ArrayBuffer,
  finish: () => void,
): ReadableStream<Uint8Array> | ArrayBuffer {
  if (body instanceof ArrayBuffer) {
    finish();
    return body;
  }
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

function errorResponse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

/** Resolves to null when the promise is still running after the grace period. */
function settlesWithin<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Answer immediately with the provider's WAV head, then deliver the speech.
 * Node (and therefore the tunnel in front of it) only sends response headers
 * with the first body byte, so a slow engine that answers nothing for its
 * whole run trips a proxy's header deadline. The browser repairs the RIFF and
 * data sizes once the body has fully arrived.
 */
function streamPendingSpeech(
  pending: Promise<TtsAudioResult>,
  early: NonNullable<ServerTtsProvider["earlyWavHead"]>,
  finish: () => void,
): ReadableStream<Uint8Array> {
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(early.head);
        const audio = await boundedAudioResult(await pending);
        if (audio.body instanceof ArrayBuffer) {
          if (!cancelled) {
            const bytes = new Uint8Array(audio.body).subarray(early.stripBytes);
            if (bytes.byteLength > 0) controller.enqueue(bytes);
            controller.close();
          }
        } else {
          const reader = audio.body.getReader();
          let skipped = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (cancelled) {
              await reader.cancel("The browser stopped the voice.").catch(() => undefined);
              break;
            }
            let chunk = value;
            if (skipped < early.stripBytes) {
              const remove = Math.min(early.stripBytes - skipped, chunk.byteLength);
              skipped += remove;
              chunk = chunk.subarray(remove);
              if (chunk.byteLength === 0) continue;
            }
            controller.enqueue(chunk);
          }
          if (!cancelled) controller.close();
        }
      } catch (error) {
        console.error(
          `[kana] Voice synthesis failed after the audio response started: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (!cancelled) controller.error(error);
      } finally {
        finish();
      }
    },
    cancel() {
      cancelled = true;
      finish();
    },
  });
}

// Stable browser boundary: JSON in, raw audio bytes out. The selected
// server-side provider owns synthesis and credentials; playback never needs
// to know whether the bytes came from the local engine or a remote compatible API.
export const POST = withSession(async (request) => {
  let tracked: ReturnType<typeof trackTtsRequest> | undefined;
  let delivering = false;
  try {
    const value = await readJsonObject(request, MAX_BODY_BYTES);
    if (typeof value.text !== "string" || !value.text.trim()) {
      return errorResponse(400, "Speech text is required.");
    }
    if (value.text.length > MAX_TTS_TEXT_CHARACTERS) {
      return errorResponse(413, `Speech text must be ${MAX_TTS_TEXT_CHARACTERS} characters or fewer.`);
    }
    const config = readKanaUserConfig().tts;
    const provider = getConfiguredTtsProvider(config);
    const requestId = safeRequestId(request.headers.get("X-Kana-Request-Id"));
    tracked = trackTtsRequest(requestId, provider);
    const synthesis = provider.synthesize({
      text: value.text,
      language:
        typeof value.language === "string" && value.language.length <= MAX_LANGUAGE_LENGTH
          ? value.language
          : "ja",
      voiceId:
        typeof value.voice_id === "string" && value.voice_id.length <= MAX_VOICE_ID_LENGTH
          ? value.voice_id
          : undefined,
      emotion: parseEmotion(value.emotion),
      requestId,
    }, AbortSignal.any([
      request.signal,
      tracked.signal,
      AbortSignal.timeout((config?.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000),
    ]));
    const early = provider.earlyWavHead;
    if (early) {
      // Keep a fast "not installed" or platform refusal as its real HTTP
      // status; only a still-running engine gets the early head.
      const generated = await settlesWithin(synthesis, EARLY_HEAD_GRACE_MS);
      if (!generated) {
        const response = new Response(streamPendingSpeech(synthesis, early, tracked.finish), {
          headers: {
            "Content-Type": "audio/wav",
            [WAV_REPAIR_HEADER]: "1",
            ...NO_STORE,
          },
        });
        delivering = true;
        return response;
      }
      const audio = await boundedAudioResult(generated);
      const response = new Response(releaseWhenDelivered(audio.body, tracked.finish), {
        headers: {
          "Content-Type": audio.contentType,
          ...(audio.contentLength ? { "Content-Length": audio.contentLength } : {}),
          ...NO_STORE,
        },
      });
      delivering = true;
      return response;
    }
    const generated = await synthesis;
    const audio = await boundedAudioResult(generated);
    delivering = true;
    return new Response(releaseWhenDelivered(audio.body, tracked.finish), {
      headers: {
        "Content-Type": audio.contentType,
        ...(audio.contentLength ? { "Content-Length": audio.contentLength } : {}),
        ...NO_STORE,
      },
    });
  } catch (error) {
    if (error instanceof TtsProviderError || error instanceof RequestBodyError) {
      return errorResponse(error.status, error.message);
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return errorResponse(499, "TTS synthesis was cancelled.");
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return errorResponse(504, "TTS synthesis timed out.");
    }
    return errorResponse(
      502,
      error instanceof Error ? `TTS synthesis failed: ${error.message}` : "TTS synthesis failed.",
    );
  } finally {
    if (!delivering) tracked?.finish();
  }
});
