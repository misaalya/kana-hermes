// Data-root resolution and migration shared by the `kana` launcher and the
// Next.js server. Plain ESM with Node built-ins only: the launcher ships
// without the bundled server's dependencies, so both sides must agree through
// this one module.

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
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

// Names only a Kana data root holds. Requiring one keeps a stray directory that
// happens to be named "data" from being moved. config.json and auth.json are
// deliberately absent: they carry generic file names that an unrelated project
// folder often holds, so they qualify nothing on their own. They are still
// moved regardless of this list once a root is recognized, because every entry
// of a recognized root moves.
const KANA_DATA_ROOT_MARKERS = [
  "appstate.db",
  "activities.db",
  "jwt-secret",
  "voices",
  "irodori",
];

/**
 * True when the directory holds something only Kana writes: a store, the
 * session secret, or the voice library and engine.
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

/**
 * Copies one path, verifying every regular file it writes: a directory is
 * recreated with its own mode and walked, a symlink is recreated as a link, and
 * a file's written size must equal the size of its source. Returns what it
 * wrote, so a caller can report a copy it can stand behind.
 *
 * @param {string} from
 * @param {string} to
 * @returns {{ files: number, bytes: number }}
 */
function copyPath(from, to) {
  const stats = lstatSync(from);
  if (stats.isDirectory()) {
    const mode = stats.mode & 0o777;
    mkdirSync(to, { recursive: true, mode: mode || 0o700 });
    let files = 0;
    let bytes = 0;
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const written = copyPath(path.join(from, entry.name), path.join(to, entry.name));
      files += written.files;
      bytes += written.bytes;
    }
    return { files, bytes };
  }
  if (stats.isSymbolicLink()) {
    symlinkSync(readlinkSync(from), to);
    return { files: 1, bytes: 0 };
  }
  if (!stats.isFile()) {
    throw new Error(`${from} is not a file, a directory, or a symlink.`);
  }
  copyFileSync(from, to);
  const written = statSync(to);
  if (written.size !== stats.size) {
    throw new Error(`${to} holds ${written.size} bytes after the copy, not ${stats.size}.`);
  }
  return { files: 1, bytes: stats.size };
}

/** The same walk as copyPath, writing nothing, for a move nobody has agreed to yet. */
function measurePath(from) {
  const stats = lstatSync(from);
  if (stats.isDirectory()) {
    let files = 0;
    let bytes = 0;
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const measured = measurePath(path.join(from, entry.name));
      files += measured.files;
      bytes += measured.bytes;
    }
    return { files, bytes };
  }
  if (stats.isSymbolicLink()) return { files: 1, bytes: 0 };
  return { files: 1, bytes: stats.isFile() ? stats.size : 0 };
}

/** Move one path, falling back to a verified copy across mount points. */
function movePath(from, to) {
  try {
    renameSync(/* turbopackIgnore: true */ from, to);
    return { mode: "moved", ...measurePath(to) };
  } catch (error) {
    if (!isExdevError(error)) throw error;
    const written = copyPath(from, to);
    rmSync(/* turbopackIgnore: true */ from, { recursive: true, force: true });
    return { mode: "copied", ...written };
  }
}

// A WAL-mode SQLite database is only complete together with its journal files,
// so a family is always taken from one source root.
function familyName(name) {
  return name.endsWith("-wal") || name.endsWith("-shm") ? name.slice(0, -4) : name;
}

/**
 * What a move would take, and what it would leave. The families of a source
 * root the target does not already hold, each paired with the one source root it
 * comes from, plus a reason for every source or family passed over. With
 * `replaceExisting`, a family the target already holds is selected too, with the
 * destination members the caller must back up and remove first.
 *
 * @param {{ targetDir: string, legacyDirs: readonly string[], requireMarker?: boolean, replaceExisting?: boolean }} input
 * @returns {{
 *   target: string,
 *   sources: string[],
 *   entries: { family: string, members: string[], sourceDir: string, replaceMembers: string[] }[],
 *   skips: { name: string, reason: string }[],
 * }}
 */
