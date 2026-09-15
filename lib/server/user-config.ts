import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import defaultUserConfig from "@/config/default-config.json";
import { resolveKanaDataDir } from "./data-dir";

export type KanaUserConfig = {
  deployment?: {
    mode: KanaDeploymentMode;
  };
  hermes?: {
    executable?: string;
    port?: number;
    workingDirectory?: string;
  };
  tts?: {
    /** The server-side audio source. Defaults to the local Irodori engine. */
    provider?: KanaTtsProviderType;
    /** Entire synthesis request, including queueing behind another utterance. */
    timeoutSeconds?: number;
    /** Provider-specific values are isolated so model/voice fields cannot clash. */
    irodoriLocal?: KanaIrodoriLocalConfig;
    openAiCompatible?: KanaOpenAiCompatibleTtsConfig;
  };
};

export type KanaTtsProviderType = "irodori-local" | "openai-compatible";
export type KanaOpenAiTtsPreset = "pollinations";
export type KanaTtsResponseFormat = "mp3" | "opus" | "aac" | "flac" | "wav";
export type KanaIrodoriPrecision = "auto" | "int8" | "fp32";

export type KanaIrodoriLocalConfig = {
  /** Where Kana installs the engine and model; defaults to <data root>/irodori. */
  installDirectory?: string;
  /** An existing Irodori v4.1 model.safetensors to use instead of downloading one. */
  modelPath?: string;
  /** Engine threads; defaults to the number of physical CPU cores. */
  threads?: number;
  /** Euler sampling steps: 8 is fastest, 40 is the engine's quality default. */
  steps?: number;
  /** int8 needs AVX-512 VNNI; auto picks int8 when the CPU supports it. */
  precision?: KanaIrodoriPrecision;
};

export type KanaOpenAiCompatibleTtsConfig = {
  /** Optional defaults/capabilities for a known OpenAI-compatible service. */
  preset?: KanaOpenAiTtsPreset;
  /** API root (for example https://host.example/v1) or full speech endpoint. */
  baseUrl?: string;
  /** Server-only user credential. This value is never returned by Kana APIs. */
  apiKey?: string;
  model?: string;
  voice?: string;
  defaultInstruction?: string;
  /** Opt-in request field for providers that support voice instructions. */
  instructionField?: string;
  responseFormat?: KanaTtsResponseFormat;
};

export type KanaDeploymentMode = "local" | "deployment";
export type KanaDeploymentModeResolution = {
  mode: KanaDeploymentMode;
  source: "environment" | "config" | "default";
  /** An invalid environment value or config.json problem, if any. */
  error: string | null;
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

function optionalStringWithLimit(
  record: Record<string, unknown>,
  key: string,
  section: string,
  maximumLength: number,
): string | undefined {
  const value = optionalString(record, key, section);
  if (value !== undefined && value.length > maximumLength) {
    throw new Error(`${section}.${key} must be ${maximumLength} characters or fewer.`);
  }
  return value;
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

function optionalPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  section: string,
  maximum: number,
): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > maximum) {
    throw new Error(`${section}.${key} must be an integer between 1 and ${maximum}.`);
  }
  return Number(value);
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

export function kanaUserConfigPath(): string {
  return path.join(resolveKanaDataDir(), "config.json");
}

export const DEFAULT_KANA_USER_CONFIG = defaultUserConfig as KanaUserConfig;

export function defaultIrodoriLocalConfig(): Required<Pick<KanaIrodoriLocalConfig, "steps" | "precision">> {
  const config = DEFAULT_KANA_USER_CONFIG.tts?.irodoriLocal;
  if (!config?.steps || !config.precision) {
    throw new Error("Kana's bundled Irodori voice defaults are incomplete.");
  }
  return { steps: config.steps, precision: config.precision };
}

