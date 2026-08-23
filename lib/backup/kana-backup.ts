import {
  normalizeCubismCoreUrl,
  normalizeLive2DModelUrl,
} from "@/lib/avatar/defaults";
import type { Conversation, KanaMessage } from "@/lib/conversation/types";
import {
  DEFAULT_PREFERENCES,
  normalizeKanaPreferences,
} from "@/lib/preferences/local-preferences-store";
import type { KanaPreferences } from "@/lib/preferences/types";
import { normalizeQwen3TTSBaseUrl } from "@/lib/voice/qwen3-tts-contract";

export const KANA_BACKUP_VERSION = 1;

export type KanaBackup = {
  kind: "kana.local-backup";
  version: typeof KANA_BACKUP_VERSION;
  exportedAt: string;
  preferences: KanaPreferences;
  conversations: Conversation[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function limitedString(value: unknown, label: string, max = 200_000): string {
  if (typeof value !== "string" || value.length > max) {
    throw new Error(`Invalid ${label} in Kana backup.`);
  }
  return value;
}

function validTimestamp(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${label} in Kana backup.`);
  }
  return value;
}

function parseMessage(value: unknown): KanaMessage {
  if (!isRecord(value)) throw new Error("Invalid message in Kana backup.");
  const role = value.role;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    throw new Error("Invalid message role in Kana backup.");
  }
  const subtitle = value.subtitle;
  if (subtitle !== undefined && !isRecord(subtitle)) {
    throw new Error("Invalid stored subtitle in Kana backup.");
  }
  return {
    id: limitedString(value.id, "message id", 500),
    role,
    ...(value.text === undefined
      ? {}
      : { text: limitedString(value.text, "message text") }),
    ...(value.command === undefined
      ? {}
      : { command: limitedString(value.command, "message command", 20_000) }),
    ...(value.speech_ja === undefined
      ? {}
      : { speech_ja: limitedString(value.speech_ja, "Japanese speech") }),
    ...(subtitle
      ? {
          subtitle: {
            text: limitedString(subtitle.text, "subtitle text"),
            language: limitedString(subtitle.language, "subtitle language", 32),
          },
        }
      : {}),
    ...(typeof value.emotion === "string"
      ? { emotion: value.emotion as KanaMessage["emotion"] }
      : {}),
    timestamp: validTimestamp(value.timestamp, "message timestamp"),
  };
}

function parseConversation(value: unknown): Conversation {
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    throw new Error("Invalid conversation in Kana backup.");
  }
  if (value.messages.length > 100_000) {
    throw new Error("A conversation in the Kana backup is unreasonably large.");
  }
  const agent = value.agent;
  if (agent !== undefined && !isRecord(agent)) {
    throw new Error("Invalid Hermes session link in Kana backup.");
  }
  return {
    id: limitedString(value.id, "conversation id", 500),
    title: limitedString(value.title, "conversation title", 500),
    messages: value.messages.map(parseMessage),
    subtitleLanguageAtCreation: limitedString(
      value.subtitleLanguageAtCreation,
      "conversation subtitle language",
      32,
    ),
    ...(agent
      ? {
          agent: {
            provider: "hermes",
            persistentSessionId: limitedString(
              agent.persistentSessionId,
              "Hermes session id",
              1_000,
            ),
            ...(agent.status === "missing" ? { status: "missing" as const } : {}),
            ...(agent.relationship === "branch"
              ? { relationship: "branch" as const }
              : { relationship: "primary" as const }),
            ...(typeof agent.parentConversationId === "string"
              ? {
                  parentConversationId: limitedString(
                    agent.parentConversationId,
                    "parent conversation id",
                    500,
                  ),
                }
              : {}),
          },
        }
      : {}),
    createdAt: validTimestamp(value.createdAt, "conversation creation time"),
    updatedAt: validTimestamp(value.updatedAt, "conversation update time"),
  };
}

export function sanitizeBackupPreferences(
  preferences: KanaPreferences,
): KanaPreferences {
  preferences = normalizeKanaPreferences(preferences);
  const bindingProfiles = Object.fromEntries(
    Object.entries(preferences.live2d.bindingProfiles ?? {}).filter(
      ([key]) => !key.startsWith("import:"),
    ),
  );
  return {
    ...preferences,
    onboardingCompleted: true,
    hermes: { cwd: preferences.hermes.cwd },
    live2d: {
      ...preferences.live2d,
      modelId: undefined,
      modelName: undefined,
      bindingProfiles,
    },
  };
}

export function createKanaBackup(
  preferences: KanaPreferences,
  conversations: Conversation[],
): KanaBackup {
  return {
    kind: "kana.local-backup",
    version: KANA_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    preferences: sanitizeBackupPreferences(preferences),
    conversations,
  };
}

function parsePreferences(value: unknown): KanaPreferences {
  if (!isRecord(value)) throw new Error("Invalid preferences in Kana backup.");
  const hermes = isRecord(value.hermes) ? value.hermes : {};
  const qwen3Tts = isRecord(value.qwen3Tts) ? value.qwen3Tts : {};
  const live2d = isRecord(value.live2d) ? value.live2d : {};
  return sanitizeBackupPreferences({
    ...DEFAULT_PREFERENCES,
    onboardingCompleted: true,
    subtitleLanguage:
      typeof value.subtitleLanguage === "string"
        ? value.subtitleLanguage.slice(0, 32)
        : DEFAULT_PREFERENCES.subtitleLanguage,
    voiceEnabled: value.voiceEnabled !== false,
    hermes: {
      cwd:
        typeof hermes.cwd === "string"
          ? hermes.cwd.slice(0, 10_000)
          : DEFAULT_PREFERENCES.hermes.cwd,
    },
    qwen3Tts: {
      baseUrl: normalizeQwen3TTSBaseUrl(
        typeof qwen3Tts.baseUrl === "string"
          ? qwen3Tts.baseUrl
          : DEFAULT_PREFERENCES.qwen3Tts.baseUrl,
      ),
      voiceId:
        typeof qwen3Tts.voiceId === "string"
          ? qwen3Tts.voiceId.slice(0, 500)
          : DEFAULT_PREFERENCES.qwen3Tts.voiceId,
      deliveryMode:
        qwen3Tts.deliveryMode === "sentence_chunks"
          ? "sentence_chunks"
          : "complete",
    },
    live2d: {
      modelUrl: normalizeLive2DModelUrl(
        typeof live2d.modelUrl === "string"
          ? live2d.modelUrl
          : DEFAULT_PREFERENCES.live2d.modelUrl,
      ),
      coreScriptUrl: normalizeCubismCoreUrl(
        typeof live2d.coreScriptUrl === "string"
          ? live2d.coreScriptUrl
          : DEFAULT_PREFERENCES.live2d.coreScriptUrl,
      ),
      mouthOpenParameter:
        typeof live2d.mouthOpenParameter === "string"
          ? live2d.mouthOpenParameter.slice(0, 500)
          : DEFAULT_PREFERENCES.live2d.mouthOpenParameter,
      bindingProfiles: isRecord(live2d.bindingProfiles)
        ? (live2d.bindingProfiles as KanaPreferences["live2d"]["bindingProfiles"])
        : {},
      hostedModels: Array.isArray(live2d.hostedModels)
        ? live2d.hostedModels.slice(0, 100).flatMap((candidate) => {
            if (
              !isRecord(candidate) ||
              typeof candidate.id !== "string" ||
              typeof candidate.name !== "string" ||
              typeof candidate.url !== "string"
            ) {
              return [];
            }
            try {
              return [{
                id: candidate.id.slice(0, 500),
                name: candidate.name.slice(0, 500),
                url: normalizeLive2DModelUrl(candidate.url),
                addedAt:
                  typeof candidate.addedAt === "number"
                    ? candidate.addedAt
                    : Date.now(),
              }];
            } catch {
              return [];
            }
          })
        : [],
    },
  });
}

export function parseKanaBackup(text: string): KanaBackup {
  if (text.length > 50 * 1024 * 1024) {
    throw new Error("Kana backups larger than 50 MB are not accepted.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  if (
    !isRecord(value) ||
    value.kind !== "kana.local-backup" ||
    value.version !== KANA_BACKUP_VERSION ||
    !Array.isArray(value.conversations)
  ) {
    throw new Error("This is not a supported Kana backup (expected version 1)." );
  }
  if (value.conversations.length > 10_000) {
    throw new Error("The Kana backup contains too many conversations.");
  }
  return {
    kind: "kana.local-backup",
    version: KANA_BACKUP_VERSION,
    exportedAt: limitedString(value.exportedAt, "backup timestamp", 100),
    preferences: parsePreferences(value.preferences),
    conversations: value.conversations.map(parseConversation),
  };
}

export function serializeKanaBackup(backup: KanaBackup): string {
  return JSON.stringify(backup, null, 2);
}
