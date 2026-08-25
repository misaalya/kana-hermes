import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { adoptLegacyKanaFile, resolveKanaDataDir } from "@/lib/server/data-dir";

/**
 * Install-level key/value state in SQLite (`appstate.db` under the unified
 * KANA_DATA_DIR root). This is where per-installation UI state lives —
 * onboarding completion, dismissed install-wide notices — as opposed to
 * browser-local preferences (localStorage) and secrets (.env). All browsers
 * for the single user share one row set, so a flag written here is seen by
 * every device that talks to this Kana server.
 */

type AppStateRow = { value: string };

const globalKey = Symbol.for("kana.appStateStore");
type StoreGlobal = typeof globalThis & {
  [globalKey]?: DatabaseSync;
};

function dbPath(): string {
  adoptLegacyKanaFile("appstate.db");
  const dir = resolveKanaDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "appstate.db");
}

function db(): DatabaseSync {
  const shared = globalThis as StoreGlobal;
  shared[globalKey] ??= openDb();
  return shared[globalKey];
}

function openDb(): DatabaseSync {
  const database = new DatabaseSync(dbPath());
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return database;
}

/** Test seam: drop the cached handle so a test can point at another directory. */
export function resetAppStateStoreForTests(): void {
  const shared = globalThis as StoreGlobal;
  try {
    shared[globalKey]?.close();
  } catch {
    // The handle may already be closed.
  }
  delete shared[globalKey];
}

export function getAppState<T>(key: string): T | null {
  const row = db()
    .prepare("SELECT value FROM app_state WHERE key = ?")
    .get(key) as AppStateRow | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    // A corrupt row behaves like a missing one; writers overwrite it.
    return null;
  }
}

export function setAppState(key: string, value: unknown): void {
  db()
    .prepare(
      `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value,
                                       updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value ?? null), Date.now());
}
