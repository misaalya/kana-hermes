import { createStore, type StoreApi } from "zustand/vanilla";
import { DEFAULT_PREFERENCES } from "@/lib/preferences/local-preferences-store";
import type { KanaPreferences } from "@/lib/preferences/types";

/**
 * In-memory copy of the local preferences. LocalPreferencesStore stays the
 * only code that reads and writes browser storage (keys, migrations,
 * normalization); PreferencesService keeps the two in step.
 */
export type PreferencesState = {
  preferences: KanaPreferences;
};

export type PreferencesStore = StoreApi<PreferencesState>;

export function createPreferencesStore(): PreferencesStore {
  return createStore<PreferencesState>()(() => ({
    preferences: DEFAULT_PREFERENCES,
  }));
}
