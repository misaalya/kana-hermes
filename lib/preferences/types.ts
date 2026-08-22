import type { SubtitleLanguage } from "@/lib/presentation/types";
import type { Live2DModelBindings } from "@/lib/avatar/live2d-avatar-provider";
import type { VoiceDeliveryMode } from "@/lib/voice/speech-chunks";

export type AgentMode = "mock" | "hermes";
export type VoiceMode = "mock" | "qwen3";
export type AvatarMode = "mock" | "live2d";
export type HostedAvatarModel = {
  id: string;
  name: string;
  url: string;
  addedAt: number;
};

export type KanaPreferences = {
  onboardingCompleted: boolean;
  subtitleLanguage: SubtitleLanguage;
  agentMode: AgentMode;
  voiceEnabled: boolean;
  voiceMode: VoiceMode;
  avatarMode: AvatarMode;
  hermes: {
    websocketUrl: string;
    token: string;
    cwd: string;
  };
  qwen3Tts: {
    baseUrl: string;
    voiceId: string;
    deliveryMode: VoiceDeliveryMode;
  };
  live2d: {
    modelUrl: string;
    modelId?: string;
    modelName?: string;
    coreScriptUrl: string;
    mouthOpenParameter: string;
    bindingProfiles?: Record<string, Live2DModelBindings>;
    hostedModels?: HostedAvatarModel[];
  };
};

export interface PreferencesStore {
  load(): KanaPreferences;
  save(preferences: KanaPreferences): void;
}

export interface HermesCredentialsStore {
  loadToken(): string;
  saveToken(token: string): void;
  clear(): void;
}
