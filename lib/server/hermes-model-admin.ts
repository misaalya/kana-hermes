import { localHermesDashboardJson, managedRuntimePort } from "./local-hermes-runtime";
import { configuredRemoteHermes, remoteHermesConnection, remoteRuntimeId } from "./remote-hermes";
import { remoteDashboardJson } from "./remote-hermes-auth";

// Kana's only model-write path: Hermes's own custom-endpoint API. Kana never
// edits config.yaml or .env itself, never keeps a provider key, and never
// returns one to the browser.

const CUSTOM_ENDPOINTS_PATH = "/api/providers/custom-endpoints";
const DASHBOARD_TIMEOUT_MS = 20_000;
const PROVIDER_CACHE_TTL_MS = 15_000;
const MAX_NAME = 100;
const MAX_BASE_URL = 2_048;
const MAX_MODEL = 200;
const MAX_API_KEY = 16_384;
const MAX_CONTEXT_LENGTH = 10_000_000;
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CHAT_COMPLETIONS_PATH = "/chat/completions";

export type HermesCustomProvider = {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  hasApiKey: boolean;
  discoverModels: boolean;
  /** "direct-config" is Hermes's synthetic view of model.provider: custom. */
  source: "providers" | "direct-config";
};

export type AddHermesModelInput = {
  providerId?: string;
  /** With providerId, replaces the existing provider's display name. */
  name?: string;
  /** With providerId, replaces the existing provider's base URL. */
  baseUrl?: string;
  model: string;
  apiKey?: string;
  contextLength?: number;
};

export class HermesModelError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 413 | 502 | 503 = 400,
  ) {
    super(message);
    this.name = "HermesModelError";
  }
}

type ProviderCache = {
  key: string;
  at: number;
  providers: HermesCustomProvider[];
};

let providerCache: ProviderCache | null = null;

function providerCacheKey(): string {
  const remote = configuredRemoteHermes();
  if (remote) return `remote:${remoteRuntimeId(remote)}`;
  return `local:${managedRuntimePort()}`;
}

function cloneProviders(providers: HermesCustomProvider[]): HermesCustomProvider[] {
  return providers.map((provider) => ({ ...provider, models: [...provider.models] }));
}

/** A save changes the list immediately, regardless of the read cache. */
export function invalidateHermesProviderCache(): void {
  providerCache = null;
}

function text(value: unknown, label: string, maximum: number, required: boolean): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new HermesModelError(`${label} is required.`);
    return undefined;
  }
  if (typeof value !== "string") throw new HermesModelError(`${label} must be text.`);
  const result = value.trim();
  if (!result) {
    if (required) throw new HermesModelError(`${label} is required.`);
    return undefined;
  }
  if (result.length > maximum) throw new HermesModelError(`${label} is too long.`);
  if (/[\u0000-\u001f\u007f]/.test(result)) throw new HermesModelError(`${label} contains invalid characters.`);
  return result;
}

function baseUrl(value: unknown): string {
  const result = text(value, "Base URL", MAX_BASE_URL, true)!;
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new HermesModelError("Base URL must be a complete URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HermesModelError("Base URL must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new HermesModelError("Base URL must not contain credentials.");
  }
  if (parsed.search || parsed.hash) {
    throw new HermesModelError("Base URL must not contain a query or fragment.");
  }
  // OpenAI clients append /chat/completions to the base URL. A pasted full
  // endpoint would otherwise become .../chat/completions/chat/completions and
  // Hermes would see an empty stream.
  const path = parsed.pathname.replace(/\/+$/, "");
  if (path.toLowerCase().endsWith(CHAT_COMPLETIONS_PATH)) {
    parsed.pathname = path.slice(0, -CHAT_COMPLETIONS_PATH.length) || "/";
    return parsed.toString().replace(/\/+$/, "");
  }
  return result.replace(/\/+$/, "");
}

function providerId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !PROVIDER_ID.test(value.trim())) {
    throw new HermesModelError("Provider id is invalid.");
  }
  return value.trim();
}

function contextLength(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_CONTEXT_LENGTH) {
    throw new HermesModelError(`Context length must be an integer between 1 and ${MAX_CONTEXT_LENGTH}.`);
  }
  return value;
}

function apiKey(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new HermesModelError("API key must be text.");
  const result = value.trim();
  if (!result) return undefined;
  if (result.length > MAX_API_KEY) throw new HermesModelError("API key is too long.");
  if (/[\u0000-\u001f\u007f]/.test(result)) throw new HermesModelError("API key contains invalid characters.");
  return result;
}

export function parseAddModelInput(body: Record<string, unknown>): AddHermesModelInput {
  const id = providerId(body.providerId);
  const model = text(body.model, "Model", MAX_MODEL, true)!;
  const key = apiKey(body.apiKey);
  const context = contextLength(body.contextLength);
  if (id) {
    const name = text(body.name, "Provider name", MAX_NAME, false);
    const url = body.baseUrl === undefined || body.baseUrl === null || body.baseUrl === ""
      ? undefined
      : baseUrl(body.baseUrl);
    return {
      providerId: id,
      model,
      ...(name ? { name } : {}),
      ...(url ? { baseUrl: url } : {}),
      ...(key ? { apiKey: key } : {}),
      ...(context ? { contextLength: context } : {}),
    };
  }
  return {
    name: text(body.name, "Provider name", MAX_NAME, true)!,
    baseUrl: baseUrl(body.baseUrl),
    model,
    ...(key ? { apiKey: key } : {}),
    ...(context ? { contextLength: context } : {}),
  };
}

