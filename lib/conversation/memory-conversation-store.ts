import type {
  Conversation,
  ConversationStore,
  CreateConversationInput,
} from "./types";
import { createConversation } from "./types";

/**
 * Per-controller working set. Hermes owns the durable transcript; a new
 * controller restores it through session.resume rather than sharing mutable
 * conversation records with another mounted workspace.
 */
export class MemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, Conversation>();

  async list(): Promise<Conversation[]> {
    return [...this.conversations.values()].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  async get(id: string): Promise<Conversation | null> {
    return this.conversations.get(id) ?? null;
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    const conversation = createConversation(input);
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  async save(conversation: Conversation): Promise<void> {
    this.conversations.set(conversation.id, conversation);
  }

  async rename(id: string, title: string): Promise<Conversation | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const renamed: Conversation = {
      ...existing,
      title,
      updatedAt: Date.now(),
    };
    this.conversations.set(renamed.id, renamed);
    return renamed;
  }

  async delete(id: string): Promise<void> {
    this.conversations.delete(id);
  }

  consumeWarning(): string | null {
    return null;
  }
}
