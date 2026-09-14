// Runtime files shared by both distribution paths (npm package and
// standalone deployment). Service and asset sources are copied from Git's
// view of the checkout — tracked files plus new files that are not ignored —
// so virtualenvs, caches, `.env` files, and anything else .gitignore excludes
// can never be shipped. Publishing additionally requires a clean tree.

import { execFileSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const UNTRACKED_FALLBACK_EXCLUDES = new Set([".venv", "__pycache__", ".pytest_cache", ".env"]);

/** Non-ignored files under `relativeDirectory`, or null outside a Git checkout. */
function trackedFiles(root, relativeDirectory) {
  try {
    const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", relativeDirectory], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return [...new Set(output.split("\0").filter(Boolean))];
  } catch {
    return null;
  }
}

async function copyTrackedDirectory(root, relativeDirectory, targetRoot) {
  // Next's output tracing may already have copied this directory wholesale
  // (including __pycache__); replace it so the Git view is the only source.
  await rm(path.join(targetRoot, relativeDirectory), { recursive: true, force: true });
  const files = trackedFiles(root, relativeDirectory);
  if (files === null) {
    // Building from a source tarball: fall back to a conservative filter.
    process.stderr.write(`[kana] ${relativeDirectory}: not a Git checkout, copying with exclusions.\n`);
    await cp(path.join(root, relativeDirectory), path.join(targetRoot, relativeDirectory), {
      recursive: true,
      force: true,
      filter: (source) => !source.split(path.sep).some((part) => UNTRACKED_FALLBACK_EXCLUDES.has(part)),
    });
    return;
  }
  if (files.length === 0) throw new Error(`No tracked files found under ${relativeDirectory}.`);
  for (const file of files) {
    const destination = path.join(targetRoot, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(root, file), destination, { force: true });
  }
}

/**
 * Static assets, public files, the Qwen service, and the default voice.
 * `launcher: true` also ships the `kana` launcher next to server.js, so a
 * standalone deployment can run `node bin/kana.mjs password|serve`.
 */
export async function copyRuntimeAssets(root, targetRoot, { launcher }) {
  await mkdir(path.join(targetRoot, ".next"), { recursive: true });
  await cp(path.join(root, ".next", "static"), path.join(targetRoot, ".next", "static"), {
    recursive: true,
    force: true,
  });
  await cp(path.join(root, "public"), path.join(targetRoot, "public"), { recursive: true, force: true });
  const directories = ["services/qwen3-tts", "assets/voices", ...(launcher ? ["bin", "config", "shared"] : [])];
  for (const directory of directories) {
    await copyTrackedDirectory(root, directory, targetRoot);
  }
}
