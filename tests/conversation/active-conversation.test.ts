import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_CONVERSATION_KEY,
  conversationFromHermesEntry,
  freshConversationFromPointer,
  readActiveConversationPointer,
  rememberedHermesEntry,
  writeActiveConversationPointer,
  type ActiveConversationPointer,
  type HermesConversationDirectoryEntry,
} from "../../lib/conversation/active-conversation";
import type { Conversation } from "../../lib/conversation/types";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    values,
  };
}

const directory: HermesConversationDirectoryEntry[] = [
  {
    hermesSessionKey: "session-a",
    title: "Session A",
    messageCount: 8,
    startedAt: 100,
    lastActive: 300,
  },
  {
    hermesSessionKey: "session-b",
    title: "Session B",
    messageCount: 0,
    startedAt: 200,
    lastActive: 200,
  },
];

test("selected Hermes session survives independently from interaction order", () => {
  const pointer: ActiveConversationPointer = {
    version: 1,
    conversationId: "conversation-b",
    persistentSessionId: "session-b",
    title: "Session B",
    subtitleLanguageAtCreation: "id",
    createdAt: 200_000,
  };

  assert.equal(rememberedHermesEntry(pointer, directory)?.hermesSessionKey, "session-b");

  const conversations = directory
    .map((entry) =>
      conversationFromHermesEntry(entry, "id", `conversation-${entry.hermesSessionKey}`),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);

  assert.equal(conversations[0]?.agent?.persistentSessionId, "session-a");
  assert.equal(conversations[1]?.agent?.persistentSessionId, "session-b");
});

test("active pointer round-trips without storing a Hermes credential", () => {
  const storage = memoryStorage();
  const conversation: Conversation = {
    id: "conversation-b",
    title: "Session B",
    messages: [],
    subtitleLanguageAtCreation: "en",
    agent: {
      provider: "hermes",
      persistentSessionId: "session-b",
      status: "linked",
      relationship: "primary",
    },
    createdAt: 10,
    updatedAt: 20,
  };

  writeActiveConversationPointer(conversation, storage);

  assert.deepEqual(readActiveConversationPointer(storage), {
    version: 1,
    conversationId: "conversation-b",
    title: "Session B",
    subtitleLanguageAtCreation: "en",
    createdAt: 10,
    persistentSessionId: "session-b",
  });
  assert.equal(storage.values.has(ACTIVE_CONVERSATION_KEY), true);
});

test("an unlinked fresh conversation is reconstructed after refresh", () => {
  const pointer: ActiveConversationPointer = {
    version: 1,
    conversationId: "fresh-conversation",
    title: "New conversation",
    subtitleLanguageAtCreation: "id",
    createdAt: 123,
  };

  assert.deepEqual(freshConversationFromPointer(pointer), {
    id: "fresh-conversation",
    title: "New conversation",
    messages: [],
    subtitleLanguageAtCreation: "id",
    createdAt: 123,
    updatedAt: 123,
  });
});
