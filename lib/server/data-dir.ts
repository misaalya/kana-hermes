import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  KANA_DATA_DIR_ENV,
  kanaLegacyDataDirsFrom,
  migrateKanaDataRoot,
  resolveKanaDataDirFrom,
} from "@/shared/data-dir.mjs";

// Single authoritative Kana data directory (config.json, auth.json, jwt-secret,
// appstate.db, and activities.db). The precedence rules and the migration of
// earlier roots live in shared/data-dir.mjs so the `kana` launcher and this
// server always agree. The current working directory is never used in
// production; a dev-only fallback keeps ad-hoc experiments working when no home
// is resolvable.

export { KANA_DATA_DIR_ENV, resolveKanaDataDirFrom };

function safeHomeDirectory(): string | null {
  try {
    return homedir() || null;
  } catch {
    return null;
  }
}

function homeDirectory(env: NodeJS.ProcessEnv): string | null {
  return env.HOME ?? safeHomeDirectory();
}

export function resolveKanaDataDir(env: NodeJS.ProcessEnv = process.env): string {
  try {
    return resolveKanaDataDirFrom({
      kanaDataDir: env.KANA_DATA_DIR,
      home: homeDirectory(env),
    });
  } catch (error) {
    // An explicit but invalid root is operator input, not a missing-home
    // development case. Never silently redirect it into the current checkout.
    if (env.KANA_DATA_DIR?.trim()) throw error;
    if (env.NODE_ENV === "production") throw error;
    // Dev-only last resort preserves the historical local layout.
    return path.join(process.cwd(), "data");
  }
}

// Roots used before the current dot directory. Files found here are moved into
// the resolved directory, once.
function legacyKanaDataDirs(env: NodeJS.ProcessEnv): string[] {
  return kanaLegacyDataDirsFrom({
    home: homeDirectory(env),
    xdgDataHome: env.XDG_DATA_HOME,
    cwd: process.cwd(),
  });
}

// Kana only rearranges its own default root. When KANA_DATA_DIR names a root,
// that root belongs to the operator: it is used as-is, and an earlier install's
// files (which may belong to a different deployment, or to a test run) are
// never moved into it.
export function kanaMovesLegacyData(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.KANA_DATA_DIR?.trim();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let rootMigrationChecked = false;

/**
 * Moves an earlier install's data root into the resolved one, once per process.
 * Best effort: never throws, so a server start is never blocked by a legacy
 * root another account owns.
 */
export function ensureKanaDataRootMigrated(env: NodeJS.ProcessEnv = process.env): string[] {
  if (rootMigrationChecked) return [];
  rootMigrationChecked = true;
  if (!kanaMovesLegacyData(env)) return [];
  try {
    const targetDir = resolveKanaDataDir(env);
    return migrateKanaDataRoot({
      targetDir,
      legacyDirs: legacyKanaDataDirs(env),
      log: (name, fromDir) => {
        console.info(`[kana] Moved ${name} from ${fromDir} into ${targetDir}.`);
      },
      warn: (name, fromDir, error) => {
        console.warn(
          `[kana] Could not move ${name} from ${fromDir} into ${targetDir}: ${describeError(error)}`,
        );
      },
    });
  } catch (error) {
    console.warn(`[kana] Could not migrate an earlier data root: ${describeError(error)}`);
    return [];
  }
}

function isExdevError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EXDEV";
}

function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (error) {
    // rename(2) cannot cross mount points; fall back to copy + unlink.
    if (!isExdevError(error)) throw error;
    copyFileSync(from, to);
    unlinkSync(from);
  }
}

// A WAL-mode SQLite database is only complete together with its journal files.
const SQLITE_COMPANION_SUFFIXES = ["-wal", "-shm"];

export function migrateLegacyKanaFile(
  fileName: string,
  targetDir: string,
  legacyDirs: readonly string[],
): boolean {
  const target = path.join(targetDir, fileName);
  if (existsSync(target)) return false;
  for (const legacyDir of legacyDirs) {
    if (legacyDir === targetDir) continue;
    const candidate = path.join(legacyDir, fileName);
    if (!existsSync(candidate)) continue;
    mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    moveFile(candidate, target);
    if (fileName.endsWith(".db")) {
      for (const suffix of SQLITE_COMPANION_SUFFIXES) {
        const companion = `${candidate}${suffix}`;
        if (existsSync(/* turbopackIgnore: true */ companion) && !existsSync(/* turbopackIgnore: true */ `${target}${suffix}`)) {
          moveFile(companion, `${target}${suffix}`);
        }
      }
    }
    console.info(`[kana] Migrated ${fileName} from ${legacyDir} into ${targetDir}.`);
    return true;
  }
  return false;
}

const adoptedFiles = new Set<string>();

// Best-effort one-time adoption of a store file from the legacy data roots. The
// whole-root move normally ran first and this is a no-op; it stays as the
// fallback for a store whose file lands in a legacy root later. Never overwrites
// an existing target and never throws: stores keep their own honest error
// handling for real failures.
export function adoptLegacyKanaFile(fileName: string): void {
  if (adoptedFiles.has(fileName)) return;
  adoptedFiles.add(fileName);
  if (!kanaMovesLegacyData()) return;
  try {
    ensureKanaDataRootMigrated();
    migrateLegacyKanaFile(
      fileName,
      resolveKanaDataDir(),
      legacyKanaDataDirs(process.env),
    );
  } catch (error) {
    console.warn(
      `[kana] Could not check legacy locations for ${fileName}: ${describeError(error)}`,
    );
  }
}