function sanitizeEndpoint(value: unknown): HermesCustomProvider | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const baseUrl = typeof record.base_url === "string" ? record.base_url.trim() : "";
  if (!id || !name || !baseUrl) return null;
  const models = Array.isArray(record.models)
    ? [...new Set(record.models.filter((model): model is string => typeof model === "string" && Boolean(model.trim())).map((model) => model.trim()))]
    : [];
  return {
    id,
    name,
    baseUrl,
    models,
    hasApiKey: record.has_api_key === true,
    discoverModels: record.discover_models !== false,
    source: record.source === "direct-config" ? "direct-config" : "providers",
  };
}

function endpointsFrom(value: unknown): HermesCustomProvider[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const endpoints = (value as Record<string, unknown>).endpoints;
  if (!Array.isArray(endpoints)) return [];
  return endpoints.flatMap((endpoint) => {
    const sanitized = sanitizeEndpoint(endpoint);
    return sanitized ? [sanitized] : [];
  });
}

function dashboardStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/\((\d{3})\)/);
  return match ? Number(match[1]) : 0;
}

/** Keep Hermes's status, never its body: a validation response can echo input. */
function dashboardFailure(error: unknown, unreachable: string): HermesModelError {
  const status = dashboardStatus(error);
  if (status === 400 || status === 422) {
    return new HermesModelError("Hermes rejected the model settings.", 400);
  }
  if (status === 404) return new HermesModelError("Hermes could not find that endpoint.", 404);
  if (status === 413) return new HermesModelError("The model settings are too large.", 413);
  return new HermesModelError(unreachable, 502);
}

async function dashboardJson(
  method: "GET" | "POST",
  body?: unknown,
): Promise<unknown> {
  const remote = configuredRemoteHermes();
  if (remote) {
    const connection = remoteHermesConnection();
    if (!connection) {
      throw new HermesModelError("Remote Hermes credentials are not available to the Kana server.", 503);
    }
    try {
      return await remoteDashboardJson(
        connection,
        CUSTOM_ENDPOINTS_PATH,
        { method, body, timeoutMs: DASHBOARD_TIMEOUT_MS },
      );
    } catch (error) {
      throw dashboardFailure(error, "Kana could not reach the remote Hermes dashboard.");
    }
  }
  try {
    return await localHermesDashboardJson(CUSTOM_ENDPOINTS_PATH, { method, body });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("session token")) {
      throw new HermesModelError(
        "Kana does not hold this local Hermes gateway's session token. Start Hermes from Kana first.",
        503,
      );
    }
    throw dashboardFailure(error, "Kana could not reach the local Hermes dashboard.");
  }
}

export async function listHermesCustomProviders(): Promise<HermesCustomProvider[]> {
  const key = providerCacheKey();
  const now = Date.now();
  if (providerCache?.key === key && now - providerCache.at < PROVIDER_CACHE_TTL_MS) {
    return cloneProviders(providerCache.providers);
  }
  const providers = endpointsFrom(await dashboardJson("GET")).sort((a, b) => a.name.localeCompare(b.name));
  providerCache = { key, at: now, providers: cloneProviders(providers) };
  return providers;
}

export async function addHermesModel(body: Record<string, unknown>): Promise<HermesCustomProvider> {
  const input = parseAddModelInput(body);
  let existing: HermesCustomProvider | undefined;
  if (input.providerId) {
    const providers = await listHermesCustomProviders();
    existing = providers.find((provider) => provider.id === input.providerId);
    if (!existing) throw new HermesModelError("That custom provider no longer exists in Hermes.", 404);
    // A direct-config endpoint's key lives in Hermes's model block, which this
    // API does not expose. Saving a providers entry without it would shadow
    // the working key with an empty one.
    if (existing.source === "direct-config" && existing.hasApiKey && !input.apiKey) {
      throw new HermesModelError(
        "Re-enter this endpoint's API key. Hermes keeps its current key where Kana cannot read it.",
      );
    }
  }
  const name = existing ? input.name ?? existing.name : input.name!;
  const url = existing ? input.baseUrl ?? existing.baseUrl : input.baseUrl!;
  const models = [...new Set([...(existing?.models ?? []), input.model])];
  const payload = {
    ...(existing ? { id: existing.id } : { name }),
    name,
    base_url: url,
    model: input.model,
    models,
    discover_models: existing?.discoverModels ?? false,
    make_default: false,
    ...(input.contextLength ? { context_length: input.contextLength } : {}),
    ...(input.apiKey ? { api_key: input.apiKey } : {}),
  };
  const response = await dashboardJson("POST", payload);
  invalidateHermesProviderCache();
  const saved = endpointsFrom(response).find((provider) =>
    existing ? provider.id === existing.id : provider.name === name,
  );
  const fallbackId = (existing?.id ?? name)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return saved ?? {
    id: fallbackId || "custom",
    name,
    baseUrl: url,
    models,
    hasApiKey: Boolean(existing?.hasApiKey || input.apiKey),
    discoverModels: existing?.discoverModels ?? false,
    source: "providers",
  };
}
