import { createStore, type StoreApi } from "zustand/vanilla";
import {
  DEFAULT_PREFERENCES,
  readStoredUiLocale,
  type BrowserStorage,
} from "@/lib/preferences/local-preferences-store";
import type { UiLocale } from "@/lib/ui/copy";

export type UiLocaleState = {
  locale: UiLocale;
  /** Adopt the stored choice after mount; the app's default renders first. */
  hydrate(): void;
};

export type UiLocaleStore = StoreApi<UiLocaleState>;

/**
 * The interface locale for a page that renders outside the workspace: the two
 * fatal error pages, which mount exactly when the workspace and its stores are
 * gone. It is the theme store's shape (`lib/store/theme-store.ts`) for the same
 * reason: the stored choice arrives in an effect through the store rather than
 * through a `setState` in an effect, so the server render and the hydration
 * pass agree on the default and the client adopts the record afterwards.
 */
export function createUiLocaleStore(storage?: BrowserStorage): UiLocaleStore {
  return createStore<UiLocaleState>()((set, get) => ({
    locale: DEFAULT_PREFERENCES.uiLocale,
    hydrate() {
      const locale = readStoredUiLocale(storage);
      if (get().locale !== locale) set({ locale });
    },
  }));
}
