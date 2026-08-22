import {
  KANA_DATABASE_STORES,
  openKanaDatabase,
  requestResult,
  transactionDone,
} from "@/lib/storage/kana-indexed-db";
import { LocalConversationStore } from "./local-conversation-store";
import {
  createConversation,
  type Conversation,
  type ConversationStore,
  type CreateConversationInput,
} from "./types";

function sortRecent(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Durable browser store for Kana history. Existing localStorage history is
 * imported once per missing conversation ID, preserving the original message
 * subtitle text and language byte-for-byte.
 */
export class IndexedDbConversationStore implements ConversationStore {
  private databasePromise: Promise<IDBDatabase | null> | null = null;
  private warning: string | null = null;

  constructor(
    private readonly legacyStore: ConversationStore = new LocalConversationStore(),
  ) {}

  async list(): Promise<Conversation[]> {
    const database = await this.getDatabase();
    if (!database) return this.legacyStore.list();
    const transaction = database.transaction(
      KANA_DATABASE_STORES.conversations,
      "readonly",
    );
    const result = await requestResult(
      transaction.objectStore(KANA_DATABASE_STORES.conversations).getAll(),
    );
    await transactionDone(transaction);
    return sortRecent(result as Conversation[]);
  }

  async get(id: string): Promise<Conversation | null> {
    const database = await this.getDatabase();
    if (!database) return this.legacyStore.get(id);
    const transaction = database.transaction(
      KANA_DATABASE_STORES.conversations,
      "readonly",
    );
    const result = await requestResult(
      transaction.objectStore(KANA_DATABASE_STORES.conversations).get(id),
    );
    await transactionDone(transaction);
    return (result as Conversation | undefined) ?? null;
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    const conversation = createConversation(input);
    await this.save(conversation);
    return conversation;
  }

  async save(conversation: Conversation): Promise<void> {
    const database = await this.getDatabase();
    if (!database) return this.legacyStore.save(conversation);
    const transaction = database.transaction(
      KANA_DATABASE_STORES.conversations,
      "readwrite",
    );
    transaction
      .objectStore(KANA_DATABASE_STORES.conversations)
      .put({ ...conversation, updatedAt: Date.now() });
    await transactionDone(transaction);
  }

  async rename(id: string, title: string): Promise<Conversation | null> {
    const conversation = await this.get(id);
    const nextTitle = title.trim();
    if (!conversation || !nextTitle) return conversation;
    const renamed = { ...conversation, title: nextTitle, updatedAt: Date.now() };
    await this.save(renamed);
    return renamed;
  }

  async delete(id: string): Promise<void> {
    const database = await this.getDatabase();
    if (!database) return this.legacyStore.delete(id);
    const transaction = database.transaction(
      KANA_DATABASE_STORES.conversations,
      "readwrite",
    );
    transaction.objectStore(KANA_DATABASE_STORES.conversations).delete(id);
    await transactionDone(transaction);
  }

  consumeWarning(): string | null {
    const warning = this.warning;
    this.warning = null;
    return warning;
  }

  private async getDatabase(): Promise<IDBDatabase | null> {
    this.databasePromise ??= this.openAndMigrate();
    return this.databasePromise;
  }

  private async openAndMigrate(): Promise<IDBDatabase | null> {
    try {
      const database = await openKanaDatabase();
      const legacyConversations = await this.legacyStore.list();
      for (const conversation of legacyConversations) {
        const transaction = database.transaction(
          KANA_DATABASE_STORES.conversations,
          "readwrite",
        );
        const store = transaction.objectStore(KANA_DATABASE_STORES.conversations);
        const existing = await requestResult(store.get(conversation.id));
        if (!existing) store.put(conversation);
        await transactionDone(transaction);
      }
      return database;
    } catch {
      this.warning =
        "Kana could not open IndexedDB. Conversation history is using the legacy local fallback for this page.";
      return null;
    }
  }
}
