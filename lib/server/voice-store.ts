import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { resolveKanaDataDir } from "@/lib/server/data-dir";

/**
 * Persistent voice-clone library for Kana.
 *
 * Reference audio uploaded by the user is stored on the filesystem under
 * `<KANA_DATA_DIR>/voices/`, and only metadata + the storage path live in
 * SQLite (`voice_clones` table in appstate.db). This decouples voices from
 * the Qwen service's own data directory: if the model cache or service data
 * is wiped, Kana still holds the original references and can re-register
 * them. The shipped default voice ("Kana") is registered through this table
 * too, flagged `is_default` and never deletable.
 */

export type VoiceCloneRow = {
  id: string;
  name: string;
  file_path: string;
  /** Qwen service voice id once registration succeeded; null while pending. */
  service_voice_id: string | null;
  is_default: number;
  created_at: number;
};

const globalKey = Symbol.for("kana.voiceStore");
type StoreGlobal = typeof globalThis & {
  [globalKey]?: DatabaseSync;
};

function dbPath(): string {
  return path.join(resolveKanaDataDir(), "appstate.db");
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
    CREATE TABLE IF NOT EXISTS voice_clones (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      file_path        TEXT NOT NULL,
      service_voice_id TEXT,
      is_default       INTEGER NOT NULL DEFAULT 0,
      created_at       INTEGER NOT NULL
    );
  `);
  return database;
}

export function listVoiceClones(): VoiceCloneRow[] {
  return db()
    .prepare(
      `SELECT id, name, file_path, service_voice_id, is_default, created_at
       FROM voice_clones ORDER BY is_default DESC, created_at ASC`,
    )
    .all() as unknown as VoiceCloneRow[];
}

export function getVoiceClone(id: string): VoiceCloneRow | null {
  const row = db()
    .prepare("SELECT id, name, file_path, service_voice_id, is_default, created_at FROM voice_clones WHERE id = ?")
    .get(id) as unknown as VoiceCloneRow | undefined;
  return row ?? null;
}

export function getDefaultVoiceClone(): VoiceCloneRow | null {
  const row = db()
    .prepare(
      "SELECT id, name, file_path, service_voice_id, is_default, created_at FROM voice_clones WHERE is_default = 1 LIMIT 1",
    )
    .get() as unknown as VoiceCloneRow | undefined;
  return row ?? null;
}

export function getVoiceCloneByServiceId(serviceVoiceId: string): VoiceCloneRow | null {
  const row = db()
    .prepare(
      "SELECT id, name, file_path, service_voice_id, is_default, created_at FROM voice_clones WHERE service_voice_id = ? LIMIT 1",
    )
    .get(serviceVoiceId) as unknown as VoiceCloneRow | undefined;
  return row ?? null;
}

export function createVoiceClone(input: {
  id: string;
  name: string;
  filePath: string;
  isDefault?: boolean;
}): VoiceCloneRow {
  db()
    .prepare(
      `INSERT INTO voice_clones (id, name, file_path, service_voice_id, is_default, created_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    )
    .run(input.id, input.name, input.filePath, input.isDefault ? 1 : 0, Date.now());
  return getVoiceClone(input.id) as VoiceCloneRow;
}

export function setVoiceCloneServiceId(id: string, serviceVoiceId: string | null): void {
  db()
    .prepare("UPDATE voice_clones SET service_voice_id = ? WHERE id = ?")
    .run(serviceVoiceId, id);
}

export function deleteVoiceClone(id: string): VoiceCloneRow | null {
  const row = getVoiceClone(id);
  if (!row) return null;
  db().prepare("DELETE FROM voice_clones WHERE id = ?").run(id);
  try {
    fs.rmSync(row.file_path, { force: true });
  } catch {
    // Best-effort; an orphaned file is harmless.
  }
  return row;
}

export function saveVoiceReferenceFile(id: string, extension: string, bytes: Uint8Array): string {
  const dir = path.join(resolveKanaDataDir(), "voices");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const safeExt = extension.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
  const target = path.join(dir, `${id}.${safeExt}`);
  fs.writeFileSync(target, bytes, { mode: 0o600 });
  return target;
}
