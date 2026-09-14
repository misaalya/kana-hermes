import type { DatabaseSync } from "node:sqlite";
import { adoptLegacyKanaFile, resolveKanaDataDir } from "@/lib/server/data-dir";
import {
  APP_STATE_DB_FILE,
  openAppStateDatabase,
  readAppStateText,
  writeAppState,
} from "@/shared/app-state-db.mjs";

/**
 * Install-level key/value state in SQLite (`appstate.db` under the unified
 * KANA_DATA_DIR root). This is where shared per-installation state lives —
 * onboarding completion, the access-password hash, and dismissed install-wide
 * notices — as opposed to browser-local preferences (localStorage). All
 * browsers for the single user share one row set, so a value written here is
 * seen by every device that talks to this Kana server.
 *
 * The schema is shared with the `kana` launcher (shared/app-state-db.mjs).
 * Other server stores that live in the same file (the voice library) reuse
 * this one handle through appStateDatabase().
 */

export type AppStateEntry<T> =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "found"; value: T };

const globalKey = Symbol.for("kana.appStateStore");
type StoreGlobal = typeof globalThis & {
  [globalKey]?: DatabaseSync;
};

/** The process-wide handle to appstate.db (created on first use). */
export function appStateDatabase(): DatabaseSync {
  const shared = globalThis as StoreGlobal;
  if (!shared[globalKey]) {
    adoptLegacyKanaFile(APP_STATE_DB_FILE);
    shared[globalKey] = openAppStateDatabase(resolveKanaDataDir());
  }
  return shared[globalKey];
}

type ResetListener = () => void;
const resetListeners = new Set<ResetListener>();

/** Lets stores that cache schema setup on the shared handle re-run it. */
export function onAppStateDatabaseReset(listener: ResetListener): void {
  resetListeners.add(listener);
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
  for (const listener of resetListeners) listener();
}

export function getAppState<T>(key: string): T | null {
  const entry = getAppStateEntry<T>(key);
  return entry.status === "found" ? entry.value : null;
}

/**
 * Read a state row without conflating missing and corrupt data. Security-
 * sensitive consumers must fail closed when a persisted row cannot be parsed.
 */
export function getAppStateEntry<T>(key: string): AppStateEntry<T> {
  const text = readAppStateText(appStateDatabase(), key);
  if (text === undefined) return { status: "missing" };
  try {
    return { status: "found", value: JSON.parse(text) as T };
  } catch {
    return { status: "invalid" };
  }
}

export function setAppState(key: string, value: unknown): void {
  writeAppState(appStateDatabase(), key, value);
}
