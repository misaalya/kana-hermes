import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Server-side store for per-turn tool activity logs.
 *
 * The conversation transcript itself lives in the Hermes state DB (read back
 * through session.history); only the activity log — runtime tool events that
 * Hermes does not persist as transcript rows — is stored here, keyed by the
 * Hermes session it belongs to and anchored to the timestamp of the
 * assistant reply that closed the turn. That anchor lets LiveChatFeed splice
 * each log back into the chronological feed between its user message and
 * Kana's reply after a refresh, a browser switch, or any other loss of
 * browser-local state.
 */

export type StoredTurnActivities = {
  /** Hermes durable session key ("20260824_052417_fe475b" style). */
  hermes_session_key: string;
  /** Unix ms of the assistant message that closed the turn. */
  turn_anchor_ms: number;
  /** The full ActivityItem[] snapshot for the turn (JSON round-trip). */
  activities: unknown[];
};

const DB_DIR_ENV = "KANA_DATA_DIR";

function dbPath(): string {
  const dir =
    process.env[DB_DIR_ENV]?.trim() ||
    path.join(process.env.HOME || process.cwd(), ".kana");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "activities.db");
}

const globalKey = Symbol.for("kana.activityStore");
type StoreGlobal = typeof globalThis & {
  [globalKey]?: DatabaseSync;
};

function db(): DatabaseSync {
  const shared = globalThis as StoreGlobal;
  shared[globalKey] ??= openDb();
  return shared[globalKey];
}

function openDb(): DatabaseSync {
  const database = new DatabaseSync(dbPath());
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS turn_activities (
      hermes_session_key TEXT NOT NULL,
      turn_anchor_ms     INTEGER NOT NULL,
      activities         TEXT NOT NULL,
      created_at         INTEGER NOT NULL,
      PRIMARY KEY (hermes_session_key, turn_anchor_ms)
    );
    CREATE INDEX IF NOT EXISTS idx_turn_activities_session
      ON turn_activities (hermes_session_key);
  `);
  return database;
}

/** Replace (or insert) the activity snapshot for one anchored turn. */
export function saveTurnActivities(
  hermesSessionKey: string,
  turnAnchorMs: number,
  activities: unknown[],
): void {
  db()
    .prepare(
      `INSERT INTO turn_activities (hermes_session_key, turn_anchor_ms, activities, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (hermes_session_key, turn_anchor_ms)
       DO UPDATE SET activities = excluded.activities`,
    )
    .run(
      hermesSessionKey,
      Math.round(turnAnchorMs),
      JSON.stringify(activities),
      Date.now(),
    );
}

/** All stored activity logs for one Hermes session, oldest anchor first. */
export function listTurnActivities(hermesSessionKey: string): StoredTurnActivities[] {
  const statement = db().prepare(
    `SELECT hermes_session_key, turn_anchor_ms, activities
     FROM turn_activities
     WHERE hermes_session_key = ?
     ORDER BY turn_anchor_ms ASC`,
  );
  const rows = statement.all(hermesSessionKey) as Array<{
    hermes_session_key: string;
    turn_anchor_ms: number;
    activities: string;
  }>;
  return rows.map((row) => ({
    hermes_session_key: String(row.hermes_session_key),
    turn_anchor_ms: Number(row.turn_anchor_ms),
    activities: safeParse(String(row.activities)),
  }));
}

function safeParse(raw: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
