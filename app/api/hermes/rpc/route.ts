import { hermesRpc } from "@/lib/server/hermes-bridge";
import { isAuthEnabled } from "@/lib/server/auth/password-store";
import { isSessionValid } from "@/lib/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Relay a single JSON-RPC request from the browser to the managed Hermes
// gateway. The browser authenticates with its Kana session cookie; the Hermes
// session token stays server-side inside the bridge.
//
// Only the JSON-RPC surface Kana needs is forwarded. Allow-listing methods
// keeps the relay a presentation-layer bridge, not an open pipe to Hermes's
// full control plane.

const ALLOWED_METHODS = new Set([
  "session.create",
  "session.resume",
  "session.close",
  "session.interrupt",
  "session.title",
  "session.branch",
  "session.save",
  "session.status",
  "session.compress",
  "session.steer",
  "prompt.submit",
  "commands.catalog",
  "complete.slash",
  "slash.exec",
  "command.dispatch",
  "approval.respond",
  "clarify.respond",
  "sudo.respond",
  "secret.respond",
  "handoff.request",
  // Applies the Kana persona overlay to the open session (see
  // HermesAgentClient.openSession). Params are hardcoded by the client
  // (key: "personality", value: "kana"); no browser-controlled config path.
  "config.set",
]);

const LONG_RUNNING_METHODS = new Set(["session.compress"]);

const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function requestAuthorized(request: Request): Promise<boolean> {
  return !isAuthEnabled() || (await isSessionValid(request));
}

export async function POST(request: Request): Promise<Response> {
  if (!(await requestAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  let body: { method?: unknown; params?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return Response.json({ error: "Request body is too large." }, { status: 413, headers: NO_STORE });
    }
    body = JSON.parse(raw) as { method?: unknown; params?: unknown };
  } catch {
    return Response.json({ error: "A JSON request body is required." }, { status: 400, headers: NO_STORE });
  }
  const method = body.method;
  if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
    return Response.json({ error: "Unsupported Hermes method." }, { status: 400, headers: NO_STORE });
  }
  const params =
    body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? (body.params as Record<string, unknown>)
      : {};
  const timeoutMs = LONG_RUNNING_METHODS.has(method) ? 180_000 : undefined;
  try {
    const result = await hermesRpc(method, params, timeoutMs);
    return Response.json({ result }, { headers: NO_STORE });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Hermes relay failed." },
      { status: 502, headers: NO_STORE },
    );
  }
}
