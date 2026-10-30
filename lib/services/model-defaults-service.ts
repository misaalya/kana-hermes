import {
  normalizeAgentModelDefaults,
} from "@/lib/preferences/local-preferences-store";
import type { AgentModelDefaults } from "@/lib/preferences/types";
import type { PreferencesAccess } from "./preferences-service";

const HYDRATE_TIMEOUT_MS = 4_000;

/**
 * The installation's default model per Hermes runtime, stored in appstate.db
 * by the server. Hydration runs before the first session opens, so a browser
 * with no local record still lands on the user's saved default; a browser
 * that carries a legacy localStorage map seeds the server once.
 */
export class ModelDefaultsService {
  constructor(
    private readonly deps: {
      preferences: PreferencesAccess;
      fetch: typeof fetch;
    },
  ) {}

  async hydrate(): Promise<void> {
    let server: AgentModelDefaults;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HYDRATE_TIMEOUT_MS);
    try {
      const response = await this.deps.fetch("/api/kana/model-defaults", {
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) return;
      const body = (await response.json()) as { defaults?: unknown };
      server = normalizeAgentModelDefaults(body.defaults);
    } catch {
      // Offline or a server still starting: keep the browser's copy and retry
      // the migration on the next start.
      return;
    } finally {
      clearTimeout(timer);
    }

    const local = normalizeAgentModelDefaults(
      this.deps.preferences.current().agentModelDefaults,
    );
    if (!Object.keys(server).length && Object.keys(local).length) {
      try {
        await this.save(local);
      } catch {
        // Keep the local map; the next start retries the migration.
      }
      return;
    }
    this.deps.preferences.update({ agentModelDefaults: server });
  }

  /** Replace the installation's map; a failed write reaches the caller. */
  async save(defaults: AgentModelDefaults): Promise<void> {
    const response = await this.deps.fetch("/api/kana/model-defaults", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ defaults: normalizeAgentModelDefaults(defaults) }),
    });
    if (!response.ok) {
      throw new Error(`The default model could not be saved (${response.status}).`);
    }
  }
}
