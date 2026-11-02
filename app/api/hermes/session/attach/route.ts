import { NO_STORE, withSession } from "@/lib/server/api-response";
import { attachCachedHermesSession } from "@/lib/server/hermes-session-registry";
import { rewriteMediaInResult } from "@/lib/server/media-links";
import { readJsonObject } from "@/lib/server/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

/** Hermes durable session keys: date_time_hex, e.g. 20260824_052417_fe475b. */
function parseKey(value: unknown): string | null {
  const key = typeof value === "string" ? value.trim() : "";
  return /^\d{8}_\d{6}_[0-9a-f]{4,16}$/.test(key) ? key : null;
}

// Refresh reattachment: the server serves a live snapshot of a session Hermes
// already opened, so the browser does not resume it again. A miss, a wrapped
// gateway, compression, or any doubt returns attached:false and the client
// falls back to session.resume. The body only names a durable session; it can
// never select a runtime session or another target.
export const POST = withSession(async (request) => {
  let body: { persistentSessionId?: unknown };
  try {
    body = await readJsonObject(request, MAX_BODY_BYTES);
  } catch {
    return Response.json({ attached: false }, { status: 400, headers: NO_STORE });
  }
  const persistentSessionId = parseKey(body.persistentSessionId);
  if (!persistentSessionId) {
    return Response.json({ attached: false }, { status: 400, headers: NO_STORE });
  }
  try {
    const session = attachCachedHermesSession(persistentSessionId);
    if (!session) {
      return Response.json({ attached: false }, { headers: NO_STORE });
    }
    return Response.json(
      { attached: true, session: rewriteMediaInResult(session) },
      { headers: NO_STORE },
    );
  } catch {
    // Any doubt falls back to the browser's real session.resume.
    return Response.json({ attached: false }, { headers: NO_STORE });
  }
});
