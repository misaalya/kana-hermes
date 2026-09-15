import type { ActivityItem, AgentHistoryRow } from "@/lib/agent/types";
import {
  clearActiveConversationPointer,
  freshConversationFromPointer,
  pointerFromConversation,
  readActiveConversationPointer,
  writeActiveConversationPointer,
  type HermesConversationDirectoryEntry,
} from "@/lib/conversation/active-conversation";
import { mergeRestoredMessages, parseHermesTranscript } from "@/lib/conversation/hermes-transcript";
import {
  createConversation,
  type Conversation,
  type CreateConversationInput,
  type KanaMessage,
} from "@/lib/conversation/types";
import type { ServerActivityTurn } from "@/lib/store/activity-store";
import { findConversation, selectActiveConversation } from "@/lib/store/conversation-store";
import type { KanaStores } from "@/lib/store/kana-stores";

export type PointerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ConversationServiceDependencies = {
  stores: Pick<KanaStores, "conversations" | "activity" | "agentSession" | "errors">;
  fetch: typeof fetch;
  /** Browser storage for the active-conversation pointer; localStorage by default. */
  pointerStorage?: PointerStorage;
};

// A conversation with zero displayed messages is still "fresh": either no
// Hermes session was opened for it yet, or the opened one is empty. Both are
// equivalent — clicking "new" while on one must reuse it, not mint another.
export function isFreshConversation(conversation: Conversation | null | undefined): boolean {
  return Boolean(conversation && conversation.messages.length === 0);
}

/**
 * Kana's working set of conversations. Hermes owns every transcript; the
 * browser keeps only which conversation is selected (the pointer) so a refresh
 * returns to the same Hermes session.
 */
