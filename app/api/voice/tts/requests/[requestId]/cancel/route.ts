import {
  getConfiguredTtsProvider,
  TtsProviderError,
} from "@/lib/server/tts-provider";
import { requireSession } from "@/lib/server/tts-relay";

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
  const provider = getConfiguredTtsProvider();
  if (!provider.cancel) {
    return Response.json({
      request_id: requestId,
      cancelled: true,
      detail: "The synthesis HTTP request was cancelled; this provider has no separate cancel endpoint.",
    });
  }
  try {
    const cancelled = await provider.cancel(requestId, AbortSignal.any([
      request.signal,
      AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    ]));
    return Response.json({
      request_id: requestId,
      cancelled,
      ...(!cancelled ? { detail: "No active provider request was found." } : {}),
    });
  } catch (error) {
    return Response.json(
      {
        request_id: requestId,
        cancelled: false,
        detail:
          error instanceof Error ? error.message : "Cancel relay failed.",
      },
      { status: error instanceof TtsProviderError ? error.status : 502 },
    );
  }
}
