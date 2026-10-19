import { readFileSync } from "node:fs";
import { kanaUserConfigPath } from "@/lib/server/user-config";
import { isJsonRecord } from "./protocol";

/**
 * The `guardrails` block of config.json: a TypeSafe/Jev prompt guardrail whose
 * rules the owner writes in natural language, and which Kana only ever reads.
 *
 * Kana has no writer for config.json at all — it is created once, owner-only,
 * 0600, and never replaced (lib/server/user-config.ts) — so no route, setting,
 * or browser request can change these rules.
 *
 * The block is parsed here rather than through parseKanaUserConfigFile so that
 * a mistake in a rule cannot take down the rest of Kana's configuration, and a
 * mistake in another block cannot silently disable the guardrail.
 *
 * Truth in code: https://docs.typesafe.ai/api for the request this rides on.
 */

export type KanaGuardrailUnavailableAction = "block" | "allow";

export type KanaGuardrailsConfig = {
  /** Server-only TypeSafe key. An unset or empty key disables the layer. */
  apiKey?: string;
  /** A TypeSafe model alias or versioned id; defaults to jev-latest. */
  model?: string;
  /** Probability at or above which the screening refuses the prompt. */
  threshold?: number;
  /** What Kana does with a prompt it could not check. */
  whenUnavailable?: KanaGuardrailUnavailableAction;
  /** Whole screening request, including the network round trip. */
  timeoutSeconds?: number;
  /**
   * The owner's rules, each written as one natural-language statement of what
   * Kana must not do. Kana turns them into the question it asks Jev; the owner
   * never writes a question, an id, or a threshold per rule.
   */
  rules?: string[];
};

export const DEFAULT_GUARDRAIL_MODEL = "jev-latest";
export const DEFAULT_GUARDRAIL_THRESHOLD = 0.7;
export const DEFAULT_GUARDRAIL_TIMEOUT_SECONDS = 10;
export const DEFAULT_GUARDRAIL_WHEN_UNAVAILABLE: KanaGuardrailUnavailableAction = "block";
/** Rules per request; they travel in the question, so this stays small. */
export const MAX_GUARDRAIL_RULES = 50;
export const MAX_GUARDRAIL_RULE_CHARACTERS = 1_000;
const MAX_API_KEY_CHARACTERS = 4_096;

export type GuardrailPolicy = {
  apiKey: string;
  model: string;
  /** Probability at or above which the screening refuses the prompt. */
  threshold: number;
  timeoutMs: number;
  whenUnavailable: KanaGuardrailUnavailableAction;
  /** The owner's rules, in their own words, ready to send. */
  rules: string[];
};

function optionalString(
  record: Record<string, unknown>,
  key: string,
  section: string,
  maximumLength: number,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${section}.${key} must be a non-empty string.`);
  }
  if (value.length > maximumLength) {
    throw new Error(`${section}.${key} must be ${maximumLength} characters or fewer.`);
  }
  return value.trim();
}

function optionalProbability(
  record: Record<string, unknown>,
  key: string,
  section: string,
): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${section}.${key} must be a probability between 0 and 1.`);
  }
  return value;
}

