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

/**
 * What the fatal error boundary can honestly report. It renders outside the
 * workspace stores, so agent, voice, avatar, and storage state are unknown
 * there, and a snapshot that guessed them would be worse than a short one.
 */
export type KanaFatalDiagnosticsInput = {
  /** The thrown value, as the boundary received it. */
  error: unknown;
  /** Next.js's hash for the failure, and the key its server log carries. */
  digest?: string;
  /** The route that failed. Query values are dropped even if one is passed. */
  route?: string;
  generatedAt?: number;
};

export type KanaFatalDiagnosticSnapshot = {
  surface: "error-boundary";
  generatedAt: string;
  route?: string;
  reference?: string;
  error: { name: string; message: string };
};
