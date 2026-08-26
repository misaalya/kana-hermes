import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveKanaDataDir } from "./data-dir";

export type KanaUserConfig = {
  hermes?: {
    executable?: string;
    port?: number;
    workingDirectory?: string;
  };
  tts?: {
    projectDirectory?: string;
    uvExecutable?: string;
    port?: number;
    model?: string;
    device?: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  section: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${section}.${key} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalAbsolutePath(
  record: Record<string, unknown>,
  key: string,
  section: string,
): string | undefined {
  const value = optionalString(record, key, section);
  if (value === undefined) return undefined;
  if (!path.isAbsolute(value)) {
    throw new Error(`${section}.${key} must be an absolute path.`);
  }
  return path.normalize(value);
}

function optionalPort(
  record: Record<string, unknown>,
  key: string,
  section: string,
): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 1024 || Number(value) > 65_535) {
    throw new Error(`${section}.${key} must be an integer between 1024 and 65535.`);
  }
  return Number(value);
}

export function kanaUserConfigPath(): string {
  return path.join(resolveKanaDataDir(), "config.json");
}

/**
 * Read the optional, server-owned advanced configuration. Environment
 * variables retain the highest precedence in each runtime; this file is the
 * approachable self-hosting fallback and is never sent to the browser.
 */
export function readKanaUserConfig(): KanaUserConfig {
  const filePath = kanaUserConfigPath();
  if (!existsSync(filePath)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Kana could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(`Kana configuration at ${filePath} must be a JSON object.`);
  }

  const config: KanaUserConfig = {};
  if (parsed.hermes !== undefined) {
    if (!isRecord(parsed.hermes)) throw new Error("hermes must be a JSON object.");
    config.hermes = {
      executable: optionalAbsolutePath(parsed.hermes, "executable", "hermes"),
      port: optionalPort(parsed.hermes, "port", "hermes"),
      workingDirectory: optionalAbsolutePath(parsed.hermes, "workingDirectory", "hermes"),
    };
  }
  if (parsed.tts !== undefined) {
    if (!isRecord(parsed.tts)) throw new Error("tts must be a JSON object.");
    config.tts = {
      projectDirectory: optionalAbsolutePath(parsed.tts, "projectDirectory", "tts"),
      uvExecutable: optionalAbsolutePath(parsed.tts, "uvExecutable", "tts"),
      port: optionalPort(parsed.tts, "port", "tts"),
      model: optionalString(parsed.tts, "model", "tts"),
      device: optionalString(parsed.tts, "device", "tts"),
    };
  }
  return config;
}
