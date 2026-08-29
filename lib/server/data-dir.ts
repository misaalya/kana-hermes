import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// Single authoritative Kana data directory (auth.json, jwt-secret, and — via a
// follow-up rewiring — activities.db). Precedence:
//   1. KANA_DATA_DIR environment variable
//   2. XDG data home ($XDG_DATA_HOME/kana, absolute values only)
//   3. $HOME/.local/share/kana
// The current working directory is never used in production; a dev-only
// fallback keeps ad-hoc experiments working when no home is resolvable.

export const KANA_DATA_DIR_ENV = "KANA_DATA_DIR";

export type KanaDataDirInput = {
  readonly kanaDataDir?: string | null;
  readonly xdgDataHome?: string | null;
  readonly home?: string | null;
};

export function resolveKanaDataDirFrom(input: KanaDataDirInput): string {
  const explicit = input.kanaDataDir?.trim();
  if (explicit) {
    if (!path.isAbsolute(explicit)) {
      throw new Error(`${KANA_DATA_DIR_ENV} must be an absolute path.`);
    }
    return path.normalize(explicit);
  }

  // XDG Base Directory spec: relative $XDG_DATA_HOME values must be ignored.
  const xdgDataHome = input.xdgDataHome?.trim();
  if (xdgDataHome && path.isAbsolute(xdgDataHome)) {
    return path.join(xdgDataHome, "kana");
  }

  const home = input.home?.trim();
  if (home) return path.join(home, ".local", "share", "kana");

  throw new Error(
    `Kana cannot resolve its data directory: neither ${KANA_DATA_DIR_ENV} nor a home directory is available. Set ${KANA_DATA_DIR_ENV} to an absolute writable path (for example ${KANA_DATA_DIR_ENV}=/var/lib/kana).`,
  );
}

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
  let home: string | null = null;
  try {
    home = env.HOME?.trim() || safeHomeDirectory();
  } catch {
    home = null;
  }
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
    mkdirSync(targetDir, { recursive: true });
    moveFile(candidate, target);
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
