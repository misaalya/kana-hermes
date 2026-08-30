import {
  getConfiguredTtsProvider,
  TtsProviderError,
} from "@/lib/server/tts-provider";
import {
  boundedAudioResult,
  MAX_TTS_TEXT_CHARACTERS,
} from "@/lib/server/tts-provider/types";
import { EMOTIONS, type Emotion } from "@/lib/presentation/types";
import { requireSession } from "@/lib/server/tts-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseEmotion(value: unknown): Emotion | undefined {
  return typeof value === "string" && (EMOTIONS as readonly string[]).includes(value)
    ? value as Emotion
    : undefined;
}

// Stable browser boundary: JSON in, raw audio bytes out. The selected
// server-side provider owns synthesis and credentials; playback never needs
// to know whether the bytes came from local Qwen or a remote compatible API.
const UPSTREAM_TIMEOUT_MS = Number(
  process.env.KANA_TTS_RELAY_TIMEOUT_MS ?? "300000",
);

function safeRequestId(value: string | null): string | undefined {
  if (!value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    return undefined;
  }
  return value;
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  try {
    const value = (await request.json()) as Record<string, unknown>;
    if (typeof value.text !== "string" || !value.text.trim()) {
      return Response.json({ error: "Speech text is required." }, { status: 400 });
    }
    if (value.text.length > MAX_TTS_TEXT_CHARACTERS) {
      return Response.json(
        { error: `Speech text must be ${MAX_TTS_TEXT_CHARACTERS} characters or fewer.` },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
    const provider = getConfiguredTtsProvider();
    const generated = await provider.synthesize({
      text: value.text,
      language:
        typeof value.language === "string" && value.language.length <= 32
          ? value.language
          : "ja",
      voiceId:
        typeof value.voice_id === "string" && value.voice_id.length <= 500
          ? value.voice_id
          : undefined,
      emotion: parseEmotion(value.emotion),
      requestId: safeRequestId(request.headers.get("X-Kana-Request-Id")),
    }, AbortSignal.any([
      request.signal,
      AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    ]));
    const audio = await boundedAudioResult(generated);
    return new Response(audio.body, {
      headers: {
        "Content-Type": audio.contentType,
        ...(audio.contentLength ? { "Content-Length": audio.contentLength } : {}),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof TtsProviderError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return Response.json(
        { error: "TTS synthesis was cancelled." },
        { status: 499, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return Response.json(
        { error: "TTS synthesis timed out." },
        { status: 504, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? `TTS synthesis failed: ${error.message}`
            : "TTS synthesis failed.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