/** Create an editable, owner-only JSON file without replacing existing data. */
export function ensureKanaUserConfigFile(): string {
  const filePath = kanaUserConfigPath();
  if (existsSync(filePath)) return filePath;
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(filePath, `${JSON.stringify(DEFAULT_KANA_USER_CONFIG, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
  }
  return filePath;
}

export type KanaUserConfigInspection = {
  path: string;
  config: KanaUserConfig;
  /** Why config.json could not be used; the config is then empty (defaults). */
  error: string | null;
};

type ConfigCache = { signature: string; inspection: KanaUserConfigInspection };
const configCacheKey = Symbol.for("kana.userConfigCache");
type ConfigCacheGlobal = typeof globalThis & { [configCacheKey]?: ConfigCache };

function fileSignature(filePath: string): string | null {
  try {
    const details = statSync(filePath);
    return `${filePath}:${details.ino}:${details.size}:${details.mtimeMs}:${details.ctimeMs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Read and validate config.json without throwing. The parsed result is cached
 * per file identity (inode, size, mtime), so hot paths such as speech requests
 * do not re-read the file, while an edit takes effect on the next request.
 */
export function inspectKanaUserConfig(): KanaUserConfigInspection {
  const filePath = kanaUserConfigPath();
  let signature: string | null;
  try {
    signature = fileSignature(filePath);
  } catch (error) {
    return {
      path: filePath,
      config: {},
      error: `Kana could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (signature === null) return { path: filePath, config: {}, error: null };

  const shared = globalThis as ConfigCacheGlobal;
  const cached = shared[configCacheKey];
  if (cached?.signature === signature) return cached.inspection;

  let inspection: KanaUserConfigInspection;
  try {
    inspection = { path: filePath, config: parseKanaUserConfigFile(filePath), error: null };
  } catch (error) {
    inspection = {
      path: filePath,
      config: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
  shared[configCacheKey] = { signature, inspection };
  return inspection;
}

/**
 * Read the optional, server-owned advanced configuration. This file is the
 * single user-facing source for Hermes and TTS runtime configuration and is
 * never sent to the browser. Integrations call this and fail honestly on an
 * invalid file; status surfaces use inspectKanaUserConfig() instead.
 */
export function readKanaUserConfig(): KanaUserConfig {
  const inspection = inspectKanaUserConfig();
  if (inspection.error) throw new Error(inspection.error);
  return inspection.config;
}

function parseKanaUserConfigFile(filePath: string): KanaUserConfig {
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
  if (parsed.deployment !== undefined) {
    if (!isRecord(parsed.deployment)) {
      throw new Error("deployment must be a JSON object.");
    }
    const mode = optionalString(parsed.deployment, "mode", "deployment");
    if (mode !== "local" && mode !== "deployment") {
      throw new Error('deployment.mode must be either "local" or "deployment".');
    }
    config.deployment = { mode };
  }
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
    const ttsRecord = parsed.tts;
    const provider = optionalString(ttsRecord, "provider", "tts");
    if (
      provider !== undefined &&
      provider !== "irodori-local" &&
      provider !== "openai-compatible" &&
      // Builds before Irodori used a local Qwen3-TTS service; its slot is now
      // the local Irodori engine, and the old qwen3Local block is ignored.
      provider !== "qwen3-local"
    ) {
      throw new Error(
        'tts.provider must be either "irodori-local" or "openai-compatible".',
      );
    }
    const legacyExternalConfig =
      ttsRecord.openAiCompatible === undefined &&
      [
        "preset",
        "baseUrl",
        "apiKey",
        "defaultInstruction",
        "instructionField",
        "responseFormat",
      ].some((key) => ttsRecord[key] !== undefined);
    if (provider === undefined && ttsRecord.irodoriLocal !== undefined && ttsRecord.openAiCompatible !== undefined) {
      throw new Error("Set tts.provider when keeping both local and external configurations.");
    }
    const resolvedProvider: KanaTtsProviderType = provider === "openai-compatible" ||
      (provider === undefined && (legacyExternalConfig || ttsRecord.openAiCompatible !== undefined))
      ? "openai-compatible"
      : "irodori-local";
    // Inactive values stay untouched on disk and cannot break the selected provider.
    const irodoriRecord = resolvedProvider === "irodori-local" ? (ttsRecord.irodoriLocal ?? {}) : {};
    if (!isRecord(irodoriRecord)) {
      throw new Error("tts.irodoriLocal must be a JSON object.");
    }
    const openAiRecord = resolvedProvider === "openai-compatible"
      ? (ttsRecord.openAiCompatible === undefined ? ttsRecord : ttsRecord.openAiCompatible)
      : {};
    if (!isRecord(openAiRecord)) {
      throw new Error("tts.openAiCompatible must be a JSON object.");
    }

    const preset = optionalString(openAiRecord, "preset", "tts.openAiCompatible");
    if (preset !== undefined && preset !== "pollinations") {
      throw new Error(
        'tts.openAiCompatible.preset currently supports only "pollinations".',
      );
    }
    const responseFormat = optionalString(
      openAiRecord,
      "responseFormat",
      "tts.openAiCompatible",
    );
    const responseFormats: KanaTtsResponseFormat[] = [
      "mp3",
      "opus",
      "aac",
      "flac",
      "wav",
    ];
    if (
      responseFormat !== undefined &&
      !responseFormats.includes(responseFormat as KanaTtsResponseFormat)
    ) {
      throw new Error(
        `tts.openAiCompatible.responseFormat must be one of: ${responseFormats.join(", ")}.`,
      );
    }
    const instructionField = optionalStringWithLimit(
      openAiRecord,
      "instructionField",
      "tts.openAiCompatible",
      64,
    );
    if (
      instructionField !== undefined &&
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(instructionField)
    ) {
      throw new Error(
        "tts.openAiCompatible.instructionField must be a simple JSON field name.",
      );
    }
    if (["model", "input", "voice", "response_format"].includes(instructionField ?? "")) {
      throw new Error(
        "tts.openAiCompatible.instructionField cannot replace a standard speech field.",
      );
    }
    const precision = optionalString(irodoriRecord, "precision", "tts.irodoriLocal");
    if (precision !== undefined && !["auto", "int8", "fp32"].includes(precision)) {
      throw new Error("tts.irodoriLocal.precision must be auto, int8, or fp32.");
    }
    const irodoriLocal = withoutUndefined<KanaIrodoriLocalConfig>({
      installDirectory: optionalAbsolutePath(irodoriRecord, "installDirectory", "tts.irodoriLocal"),
      modelPath: optionalAbsolutePath(irodoriRecord, "modelPath", "tts.irodoriLocal"),
      threads: optionalPositiveInteger(irodoriRecord, "threads", "tts.irodoriLocal", 256),
      steps: optionalPositiveInteger(irodoriRecord, "steps", "tts.irodoriLocal", 200),
      precision: precision as KanaIrodoriPrecision | undefined,
    });
    const openAiCompatible = withoutUndefined<KanaOpenAiCompatibleTtsConfig>({
        preset: preset as KanaOpenAiTtsPreset | undefined,
        baseUrl: optionalStringWithLimit(
          openAiRecord,
          "baseUrl",
          "tts.openAiCompatible",
          2_048,
        ),
        apiKey: optionalStringWithLimit(
          openAiRecord,
          "apiKey",
          "tts.openAiCompatible",
          16_384,
        ),
        model: optionalString(openAiRecord, "model", "tts.openAiCompatible"),
        voice: optionalStringWithLimit(
          openAiRecord,
          "voice",
          "tts.openAiCompatible",
          500,
        ),
        defaultInstruction: optionalStringWithLimit(
          openAiRecord,
          "defaultInstruction",
          "tts.openAiCompatible",
          8_000,
        ),
        instructionField,
        responseFormat: responseFormat as KanaTtsResponseFormat | undefined,
      });
    config.tts = {
      provider: resolvedProvider,
      ...withoutUndefined({ timeoutSeconds: optionalPositiveInteger(ttsRecord, "timeoutSeconds", "tts", 3600) }),
      ...(Object.keys(irodoriLocal).length ? { irodoriLocal } : {}),
      ...(Object.keys(openAiCompatible).length ? { openAiCompatible } : {}),
    };
  }
  return config;
}

/**
 * Explicit operator intent wins over framework build mode. This matters when
 * `next dev` is intentionally placed behind Nginx on a VPS, or a production
 * standalone build is used only on localhost. Never throws: an invalid value
 * falls back to "local" and is reported through `error`.
 */
export function resolveKanaDeploymentMode(): KanaDeploymentModeResolution {
  const fromEnvironment = process.env.KANA_DEPLOYMENT_MODE?.trim().toLowerCase();
  if (fromEnvironment) {
    if (fromEnvironment !== "local" && fromEnvironment !== "deployment") {
      return {
        mode: "local",
        source: "default",
        error: 'KANA_DEPLOYMENT_MODE must be either "local" or "deployment".',
      };
    }
    return { mode: fromEnvironment, source: "environment", error: null };
  }
  const inspection = inspectKanaUserConfig();
  const fromConfig = inspection.config.deployment?.mode;
  return fromConfig
    ? { mode: fromConfig, source: "config", error: inspection.error }
    : { mode: "local", source: "default", error: inspection.error };
}
