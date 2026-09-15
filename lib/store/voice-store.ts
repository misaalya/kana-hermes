import { createStore, type StoreApi } from "zustand/vanilla";
import type { VoiceProviderStatus } from "@/lib/voice/types";

export type VoiceState = {
  /** Playback provider state: idle, checking, synthesizing, playing, stopping, ... */
  runtimeState: string;
  /** Last inspection of the server-selected TTS provider. */
  status: VoiceProviderStatus | null;
};

export type VoiceStore = StoreApi<VoiceState>;

export function createVoiceStore(): VoiceStore {
  return createStore<VoiceState>()(() => ({
    runtimeState: "idle",
    status: null,
  }));
}

export function isVoiceActive(runtimeState: string): boolean {
  return runtimeState === "synthesizing" || runtimeState === "playing" || runtimeState === "stopping";
}
