import { cancelTtsRequest } from "@/lib/server/tts-provider/active-requests";
import {
  TtsProviderError,
} from "@/lib/server/tts-provider";
import { NO_STORE, withSession } from "@/lib/server/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Abort the active relay request and notify its original provider when supported.
// Cancellation never reads the newly selected provider or starts a service.
const UPSTREAM_TIMEOUT_MS = 10_000;

export const POST = withSession(async (
  request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> => {
  const { requestId } = await context.params;
  try {
    const cancelled = await cancelTtsRequest(requestId, AbortSignal.any([
      request.signal,
      AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    ]));
    return Response.json({
      request_id: requestId,
      cancelled,
      ...(!cancelled ? { detail: "No active provider request was found." } : {}),
    }, { headers: NO_STORE });
  } catch (error) {
    return Response.json(
      {
        request_id: requestId,
        cancelled: false,
        detail:
          error instanceof Error ? error.message : "Cancel relay failed.",
      },
      { status: error instanceof TtsProviderError ? error.status : 502, headers: NO_STORE },
    );
  }
});
