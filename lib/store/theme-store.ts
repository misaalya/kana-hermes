import { createStore, type StoreApi } from "zustand/vanilla";

export type ThemeMode = "dark" | "light";

export const THEME_STORAGE_KEY = "kana.theme";

export type ThemeState = {
  theme: ThemeMode;
  /** Adopt the stored choice after hydration; dark is the default. */
  hydrate(): void;
  toggle(): void;
};

export type ThemeStore = StoreApi<ThemeState>;

type ThemeEnvironment = {
  root?: { dataset: DOMStringMap };
  storage?: Pick<Storage, "getItem" | "setItem">;
};

function browserEnvironment(): ThemeEnvironment {
  if (typeof document === "undefined") return {};
  let storage: ThemeEnvironment["storage"];
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  return { root: document.documentElement, storage };
}

/**
 * Dual-tone theme. The [data-theme] attribute on <html> is what the CSS reads;
 * this store keeps React in step with it and persists the choice per browser.
 */
export function createThemeStore(environment: ThemeEnvironment = browserEnvironment()): ThemeStore {
  const { root, storage } = environment;

  function apply(theme: ThemeMode) {
    if (root) root.dataset.theme = theme;
    try {
      storage?.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable in hardened browsers; the session still works.
    }
  }

  return createStore<ThemeState>()((set, get) => ({
    // Server render and hydration start dark; hydrate() adopts the stored choice.
    theme: "dark",
    hydrate() {
      let stored: string | null = null;
      try {
        stored = storage?.getItem(THEME_STORAGE_KEY) ?? null;
      } catch {
        stored = null;
      }
      const theme: ThemeMode = stored === "light" ? "light" : "dark";
      if (root?.dataset.theme !== theme) apply(theme);
      if (get().theme !== theme) set({ theme });
    },
    toggle() {
      const theme: ThemeMode = get().theme === "dark" ? "light" : "dark";
      apply(theme);
      set({ theme });
    },
  }));
}
