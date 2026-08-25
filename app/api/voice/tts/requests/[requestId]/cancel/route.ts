import {
  inspectLocalQwen3TtsRuntime,
} from "@/lib/server/local-qwen3-tts-runtime";
import { requireSession, ttsServiceUrl } from "@/lib/server/tts-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relay POST /v1/requests/{id}/cancel so a browser stop() reaches the Python
// CancelRegistry. Probe-only: cancelling must never spawn a service; when no
// service is running there is simply nothing to cancel.
const UPSTREAM_TIMEOUT_MS = 10_000;

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  const { requestId } = await context.params;
  const status = await inspectLocalQwen3TtsRuntime();
  if (status.state !== "running" && status.state !== "external") {
    return Response.json({
      request_id: requestId,
      cancelled: false,
      detail: "The Qwen3-TTS service is not running; nothing to cancel.",
    });
  }
  try {
    // The browser disconnecting must also tear down this forward, and the
    // cancel call itself may not hang longer than the timeout below.
    const upstream = await fetch(
      ttsServiceUrl(status.port, `/v1/requests/${encodeURIComponent(requestId)}/cancel`),
      {
        method: "POST",
        headers: { Accept: "application/json" },
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        ]),
        cache: "no-store",
      },
    );
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      {
        request_id: requestId,
        cancelled: false,
        detail:
          error instanceof Error ? error.message : "Cancel relay failed.",
      },
      { status: 502 },
    );
  }
}
