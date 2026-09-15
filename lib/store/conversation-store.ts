import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  ActiveConversationPointer,
  HermesConversationDirectoryEntry,
} from "@/lib/conversation/active-conversation";
import type { Conversation } from "@/lib/conversation/types";

export type ConversationState = {
  /** False until the stored selection has been reconstructed on start. */
  ready: boolean;
  /** Most recently updated first. */
  conversations: Conversation[];
  activeConversationId: string | null;
  /** What the browser remembers as selected, including before it is loaded. */
  activePointer: ActiveConversationPointer | null;
  /** Kana sessions known to Hermes, including ones this browser never opened. */
  hermesSessions: HermesConversationDirectoryEntry[];
  commit(conversations: Conversation[]): void;
  upsert(conversation: Conversation): void;
};

export type ConversationStateStore = StoreApi<ConversationState>;

export function recentFirst(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createConversationStore(): ConversationStateStore {
  return createStore<ConversationState>()((set, get) => ({
    ready: false,
    conversations: [],
    activeConversationId: null,
    activePointer: null,
    hermesSessions: [],
    commit(conversations) {
      set({ conversations: recentFirst(conversations) });
    },
    upsert(conversation) {
      const current = get().conversations;
      get().commit(
        current.some((item) => item.id === conversation.id)
          ? current.map((item) => (item.id === conversation.id ? conversation : item))
          : [...current, conversation],
      );
    },
  }));
}

export function findConversation(
  state: Pick<ConversationState, "conversations">,
  id: string | null | undefined,
): Conversation | undefined {
  return id ? state.conversations.find((item) => item.id === id) : undefined;
}

export function selectActiveConversation(state: ConversationState): Conversation | null {
  return findConversation(state, state.activeConversationId) ?? null;
}