function selectKanaDataEntries(input) {
  const target = path.resolve(input.targetDir);
  const requireMarker = input.requireMarker !== false;
  const replaceExisting = input.replaceExisting === true;
  const skips = [];

  const sources = [];
  for (const dir of new Set(input.legacyDirs.map((entry) => path.resolve(entry)))) {
    if (dir === target) {
      skips.push({ name: dir, reason: "target" });
      continue;
    }
    if (!existsSync(/* turbopackIgnore: true */ dir)) {
      skips.push({ name: dir, reason: "missing" });
      continue;
    }
    if (requireMarker && !looksLikeKanaDataRoot(dir)) {
      skips.push({ name: dir, reason: "unrecognized" });
      continue;
    }
    sources.push(dir);
  }

  const names = new Set();
  for (const source of sources) {
    for (const name of readdirSync(/* turbopackIgnore: true */ source)) names.add(name);
  }

  // Reading the destination once proves which members it holds and lets a
  // replacement name every one it will back up. An unreadable destination is
  // refused when replacing, because copying over an entry Kana cannot see would
  // overwrite it without a backup.
  let targetNames = [];
  let targetReadable = true;
  if (existsSync(/* turbopackIgnore: true */ target)) {
    try {
      targetNames = readdirSync(/* turbopackIgnore: true */ target);
    } catch {
      targetReadable = false;
    }
  }
  if (replaceExisting && !targetReadable) {
    throw new Error(`Cannot read the destination ${target}, so nothing was replaced.`);
  }

  const families = new Map();
  for (const name of names) {
    const family = familyName(name);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(name);
  }

  const entries = [];
  for (const [family, members] of families) {
    const familyNames = [family, ...members];
    const targetMembers = targetNames
      .filter((name) => familyName(name) === family)
      .sort();

    // The whole family is left alone when the target already holds any part of
    // it. A database and its journal files must never come from two roots, so a
    // target that holds one member keeps the family where it is. Replacing is
    // the explicit exception: the target family is what gets backed up and
    // removed, and the source family arrives whole.
    const collides =
      targetMembers.length > 0 ||
      (!targetReadable &&
        familyNames.some((name) =>
          existsSync(/* turbopackIgnore: true */ path.join(target, name)),
        ));
    if (collides && !replaceExisting) {
      skips.push({ name: family, reason: "target" });
      continue;
    }

    // The newest copy of the family's base name decides which root it comes
    // from, so a database is never assembled from two different roots. A
    // replacement must come from a root that actually holds the base file: a
    // lone journal file may never replace a whole database.
    let sourceDir = null;
    let newest = -1;
    for (const dir of sources) {
      for (const candidate of collides ? [family] : familyNames) {
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
    if (!sourceDir) {
      if (collides) skips.push({ name: family, reason: "incomplete" });
      continue;
    }

    entries.push({ family, members, sourceDir, replaceMembers: collides ? targetMembers : [] });
  }

  return { target, sources, entries, skips };
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
 * `copyOnly` copies rather than moves, verifies every file it writes, and leaves
 * each source entry where it was; `dryRun` reports the same names and touches
 * nothing. Both exist for the operator-run `kana migrate`, which must be able to
 * show a plan and to keep the source until the operator deletes it.
 *
 * `replaceExisting` backs up every destination member of a colliding family
 * into a new `.kana-migrate-backup-*` directory inside the destination, removes
 * the destination family whole, and only then copies and verifies the source
 * family. A failed replacement restores the destination from that backup. The
 * source is still removed only after every copy verified, even when `copyOnly`
 * is off.
 *
 * @param {{
 *   targetDir: string,
 *   legacyDirs: readonly string[],
 *   log?: (name: string, fromDir: string, targetDir: string, result?: { mode: string, files: number, bytes: number }) => void,
 *   warn?: (name: string, fromDir: string, error: unknown) => void,
 *   skip?: (name: string, reason: string) => void,
 *   onBackupDir?: (backupDir: string) => void,
 *   requireMarker?: boolean,
 *   copyOnly?: boolean,
 *   dryRun?: boolean,
 *   replaceExisting?: boolean,
 * }} input
 * @returns {string[]} the names it moved, in the order it moved them
 */
export function migrateKanaDataRoot(input) {
  const { target, sources, entries, skips } = selectKanaDataEntries(input);
  for (const skipped of skips) input.skip?.(skipped.name, skipped.reason);

  const moved = [];
  let createdTarget = false;
  let backupDir = null;
  let backupReported = false;

  for (const entry of entries) {
    const copied = [];
    const replacing =
      input.replaceExisting === true && (entry.replaceMembers?.length ?? 0) > 0;

    if (replacing && !input.dryRun) {
      try {
        if (!createdTarget) {
          mkdirSync(/* turbopackIgnore: true */ target, { recursive: true, mode: 0o700 });
          createdTarget = true;
        }
        if (!backupDir) {
          backupDir = mkdtempSync(path.join(target, ".kana-migrate-backup-"));
        }
        // The destination family is copied aside before any of it is removed.
        for (const member of entry.replaceMembers) {
          const from = path.join(target, member);
          if (!existsSync(/* turbopackIgnore: true */ from)) continue;
          copyPath(from, path.join(/* turbopackIgnore: true */ backupDir, member));
        }
        // Report the directory only once it holds a complete backup.
        if (!backupReported) {
          input.onBackupDir?.(backupDir);
          backupReported = true;
        }
        // Remove every destination member, including a stale journal the
        // source no longer has, so the new family is never mixed with the old.
        for (const member of entry.replaceMembers) {
          rmSync(/* turbopackIgnore: true */ path.join(target, member), {
            recursive: true,
            force: true,
          });
        }
        const written = [];
        for (const member of entry.members) {
          const from = path.join(entry.sourceDir, member);
          if (!existsSync(/* turbopackIgnore: true */ from)) continue;
          const result = copyPath(from, path.join(target, member));
          copied.push(member);
          written.push({ member, result });
        }
        // A move deletes each source entry only after the whole family is
        // written and verified, so a failure never leaves the source partial.
        if (!input.copyOnly) {
          for (const { member } of written) {
            try {
              rmSync(/* turbopackIgnore: true */ path.join(entry.sourceDir, member), {
                recursive: true,
                force: true,
              });
            } catch (error) {
              input.warn?.(
                member,
                entry.sourceDir,
                new Error(
                  `copied and verified, but the source could not be removed: ${error instanceof Error ? error.message : String(error)}`,
                ),
              );
            }
          }
        }
        for (const { member, result } of written) {
          moved.push(member);
          input.log?.(member, entry.sourceDir, target, {
            mode: input.copyOnly ? "copied" : "moved",
            ...result,
          });
        }
        continue;
      } catch (error) {
        // Take back the partial family and put the destination back exactly as
        // it was. The backup remains on disk either way.
        for (const member of copied) {
          try {
            rmSync(/* turbopackIgnore: true */ path.join(target, member), {
              recursive: true,
              force: true,
            });
          } catch {
            // Keep restoring what can be restored.
          }
        }
        const restored = [];
        if (backupDir) {
          for (const member of entry.replaceMembers) {
            const backup = path.join(/* turbopackIgnore: true */ backupDir, member);
            if (!existsSync(/* turbopackIgnore: true */ backup)) continue;
            try {
              copyPath(backup, path.join(target, member));
              restored.push(member);
            } catch {
              // The warning below still names the backup directory.
            }
          }
        }
        const backupExpected = backupDir
          ? entry.replaceMembers.filter((member) =>
              existsSync(path.join(/* turbopackIgnore: true */ backupDir, member)),
            ).length
          : 0;
        let detail = error instanceof Error ? error.message : String(error);
        if (restored.length && restored.length === backupExpected) {
          detail += "; the previous destination entries were restored from the backup";
        } else if (restored.length) {
          detail += `; only ${restored.length} of ${backupExpected} destination entries were restored from ${backupDir}`;
        } else if (backupDir) {
          detail += `; restore the destination from ${backupDir}`;
        }
        input.warn?.(entry.family, entry.sourceDir, new Error(detail));
        continue;
      }
    }

    for (const member of entry.members) {
      const from = path.join(entry.sourceDir, member);
      if (!existsSync(/* turbopackIgnore: true */ from)) continue;
      const to = path.join(target, member);

      if (input.dryRun) {
        moved.push(member);
        input.log?.(member, entry.sourceDir, target);
        continue;
      }

      try {
        if (!createdTarget) {
          mkdirSync(/* turbopackIgnore: true */ target, { recursive: true, mode: 0o700 });
          createdTarget = true;
        }
        const result = input.copyOnly
          ? { mode: "copied", ...copyPath(from, to) }
          : movePath(from, to);
        copied.push(member);
        moved.push(member);
        input.log?.(member, entry.sourceDir, target, result);
      } catch (error) {
        // A copy that failed halfway would leave a database family split across
        // two roots, which is what the family rule exists to prevent: take back
        // what this call wrote and leave the source whole for another try.
        if (input.copyOnly) {
          for (const written of copied) {
            try {
              rmSync(path.join(target, written), { recursive: true, force: true });
            } catch {
              // An entry that will not come back off is still better left in
              // place than made a reason to fail the whole move.
            }
          }
        }
        input.warn?.(member, entry.sourceDir, error);
        if (input.copyOnly) break;
      }
    }
  }

  // A legacy root that gave up everything it held leaves no clutter behind.
  if (!input.dryRun && !input.copyOnly) {
    for (const source of sources) {
      try {
        if (!readdirSync(/* turbopackIgnore: true */ source).length) {
          rmdirSync(/* turbopackIgnore: true */ source);
        }
      } catch {
        // Still in use, partly drained, or not ours to remove.
      }
    }
  }

  return moved;
}

/**
 * What a move would take, without taking it: the entries, how much they hold,
 * which destination members a replacement would back up, and why anything was
 * passed over. `kana migrate` shows this before it asks for agreement, and the
 * move itself runs the same selection again, so a plan that was read by a
 * person and the move that follows it cannot disagree about the rules.
 *
 * @param {{ targetDir: string, legacyDirs: readonly string[], requireMarker?: boolean, replaceExisting?: boolean }} input
 * @returns {{
 *   target: string,
 *   move: { name: string, from: string, to: string, directory: boolean, files: number, bytes: number }[],
 *   replace: {
 *     family: string,
 *     sourceDir: string,
 *     sourceMembers: string[],
 *     targetMembers: { name: string, path: string, directory: boolean, files: number, bytes: number }[],
 *   }[],
 *   skip: { name: string, reason: string }[],
 * }}
 */
export function planKanaDataRootMove(input) {
  const { target, entries, skips } = selectKanaDataEntries(input);
  const move = [];
  const replace = [];
  for (const entry of entries) {
    if (entry.replaceMembers?.length) {
      const sourceMembers = [];
      for (const member of entry.members) {
        if (existsSync(/* turbopackIgnore: true */ path.join(entry.sourceDir, member))) {
          sourceMembers.push(member);
        }
      }
      const targetMembers = [];
      for (const member of entry.replaceMembers) {
        const from = path.join(target, member);
        if (!existsSync(/* turbopackIgnore: true */ from)) continue;
        const stats = lstatSync(/* turbopackIgnore: true */ from);
        const measured = measurePath(from);
        targetMembers.push({
          name: member,
          path: from,
          directory: stats.isDirectory(),
          files: measured.files,
          bytes: measured.bytes,
        });
      }
      replace.push({
        family: entry.family,
        sourceDir: entry.sourceDir,
        sourceMembers,
        targetMembers,
      });
    }
    for (const member of entry.members) {
      const from = path.join(entry.sourceDir, member);
      if (!existsSync(/* turbopackIgnore: true */ from)) continue;
      const stats = lstatSync(/* turbopackIgnore: true */ from);
      const measured = measurePath(from);
      move.push({
        name: member,
        from,
        to: path.join(target, member),
        directory: stats.isDirectory(),
        files: measured.files,
        bytes: measured.bytes,
      });
    }
  }
  return { target, move, replace, skip: skips };
}
