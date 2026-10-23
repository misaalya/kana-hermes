import { NO_STORE, withSession } from "@/lib/server/api-response";
import { readJsonObject, RequestBodyError } from "@/lib/server/request-body";
import {
  loadVoicePreview,
  VoicePreviewNotFoundError,
} from "@/lib/server/voice-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
const MAX_VOICE_ID_LENGTH = 200;

function errorResponse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

/**
 * POST /api/kana/voices/preview — the sample for one library voice. Kana and
 * user-added voices return their reference WAV as-is; the model voice returns
 * the prepared generation. Playing a preview never starts the voice engine.
 */
export const POST = withSession(async (request) => {
  try {
    const value = await readJsonObject(request, MAX_BODY_BYTES);
    const id = typeof value.id === "string" ? value.id : "";
    if (!id || id.length > MAX_VOICE_ID_LENGTH) {
      return errorResponse(400, "A voice id is required.");
    }
    const audio = new Uint8Array(loadVoicePreview(id));
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(audio.byteLength),
        ...NO_STORE,
      },
    });
  } catch (error) {
    if (error instanceof VoicePreviewNotFoundError) {
      return errorResponse(error.status, error.message);
    }
    if (error instanceof RequestBodyError) {
      return errorResponse(error.status, error.message);
    }
    return errorResponse(500, "The voice preview could not be read.");
  }
});
