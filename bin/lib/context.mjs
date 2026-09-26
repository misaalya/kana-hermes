// Paths and configuration the launcher needs before starting the server.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveKanaDataDirFrom } from "../../shared/data-dir.mjs";

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));

/** The published package ships a prebuilt runtime; a checkout uses its standalone build. */
export const isPublishedPackage = manifest.name === "kana-alya";

/**
 * Where server.js lives: the npm package's bundled runtime, a deployed
 * standalone directory (launcher copied next to server.js), or a checkout's
 * `.next/standalone` build.
 */
export const runtimeRoot = isPublishedPackage
  ? path.join(packageRoot, ".npm-package", "runtime")
  : existsSync(path.join(packageRoot, "server.js"))
    ? packageRoot
    : path.join(packageRoot, ".next", "standalone");

/**
 * The command that sets the access password on this kind of install; the
 * login page shows it until a password exists. docs/SECURITY.md lists the
 * same three.
 */
export const passwordCommand = isPublishedPackage
  ? "kana password"
  : runtimeRoot === packageRoot
    ? "node bin/kana.mjs password"
    : "npm run password";

export const userHome = process.env.HOME?.trim() || homedir();

export const defaultConfig = JSON.parse(
  readFileSync(path.join(packageRoot, "config", "default-config.json"), "utf8"),
);

export function resolveDataRoot(env = process.env) {
  return resolveKanaDataDirFrom({
    kanaDataDir: env.KANA_DATA_DIR,
    xdgDataHome: env.XDG_DATA_HOME,
    home: userHome,
  });
}

export function configPath(dataRoot) {
  return path.join(dataRoot, "config.json");
}

/**
 * Reads config.json without throwing; the server validates it in full and
 * reports problems in Settings, so the launcher only needs a best effort.
 * @returns {{ value: Record<string, any>, error: string | null }}
 */
export function readConfigSafely(dataRoot) {
  const file = configPath(dataRoot);
  if (!existsSync(file)) return { value: {}, error: null };
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { value: {}, error: `${file} must contain a JSON object.` };
    }
    return { value, error: null };
  } catch (error) {
    return { value: {}, error: `${file}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * The voice service config.json selects, read the way the server reads it:
 * "irodori-local" (also the Qwen-era "qwen3-local") or "pollinations",
 * including configs from when Pollinations was an "openai-compatible" preset.
 * @param {Record<string, any>} config
 * @returns {string}
 */
export function voiceProviderName(config) {
  const tts = config.tts ?? {};
  const legacy = tts.openAiCompatible ?? tts;
  if (tts.provider === "pollinations" || (tts.provider === undefined && tts.pollinations !== undefined)) {
    return "pollinations";
  }
  if (tts.provider === "openai-compatible" || (tts.provider === undefined && tts.openAiCompatible !== undefined)) {
    return legacy.preset === "pollinations" ? "pollinations" : "openai-compatible (no longer supported)";
  }
  return "irodori-local";
}

/** Server entry for this installation, or a reason it is not runnable yet. */
export function serverEntry() {
  const entry = path.join(runtimeRoot, "server.js");
  if (!existsSync(entry)) {
    return {
      entry: null,
      problem: isPublishedPackage
        ? "This Kana package is missing its web runtime. Reinstall it with `npm install -g kana-alya`."
        : "Kana has not been built in this checkout yet. Run `npm run package:local` first.",
    };
  }
  if (!existsSync(path.join(runtimeRoot, ".next", "static"))) {
    return {
      entry: null,
      problem: "The standalone build is incomplete (static assets are missing). Run `npm run package:local`.",
    };
  }
  return { entry, problem: null };
}
