import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  KANA_DATA_DIR_ENV,
  resolveKanaDataDirFrom,
} from "@/shared/data-dir.mjs";

// Single authoritative Kana data directory (appstate.db, jwt-secret, and
// activities.db). The precedence rules live in shared/data-dir.mjs so the
// `kana` launcher and this server always resolve the same root. The current
// working directory is never used in production; a dev-only fallback keeps
// ad-hoc experiments working when no home is resolvable.

export { KANA_DATA_DIR_ENV, resolveKanaDataDirFrom };

function safeHomeDirectory(): string | null {
  try {
    return homedir() || null;
  } catch {
    return null;
  }
}

export function resolveKanaDataDir(env: NodeJS.ProcessEnv = process.env): string {
  try {
    return resolveKanaDataDirFrom({
      kanaDataDir: env.KANA_DATA_DIR,
      xdgDataHome: env.XDG_DATA_HOME,
      home: env.HOME ?? safeHomeDirectory(),
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

// Data roots used before the consolidated resolver existed. Files found here
// are adopted once into the resolved directory.
function legacyKanaDataDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs = [path.join(process.cwd(), "data")];
  const home = env.HOME?.trim() || safeHomeDirectory();
  if (home) dirs.push(path.join(home, ".kana"));
  return dirs;
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
        if (existsSync(companion) && !existsSync(`${target}${suffix}`)) {
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

// Best-effort one-time adoption of a store file from the legacy data roots
// ($CWD/data, $HOME/.kana). Never overwrites an existing target and never
// throws: stores keep their own honest error handling for real failures.
export function adoptLegacyKanaFile(fileName: string): void {
  if (adoptedFiles.has(fileName)) return;
  adoptedFiles.add(fileName);
  try {
    migrateLegacyKanaFile(
      fileName,
      resolveKanaDataDir(),
      legacyKanaDataDirs(process.env),
    );
  } catch (error) {
    console.warn(
      `[kana] Could not check legacy locations for ${fileName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
