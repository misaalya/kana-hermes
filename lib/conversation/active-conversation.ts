import type { SubtitleLanguage } from "@/lib/presentation/types";
import type { Conversation } from "./types";

const ACTIVE_CONVERSATION_KEY = "kana.active-conversation.v1";

export type ActiveConversationPointer = {
  version: 1;
  conversationId: string;
  title: string;
  subtitleLanguageAtCreation: SubtitleLanguage;
  createdAt: number;
  persistentSessionId?: string;
};

export type HermesConversationDirectoryEntry = {
  hermesSessionKey: string;
  title: string;
  messageCount: number;
  startedAt: number;
  lastActive: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function pointerFromConversation(conversation: Conversation): ActiveConversationPointer {
  return {
    version: 1,
    conversationId: conversation.id,
    title: conversation.title,
    subtitleLanguageAtCreation: conversation.subtitleLanguageAtCreation,
    createdAt: conversation.createdAt,
    ...(conversation.agent?.persistentSessionId
      ? { persistentSessionId: conversation.agent.persistentSessionId }
      : {}),
  };
}

export function readActiveConversationPointer(
  storage: Pick<Storage, "getItem"> | undefined =
    typeof window === "undefined" ? undefined : window.localStorage,
): ActiveConversationPointer | null {
  if (!storage) return null;
  try {
    const value: unknown = JSON.parse(storage.getItem(ACTIVE_CONVERSATION_KEY) ?? "null");
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      typeof value.conversationId !== "string" ||
      typeof value.title !== "string" ||
      typeof value.subtitleLanguageAtCreation !== "string" ||
      typeof value.createdAt !== "number" ||
      (value.persistentSessionId !== undefined && typeof value.persistentSessionId !== "string")
    ) {
      return null;
    }
    return value as ActiveConversationPointer;
  } catch {
    return null;
  }
}

export function writeActiveConversationPointer(
  conversation: Conversation,
  storage: Pick<Storage, "setItem"> | undefined =
    typeof window === "undefined" ? undefined : window.localStorage,
): void {
  if (!storage) return;
  try {
    storage.setItem(ACTIVE_CONVERSATION_KEY, JSON.stringify(pointerFromConversation(conversation)));
  } catch {
    // Active selection is a convenience; storage failure must not block chat.
  }
}

export function clearActiveConversationPointer(
  storage: Pick<Storage, "removeItem"> | undefined =
    typeof window === "undefined" ? undefined : window.localStorage,
): void {
  try {
    storage?.removeItem(ACTIVE_CONVERSATION_KEY);
  } catch {
    // Best effort only.
  }
}

export function freshConversationFromPointer(
  pointer: ActiveConversationPointer | null,
): Conversation | null {
  if (!pointer || pointer.persistentSessionId) return null;
  return {
    id: pointer.conversationId,
    title: pointer.title,
    messages: [],
    subtitleLanguageAtCreation: pointer.subtitleLanguageAtCreation,
    createdAt: pointer.createdAt,
    updatedAt: pointer.createdAt,
  };
}

export function conversationFromHermesEntry(
  entry: HermesConversationDirectoryEntry,
  subtitleLanguage: SubtitleLanguage,
  id: string,
): Conversation {
  const createdAt = entry.startedAt > 0 ? entry.startedAt * 1000 : Date.now();
  const updatedAt = entry.lastActive > 0 ? entry.lastActive * 1000 : createdAt;
  return {
    id,
    title: entry.title || "Untitled",
    messages: [],
    subtitleLanguageAtCreation: subtitleLanguage,
    agent: {
      provider: "hermes",
      persistentSessionId: entry.hermesSessionKey,
      status: "linked",
      relationship: "primary",
    },
    createdAt,
    updatedAt,
  };
}

export function rememberedHermesEntry(
  pointer: ActiveConversationPointer | null,
  directory: HermesConversationDirectoryEntry[],
): HermesConversationDirectoryEntry | null {
  if (!pointer?.persistentSessionId) return null;
  return directory.find((entry) => entry.hermesSessionKey === pointer.persistentSessionId) ?? null;
}

export { ACTIVE_CONVERSATION_KEY };
