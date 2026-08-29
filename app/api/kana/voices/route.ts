import {
  deleteVoiceClone,
  getVoiceClone,
  createVoiceClone,
  saveVoiceReferenceFile,
} from "@/lib/server/voice-store";
import { getQwen3TtsServiceReadiness } from "@/lib/server/local-qwen3-tts-runtime";
import { isAuthEnabled } from "@/lib/server/auth/password-store";
import { isSessionValid } from "@/lib/server/auth/session";
import {
  DEFAULT_VOICE_NAME,
  ensureDefaultVoice,
  listLibraryVoices,
  registerVoiceClone,
} from "@/lib/server/voice-library";
import { getConfiguredTtsProvider } from "@/lib/server/tts-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

async function requestAuthorized(request: Request): Promise<boolean> {
  return !isAuthEnabled() || (await isSessionValid(request));
}

const PENDING_REASON_MESSAGE: Record<string, string> = {
  loading: "Mesin suara sedang menyiapkan model — suara akan terdaftar otomatis begitu siap.",
  stopped: "Mesin suara belum menyala — suara akan terdaftar otomatis saat pertama dibutuhkan.",
  error: "Mesin suara gagal dimuat. Perbaiki lewat Pengaturan → mesin suara, lalu tekan Refresh.",
};

/**
 * GET /api/kana/voices — persistent voice library (SQLite + data/voices)
 * plus current engine readiness. Default-voice registration is kicked off
 * fire-and-forget and throttled server-side; this never blocks on spawn.
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await requestAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
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
}

/**
 * POST /api/kana/voices — persist the reference audio first (it always
 * survives), then register with the service only when it is already READY.
 * This endpoint never waits for a spawn/model-load.
 */
export async function POST(request: Request): Promise<Response> {
  if (!(await requestAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const provider = getConfiguredTtsProvider();
  if (!provider.descriptor.capabilities.voiceLibrary) {
    return Response.json(
      { error: `${provider.descriptor.name} uses the voice configured in config.json.` },
      { status: 409, headers: NO_STORE },
    );
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Multipart form data is required." }, { status: 400, headers: NO_STORE });
  }
  const name = String(form.get("name") ?? "").trim();
  const audio = form.get("audio");
  const consent = form.get("consent") === "1" || form.get("consent") === "true";
  if (!name || name.length > 80) {
    return Response.json({ error: "A voice name (1–80 chars) is required." }, { status: 400, headers: NO_STORE });
  }
  if (!(audio instanceof File) || audio.size === 0) {
    return Response.json({ error: "A reference audio file is required." }, { status: 400, headers: NO_STORE });
  }
  if (audio.size > MAX_REFERENCE_BYTES) {
    return Response.json({ error: "Reference audio must be 20 MB or smaller." }, { status: 400, headers: NO_STORE });
  }
  if (!consent) {
    return Response.json(
      { error: "Consent confirmation is required to clone a voice." },
      { status: 400, headers: NO_STORE },
    );
  }

  const id = `kc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const extension = audio.name.includes(".") ? audio.name.split(".").pop() ?? "bin" : "bin";
  const bytes = new Uint8Array(await audio.arrayBuffer());
  const filePath = saveVoiceReferenceFile(id, extension, bytes);
  const row = createVoiceClone({ id, name, filePath });

  const serviceVoiceId = await registerVoiceClone(row);
  const updated = getVoiceClone(id);
  if (!serviceVoiceId || !updated?.service_voice_id) {
    const readiness = await getQwen3TtsServiceReadiness();
    const warning = readiness.ready
      ? "Pendaftaran ke mesin suara gagal. Coba Refresh nanti."
      : PENDING_REASON_MESSAGE[readiness.reason];
    return Response.json(
      {
        voice: { id: row.id, name: row.name, registered: false, serviceVoiceId: null, isDefault: false },
        warning,
      },
      { status: 202, headers: NO_STORE },
    );
  }
  return Response.json(
    {
      voice: { id, name, registered: true, serviceVoiceId: updated.service_voice_id, isDefault: false },
    },
    { headers: NO_STORE },
  );
}

/** DELETE /api/kana/voices?id=… — remove a library entry (default is protected). */
export async function DELETE(request: Request): Promise<Response> {
  if (!(await requestAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const provider = getConfiguredTtsProvider();
  if (!provider.descriptor.capabilities.voiceLibrary) {
    return Response.json(
      { error: `${provider.descriptor.name} has no Kana-managed voice library.` },
      { status: 409, headers: NO_STORE },
    );
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing voice id." }, { status: 400, headers: NO_STORE });
  const row = getVoiceClone(id);
  if (!row) return Response.json({ error: "Voice not found." }, { status: 404, headers: NO_STORE });
  if (row.is_default === 1 || row.name === DEFAULT_VOICE_NAME) {
    return Response.json({ error: "Suara bawaan tidak bisa dihapus." }, { status: 403, headers: NO_STORE });
  }
  deleteVoiceClone(id);
  if (row.service_voice_id) {
    try {
      const readiness = await getQwen3TtsServiceReadiness();
      if (readiness.ready) {
        await fetch(`http://127.0.0.1:${readiness.port}/v1/voices/${encodeURIComponent(row.service_voice_id)}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(15_000),
        });
      }
    } catch {
      // Best-effort; the service-side profile may already be gone.
    }
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
}
