import { getAppStateEntry, setAppState } from "@/lib/server/app-state-store";
import type { AgentModelDefaults } from "@/lib/preferences/types";
import { RUNTIME_ID_PATTERN } from "@/lib/runtime/runtime-identity";

// The default model belongs to the installation, not one browser: the same
// Kana server serves a phone and a laptop, and the choice follows the user.
// It lives in appstate.db beside the other install-level state.

export const MODEL_DEFAULTS_APP_STATE_KEY = "model-defaults";
export const MAX_MODEL_DEFAULTS = 32;
const MAX_PROVIDER_LENGTH = 200;
const MAX_MODEL_LENGTH = 500;

/**
 * Strict projection for a stored or submitted map. A malformed map is
 * rejected whole rather than silently dropping entries: a truncated write
 * must not erase the user's other runtimes.
 */
export function parseModelDefaults(value: unknown): AgentModelDefaults | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_MODEL_DEFAULTS) return null;
  const defaults: AgentModelDefaults = {};
  for (const [runtimeId, raw] of entries) {
    if (!RUNTIME_ID_PATTERN.test(runtimeId)) return null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const candidate = raw as { provider?: unknown; model?: unknown };
    if (
      Object.keys(candidate).some((key) => key !== "provider" && key !== "model")
      || typeof candidate.provider !== "string"
      || typeof candidate.model !== "string"
    ) {
      return null;
    }
    const provider = candidate.provider.trim();
    const model = candidate.model.trim();
    if (
      !provider
      || !model
      || provider.length > MAX_PROVIDER_LENGTH
      || model.length > MAX_MODEL_LENGTH
    ) {
      return null;
    }
    defaults[runtimeId] = { provider, model };
  }
  return defaults;
}

/** The installation's defaults; corrupt or missing state reads as empty. */
export function readModelDefaults(): AgentModelDefaults {
  const entry = getAppStateEntry<unknown>(MODEL_DEFAULTS_APP_STATE_KEY);
  if (entry.status !== "found") return {};
  return parseModelDefaults(entry.value) ?? {};
}

export function writeModelDefaults(defaults: AgentModelDefaults): void {
  setAppState(MODEL_DEFAULTS_APP_STATE_KEY, defaults);
}
