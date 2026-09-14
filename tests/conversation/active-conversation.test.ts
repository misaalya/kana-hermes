import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_CONVERSATION_KEY,
  conversationFromHermesEntry,
  freshConversationFromPointer,
  readActiveConversationPointer,
  rememberedHermesEntry,
  resumableSessionId,
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
    createdAt: 200_000,
  };

  assert.equal(rememberedHermesEntry(pointer, directory)?.hermesSessionKey, "session-b");

  const conversations = directory
    .map((entry) =>
      conversationFromHermesEntry(entry, `conversation-${entry.hermesSessionKey}`),
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
    createdAt: 10,
    persistentSessionId: "session-b",
  });
  assert.equal(storage.values.has(ACTIVE_CONVERSATION_KEY), true);
});

test("pointers from builds with a subtitle language setting still restore", () => {
  const storage = memoryStorage();
  storage.setItem(ACTIVE_CONVERSATION_KEY, JSON.stringify({
    version: 1,
    conversationId: "legacy",
    title: "Legacy",
    subtitleLanguageAtCreation: "id",
    createdAt: 5,
  }));

  assert.deepEqual(readActiveConversationPointer(storage), {
    version: 1,
    conversationId: "legacy",
    title: "Legacy",
    createdAt: 5,
  });
});

test("an unlinked fresh conversation is reconstructed after refresh", () => {
  const pointer: ActiveConversationPointer = {
    version: 1,
    conversationId: "fresh-conversation",
    title: "New conversation",
    createdAt: 123,
  };

  assert.deepEqual(freshConversationFromPointer(pointer), {
    id: "fresh-conversation",
    title: "New conversation",
    messages: [],
    createdAt: 123,
    updatedAt: 123,
  });
});

test("a session Hermes has not stored yet keeps the refresh on the same fresh conversation", () => {
  const storage = memoryStorage();
  const conversation: Conversation = {
    id: "fresh-conversation",
    title: "New conversation",
    messages: [],
    // session.create linked it, but no prompt has reached Hermes yet.
    agent: {
      provider: "hermes",
      persistentSessionId: "in-memory-session",
      durable: false,
      status: "linked",
      relationship: "primary",
    },
    createdAt: 123,
    updatedAt: 123,
  };

  assert.equal(resumableSessionId(conversation), undefined);
  writeActiveConversationPointer(conversation, storage);
  const pointer = readActiveConversationPointer(storage);
  assert.equal(pointer?.persistentSessionId, undefined);
  // Refresh (even after a Hermes restart) lands on the same fresh conversation.
  assert.equal(freshConversationFromPointer(pointer)?.id, "fresh-conversation");

  // After the first prompt, the stored session becomes the refresh target.
  const stored = { ...conversation, agent: { ...conversation.agent!, durable: true } };
  assert.equal(resumableSessionId(stored), "in-memory-session");
  writeActiveConversationPointer(stored, storage);
  assert.equal(readActiveConversationPointer(storage)?.persistentSessionId, "in-memory-session");
  assert.equal(freshConversationFromPointer(readActiveConversationPointer(storage)), null);
});

test("links without a durability flag (older builds, Hermes directory) stay resumable", () => {
  assert.equal(
    resumableSessionId(conversationFromHermesEntry(directory[0]!, "adopted")),
    "session-a",
  );
});
