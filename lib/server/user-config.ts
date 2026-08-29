import {
  existsSync,
  mkdirSync,
  readFileSync,
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
    /** The server-side audio source. Defaults to the bundled local provider. */
    provider?: KanaTtsProviderType;
    /** Provider-specific values are isolated so model/voice fields cannot clash. */
    qwen3Local?: KanaQwen3LocalConfig;
    openAiCompatible?: KanaOpenAiCompatibleTtsConfig;
  };
};

export type KanaTtsProviderType = "qwen3-local" | "openai-compatible";
export type KanaOpenAiTtsPreset = "pollinations";
export type KanaTtsResponseFormat = "mp3" | "opus" | "aac" | "flac" | "wav";
export type KanaQwen3TtsDtype = "auto" | "float32" | "float16" | "bfloat16";

export type KanaQwen3LocalConfig = {
  projectDirectory?: string;
  uvExecutable?: string;
  runtimeDirectory?: string;
  cacheDirectory?: string;
  dataDirectory?: string;
  port?: number;
  model?: string;
  modelRevision?: string | null;
  device?: string;
  dtype?: KanaQwen3TtsDtype;
  attention?: string;
  defaultVoice?: string;
  maxCharacters?: number;
  maxNewTokens?: number;
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

function optionalNullableString(
  record: Record<string, unknown>,
  key: string,
  section: string,
): string | null | undefined {
  if (record[key] === null) return null;
  return optionalString(record, key, section);
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

export function defaultQwen3LocalConfig(): Required<
  Pick<
    KanaQwen3LocalConfig,
    | "port"
    | "model"
    | "modelRevision"
    | "device"
    | "dtype"
    | "attention"
    | "maxCharacters"
    | "maxNewTokens"
  >
> {
  const config = DEFAULT_KANA_USER_CONFIG.tts?.qwen3Local;
  if (
    !config?.port ||
    !config.model ||
    config.modelRevision === undefined ||
    !config.device ||
    !config.dtype ||
    !config.attention ||
    !config.maxCharacters ||
    !config.maxNewTokens
  ) {
    throw new Error("Kana's bundled Qwen3-TTS defaults are incomplete.");
  }
  return {
    port: config.port,
    model: config.model,
    modelRevision: config.modelRevision,
    device: config.device,
    dtype: config.dtype,
    attention: config.attention,
    maxCharacters: config.maxCharacters,
    maxNewTokens: config.maxNewTokens,
  };
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

/**
 * Read the optional, server-owned advanced configuration. This file is the
 * single user-facing source for Hermes and TTS runtime configuration and is
 * never sent to the browser.
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
      provider !== "qwen3-local" &&
      provider !== "openai-compatible"
    ) {
      throw new Error(
        'tts.provider must be either "qwen3-local" or "openai-compatible".',
      );
    }
    const usesNestedProviderConfig =
      ttsRecord.qwen3Local !== undefined ||
      ttsRecord.openAiCompatible !== undefined;
    const legacyExternalConfig =
      !usesNestedProviderConfig &&
      [
        "preset",
        "baseUrl",
        "apiKey",
        "defaultInstruction",
        "instructionField",
        "responseFormat",
      ].some((key) => ttsRecord[key] !== undefined);
    const resolvedProvider = provider ??
      (legacyExternalConfig ? "openai-compatible" : undefined);
    const qwenRecord = ttsRecord.qwen3Local === undefined
      ? resolvedProvider === "openai-compatible" ? {} : ttsRecord
      : ttsRecord.qwen3Local;
    if (!isRecord(qwenRecord)) {
      throw new Error("tts.qwen3Local must be a JSON object.");
    }
    const openAiRecord = ttsRecord.openAiCompatible === undefined
      ? resolvedProvider === "openai-compatible" ? ttsRecord : {}
      : ttsRecord.openAiCompatible;
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
    const dtype = optionalString(qwenRecord, "dtype", "tts.qwen3Local");
    if (
      dtype !== undefined &&
      !["auto", "float32", "float16", "bfloat16"].includes(dtype)
    ) {
      throw new Error(
        "tts.qwen3Local.dtype must be auto, float32, float16, or bfloat16.",
      );
    }
    const qwen3Local = withoutUndefined<KanaQwen3LocalConfig>({
        projectDirectory: optionalAbsolutePath(
          qwenRecord,
          "projectDirectory",
          "tts.qwen3Local",
        ),
        uvExecutable: optionalAbsolutePath(
          qwenRecord,
          "uvExecutable",
          "tts.qwen3Local",
        ),
        runtimeDirectory: optionalAbsolutePath(
          qwenRecord,
          "runtimeDirectory",
          "tts.qwen3Local",
        ),
        cacheDirectory: optionalAbsolutePath(
          qwenRecord,
          "cacheDirectory",
          "tts.qwen3Local",
        ),
        dataDirectory: optionalAbsolutePath(
          qwenRecord,
          "dataDirectory",
          "tts.qwen3Local",
        ),
        port: optionalPort(qwenRecord, "port", "tts.qwen3Local"),
        model: optionalString(qwenRecord, "model", "tts.qwen3Local"),
        modelRevision: optionalNullableString(
          qwenRecord,
          "modelRevision",
          "tts.qwen3Local",
        ),
        device: optionalString(qwenRecord, "device", "tts.qwen3Local"),
        dtype: dtype as KanaQwen3TtsDtype | undefined,
        attention: optionalString(qwenRecord, "attention", "tts.qwen3Local"),
        defaultVoice: optionalString(qwenRecord, "defaultVoice", "tts.qwen3Local"),
        maxCharacters: optionalPositiveInteger(
          qwenRecord,
          "maxCharacters",
          "tts.qwen3Local",
          100_000,
        ),
        maxNewTokens: optionalPositiveInteger(
          qwenRecord,
          "maxNewTokens",
          "tts.qwen3Local",
          100_000,
        ),
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
      provider: resolvedProvider as KanaTtsProviderType | undefined,
      ...(Object.keys(qwen3Local).length ? { qwen3Local } : {}),
      ...(Object.keys(openAiCompatible).length ? { openAiCompatible } : {}),
    };
  }
  return config;
}

/**
 * Explicit operator intent wins over framework build mode. This matters when
 * `next dev` is intentionally placed behind Nginx on a VPS, or a production
 * standalone build is used only on localhost.
 */
export function resolveKanaDeploymentMode(): KanaDeploymentModeResolution {
  const fromEnvironment = process.env.KANA_DEPLOYMENT_MODE?.trim().toLowerCase();
  if (fromEnvironment) {
    if (fromEnvironment !== "local" && fromEnvironment !== "deployment") {
      throw new Error(
        'KANA_DEPLOYMENT_MODE must be either "local" or "deployment".',
      );
    }
    return { mode: fromEnvironment, source: "environment" };
  }
  const fromConfig = readKanaUserConfig().deployment?.mode;
  return fromConfig
    ? { mode: fromConfig, source: "config" }
    : { mode: "local", source: "default" };
}
