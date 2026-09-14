// PATH lookup without a shell, shared by the launcher and the server.

import { accessSync, constants } from "node:fs";
import path from "node:path";

/**
 * First executable named `name` in `configured`, PATH, then `extraFolders`.
 * @param {string} name
 * @param {{ configured?: string | null, env?: NodeJS.ProcessEnv, extraFolders?: Array<string | null | undefined> }} [options]
 * @returns {string | null}
 */
export function findExecutableSync(name, options = {}) {
  const env = options.env ?? process.env;
  const home = env.HOME?.trim();
  const candidates = [
    options.configured?.trim(),
    ...(env.PATH ?? "").split(path.delimiter).filter(Boolean).map((folder) => path.join(folder, name)),
    ...(options.extraFolders ?? []).filter(Boolean).map((folder) => path.join(/** @type {string} */ (folder), name)),
    ...(home ? [path.join(home, ".local", "bin", name), path.join(home, ".cargo", "bin", name)] : []),
    ...(env.PREFIX?.trim() ? [path.join(env.PREFIX.trim(), "bin", name)] : []),
    path.join("/usr/local/bin", name),
    path.join("/usr/bin", name),
  ];
  for (const candidate of new Set(candidates)) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep scanning.
    }
  }
  return null;
}
