// Hermes discovery shared by `kana doctor`/launch and the server runtime.
//
// Executable lookup covers the layouts produced by Hermes's official
// installer (user: ~/.local/bin + ~/.hermes/hermes-agent; root on Linux:
// /usr/local/bin + /usr/local/lib/hermes-agent; Termux: $PREFIX/bin), pip/pipx/
// uv tool installs, Nix profiles, and Homebrew on Linux. Process discovery
// reads /proc directly, so it works on every Linux distribution and in minimal
// containers without procps/pgrep.

import { constants } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Hermes's own default when `hermes serve` is started without --port. */
export const HERMES_DEFAULT_PORT = 9119;
export const HERMES_TOKEN_ENV = "HERMES_DASHBOARD_SESSION_TOKEN";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Ordered, absolute, de-duplicated candidates.
 * @param {{
 *   explicit?: string | null, configured?: string | null, pathValue?: string | null,
 *   home?: string | null, hermesHome?: string | null, installDirectory?: string | null,
 *   prefix?: string | null, xdgBinHome?: string | null, localAppData?: string | null,
 *   userProfile?: string | null, operatingSystem?: NodeJS.Platform,
 * }} input
 * @returns {string[]}
 */
export function hermesExecutableCandidates(input) {
  const operatingSystem = input.operatingSystem ?? process.platform;
  const windows = operatingSystem === "win32";
  const name = windows ? "hermes.exe" : "hermes";
  const home = input.home?.trim() || null;
  const hermesHome = input.hermesHome?.trim() || (home ? path.join(home, ".hermes") : null);
  const installDirectory = input.installDirectory?.trim() || null;
  const prefix = input.prefix?.trim() || null;
  const xdgBinHome = input.xdgBinHome?.trim() || null;
  const inDir = (/** @type {string | null} */ directory, ...segments) =>
    directory ? path.join(directory, ...segments, name) : null;

  /** @type {Array<string | null | undefined>} */
  const candidates = [
    input.explicit?.trim(),
    input.configured?.trim(),
    ...(input.pathValue || "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((directory) => path.join(directory, name)),
    // Official installer, explicit --dir / HERMES_INSTALL_DIR.
    inDir(installDirectory, "venv", "bin"),
    inDir(installDirectory),
    // Official installer, user layout and older layouts.
    inDir(home, ".local", "bin"),
    inDir(hermesHome, "bin"),
    inDir(hermesHome, "hermes-agent", "venv", "bin"),
    inDir(hermesHome, "venv", "bin"),
    // uv tool / pipx honour XDG_BIN_HOME before ~/.local/bin.
    xdgBinHome && path.isAbsolute(xdgBinHome) ? path.join(xdgBinHome, name) : null,
    // Termux.
    inDir(prefix, "bin"),
    windows && input.localAppData?.trim() ? path.join(input.localAppData.trim(), "hermes", "bin", name) : null,
    windows && input.userProfile?.trim() ? path.join(input.userProfile.trim(), ".local", "bin", name) : null,
    ...(windows
      ? []
      : [
          // Nix (per-user profile, default profile, NixOS system profile).
          inDir(home, ".nix-profile", "bin"),
          "/nix/var/nix/profiles/default/bin/hermes",
          "/run/current-system/sw/bin/hermes",
          // Homebrew on Linux.
          "/home/linuxbrew/.linuxbrew/bin/hermes",
          // Official installer, root FHS layout.
          "/usr/local/bin/hermes",
          "/usr/local/lib/hermes-agent/venv/bin/hermes",
          "/usr/bin/hermes",
        ]),
  ];
  return [
    ...new Set(
      candidates
        .filter((value) => typeof value === "string" && value.length > 0)
        .map((value) => path.resolve(/** @type {string} */ (value))),
    ),
  ];
}

/**
 * First executable candidate, or null.
 * @param {Parameters<typeof hermesExecutableCandidates>[0]} input
 * @returns {Promise<string | null>}
 */
export async function findHermesExecutable(input) {
  for (const candidate of hermesExecutableCandidates(input)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the remaining known locations.
    }
  }
  return null;
}

