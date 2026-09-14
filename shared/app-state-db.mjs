// Install-level SQLite state (`appstate.db`) shared by the launcher and the
// server. The schema and the access-password record format live here once so
// `kana password` and the web login can never disagree about them.

import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const APP_STATE_DB_FILE = "appstate.db";
export const PASSWORD_STATE_KEY = "auth.password";

/**
 * Opens (and creates) the owner-only state database under the data root.
 * @param {string} dataDir
 * @returns {DatabaseSync}
 */
export function openAppStateDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, APP_STATE_DB_FILE);
  const database = new DatabaseSync(file);
  chmodSync(file, 0o600);
  // Two processes (a running server and `kana password`) may write at once.
  database.exec("PRAGMA busy_timeout = 5000;");
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

/**
 * @param {DatabaseSync} database
 * @param {string} key
 * @returns {string | undefined} the raw JSON text
 */
export function readAppStateText(database, key) {
  const row = /** @type {{ value: string } | undefined} */ (
    database.prepare("SELECT value FROM app_state WHERE key = ?").get(key)
  );
  return row?.value;
}

/**
 * @param {DatabaseSync} database
 * @param {string} key
 * @param {unknown} value
 */
export function writeAppState(database, key, value) {
  database
    .prepare(
      `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value,
                                       updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value ?? null), Date.now());
}

/**
 * A stored password carries a session version; replacing it rotates the
 * version so every previously issued login session is revoked.
 * @param {string} passwordHash
 * @returns {{ passwordHash: string, sessionVersion: string }}
 */
export function newPasswordRecord(passwordHash) {
  return { passwordHash, sessionVersion: randomUUID() };
}

/**
 * @param {DatabaseSync} database
 * @returns {boolean}
 */
export function hasStoredPassword(database) {
  const text = readAppStateText(database, PASSWORD_STATE_KEY);
  if (text === undefined) return false;
  try {
    const value = JSON.parse(text);
    return typeof value?.passwordHash === "string" && value.passwordHash.length > 0;
  } catch {
    return false;
  }
}
