import { listTurnActivities, saveTurnActivities } from "@/lib/server/activity-store";
import { isAuthEnabled } from "@/lib/server/auth/password-store";
import { isSessionValid } from "@/lib/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function requestAuthorized(request: Request): Promise<boolean> {
  return !isAuthEnabled() || (await isSessionValid(request));
}

function parseKey(value: unknown): string | null {
  const key = typeof value === "string" ? value.trim() : "";
  // Hermes durable session keys: date_time_hex, e.g. 20260824_052417_fe475b.
  return /^\d{8}_\d{6}_[0-9a-f]{4,16}$/.test(key) ? key : null;
}

/**
 * GET /api/kana/activities?session=<hermes_session_key>
 * Returns every stored per-turn activity log for the session, oldest first:
 * [{ turn_anchor_ms, activities }, ...]
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await requestAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const url = new URL(request.url);
  const sessionKey = parseKey(url.searchParams.get("session"));
  if (!sessionKey) {
    return Response.json({ error: "Invalid or missing session" }, { status: 400, headers: NO_STORE });
  }
  const turns = listTurnActivities(sessionKey).map(({ turn_anchor_ms, activities }) => ({
    turnAnchorMs: turn_anchor_ms,
    activities,
  }));
  return Response.json({ turns }, { headers: NO_STORE });
}

/**
 * PUT /api/kana/activities
 * Body: { session: "<key>", turnAnchorMs: <number>, activities: [...] }
 * Upserts one turn's activity snapshot. Idempotent per (session, anchor).
 */
export async function PUT(request: Request): Promise<Response> {
  if (!(await requestAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  let body: {
    session?: unknown;
    turnAnchorMs?: unknown;
    activities?: unknown;
  };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return Response.json({ error: "Request body is too large." }, { status: 413, headers: NO_STORE });
    }
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400, headers: NO_STORE });
  }
  const sessionKey = parseKey(body.session);
  const anchor = Number(body.turnAnchorMs);
  if (!sessionKey || !Number.isFinite(anchor) || anchor <= 0) {
    return Response.json(
      { error: "Fields 'session' (valid key) and 'turnAnchorMs' (positive number) are required." },
      { status: 400, headers: NO_STORE },
    );
  }
  if (!Array.isArray(body.activities)) {
    return Response.json({ error: "Field 'activities' must be an array." }, { status: 400, headers: NO_STORE });
  }
  saveTurnActivities(sessionKey, anchor, body.activities);
  return Response.json({ ok: true }, { headers: NO_STORE });
}