/**
 * Candidate input from a process environment.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ home?: string | null, configured?: string | null }} [extra]
 */
export function hermesCandidateInputFromEnv(env, extra = {}) {
  return {
    explicit: env.KANA_HERMES_BIN,
    configured: extra.configured,
    pathValue: env.PATH,
    home: env.HOME?.trim() || extra.home,
    hermesHome: env.HERMES_HOME,
    installDirectory: env.HERMES_INSTALL_DIR,
    prefix: env.PREFIX,
    xdgBinHome: env.XDG_BIN_HOME,
    localAppData: env.LOCALAPPDATA,
    userProfile: env.USERPROFILE,
  };
}

/** @param {string} value */
function isHermesEntrypoint(value) {
  const base = path.basename(value);
  return base === "hermes" || base === "hermes.exe" || base === "hermes-agent" ||
    value.endsWith(`hermes_cli${path.sep}main.py`);
}

/**
 * Parses one process argv the way Hermes recognises its own `serve` shape
 * (`hermes serve`, `python …/hermes serve`, `python -m hermes_cli.main serve`).
 * Returns null for anything else, for Desktop's ephemeral `--port 0`, and for
 * non-loopback binds where Hermes rejects the legacy session token.
 * @param {readonly string[]} argv
 * @returns {{ port: number, host: string } | null}
 */
export function parseHermesServeArgv(argv) {
  let entry = -1;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (isHermesEntrypoint(token) || (token === "hermes_cli.main" && argv[index - 1] === "-m")) {
      entry = index;
      break;
    }
  }
  if (entry === -1) return null;
  const rest = argv.slice(entry + 1);
  if (!rest.includes("serve")) return null;

  /** @param {string} flag */
  const option = (flag) => {
    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === flag) return rest[index + 1];
      if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
    }
    return undefined;
  };
  const portText = option("--port");
  const port = portText === undefined ? HERMES_DEFAULT_PORT : Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  const host = option("--host") ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host)) return null;
  return { port, host };
}

/**
 * Lists `hermes serve` processes visible to this user. Linux only; returns an
 * empty list where /proc is unavailable.
 * @param {string} [procRoot]
 * @returns {Promise<Array<{ pid: number, port: number, host: string }>>}
 */
export async function scanHermesServeProcesses(procRoot = "/proc") {
  let entries;
  try {
    entries = await readdir(procRoot);
  } catch {
    return [];
  }
  const results = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    let cmdline;
    try {
      cmdline = await readFile(path.join(procRoot, entry, "cmdline"), "utf8");
    } catch {
      continue; // Exited meanwhile, or hidden by hidepid.
    }
    const argv = cmdline.split("\0").filter((part) => part.length > 0);
    const serve = parseHermesServeArgv(argv);
    if (serve) results.push({ pid, ...serve });
  }
  return results.sort((left, right) => left.pid - right.pid);
}

/**
 * Reads the session token Hermes was started with. Only readable for
 * processes owned by the same user (or root), which matches Kana's model of
 * running under the account that owns Hermes.
 * @param {number} pid
 * @param {string} [procRoot]
 * @returns {Promise<string | null>}
 */
export async function readHermesProcessToken(pid, procRoot = "/proc") {
  try {
    const environ = await readFile(path.join(procRoot, String(pid), "environ"), "utf8");
    const prefix = `${HERMES_TOKEN_ENV}=`;
    for (const entry of environ.split("\0")) {
      if (entry.startsWith(prefix)) {
        const value = entry.slice(prefix.length);
        return value.length > 0 ? value : null;
      }
    }
  } catch {
    // Not ours, exited, or no /proc.
  }
  return null;
}
