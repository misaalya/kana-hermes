import { subscribeHermesEvents, ensureHermesConnection } from "@/lib/server/hermes-bridge";
import { isAuthEnabled } from "@/lib/server/auth/password-store";
import { isSessionValid } from "@/lib/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-sent events stream of Hermes gateway events. The browser subscribes
// with its Kana session cookie; the shared server->Hermes WebSocket lives in
// the bridge. SSE (not WS) is enough here: every client->Hermes message goes
// through POST /api/hermes/rpc, so the downstream channel is one-way.

const HEARTBEAT_MS = 25_000;

export async function GET(request: Request): Promise<Response> {
  if (isAuthEnabled() && !(await isSessionValid(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      send("open", { ok: true });

      try {
        await ensureHermesConnection();
        send("gateway", { connected: true });
      } catch (error) {
        send("gateway", {
          connected: false,
          message: error instanceof Error ? error.message : "Hermes gateway is unreachable.",
        });
      }

      unsubscribe = subscribeHermesEvents((params) =>
        // The bridge fan-out delivers the raw gateway event params
        // ({type, session_id, payload}). Wrap it back into the JSON-RPC
        // "event" frame shape the browser client expects (frame.method ===
        // "event", frame.params) so handleFrame routes it correctly.
        send("hermes", { jsonrpc: "2.0", method: "event", params }),
      );

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      request.signal.addEventListener("abort", () => {
        closed = true;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
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
