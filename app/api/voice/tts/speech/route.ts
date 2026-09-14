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
} from "@/lib/server/tts-provider/types";
import { EMOTIONS, type Emotion } from "@/lib/presentation/types";
import { readKanaUserConfig } from "@/lib/server/user-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_SECONDS = 900;
const MAX_LANGUAGE_LENGTH = 32;
const MAX_VOICE_ID_LENGTH = 500;

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

// Stable browser boundary: JSON in, raw audio bytes out. The selected
// server-side provider owns synthesis and credentials; playback never needs
// to know whether the bytes came from local Qwen or a remote compatible API.
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
    const generated = await provider.synthesize({
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
