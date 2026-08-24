import { create } from "zustand";
import type {
  Conversation,
  ConversationStore,
  CreateConversationInput,
} from "./types";
import { createConversation } from "./types";

/**
 * In-memory conversation store.
 *
 * The transcript is owned by Hermes (state.db) and read back through
 * session.history; this store only holds the live React session's records in
 * memory. Nothing is written to the browser's disk, so every browser sees
 * identical history straight from Hermes — no cache to go stale.
 *
 * A module-level Zustand-like map survives React remounts within one page
 * load; a full page refresh intentionally starts clean and re-hydrates from
 * Hermes via /api/kana/sessions + session.history.
 */

const memoryConversations = create<{
  conversations: Map<string, Conversation>;
  add: (conversation: Conversation) => void;
  remove: (id: string) => void;
}>((set) => ({
  conversations: new Map<string, Conversation>(),
  add: (conversation) =>
    set((state) => {
      state.conversations.set(conversation.id, conversation);
      return { conversations: new Map(state.conversations) };
    }),
  remove: (id) =>
    set((state) => {
      state.conversations.delete(id);
      return { conversations: new Map(state.conversations) };
    }),
}));

export class MemoryConversationStore implements ConversationStore {
  async list(): Promise<Conversation[]> {
    return [...memoryConversations.getState().conversations.values()].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  async get(id: string): Promise<Conversation | null> {
    return memoryConversations.getState().conversations.get(id) ?? null;
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    const conversation = createConversation(input);
    memoryConversations.getState().add(conversation);
    return conversation;
  }

  async save(conversation: Conversation): Promise<void> {
    memoryConversations.getState().add(conversation);
  }

  async rename(id: string, title: string): Promise<Conversation | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const renamed: Conversation = {
      ...existing,
      title,
      updatedAt: Date.now(),
    };
    memoryConversations.getState().add(renamed);
    return renamed;
  }

  async delete(id: string): Promise<void> {
    memoryConversations.getState().remove(id);
  }

  consumeWarning(): string | null {
    return null;
  }
}