export class ConversationService {
  private restoring = false;
  private activityRequest = 0;
  private sessionsRequest = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: ConversationServiceDependencies) {}

  private get store() {
    return this.deps.stores.conversations;
  }

  /** True while a restored transcript is being applied. */
  get restoringTranscript(): boolean {
    return this.restoring;
  }

  get(id: string | null | undefined): Conversation | undefined {
    return findConversation(this.store.getState(), id);
  }

  active(): Conversation | undefined {
    return selectActiveConversation(this.store.getState()) ?? undefined;
  }

  all(): Conversation[] {
    return this.store.getState().conversations;
  }

  create(input: CreateConversationInput = {}): Conversation {
    return createConversation(input);
  }

  /** Put a conversation into the working set, optionally marking it recently used. */
  persist(conversation: Conversation, touchRecency: boolean): Conversation {
    const updated = touchRecency ? { ...conversation, updatedAt: Date.now() } : conversation;
    this.store.getState().upsert(updated);
    return updated;
  }

  /** Persist as recently used; the active conversation also updates the pointer. */
  save(conversation: Conversation): Conversation {
    const saved = this.persist(conversation, true);
    if (this.store.getState().activeConversationId === saved.id) this.writePointer(saved);
    return saved;
  }

  /** Select a conversation. Switching clears the previous conversation's activity. */
  activate(conversation: Conversation): void {
    if (this.store.getState().activeConversationId !== conversation.id) {
      this.deps.stores.activity.getState().reset();
    }
    this.store.setState({ activeConversationId: conversation.id });
    this.writePointer(conversation);
  }

  /** Re-point the selection after the active conversation changed (link, title). */
  refreshActive(conversation: Conversation): void {
    if (this.store.getState().activeConversationId === conversation.id) this.activate(conversation);
  }

  remove(id: string): void {
    this.store.getState().commit(this.all().filter((item) => item.id !== id));
  }

  clearActive(): void {
    this.store.setState({ activeConversationId: null, activePointer: null });
    clearActiveConversationPointer(this.pointerStorage());
  }

  /** Forget a remembered linked session that Hermes no longer lists. */
  forgetPointer(): void {
    this.store.setState({ activePointer: null });
    clearActiveConversationPointer(this.pointerStorage());
  }

  rename(id: string, title: string): void {
    const existing = this.get(id);
    if (!existing) return;
    this.refreshActive(this.persist({ ...existing, title }, false));
  }

  markMissing(id: string | null | undefined): void {
    const conversation = this.get(id);
    if (!conversation?.agent || conversation.agent.status === "missing") return;
    this.persist({ ...conversation, agent: { ...conversation.agent, status: "missing" } }, false);
  }

  /**
   * Reconstruct the selected conversation before Hermes is reachable, so the
   * composer works immediately.
   */
  initialize(): void {
    let pointer = readActiveConversationPointer(this.pointerStorage());
    const fresh = freshConversationFromPointer(pointer);
    let conversation: Conversation;
    if (fresh) {
      conversation = fresh;
    } else if (pointer?.persistentSessionId) {
      // A lightweight handle for the linked conversation; its transcript loads
      // from Hermes once the automatic connection opens the session.
      conversation = {
        id: pointer.conversationId,
        title: pointer.title,
        messages: [],
        agent: {
          provider: "hermes",
          persistentSessionId: pointer.persistentSessionId,
          status: "linked",
          relationship: "primary",
        },
        createdAt: pointer.createdAt,
        updatedAt: pointer.createdAt,
      };
    } else {
      // A brand-new browser still needs a local conversation, or the controlled
      // message box would discard every typed character.
      conversation = this.create();
      pointer = pointerFromConversation(conversation);
      writeActiveConversationPointer(conversation, this.pointerStorage());
    }
    this.store.getState().commit([conversation]);
    this.store.setState({ activeConversationId: conversation.id, activePointer: pointer });
  }

  /** Append a finished assistant reply and mirror its tool activity to the server log. */
  commitAssistantMessage(conversationId: string, message: KanaMessage): void {
    const conversation = this.get(conversationId);
    if (!conversation) return;
    this.save({
      ...conversation,
      messages: [...conversation.messages, message],
      // A completed reply means Hermes ran a turn, so its session is stored.
      ...(conversation.agent ? { agent: { ...conversation.agent, durable: true } } : {}),
    });
    const hermesSessionKey = conversation.agent?.persistentSessionId;
    const activities = message.activities ?? [];
    if (hermesSessionKey && activities.length) {
      const lastToolTimestamp = Math.max(...activities.map((activity) => activity.timestamp));
      this.putActivities({
        session: hermesSessionKey,
        turnAnchorMs: Math.min(lastToolTimestamp + 1, message.timestamp),
        turnIndex: conversation.messages.filter((item) => item.role === "assistant").length,
        activities,
      });
    }
  }

  /**
   * Apply a restored Hermes transcript to one conversation.
   *
   * Primary source: the messages returned by session.resume (delivered through
   * the history.restored event). session.history is a fallback only — it
   * resolves runtime session ids, never durable keys. When neither yields rows
   * the outcome is a visible status, never a silent empty transcript.
   */
  async restoreTranscript(
    conversationId: string,
    hermesSessionKey: string,
    resumedRows: AgentHistoryRow[],
    fetchHistory: () => Promise<AgentHistoryRow[]>,
  ): Promise<void> {
    this.restoring = true;
    try {
      let rows = resumedRows;
      if (!rows.length) {
        try {
          rows = await fetchHistory();
        } catch (historyError) {
          this.deps.stores.errors.getState().report("agent", historyError);
        }
      }

      const { messages, turns } = parseHermesTranscript(rows);
      // Fresh read: rows appended while the fallback fetch was in flight must
      // not be clobbered by a stale snapshot.
      const target = this.get(conversationId);
      if (!target) return;

      if (!messages.length) {
        if (!target.messages.length) {
          this.deps.stores.agentSession.setState({
            status: "Hermes returned no stored transcript for this conversation.",
          });
        }
        return;
      }

      this.persist({ ...target, messages: mergeRestoredMessages(messages, target.messages) }, false);
      for (const turn of turns) {
        this.putActivities({
          session: hermesSessionKey,
          turnAnchorMs: turn.anchorMs,
          turnIndex: turn.turnIndex,
          activities: turn.activities,
        });
      }
    } finally {
      this.restoring = false;
    }
  }

  /** Load the Hermes session directory; returns null when it could not be read. */
  async loadHermesSessions(): Promise<HermesConversationDirectoryEntry[] | null> {
    const request = ++this.sessionsRequest;
    const response = await this.deps.fetch("/api/kana/sessions", { credentials: "same-origin" });
    const directory = (response.ok ? await response.json() : null) as {
      sessions?: HermesConversationDirectoryEntry[];
    } | null;
    if (!directory) return null;
    const sessions = [...(directory.sessions ?? [])].sort((a, b) => b.lastActive - a.lastActive);
    // A slower, older response must not replace a newer directory.
    if (request === this.sessionsRequest) this.store.setState({ hermesSessions: sessions });
    return sessions;
  }

  /** Load stored tool activity for a Hermes session. Stale responses are ignored. */
  async loadServerActivities(sessionKey: string): Promise<void> {
    const request = ++this.activityRequest;
    this.deps.stores.activity.setState({ sessionKey });
    try {
      const response = await this.deps.fetch(
        `/api/kana/activities?session=${encodeURIComponent(sessionKey)}`,
        { credentials: "same-origin" },
      );
      const data = (response.ok ? await response.json() : null) as { turns?: ServerActivityTurn[] } | null;
      if (
        !data?.turns ||
        request !== this.activityRequest ||
        this.deps.stores.activity.getState().sessionKey !== sessionKey
      ) {
        return;
      }
      // Merge by ordinal: at most one row per turn index reaches the feed, so a
      // legacy anchor row and its indexed successor never render a turn twice.
      const seenIndexes = new Set<number>();
      this.deps.stores.activity.setState({
        serverActivityTurns: data.turns.filter((turn) => {
          if (typeof turn.turnIndex !== "number") return true;
          if (seenIndexes.has(turn.turnIndex)) return false;
          seenIndexes.add(turn.turnIndex);
          return true;
        }),
      });
    } catch {
      // Best effort: no stored turns simply shows none.
    }
  }

  /** Follow the open conversation's Hermes session: stored activity and the session directory. */
  start(): void {
    if (this.unsubscribe) return;
    let sessionKey = this.active()?.agent?.persistentSessionId ?? null;
    const follow = (key: string | null) => {
      // Any change invalidates responses for the previous session.
      this.activityRequest += 1;
      if (!key) return;
      void this.loadServerActivities(key);
      void this.loadHermesSessions().catch(() => undefined);
    };
    follow(sessionKey);
    this.unsubscribe = this.store.subscribe((state) => {
      const next = selectActiveConversation(state)?.agent?.persistentSessionId ?? null;
      if (next === sessionKey) return;
      sessionKey = next;
      follow(next);
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.activityRequest += 1;
    this.sessionsRequest += 1;
  }

  private putActivities(body: {
    session: string;
    turnAnchorMs: number;
    turnIndex: number;
    activities: ActivityItem[];
  }): void {
    void this.deps
      .fetch("/api/kana/activities", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      })
      .catch(() => {});
  }

  private writePointer(conversation: Conversation): void {
    this.store.setState({ activePointer: pointerFromConversation(conversation) });
    writeActiveConversationPointer(conversation, this.pointerStorage());
  }

  private pointerStorage(): PointerStorage | undefined {
    if (this.deps.pointerStorage) return this.deps.pointerStorage;
    try {
      return typeof window === "undefined" ? undefined : window.localStorage;
    } catch {
      return undefined;
    }
  }
}
