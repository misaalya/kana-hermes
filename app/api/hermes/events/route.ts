import { createHermesEventStream } from "@/lib/server/hermes-event-stream";
import { subscribeHermesEvents, ensureHermesConnection } from "@/lib/server/hermes-bridge";
import { isSessionValid } from "@/lib/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-sent events stream of Hermes gateway events. The browser subscribes
// with its Kana session cookie; the shared server->Hermes WebSocket lives in
// the bridge. SSE (not WS) is enough here: every client->Hermes message goes
// through POST /api/hermes/rpc, so the downstream channel is one-way.

export async function GET(request: Request): Promise<Response> {
  if (!(await isSessionValid(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stream = createHermesEventStream(request.signal, {
    connect: ensureHermesConnection,
    subscribe: subscribeHermesEvents,
    authorized: () => isSessionValid(request),
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
