import type { AvatarController } from "@/lib/avatar/avatar-controller";
import type { Emotion } from "@/lib/presentation/types";
import type { VoiceDeliveryMode } from "./speech-chunks";

export type VoiceSpeakOptions = {
  text: string;
  voiceId?: string;
  language?: string;
  emotion?: Emotion;
  /** Fires the moment audible playback begins (synthesis already done). */
  onAudioStart?: () => void;
};

export type VoiceDescriptor = {
  id: string;
  name?: string;
  language: string;
  kind?: "preset" | "cloned";
  durationSeconds?: number;
  createdAt?: string;
  xVectorOnly?: boolean;
};

export type VoiceProviderStatus = {
  state: "ready" | "loading" | "error" | "unavailable";
  service?: string;
  apiVersion?: string;
  model?: string;
  device?: string;
  supportsInstruction?: boolean;
  supportsVoiceClone?: boolean;
  modelType?: string;
  defaultVoiceId?: string;
  voices: VoiceDescriptor[];
  message?: string;
  setup?: {
    cacheDir?: string;
    cacheExists: boolean;
    modelCacheDetected: boolean;
    freeDiskBytes: number;
    totalDiskBytes: number;
    recommendedFreeDiskBytes: number;
    diskSufficient: boolean;
  };
};

export type VoiceLifecycleState =
  | "idle"
  | "checking"
  | "offline"
  | "loading_model"
  | "ready"
  | "synthesizing"
  | "playing"
  | "stopping"
  | "failed";

export type VoiceRuntimeSnapshot = {
  state: VoiceLifecycleState;
  canReplay: boolean;
  requestId?: string;
  lastSynthesisDurationMs?: number;
  lastPlaybackDurationMs?: number;
  timeToFirstAudioMs?: number;
  deliveryMode?: VoiceDeliveryMode;
  currentChunk?: number;
  chunkCount?: number;
  message?: string;
};

export interface VoiceProvider {
  readonly id: string;
  inspect(): Promise<VoiceProviderStatus>;
  speak(options: VoiceSpeakOptions): Promise<void>;
  replay(): Promise<void>;
  stop(): void;
  getSnapshot(): VoiceRuntimeSnapshot;
  subscribe(listener: (snapshot: VoiceRuntimeSnapshot) => void): () => void;
}

export type VoiceProviderDependencies = {
  avatar: AvatarController;
};
