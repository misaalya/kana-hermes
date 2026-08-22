import {
  createConversation,
  type Conversation,
  type ConversationStore,
  type CreateConversationInput,
} from "./types";

type StoredConversationEnvelope = {
  version: 1;
  conversations: Conversation[];
};

const DEFAULT_STORAGE_KEY = "kana.conversations.v1";

function sortRecent(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}

export class LocalConversationStore implements ConversationStore {
  constructor(private readonly storageKey = DEFAULT_STORAGE_KEY) {}

  async list(): Promise<Conversation[]> {
    return sortRecent(this.read());
  }

  async get(id: string): Promise<Conversation | null> {
    return this.read().find((conversation) => conversation.id === id) ?? null;
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    const conversation = createConversation(input);
    const conversations = this.read();
    conversations.push(conversation);
    this.write(conversations);
    return conversation;
  }

  async save(conversation: Conversation): Promise<void> {
    const conversations = this.read();
    const index = conversations.findIndex((item) => item.id === conversation.id);
    const next = { ...conversation, updatedAt: Date.now() };

    if (index === -1) {
      conversations.push(next);
    } else {
      conversations[index] = next;
    }

    this.write(conversations);
  }

  async rename(id: string, title: string): Promise<Conversation | null> {
    const conversation = await this.get(id);
    const nextTitle = title.trim();
    if (!conversation || !nextTitle) {
      return conversation;
    }

    const renamed = { ...conversation, title: nextTitle, updatedAt: Date.now() };
    await this.save(renamed);
    return renamed;
  }

  async delete(id: string): Promise<void> {
    this.write(this.read().filter((conversation) => conversation.id !== id));
  }

  private read(): Conversation[] {
    if (typeof window === "undefined") {
      return [];
    }

    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as StoredConversationEnvelope;
      return parsed.version === 1 && Array.isArray(parsed.conversations)
        ? parsed.conversations
        : [];
    } catch {
      return [];
    }
  }

  private write(conversations: Conversation[]): void {
    if (typeof window === "undefined") {
      return;
    }

    const envelope: StoredConversationEnvelope = {
      version: 1,
      conversations,
    };
    window.localStorage.setItem(this.storageKey, JSON.stringify(envelope));
  }
}

