// Data-root resolution and migration shared by the `kana` launcher and the
// Next.js server. Plain ESM with Node built-ins only: the launcher ships
// without the bundled server's dependencies, so both sides must agree through
// this one module.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
} from "node:fs";
import path from "node:path";

export const KANA_DATA_DIR_ENV = "KANA_DATA_DIR";

/**
 * Precedence: KANA_DATA_DIR (absolute) → $HOME/.kana.
 *
 * The dot directory keeps Kana beside the other agent tools a user installs
 * (`~/.hermes`, `~/.opencode`). Roots past releases wrote into are migration
 * sources only; see kanaLegacyDataDirsFrom.
 *
 * @param {{ kanaDataDir?: string | null, home?: string | null }} input
 * @returns {string}
 */
export function resolveKanaDataDirFrom(input) {
  const explicit = input.kanaDataDir?.trim();
  if (explicit) {
    if (!path.isAbsolute(explicit)) {
      throw new Error(`${KANA_DATA_DIR_ENV} must be an absolute path.`);
    }
    return path.normalize(explicit);
  }

  const home = input.home?.trim();
  if (home) return path.join(home, ".kana");

  throw new Error(
    `Kana cannot resolve its data directory: neither ${KANA_DATA_DIR_ENV} nor a home directory is available. Set ${KANA_DATA_DIR_ENV} to an absolute writable path (for example ${KANA_DATA_DIR_ENV}=/var/lib/kana).`,
  );
}

/**
 * Roots earlier releases wrote into, most recent layout first. Their contents
 * are migrated into the resolved root; nothing else ever reads them.
 *
 * @param {{ home?: string | null, xdgDataHome?: string | null, cwd?: string | null }} input
 * @returns {string[]}
 */
export function kanaLegacyDataDirsFrom(input) {
  const dirs = [];
  const xdgDataHome = input.xdgDataHome?.trim();
  if (xdgDataHome && path.isAbsolute(xdgDataHome)) {
    dirs.push(path.join(xdgDataHome, "kana"));
  }
  const home = input.home?.trim();
  if (home) dirs.push(path.join(home, ".local", "share", "kana"));
  const cwd = input.cwd?.trim();
  if (cwd) dirs.push(path.join(cwd, "data"));
  return dirs;
}

// Files that only a Kana data root holds. Requiring one keeps a stray
// directory that happens to be named "data" from being moved.
const KANA_DATA_ROOT_MARKERS = [
  "config.json",
  "auth.json",
  "appstate.db",
  "activities.db",
  "jwt-secret",
  "voices",
];

/**
 * True when the directory holds something Kana wrote: config.json, a store, or
 * the voice library.
 *
 * @param {string} dir
 * @returns {boolean}
 */
export function looksLikeKanaDataRoot(dir) {
  return KANA_DATA_ROOT_MARKERS.some((name) =>
    existsSync(/* turbopackIgnore: true */ path.join(dir, name)),
  );
}

function isExdevError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EXDEV");
}

/** Move one path, falling back to a recursive copy across mount points. */
function movePath(from, to) {
  try {
    renameSync(/* turbopackIgnore: true */ from, to);
  } catch (error) {
    if (!isExdevError(error)) throw error;
    cpSync(/* turbopackIgnore: true */ from, to, { recursive: true });
    rmSync(/* turbopackIgnore: true */ from, { recursive: true, force: true });
  }
}

// A WAL-mode SQLite database is only complete together with its journal files,
// so a family is always taken from one source root.
function familyName(name) {
  return name.endsWith("-wal") || name.endsWith("-shm") ? name.slice(0, -4) : name;
}

/**
 * Moves everything an earlier data root holds into the resolved root, one file
 * at a time: an existing target file always wins, and for a name that two
 * legacy roots both hold the newest copy wins. Directories (the voice library,
 * an installed voice engine) move whole.
 *
 * Best effort by design: a failure leaves that entry in place for the next
 * start, and never throws, so a launcher or server start is never blocked by a
 * read-only or foreign-owned legacy root.
 *
 * @param {{
 *   targetDir: string,
 *   legacyDirs: readonly string[],
 *   log?: (name: string, fromDir: string, targetDir: string) => void,
 *   warn?: (name: string, fromDir: string, error: unknown) => void,
 *   requireMarker?: boolean,
 * }} input
 * @returns {string[]} the names it moved, in the order it moved them
 */
export function migrateKanaDataRoot(input) {
  const target = path.resolve(input.targetDir);
  const requireMarker = input.requireMarker !== false;
  const sources = [...new Set(
    input.legacyDirs
      .map((dir) => path.resolve(dir))
      .filter((dir) => dir !== target && existsSync(/* turbopackIgnore: true */ dir)),
  )].filter((dir) => !requireMarker || looksLikeKanaDataRoot(dir));

  const moved = [];
  if (!sources.length) return moved;

  const names = new Set();
  for (const source of sources) {
    for (const name of readdirSync(/* turbopackIgnore: true */ source)) names.add(name);
  }

  const families = new Map();
  for (const name of names) {
    const family = familyName(name);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(name);
  }

  let createdTarget = false;
  for (const [family, members] of families) {
    if (existsSync(/* turbopackIgnore: true */ path.join(target, family))) continue;

    // The newest copy of the family's base name decides which root it comes
    // from, so a database is never assembled from two different roots.
    let sourceDir = null;
    let newest = -1;
    for (const dir of sources) {
      for (const candidate of [family, ...members]) {
        let stats;
        try {
          stats = statSync(/* turbopackIgnore: true */ path.join(dir, candidate));
        } catch {
          continue;
        }
        if (stats.mtimeMs > newest) {
          newest = stats.mtimeMs;
          sourceDir = dir;
        }
      }
    }
    if (!sourceDir) continue;

    for (const member of members) {
      const from = path.join(/* turbopackIgnore: true */ sourceDir, member);
      if (
        !existsSync(/* turbopackIgnore: true */ from) ||
        existsSync(/* turbopackIgnore: true */ path.join(target, member))
      ) {
        continue;
      }
      try {
        if (!createdTarget) {
          mkdirSync(/* turbopackIgnore: true */ target, { recursive: true, mode: 0o700 });
          createdTarget = true;
        }
        movePath(from, path.join(/* turbopackIgnore: true */ target, member));
        moved.push(member);
        input.log?.(member, sourceDir, target);
      } catch (error) {
        input.warn?.(member, sourceDir, error);
      }
    }
  }

  // A legacy root that gave up everything it held leaves no clutter behind.
  for (const source of sources) {
    try {
      if (!readdirSync(/* turbopackIgnore: true */ source).length) {
        rmdirSync(/* turbopackIgnore: true */ source);
      }
    } catch {
      // Still in use, partly drained, or not ours to remove.
    }
  }

  return moved;
}