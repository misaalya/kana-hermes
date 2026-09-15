// Pinned Irodori TTS artifacts, shared by the `kana` launcher and the server.
// Plain ESM with Node built-ins only (see shared/data-dir.mjs).
//
// Everything Kana downloads for local speech is listed here with its exact
// size and SHA-256, so an upstream re-tag, a CDN swap, or a truncated download
// can never reach the engine unverified.
//
// Engine: https://github.com/misaalya/irodori-c (CPU inference engine in C)
// Model:  https://huggingface.co/phasefield-audio/Irodori-TTS-v4.1-Anime (MIT)

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * @typedef {{
 *   id: "engine" | "assets" | "model",
 *   url: string,
 *   sizeBytes: number,
 *   sha256: string,
 *   installedBytes: number,
 * }} IrodoriArtifact
 */

export const IRODORI_ENGINE_VERSION = "v0.2.0";
const RELEASE_BASE = `https://github.com/misaalya/irodori-c/releases/download/${IRODORI_ENGINE_VERSION}`;

/** Prebuilt Linux x86-64 binaries plus their bundled oneMKL/OpenBLAS runtime. @type {IrodoriArtifact} */
export const IRODORI_ENGINE_ARCHIVE = {
  id: "engine",
  url: `${RELEASE_BASE}/irodori-c-${IRODORI_ENGINE_VERSION}-linux-x86_64.tar.gz`,
  sizeBytes: 134_968_434,
  sha256: "ffa8a4e73da48b2471bcea6bf7ea47d202e6d3b950e9694fd10c52ee0dbcbae8",
  installedBytes: 414_043_694,
};

/** Tokenizer and DACVAE codec exports shared by every v4.1-Small checkpoint. @type {IrodoriArtifact} */
export const IRODORI_ASSETS_ARCHIVE = {
  id: "assets",
  url: `${RELEASE_BASE}/irodori-c-assets-${IRODORI_ENGINE_VERSION}.tar.gz`,
  sizeBytes: 345_636_152,
  sha256: "f99a171d83f6e16719f11df636306c401f6c4837384a60658f1830f3ce020984",
  installedBytes: 372_121_641,
};

export const IRODORI_MODEL_REPOSITORY = "phasefield-audio/Irodori-TTS-v4.1-Anime";
export const IRODORI_MODEL_REVISION = "6b259f5baa5e236b3d14cbd1f8555ca87d92b530";
export const IRODORI_MODEL_NAME = "Irodori-TTS v4.1 Anime";

/** FP32 checkpoint; the engine quantizes it to int8 at load time when supported. @type {IrodoriArtifact} */
export const IRODORI_MODEL_FILE = {
  id: "model",
  url: `https://huggingface.co/${IRODORI_MODEL_REPOSITORY}/resolve/${IRODORI_MODEL_REVISION}/model.safetensors`,
  sizeBytes: 3_064_295_596,
  sha256: "5630aa0a661930ff678a1d1f1893876e24520f4776d4fcc25ca54e6ab9f41f37",
  installedBytes: 3_064_295_596,
};

/** Files Kana keeps from the engine archive (the demo UI and scalar oracle are skipped). */
export const IRODORI_ENGINE_MEMBERS = ["bin/irodori-onemkl", "bin/irodori-blas", "lib", "licenses", "README-engine.md"];

/** Files Kana keeps from the assets archive. */
export const IRODORI_ASSET_MEMBERS = [
  "weights/tokenizer.bin",
  "weights/dacvae_decoder.safetensors",
  "weights/dacvae_encoder.safetensors",
];

export const IRODORI_ENGINE_MARKER = ".kana-install.json";
export const IRODORI_MODEL_MARKER = "model.verified.json";

/**
 * Install locations under the configured directory or `<data root>/irodori`.
 * @param {{ dataRoot: string, installDirectory?: string }} input
 */
export function irodoriInstallPaths({ dataRoot, installDirectory }) {
  const root = installDirectory ?? path.join(dataRoot, "irodori");
  const modelDirectory = path.join(root, "models", IRODORI_MODEL_REVISION);
  return {
    root,
    engineDirectory: path.join(root, `engine-${IRODORI_ENGINE_VERSION}`),
    modelDirectory,
    modelFile: path.join(modelDirectory, "model.safetensors"),
    downloads: path.join(root, "downloads"),
    temporary: path.join(root, "tmp"),
  };
}

/** @param {string} filePath @returns {Record<string, unknown> | null} */
function readJson(filePath) {
  try {
    const value = JSON.parse(readFileSync(/* turbopackIgnore: true */ filePath, "utf8"));
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}

/** @param {ReturnType<typeof irodoriInstallPaths>} paths */
export function irodoriEngineInstalled(paths) {
  const marker = readJson(path.join(paths.engineDirectory, IRODORI_ENGINE_MARKER));
  return (
    marker?.engineSha256 === IRODORI_ENGINE_ARCHIVE.sha256 &&
    marker?.assetsSha256 === IRODORI_ASSETS_ARCHIVE.sha256 &&
    [...IRODORI_ENGINE_MEMBERS, ...IRODORI_ASSET_MEMBERS].every((member) =>
      existsSync(/* turbopackIgnore: true */ path.join(paths.engineDirectory, member)),
    )
  );
}

/**
 * The verified model file and its origin, or null when it still has to be
 * installed. A configured path is trusted as the operator's choice.
 * @param {ReturnType<typeof irodoriInstallPaths>} paths
 * @param {string | undefined} configuredModelPath
 * @returns {{ path: string, source: "download" | "huggingface-cache" | "config" } | null}
 */
export function irodoriInstalledModel(paths, configuredModelPath) {
  if (configuredModelPath) return existsSync(/* turbopackIgnore: true */ configuredModelPath) ? { path: configuredModelPath, source: "config" } : null;
  const marker = readJson(path.join(paths.modelDirectory, IRODORI_MODEL_MARKER));
  if (!marker || marker.sha256 !== IRODORI_MODEL_FILE.sha256 || typeof marker.path !== "string") return null;
  let details;
  try {
    details = statSync(/* turbopackIgnore: true */ marker.path);
  } catch {
    return null;
  }
  // A replaced file (different size or mtime) must be verified again.
  if (details.size !== IRODORI_MODEL_FILE.sizeBytes || details.mtimeMs !== marker.mtimeMs) return null;
  return { path: marker.path, source: marker.path === paths.modelFile ? "download" : "huggingface-cache" };
}
