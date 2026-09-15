import type { AgentModelCatalog } from "@/lib/agent/types";
import type { AgentSessionStore } from "@/lib/store/agent-session-store";
import type { ModelCatalogStore } from "@/lib/store/model-catalog-store";

export type ModelCatalogServiceDependencies = {
  store: ModelCatalogStore;
  agentSession: AgentSessionStore;
  /** model.options on the open Hermes session; refresh busts Hermes's own caches. */
  listModels(refresh: boolean): Promise<AgentModelCatalog>;
};

function sameCatalog(a: AgentModelCatalog, b: AgentModelCatalog): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Keeps the Hermes model catalog so pickers open at once. The catalog is not
 * fixed for the life of the gateway: Hermes re-reads config.yaml and saved
 * provider keys on every model.options call, and the active model belongs to
 * the open session. Pickers therefore show the cached catalog and refresh it
 * in the background; switching models, a new session, or a lost connection
 * drops it.
 */
export class ModelCatalogService {
  private inflight: { key: string; refresh: boolean; promise: Promise<AgentModelCatalog> } | null = null;
  /** Bumped by invalidate(); responses from an older generation are not stored. */
  private generation = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: ModelCatalogServiceDependencies) {}

  /** Cached catalog for the open session, loading it only on a miss. For per-keystroke completion. */
  async get(): Promise<AgentModelCatalog> {
    const entry = this.deps.store.getState().entry;
    if (entry?.key === this.key()) return entry.catalog;
    return this.fetch(false);
  }

  /** For pickers: the cached catalog at once, refreshed in the background. `refresh` waits for a full reload. */
  async list(refresh = false): Promise<AgentModelCatalog> {
    const entry = this.deps.store.getState().entry;
    if (!refresh && entry?.key === this.key()) {
      void this.fetch(false).catch(() => undefined);
      return entry.catalog;
    }
    return this.fetch(refresh);
  }

  invalidate(): void {
    this.generation += 1;
    this.inflight = null;
    if (this.deps.store.getState().entry) this.deps.store.setState({ entry: null });
  }

  /** Follow the open session: another session or a lost connection drops the catalog. */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.deps.agentSession.subscribe((state, previous) => {
      if (state.openSessionId === previous.openSessionId) return;
      const hadCatalog = Boolean(this.deps.store.getState().entry);
      this.invalidate();
      // Someone is showing the catalog; load the new session's one.
      if (hadCatalog && state.openSessionId && state.connectionState === "connected") {
        void this.fetch(false).catch(() => undefined);
      }
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.invalidate();
  }

  private key(): string {
    return this.deps.agentSession.getState().openSessionId ?? "";
  }

  private fetch(refresh: boolean): Promise<AgentModelCatalog> {
    const key = this.key();
    const running = this.inflight;
    // A plain load joins any request for the same session; a refresh only joins another refresh.
    if (running && running.key === key && (running.refresh || !refresh)) return running.promise;
    const generation = this.generation;
    const promise = this.deps
      .listModels(refresh)
      .then((catalog) => {
        if (generation === this.generation && key === this.key()) {
          const current = this.deps.store.getState().entry;
          if (!(current?.key === key && sameCatalog(current.catalog, catalog))) {
            this.deps.store.setState({ entry: { key, catalog } });
          }
        }
        return catalog;
      })
      .finally(() => {
        if (this.inflight?.promise === promise) this.inflight = null;
      });
    this.inflight = { key, refresh, promise };
    return promise;
  }
}
