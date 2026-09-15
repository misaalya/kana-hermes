import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { resolveKanaDataDir } from "@/lib/server/data-dir";
import { appStateDatabase, onAppStateDatabaseReset } from "@/lib/server/app-state-store";

/**
 * Persistent voice library for Kana.
 *
 * Reference audio uploaded by the user is stored on the filesystem under
 * `<KANA_DATA_DIR>/voices/`, and only metadata + the storage path live in
 * SQLite (`voice_clones` table in appstate.db). The shipped default voice
 * ("Kana") is a row too, flagged `is_default` and never deletable.
 */

export type VoiceCloneRow = {
  id: string;
  name: string;
  file_path: string;
  /** Unused since the local engine reads references directly; kept for old databases. */
  service_voice_id: string | null;
  is_default: number;
  created_at: number;
};

let schemaReady: DatabaseSync | null = null;
onAppStateDatabaseReset(() => {
  schemaReady = null;
});

// The voice library lives in appstate.db next to install-level state, so it
// shares that store's single handle (owner-only file, WAL, legacy adoption).
function db(): DatabaseSync {
  const database = appStateDatabase();
  if (schemaReady !== database) {
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
    schemaReady = database;
  }
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

export function deleteVoiceClone(id: string): VoiceCloneRow | null {
  const row = getVoiceClone(id);
  if (!row) return null;
  db().prepare("DELETE FROM voice_clones WHERE id = ?").run(id);
  try {
    fs.rmSync(/* turbopackIgnore: true */ row.file_path, { force: true });
  } catch {
    // Best-effort; an orphaned file is harmless.
  }
  return row;
}

export function saveVoiceReferenceFile(id: string, extension: string, bytes: Uint8Array): string {
  const dir = path.join(resolveKanaDataDir(), "voices");
  fs.mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true, mode: 0o700 });
  const safeExt = extension.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
  const target = path.join(dir, `${id}.${safeExt}`);
  fs.writeFileSync(/* turbopackIgnore: true */ target, bytes, { mode: 0o600 });
  return target;
}
