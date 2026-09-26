import { createStore, type StoreApi } from "zustand/vanilla";
import type { AvatarPortraits } from "@/lib/avatar/portrait";
import type { AvatarSnapshot } from "@/lib/avatar/types";

export const EMPTY_AVATAR: AvatarSnapshot = {
  loaded: false,
  renderMode: "mock",
  emotion: "neutral",
  emotionIntensity: 0.2,
  mouthOpen: 0,
  talking: false,
};

export type AvatarState = {
  snapshot: AvatarSnapshot;
  /**
   * Adopt a provider snapshot. Mouth movement changes every frame during
   * speech; only the fields the UI shows replace the stored snapshot.
   */
  apply(snapshot: AvatarSnapshot): void;
  /** Stage portraits for the Settings avatar cards, by model id or URL. */
  portraits: AvatarPortraits;
};

export type AvatarStore = StoreApi<AvatarState>;

export function createAvatarStore(): AvatarStore {
  return createStore<AvatarState>()((set, get) => ({
    snapshot: EMPTY_AVATAR,
    portraits: {},
    apply(snapshot) {
      const previous = get().snapshot;
      if (
        previous.emotion === snapshot.emotion &&
        previous.talking === snapshot.talking &&
        previous.loaded === snapshot.loaded &&
        previous.renderMode === snapshot.renderMode &&
        previous.loadError === snapshot.loadError
      ) {
        return;
      }
      set({ snapshot });
    },
  }));
}
