import {
  createConversation,
  type Conversation,
  type ConversationStore,
  type CreateConversationInput,
} from "./types";

export class MockConversationStore implements ConversationStore {
  private conversations: Conversation[] = [];

  async list(): Promise<Conversation[]> {
    return [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Conversation | null> {
    return this.conversations.find((item) => item.id === id) ?? null;
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    const conversation = createConversation(input);
    this.conversations.push(conversation);
    return conversation;
  }

  async save(conversation: Conversation): Promise<void> {
    const index = this.conversations.findIndex(
      (item) => item.id === conversation.id,
    );
    const next = { ...conversation, updatedAt: Date.now() };
    if (index === -1) {
      this.conversations.push(next);
    } else {
      this.conversations[index] = next;
    }
  }

  async rename(id: string, title: string): Promise<Conversation | null> {
    const conversation = await this.get(id);
    if (!conversation || !title.trim()) {
      return conversation;
    }
    const renamed = { ...conversation, title: title.trim(), updatedAt: Date.now() };
    await this.save(renamed);
    return renamed;
  }

  async delete(id: string): Promise<void> {
    this.conversations = this.conversations.filter((item) => item.id !== id);
  }
}

