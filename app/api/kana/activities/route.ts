import { readJsonObject, RequestBodyError } from "@/lib/server/request-body";
import { listTurnActivities, saveTurnActivities } from "@/lib/server/activity-store";
import { isSessionValid } from "@/lib/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function requestAuthorized(request: Request): Promise<boolean> {
  return isSessionValid(request);
}

function parseKey(value: unknown): string | null {
  const key = typeof value === "string" ? value.trim() : "";
  // Hermes durable session keys: date_time_hex, e.g. 20260824_052417_fe475b.
  return /^\d{8}_\d{6}_[0-9a-f]{4,16}$/.test(key) ? key : null;
}

/**
 * GET /api/kana/activities?session=<hermes_session_key>
 * Returns every stored per-turn activity log for the session, oldest first:
 * [{ turnAnchorMs, turnIndex, activities }, ...] — turnIndex is null for
 * legacy v1 rows that predate ordinal anchoring.
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
  const turns = listTurnActivities(sessionKey).map(
    ({ turn_anchor_ms, turn_index, activities }) => ({
      turnAnchorMs: turn_anchor_ms,
      turnIndex: turn_index,
      activities,
    }),
  );
  return Response.json({ turns }, { headers: NO_STORE });
}

/**
 * PUT /api/kana/activities
 * Body: { session, turnAnchorMs, activities, turnIndex? }
 * Upserts one turn's activity snapshot. With turnIndex (non-negative int)
 * the snapshot is keyed by (session, turnIndex) so live and reconstructed
 * writes converge on one row; without it the anchor stays the identity.
 */
export async function PUT(request: Request): Promise<Response> {
  if (!(await requestAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  let body: {
    session?: unknown;
    turnAnchorMs?: unknown;
    turnIndex?: unknown;
    activities?: unknown;
  };
  try {
    body = await readJsonObject(request, MAX_BODY_BYTES);
  } catch (error) {
    return Response.json(
      { error: error instanceof RequestBodyError ? error.message : "A JSON object is required." },
      { status: error instanceof RequestBodyError ? error.status : 400, headers: NO_STORE },
    );
  }
  const sessionKey = parseKey(body.session);
  const anchor = body.turnAnchorMs;
  if (!sessionKey || typeof anchor !== "number" || !Number.isSafeInteger(Math.round(anchor)) || anchor < 1) {
    return Response.json(
      { error: "Fields 'session' (valid key) and 'turnAnchorMs' (positive number) are required." },
      { status: 400, headers: NO_STORE },
    );
  }
  let turnIndex: number | undefined;
  if (body.turnIndex !== undefined && body.turnIndex !== null) {
    const parsed = body.turnIndex;
    if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
      return Response.json(
        { error: "Field 'turnIndex' must be a non-negative integer." },
        { status: 400, headers: NO_STORE },
      );
    }
    turnIndex = parsed;
  }
  if (!Array.isArray(body.activities)) {
    return Response.json({ error: "Field 'activities' must be an array." }, { status: 400, headers: NO_STORE });
  }
  saveTurnActivities(sessionKey, anchor, body.activities, turnIndex);
  return Response.json({ ok: true }, { headers: NO_STORE });
}
