import type { KanaPreferences } from "@/lib/preferences/types";
import type { PreferencesStore } from "@/lib/store/preferences-store";

/** Browser persistence of preferences; LocalPreferencesStore in the app. */
export type PreferencesPersistence = {
  load(): KanaPreferences;
  save(preferences: KanaPreferences): void;
  consumeWarning(): string | null;
};

/** Reads and persists preferences without applying their side effects. */
export class PreferencesAccess {
  constructor(
    private readonly store: PreferencesStore,
    private readonly persistence: PreferencesPersistence,
  ) {}

  current(): KanaPreferences {
    return this.store.getState().preferences;
  }

  load(): KanaPreferences {
    return this.persistence.load();
  }

  consumeWarning(): string | null {
    return this.persistence.consumeWarning();
  }

  /** Replace the in-memory copy without writing storage (initial load). */
  adopt(preferences: KanaPreferences): void {
    this.store.setState({ preferences });
  }

  persist(preferences: KanaPreferences): void {
    this.store.setState({ preferences });
    this.persistence.save(preferences);
  }
}
