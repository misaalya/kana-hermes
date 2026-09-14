import { NO_STORE, withSession } from "@/lib/server/api-response";
import { inspectLocalQwen3TtsRuntime } from "@/lib/server/local-qwen3-tts-runtime";
import { getConfiguredTtsProvider } from "@/lib/server/tts-provider";
import { providerConflict, relayUpstream, ttsServiceUrl } from "@/lib/server/tts-relay";
import {
  QWEN3_TTS_API_VERSION,
  QWEN3_TTS_SERVICE_NAME,
} from "@/lib/voice/qwen3-tts-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relay GET /v1/health as a PROBE ONLY: this route never spawns the Python
// service, so polling it cannot trigger a cold start against short client
// timeouts. When no service answers, an explicit relay envelope tells the
// browser whether the runtime is stopped or loading its model.
const UPSTREAM_TIMEOUT_MS = 5_000;

function relayNotice(relayStatus: "stopped" | "loading", message?: string): Response {
  return Response.json(
    {
      service: QWEN3_TTS_SERVICE_NAME,
      api_version: QWEN3_TTS_API_VERSION,
      relay_status: relayStatus,
      ...(message ? { message } : {}),
    },
    { headers: NO_STORE },
  );
}

export const GET = withSession(async () => {
  const provider = getConfiguredTtsProvider();
  if (provider.descriptor.type !== "qwen3-local") {
    return providerConflict("This Qwen3-TTS health endpoint is unavailable for the configured provider.");
  }
  const status = await inspectLocalQwen3TtsRuntime();
  if (status.state === "running" || status.state === "external") {
    return relayUpstream(ttsServiceUrl(status.port, "/v1/health"), {
      headers: { Accept: "application/json" },
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      failure: "Health check failed",
    });
  }
  return relayNotice(status.state === "starting" ? "loading" : "stopped", status.message);
});
