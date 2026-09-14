import type {
  Emotion,
  Subtitle,
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
  /**
   * False while the Hermes session exists only in the gateway's memory:
   * Hermes writes its database row on the first prompt, so a session that
   * never received one vanishes when Hermes restarts. Absent means durable
   * (resumed, adopted from the Hermes directory, or stored by older builds).
   */
  durable?: boolean;
};

export type Conversation = {
  id: string;
  title: string;
  messages: KanaMessage[];
  agent?: ConversationAgentLink;
  createdAt: number;
  updatedAt: number;
};

export type CreateConversationInput = {
  title?: string;
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
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
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
    createdAt: now,
    updatedAt: now,
  };
}
