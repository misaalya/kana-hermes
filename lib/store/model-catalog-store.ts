import { createStore, type StoreApi } from "zustand/vanilla";
import type { AgentModelCatalog } from "@/lib/agent/types";

export type ModelCatalogEntry = {
  /** Runtime Hermes session the catalog was read for; "" when none was open. */
  key: string;
  catalog: AgentModelCatalog;
};

export type ModelCatalogState = {
  /** Last model catalog Hermes returned. Hermes re-reads its config on every call, so this is only a head start. */
  entry: ModelCatalogEntry | null;
};

export type ModelCatalogStore = StoreApi<ModelCatalogState>;

export function createModelCatalogStore(): ModelCatalogStore {
  return createStore<ModelCatalogState>()(() => ({ entry: null }));
}