function parseRule(value: unknown, index: number): string {
  const section = `guardrails.rules[${index}]`;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${section} must be a non-empty string: one rule, in your own words.`);
  }
  if (value.length > MAX_GUARDRAIL_RULE_CHARACTERS) {
    throw new Error(`${section} must be ${MAX_GUARDRAIL_RULE_CHARACTERS} characters or fewer.`);
  }
  // One line, no runs of whitespace: the rule is sent as data, and indentation
  // in a JSON string is noise Jev does not need.
  return value.replaceAll(/\s+/g, " ").trim();
}

/** Validate the `guardrails` block. Throws on anything Kana cannot honour. */
export function parseGuardrailsConfig(value: unknown): KanaGuardrailsConfig {
  if (!isJsonRecord(value)) throw new Error("guardrails must be a JSON object.");
  const config: KanaGuardrailsConfig = {};
  const apiKey = optionalString(value, "apiKey", "guardrails", MAX_API_KEY_CHARACTERS);
  if (apiKey !== undefined) config.apiKey = apiKey;
  const model = optionalString(value, "model", "guardrails", 200);
  if (model !== undefined) {
    if (!/^[\w.:-]+$/.test(model)) {
      throw new Error('guardrails.model must be a TypeSafe model name, such as "jev-latest".');
    }
    config.model = model;
  }
  const threshold = optionalProbability(value, "threshold", "guardrails");
  if (threshold !== undefined) config.threshold = threshold;
  const whenUnavailable = optionalString(value, "whenUnavailable", "guardrails", 20);
  if (whenUnavailable !== undefined) {
    if (whenUnavailable !== "block" && whenUnavailable !== "allow") {
      throw new Error('guardrails.whenUnavailable must be either "block" or "allow".');
    }
    config.whenUnavailable = whenUnavailable;
  }
  const timeoutSeconds = value.timeoutSeconds;
  if (timeoutSeconds !== undefined) {
    if (!Number.isInteger(timeoutSeconds) || Number(timeoutSeconds) < 1 || Number(timeoutSeconds) > 120) {
      throw new Error("guardrails.timeoutSeconds must be an integer between 1 and 120.");
    }
    config.timeoutSeconds = Number(timeoutSeconds);
  }
  if (value.rules !== undefined) {
    if (!Array.isArray(value.rules)) throw new Error("guardrails.rules must be an array.");
    if (value.rules.length > MAX_GUARDRAIL_RULES) {
      throw new Error(`guardrails.rules must have at most ${MAX_GUARDRAIL_RULES} entries.`);
    }
    config.rules = value.rules.map(parseRule);
  }
  return config;
}

/**
 * The screening the config asks for, or null when nothing should be screened:
 * no API key (the layer is off), or a key with no rules (nothing to check).
 * Both are the owner's explicit choice, so neither sends a request.
 */
export function resolveGuardrailPolicy(config: KanaGuardrailsConfig): GuardrailPolicy | null {
  if (!config.apiKey) return null;
  const rules = config.rules ?? [];
  if (!rules.length) return null;
  return {
    apiKey: config.apiKey,
    model: config.model ?? DEFAULT_GUARDRAIL_MODEL,
    threshold: config.threshold ?? DEFAULT_GUARDRAIL_THRESHOLD,
    timeoutMs: (config.timeoutSeconds ?? DEFAULT_GUARDRAIL_TIMEOUT_SECONDS) * 1_000,
    whenUnavailable: config.whenUnavailable ?? DEFAULT_GUARDRAIL_WHEN_UNAVAILABLE,
    rules: [...rules],
  };
}

export type GuardrailConfigLoad =
  | { kind: "disabled"; reason: string }
  | { kind: "enabled"; policy: GuardrailPolicy }
  | { kind: "invalid"; error: string; whenUnavailable: KanaGuardrailUnavailableAction };

/** What a status surface may show: never the key itself, only what it does. */
export type GuardrailSummary = {
  state: "disabled" | "enabled" | "invalid";
  /** Rules that would be sent, when the guardrail is enabled. */
  rules: number;
  /** Why it is not screening, for the owner reading the docs page. */
  reason: string | null;
};

export function summarizeGuardrail(load: GuardrailConfigLoad): GuardrailSummary {
  if (load.kind === "enabled") {
    return { state: "enabled", rules: load.policy.rules.length, reason: null };
  }
  if (load.kind === "disabled") return { state: "disabled", rules: 0, reason: load.reason };
  return { state: "invalid", rules: 0, reason: load.error };
}

function readConfigFile(): { raw: string } | { missing: true } | { error: string } {
  const filePath = kanaUserConfigPath();
  try {
    return { raw: readFileSync(filePath, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { missing: true };
    return { error: `Kana could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Read the guardrail the owner configured. Never throws: a broken block is
 * reported instead, and the failure action is read from the raw block first so
 * the owner keeps the escape hatch even while a rule is invalid.
 */
export function loadGuardrailConfig(): GuardrailConfigLoad {
  const read = readConfigFile();
  if ("missing" in read) return { kind: "disabled", reason: "config.json does not exist yet" };
  if ("error" in read) {
    return { kind: "invalid", error: read.error, whenUnavailable: DEFAULT_GUARDRAIL_WHEN_UNAVAILABLE };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.raw);
  } catch (error) {
    return {
      kind: "invalid",
      error: `Kana could not read ${kanaUserConfigPath()}: ${error instanceof Error ? error.message : String(error)}`,
      whenUnavailable: DEFAULT_GUARDRAIL_WHEN_UNAVAILABLE,
    };
  }
  if (!isJsonRecord(parsed) || parsed.guardrails === undefined) {
    return { kind: "disabled", reason: "config.json has no guardrails block" };
  }
  const declared = isJsonRecord(parsed.guardrails) ? parsed.guardrails.whenUnavailable : undefined;
  const whenUnavailable: KanaGuardrailUnavailableAction = declared === "allow" ? "allow" : "block";
  let config: KanaGuardrailsConfig;
  try {
    config = parseGuardrailsConfig(parsed.guardrails);
  } catch (error) {
    return {
      kind: "invalid",
      error: error instanceof Error ? error.message : String(error),
      whenUnavailable,
    };
  }
  const policy = resolveGuardrailPolicy(config);
  if (!policy) {
    return {
      kind: "disabled",
      reason: config.apiKey ? "guardrails.rules is empty" : "guardrails.apiKey is empty",
    };
  }
  return { kind: "enabled", policy };
}