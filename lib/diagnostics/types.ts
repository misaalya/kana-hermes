import type { AgentConnectionState } from "@/lib/agent/types";
import type {
  AgentMode,
  AvatarMode,
  VoiceMode,
} from "@/lib/preferences/types";
import type { VoiceDeliveryMode } from "@/lib/voice/speech-chunks";

export type KanaErrorCategory =
  | "connection"
  | "authentication"
  | "protocol"
  | "session"
  | "model_response"
  | "storage"
  | "voice"
  | "avatar"
  | "cancelled"
  | "unknown";

export type KanaErrorSource =
  | "agent"
  | "conversation"
  | "preferences"
  | "voice"
  | "avatar"
  | "application";

export type KanaErrorRecord = {
  category: KanaErrorCategory;
  source: KanaErrorSource;
  message: string;
  occurredAt: number;
};

export type KanaRuntimeMetrics = {
  reconnectCount: number;
  lastConnectDurationMs?: number;
  lastAgentTurnDurationMs?: number;
  lastVoiceDurationMs?: number;
  lastVoiceSynthesisDurationMs?: number;
  lastVoicePlaybackDurationMs?: number;
  lastVoiceTimeToFirstAudioMs?: number;
  lastAvatarLoadDurationMs?: number;
};

export type KanaDiagnosticsInput = {
  appVersion: string;
  generatedAt?: number;
  agent: {
    mode: AgentMode;
    state: AgentConnectionState;
    websocketUrl: string;
  };
  voice: {
    mode: VoiceMode;
    enabled: boolean;
    state?: string;
    service?: string;
    model?: string;
    device?: string;
    deliveryMode?: VoiceDeliveryMode;
  };
  avatar: {
    mode: AvatarMode;
    renderMode: "mock" | "live2d";
    loaded: boolean;
    source: "official-sample" | "hosted-url" | "imported-folder";
  };
  storage: {
    provider: "indexeddb";
    conversationCount: number;
    messageCount: number;
    linkedHermesSession: boolean;
  };
  metrics: KanaRuntimeMetrics;
  lastError?: KanaErrorRecord | null;
};

export type KanaDiagnosticSnapshot = Omit<
  KanaDiagnosticsInput,
  "generatedAt" | "lastError"
> & {
  generatedAt: string;
  lastError?: Omit<KanaErrorRecord, "occurredAt"> & { occurredAt: string };
};
