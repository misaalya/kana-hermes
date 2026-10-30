import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { readJsonObject } from "@/lib/server/request-body";
import {
  listTurnActivities,
  replaceTurnActivities,
  saveTurnActivities,
} from "@/lib/server/activity-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A restore replaces every turn in one request; a long session's transcript
// is larger than one live snapshot.
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_REPLACED_TURNS = 5000;

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
export const GET = withSession(async (request) => {
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
});

/**
 * PUT /api/kana/activities
 * Body: { session, turnAnchorMs, activities, turnIndex? }
 * or:   { session, replace: true, turns: [{ turnAnchorMs, activities, turnIndex? }] }
 * Upserts one turn's activity snapshot. With turnIndex (non-negative int)
 * the snapshot is keyed by (session, turnIndex) so live and reconstructed
 * writes converge on one row; without it the anchor stays the identity. A
 * replace is the transcript restore's authoritative write: it clears the
 * session's log first, so stale ordinals and duplicate rows cannot survive.
 */
function parseTurn(raw: unknown): {
  turnAnchorMs: number;
  turnIndex: number | null;
  activities: unknown[];
} | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const turn = raw as {
    turnAnchorMs?: unknown;
    turnIndex?: unknown;
    activities?: unknown;
  };
  const anchor = turn.turnAnchorMs;
  if (typeof anchor !== "number" || !Number.isSafeInteger(Math.round(anchor)) || anchor < 1) {
    return null;
  }
  let turnIndex: number | null = null;
  if (turn.turnIndex !== undefined && turn.turnIndex !== null) {
    if (typeof turn.turnIndex !== "number" || !Number.isSafeInteger(turn.turnIndex) || turn.turnIndex < 0) {
      return null;
    }
    turnIndex = turn.turnIndex;
  }
  if (!Array.isArray(turn.activities)) return null;
  return { turnAnchorMs: Math.round(anchor), turnIndex, activities: turn.activities };
}

export const PUT = withSession(async (request) => {
  let body: {
    session?: unknown;
    turnAnchorMs?: unknown;
    turnIndex?: unknown;
    activities?: unknown;
    replace?: unknown;
    turns?: unknown;
  };
  try {
    body = await readJsonObject(request, MAX_BODY_BYTES);
  } catch (error) {
    return jsonError(error);
  }
  const sessionKey = parseKey(body.session);
  if (!sessionKey) {
    return Response.json(
      { error: "Field 'session' must be a valid Hermes session key." },
      { status: 400, headers: NO_STORE },
    );
  }
  if (body.replace === true) {
    if (!Array.isArray(body.turns) || body.turns.length > MAX_REPLACED_TURNS) {
      return Response.json(
        { error: `Field 'turns' must be an array of at most ${MAX_REPLACED_TURNS} turns.` },
        { status: 400, headers: NO_STORE },
      );
    }
    const parsedTurns = body.turns.map(parseTurn);
    const turns = parsedTurns.filter(
      (turn): turn is NonNullable<typeof turn> => turn !== null,
    );
    if (turns.length !== parsedTurns.length) {
      return Response.json(
        { error: "Every replaced turn needs a positive anchor and an activities array." },
        { status: 400, headers: NO_STORE },
      );
    }
    replaceTurnActivities(sessionKey, turns);
    return Response.json({ ok: true }, { headers: NO_STORE });
  }
  const turn = parseTurn(body);
  if (!turn) {
    return Response.json(
      { error: "Fields 'turnAnchorMs' (positive number) and 'activities' (array) are required." },
      { status: 400, headers: NO_STORE },
    );
  }
  saveTurnActivities(
    sessionKey,
    turn.turnAnchorMs,
    turn.activities,
    turn.turnIndex ?? undefined,
  );
  return Response.json({ ok: true }, { headers: NO_STORE });
});
