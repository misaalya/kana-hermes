import { NonJsonResponseError, readJsonResponse } from "./read-json-response";

// Browser client for Kana's server-side Hermes model-management bridge.
// Provider keys are sent once to the authenticated route and are never stored
// in this client or returned by it.

export type HermesCustomProvider = {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  hasApiKey: boolean;
  discoverModels: boolean;
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

function errorMessage(value: unknown): string {
  return value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string"
    ? (value as { error: string }).error
    : "";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await readJsonResponse<unknown>(response);
  } catch (error) {
    // A page instead of Kana's JSON: say so rather than show a bare status.
    if (error instanceof NonJsonResponseError) throw error;
    return null;
  }
}

export async function listHermesModelProviders(): Promise<HermesCustomProvider[]> {
  const response = await fetch("/api/hermes/models", {
    credentials: "same-origin",
    cache: "no-store",
  });
  const value = await readJson(response);
  if (!response.ok) {
    throw new Error(errorMessage(value) || `Could not load Hermes providers (${response.status}).`);
  }
  const providers = value && typeof value === "object" ? (value as { providers?: unknown }).providers : null;
  return Array.isArray(providers) ? (providers as HermesCustomProvider[]) : [];
}

export async function addHermesModel(input: AddHermesModelInput): Promise<HermesCustomProvider> {
  const response = await fetch("/api/hermes/models", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const value = await readJson(response);
  if (!response.ok) {
    throw new Error(errorMessage(value) || `Could not add the model (${response.status}).`);
  }
  const provider = value && typeof value === "object" ? (value as { provider?: unknown }).provider : null;
  if (!provider || typeof provider !== "object") {
    throw new Error("Hermes did not return the saved provider.");
  }
  return provider as HermesCustomProvider;
}
