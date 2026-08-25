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
  /**
   * Zero-based assistant-reply ordinal within the session transcript.
   * Reconstructed history has no real timestamps, so this ordinal — not the
   * anchor — is the cross-browser identity of a turn. Legacy v1 rows keep
   * NULL and remain anchor-addressed.
   */
  turn_index: number | null;
  /** The full ActivityItem[] snapshot for the turn (JSON round-trip). */
  activities: unknown[];
};

const DB_DIR_ENV = "KANA_DATA_DIR";
const SCHEMA_VERSION = 2;

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

/** Test seam: drop the process-wide cached handle so a test can re-open
 *  the store against another database directory. */
export function resetActivityStoreForTests(): void {
  const shared = globalThis as StoreGlobal;
  try {
    shared[globalKey]?.close();
  } catch {
    // The handle may already be closed.
  }
  delete shared[globalKey];
}

function openDb(): DatabaseSync {
  const database = new DatabaseSync(dbPath());
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS turn_activities (
      hermes_session_key TEXT NOT NULL,
      turn_anchor_ms     INTEGER NOT NULL,
      turn_index         INTEGER,
      activities         TEXT NOT NULL,
      created_at         INTEGER NOT NULL,
      PRIMARY KEY (hermes_session_key, turn_anchor_ms)
    );
  `);
  migrateToV2(database);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_turn_activities_session
      ON turn_activities (hermes_session_key);
  `);
  return database;
}

/**
 * v1 → v2: add the per-turn ordinal column plus its unique index. Idempotent:
 * fresh databases are created at v2 directly, v1 databases get one ALTER
 * TABLE (legacy rows keep turn_index = NULL), and re-opening a v2 database
 * changes nothing. PRAGMA user_version records the reached version.
 */
function migrateToV2(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(turn_activities)")
    .all() as Array<{ name: string }>;
  if (columns.length && !columns.some((column) => column.name === "turn_index")) {
    database.exec("ALTER TABLE turn_activities ADD COLUMN turn_index INTEGER");
  }
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_activities_session_turn
      ON turn_activities (hermes_session_key, turn_index)
      WHERE turn_index IS NOT NULL;
  `);
  database.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

/**
 * Replace (or insert) the activity snapshot for one turn.
 *
 * With a turnIndex the row is addressed by (session, turn_index): a live
 * write and a reconstructed write for the same turn converge on ONE row,
 * and an existing live row keeps its real anchor while gaining the newer
 * snapshot. Without one (legacy callers) the anchor stays the identity.
 */
export function saveTurnActivities(
  hermesSessionKey: string,
  turnAnchorMs: number,
  activities: unknown[],
  turnIndex?: number,
): void {
  const database = db();
  const payload = JSON.stringify(activities);
  if (typeof turnIndex === "number") {
    const updated = database
      .prepare(
        `UPDATE turn_activities SET activities = ?
         WHERE hermes_session_key = ? AND turn_index = ?`,
      )
      .run(payload, hermesSessionKey, turnIndex);
    if (updated.changes > 0) return;
  }
  database
    .prepare(
      `INSERT INTO turn_activities
         (hermes_session_key, turn_anchor_ms, turn_index, activities, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (hermes_session_key, turn_anchor_ms)
       DO UPDATE SET
         activities = excluded.activities,
         turn_index = COALESCE(turn_activities.turn_index, excluded.turn_index)`,
    )
    .run(
      hermesSessionKey,
      Math.round(turnAnchorMs),
      typeof turnIndex === "number" ? turnIndex : null,
      payload,
      Date.now(),
    );
}

/** All stored activity logs for one Hermes session, oldest anchor first. */
export function listTurnActivities(hermesSessionKey: string): StoredTurnActivities[] {
  const statement = db().prepare(
    `SELECT hermes_session_key, turn_anchor_ms, turn_index, activities
     FROM turn_activities
     WHERE hermes_session_key = ?
     ORDER BY turn_anchor_ms ASC`,
  );
  const rows = statement.all(hermesSessionKey) as Array<{
    hermes_session_key: string;
    turn_anchor_ms: number;
    turn_index: number | null;
    activities: string;
  }>;
  return rows.map((row) => ({
    hermes_session_key: String(row.hermes_session_key),
    turn_anchor_ms: Number(row.turn_anchor_ms),
    turn_index: row.turn_index === null ? null : Number(row.turn_index),
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
