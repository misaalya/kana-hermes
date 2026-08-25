import { inspectLocalQwen3TtsRuntime } from "@/lib/server/local-qwen3-tts-runtime";
import { requireSession, ttsServiceUrl } from "@/lib/server/tts-relay";
import {
  QWEN3_TTS_API_VERSION,
  QWEN3_TTS_SERVICE_NAME,
} from "@/lib/voice/qwen3-tts-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relay GET /v1/health as a PROBE ONLY: this route never spawns the Python
// service, so polling it cannot trigger a 120-second cold start against 5s
// client timeouts. When no service answers, an explicit relay envelope tells
// the browser whether the runtime is stopped or loading its model.
const UPSTREAM_TIMEOUT_MS = 5_000;

function relayNotice(
  relayStatus: "stopped" | "loading",
  message?: string,
): Response {
  return Response.json(
    {
      service: QWEN3_TTS_SERVICE_NAME,
      api_version: QWEN3_TTS_API_VERSION,
      relay_status: relayStatus,
      ...(message ? { message } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  const status = await inspectLocalQwen3TtsRuntime();
  if (status.state === "running" || status.state === "external") {
    try {
      const upstream = await fetch(ttsServiceUrl(status.port, "/v1/health"), {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          "Content-Type":
            upstream.headers.get("Content-Type") ?? "application/json",
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Health check failed." },
        { status: 502 },
      );
    }
  }
  if (status.state === "starting") {
    return relayNotice("loading", status.message);
  }
  return relayNotice("stopped", status.message);
}
