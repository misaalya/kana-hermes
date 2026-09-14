import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import {
  ensureQwen3TTSService,
  inspectLocalQwen3TtsRuntime,
  stopLocalQwen3TtsRuntime,
} from "@/lib/server/local-qwen3-tts-runtime";
import { readJsonObject } from "@/lib/server/request-body";
import { getConfiguredTtsProvider } from "@/lib/server/tts-provider";
import { providerConflict, uncontrolledProviderStatus } from "@/lib/server/tts-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Status and manual control for the Qwen3-TTS runtime. GET never blocks on a
// spawn; POST start/restart/stop mirrors the Hermes control route semantics.

const MAX_BODY_BYTES = 1024;

export const GET = withSession(async () => {
  const provider = getConfiguredTtsProvider();
  if (!provider.descriptor.capabilities.runtimeControl) return uncontrolledProviderStatus(provider);
  return Response.json(
    { ...(await inspectLocalQwen3TtsRuntime()), provider: provider.descriptor, controllable: true },
    { headers: NO_STORE },
  );
});

export const POST = withSession(async (request) => {
  try {
    const provider = getConfiguredTtsProvider();
    if (!provider.descriptor.capabilities.runtimeControl) {
      return providerConflict(`${provider.descriptor.name} has no local runtime to control.`);
    }
    const { action } = await readJsonObject(request, MAX_BODY_BYTES);
    if (action === "stop") {
      return Response.json(await stopLocalQwen3TtsRuntime(), { headers: NO_STORE });
    }
    if (action !== "start" && action !== "restart") {
      return Response.json(
        { error: "Action must be start, restart, or stop." },
        { status: 400, headers: NO_STORE },
      );
    }
    if (action === "restart") await stopLocalQwen3TtsRuntime();
    // Single-flight: shares the exact promise used by speech-time ensure and
    // status kicks, so concurrent starts can never spawn two children.
    const result = await ensureQwen3TTSService();
    if (result.ok) return Response.json(result.status, { headers: NO_STORE });
    return Response.json(
      { ...result.status, error: result.status.message },
      { status: 400, headers: NO_STORE },
    );
  } catch (error) {
    return jsonError(error);
  }
});
