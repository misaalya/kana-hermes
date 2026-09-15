import { randomUUID } from "node:crypto";
import {
  deleteVoiceClone,
  getVoiceClone,
  createVoiceClone,
  saveVoiceReferenceFile,
} from "@/lib/server/voice-store";
import { NO_STORE, withSession } from "@/lib/server/api-response";
import {
  isWavReference,
  listLibraryVoices,
} from "@/lib/server/voice-library";
import { getConfiguredTtsProvider } from "@/lib/server/tts-provider";
import { MAX_VOICE_REFERENCE_BYTES, MAX_VOICE_REQUEST_BYTES } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_VOICE_NAME_LENGTH = 80;

// Responses carry stable `code` / `pending` values; the browser localizes them.
function voiceError(status: number, code: string, error: string): Response {
  return Response.json({ error, code }, { status, headers: NO_STORE });
}

function providerWithoutLibrary(): Response | null {
  const provider = getConfiguredTtsProvider();
  if (provider.descriptor.capabilities.voiceLibrary) return null;
  return voiceError(
    409,
    "provider_without_library",
    `${provider.descriptor.name} uses the voice configured in config.json.`,
  );
}

/**
 * GET /api/kana/voices — the persistent voice library (SQLite + data/voices).
 * Voices are reference WAVs read by the local engine per utterance, so every
 * entry is immediately usable; nothing here waits on or starts the engine.
 */
export const GET = withSession(async () => {
  const provider = getConfiguredTtsProvider();
  if (!provider.descriptor.capabilities.voiceLibrary) {
    const providerStatus = await provider.inspect();
    return Response.json(
      { voices: [], provider: provider.descriptor, providerStatus, supportsVoiceLibrary: false },
      { headers: NO_STORE },
    );
  }
  return Response.json(
    { voices: listLibraryVoices(), provider: provider.descriptor, supportsVoiceLibrary: true },
    { headers: NO_STORE },
  );
});

/** POST /api/kana/voices — store a consented reference WAV as a new voice. */
export const POST = withSession(async (request) => {
  const unsupported = providerWithoutLibrary();
  if (unsupported) return unsupported;

  // Reject before buffering: Next truncates oversized bodies instead of failing.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_VOICE_REQUEST_BYTES) {
    return voiceError(413, "voice_too_large", "Reference audio is too large.");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return voiceError(400, "invalid_form", "Multipart form data is required.");
  }
  const name = String(form.get("name") ?? "").trim();
  const audio = form.get("audio");
  const consent = form.get("consent") === "1" || form.get("consent") === "true";
  if (!name || name.length > MAX_VOICE_NAME_LENGTH) {
    return voiceError(400, "name_required", `A voice name (1–${MAX_VOICE_NAME_LENGTH} chars) is required.`);
  }
  if (!(audio instanceof File) || audio.size === 0) {
    return voiceError(400, "audio_required", "A reference audio file is required.");
  }
  if (audio.size > MAX_VOICE_REFERENCE_BYTES) {
    return voiceError(413, "voice_too_large", "Reference audio is too large.");
  }
  if (!consent) {
    return voiceError(400, "consent_required", "Consent confirmation is required to clone a voice.");
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (!isWavReference(bytes)) {
    return voiceError(400, "audio_not_wav", "Reference audio must be a WAV file.");
  }
  const id = `kc-${randomUUID()}`;
  const filePath = saveVoiceReferenceFile(id, "wav", bytes);
  createVoiceClone({ id, name, filePath });
  return Response.json(
    { voice: { id, name, kind: "reference", isDefault: false } },
    { headers: NO_STORE },
  );
});

/** DELETE /api/kana/voices?id=… — remove a library entry (default is protected). */
export const DELETE = withSession(async (request) => {
  const unsupported = providerWithoutLibrary();
  if (unsupported) return unsupported;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return voiceError(400, "id_required", "Missing voice id.");
  const row = getVoiceClone(id);
  if (!row) return voiceError(404, "not_found", "Voice not found.");
  if (row.is_default === 1) {
    return voiceError(403, "default_voice_protected", "The bundled voice cannot be removed.");
  }
  deleteVoiceClone(id);
  return Response.json({ ok: true }, { headers: NO_STORE });
});
