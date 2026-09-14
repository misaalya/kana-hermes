// Data-root resolution shared by the `kana` launcher and the Next.js server.
// Plain ESM with Node built-ins only: the launcher ships without the bundled
// server's dependencies, so both sides must agree through this one module.

import path from "node:path";

export const KANA_DATA_DIR_ENV = "KANA_DATA_DIR";

/**
 * Precedence: KANA_DATA_DIR (absolute) → $XDG_DATA_HOME/kana (absolute only,
 * per the XDG spec) → $HOME/.local/share/kana.
 *
 * @param {{ kanaDataDir?: string | null, xdgDataHome?: string | null, home?: string | null }} input
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
