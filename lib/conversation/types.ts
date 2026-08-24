import type {
  Emotion,
  Subtitle,
  SubtitleLanguage,
} from "@/lib/presentation/types";

export type KanaMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text?: string;
  command?: string;
  speech_ja?: string;
  subtitle?: Subtitle;
  emotion?: Emotion;
  timestamp: number;
  /** Tool activity log for the turn that produced this assistant reply. */
  activities?: import("@/lib/agent/types").ActivityItem[];
};

export type ConversationAgentLink = {
  provider: "hermes";
  persistentSessionId: string;
  status?: "linked" | "missing";
  relationship?: "primary" | "branch";
  parentConversationId?: string;
};

export type Conversation = {
  id: string;
  title: string;
  messages: KanaMessage[];
  subtitleLanguageAtCreation: SubtitleLanguage;
  agent?: ConversationAgentLink;
  createdAt: number;
  updatedAt: number;
};

export type CreateConversationInput = {
  title?: string;
  subtitleLanguage: SubtitleLanguage;
};

export interface ConversationStore {
  list(): Promise<Conversation[]>;
  get(id: string): Promise<Conversation | null>;
  create(input: CreateConversationInput): Promise<Conversation>;
  save(conversation: Conversation): Promise<void>;
  rename(id: string, title: string): Promise<Conversation | null>;
  delete(id: string): Promise<void>;
}

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createConversation(
  input: CreateConversationInput,
): Conversation {
  const now = Date.now();
  return {
    id: createId("conversation"),
    title: input.title?.trim() || "New conversation",
    messages: [],
    subtitleLanguageAtCreation: input.subtitleLanguage,
    createdAt: now,
    updatedAt: now,
  };
}
