import { randomUUID } from "node:crypto";
import {
  deleteVoiceClone,
  getVoiceClone,
  createVoiceClone,
  saveVoiceReferenceFile,
} from "@/lib/server/voice-store";
import { getQwen3TtsServiceReadiness } from "@/lib/server/local-qwen3-tts-runtime";
import { NO_STORE, withSession } from "@/lib/server/api-response";
import {
  DEFAULT_VOICE_NAME,
  ensureDefaultVoice,
  listLibraryVoices,
  registerVoiceClone,
} from "@/lib/server/voice-library";
import { getConfiguredTtsProvider } from "@/lib/server/tts-provider";
import { MAX_VOICE_REFERENCE_BYTES, MAX_VOICE_REQUEST_BYTES } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_VOICE_NAME_LENGTH = 80;
const SERVICE_DELETE_TIMEOUT_MS = 15_000;

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
 * GET /api/kana/voices — persistent voice library (SQLite + data/voices)
 * plus current engine readiness. Default-voice registration is kicked off
 * fire-and-forget and throttled server-side; this never blocks on spawn.
 */
export const GET = withSession(async () => {
  const provider = getConfiguredTtsProvider();
  if (!provider.descriptor.capabilities.voiceLibrary) {
    const providerStatus = await provider.inspect();
    return Response.json(
      {
        voices: [],
        engine: { state: providerStatus.state },
        provider: provider.descriptor,
        providerStatus,
        supportsVoiceLibrary: false,
      },
      { headers: NO_STORE },
    );
  }
  void ensureDefaultVoice().catch(() => undefined);
  const readiness = await getQwen3TtsServiceReadiness();
  return Response.json(
    {
      voices: listLibraryVoices(),
      engine: readiness.ready ? { state: "ready" } : { state: readiness.reason },
      provider: provider.descriptor,
      supportsVoiceLibrary: true,
    },
    { headers: NO_STORE },
  );
});

/**
 * POST /api/kana/voices — persist the reference audio first (it always
 * survives), then register with the service only when it is already READY.
 * This endpoint never waits for a spawn/model-load.
 */
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

  const id = `kc-${randomUUID()}`;
  const extension = audio.name.includes(".") ? audio.name.split(".").pop() ?? "bin" : "bin";
  const bytes = new Uint8Array(await audio.arrayBuffer());
  const filePath = saveVoiceReferenceFile(id, extension, bytes);
  const row = createVoiceClone({ id, name, filePath });

  const serviceVoiceId = await registerVoiceClone(row);
  const updated = getVoiceClone(id);
  if (!serviceVoiceId || !updated?.service_voice_id) {
    const readiness = await getQwen3TtsServiceReadiness();
    return Response.json(
      {
        voice: { id: row.id, name: row.name, registered: false, serviceVoiceId: null, isDefault: false },
        pending: readiness.ready ? "registration_failed" : readiness.reason,
      },
      { status: 202, headers: NO_STORE },
    );
  }
  return Response.json(
    { voice: { id, name, registered: true, serviceVoiceId: updated.service_voice_id, isDefault: false } },
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
  if (row.is_default === 1 || row.name === DEFAULT_VOICE_NAME) {
    return voiceError(403, "default_voice_protected", "The bundled voice cannot be removed.");
  }
  deleteVoiceClone(id);
  if (row.service_voice_id) {
    try {
      const readiness = await getQwen3TtsServiceReadiness();
      if (readiness.ready) {
        await fetch(`http://127.0.0.1:${readiness.port}/v1/voices/${encodeURIComponent(row.service_voice_id)}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(SERVICE_DELETE_TIMEOUT_MS),
        });
      }
    } catch {
      // Best-effort; the service-side profile may already be gone.
    }
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
});
