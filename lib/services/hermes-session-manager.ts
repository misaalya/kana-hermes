import type {
  AgentClient,
  AgentInputResponse,
  AgentModelCatalog,
  AgentModelSwitchResult,
} from "@/lib/agent/types";
import type { AvatarController } from "@/lib/avatar/avatar-controller";
import {
  conversationFromHermesEntry,
  freshConversationFromPointer,
  rememberedHermesEntry,
  resumableSessionId,
  type HermesConversationDirectoryEntry,
} from "@/lib/conversation/active-conversation";
import { createId, type Conversation } from "@/lib/conversation/types";
import type { KanaStores } from "@/lib/store/kana-stores";
import { getCopy } from "@/lib/ui/copy";
import {
  handleAgentEvent,
  statusCopy,
  type AgentEventContext,
  type SessionTracking,
} from "./agent-event-handlers";
import { isFreshConversation, type ConversationService } from "./conversation-service";
import type { PreferencesAccess } from "./preferences-service";
import type { VoiceService } from "./voice-service";

export type HermesSessionManagerDependencies = {
  stores: KanaStores;
  conversations: ConversationService;
  voice: VoiceService;
  avatar: AvatarController;
  preferences: PreferencesAccess;
  /** HermesAgentClient in the app; the browser reaches Hermes only through the Kana relay. */
  createAgent(): AgentClient;
};

/**
 * Owns the Hermes client for one workspace: connection, which conversation's
 * session is open, and conversation switches that need Hermes. The client is
 * subscribed once; every event goes through handleAgentEvent into the stores.
 */
export class HermesSessionManager {
  readonly tracking: SessionTracking = {
    openedId: null,
    openingId: null,
    turnId: null,
    connectionStartedAt: null,
    turnStartedAt: null,
  };
  private agent: AgentClient | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly eventContext: AgentEventContext;

  constructor(private readonly deps: HermesSessionManagerDependencies) {
    this.eventContext = {
      stores: deps.stores,
      tracking: this.tracking,
      conversations: deps.conversations,
      voice: deps.voice,
      avatar: deps.avatar,
      preferences: deps.preferences,
      fetchHistory: async () => {
        if (!this.agent) throw new Error("Hermes client is not connected.");
        return (await this.agent.fetchHistory()).messages ?? [];
      },
    };
  }

  /** The connected client, if any. */
  get client(): AgentClient | null {
    return this.agent;
  }

  private get session() {
    return this.deps.stores.agentSession;
  }

  private status(pick: (copy: ReturnType<typeof statusCopy>) => string) {
    this.session.setState({ status: pick(statusCopy(this.deps.preferences.current().uiLocale)) });
  }

  /** Connect if needed and open the conversation's Hermes session on the client. */
  async ensure(conversation: Conversation): Promise<AgentClient> {
    if (!this.agent) {
      const agent = this.deps.createAgent();
      this.agent = agent;
      this.tracking.openedId = null;
      this.unsubscribe = agent.subscribe((event) => handleAgentEvent(this.eventContext, event));
    }
    const agent = this.agent;
    if (agent.connectionState !== "connected") await agent.connect();
    if (this.tracking.openedId !== conversation.id) {
      this.tracking.openingId = conversation.id;
      await agent.openSession({
        title: conversation.title,
        // A session Hermes never stored cannot be resumed; open a new one.
        persistentSessionId: resumableSessionId(conversation),
        cwd: this.deps.preferences.current().hermes.cwd || undefined,
      });
    }
    return agent;
  }

  /** The next prompt opens the active conversation's session again. */
  forgetOpenedSession(): void {
    this.tracking.openedId = null;
  }

  /**
   * Connect and land on a conversation: the remembered selection, else the
   * most recent non-empty Hermes session, else a fresh conversation. Sessions
   * from other browsers are added to the working set.
   */
  async connect(): Promise<void> {
    const { conversations, stores } = this.deps;
    stores.errors.getState().dismiss();
    try {
      // Selection and recency are separate: the pointer says which
      // conversation was open, Hermes last_active orders the history.
      let remote: HermesConversationDirectoryEntry[] = [];
      let directoryLoaded = false;
      try {
        const sessions = await conversations.loadHermesSessions();
        remote = sessions ?? [];
        directoryLoaded = sessions !== null;
      } catch {
        // Directory hydration is best-effort.
      }

      let conversation: Conversation | undefined = conversations.active();
      if (!conversation) {
        const pointer = stores.conversations.getState().activePointer;
        const entry = rememberedHermesEntry(pointer, remote) ?? remote.find((item) => item.messageCount > 0);
        if (entry) {
          conversation =
            conversations.all().find((item) => item.agent?.persistentSessionId === entry.hermesSessionKey) ??
            conversations.persist(
              conversationFromHermesEntry(
                entry,
                pointer?.persistentSessionId === entry.hermesSessionKey
                  ? pointer.conversationId
                  : createId("conversation"),
              ),
              false,
            );
        } else {
          if (pointer?.persistentSessionId && !directoryLoaded) {
            conversation = conversations.persist(
              {
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
              },
              false,
            );
          } else if (pointer?.persistentSessionId) {
            conversations.forgetPointer();
          }
          if (!conversation) {
            const fresh = freshConversationFromPointer(pointer);
            conversation = conversations.persist(fresh ?? conversations.create(), false);
          }
        }
        conversations.activate(conversation);
        this.tracking.openedId = null;
      }

      await this.ensure(conversation);

      const known = new Set(conversations.all().map((item) => item.agent?.persistentSessionId).filter(Boolean));
      for (const entry of remote) {
        if (known.has(entry.hermesSessionKey)) continue;
        conversations.persist(conversationFromHermesEntry(entry, createId("conversation")), false);
      }
      this.status((copy) => copy.connected);
    } catch (connectError) {
      stores.errors
        .getState()
        .report("agent", connectError instanceof Error ? connectError.message : "Could not connect to the agent.");
    }
  }

  async abort(): Promise<void> {
    this.deps.voice.flushHeld();
    if (this.session.getState().busy) await this.agent?.abort();
  }

  async respondToInput(response: AgentInputResponse): Promise<void> {
    const { stores } = this.deps;
    const agent = this.agent;
    if (!agent) {
      stores.errors.getState().report("agent", "Hermes is not connected.", "connection");
      return;
    }
    const closeMatchingRequest = () => {
      const current = this.session.getState().pendingInput;
      if (!current || current.kind !== response.kind) return;
      if (current.kind === "approval" || response.kind === "approval" || current.requestId === response.requestId) {
        this.session.setState({ pendingInput: null });
      }
    };
    this.session.setState({ respondingToInput: true });
    stores.errors.getState().dismiss();
    try {
      await agent.respondToInput(response);
      closeMatchingRequest();
      this.status((copy) => copy.inputSent);
    } catch (responseError) {
      const message = responseError instanceof Error ? responseError.message : "Could not send input to Hermes.";
      stores.errors.getState().report("agent", message);
      // Never trap the user behind an unanswerable dialog: close it and show
      // the failure in the activity stack instead.
      closeMatchingRequest();
      stores.activity.getState().add({
        id: createId("activity"),
        kind: "input",
        title: "Hermes input could not be delivered",
        detail: message,
        state: "attention",
        timestamp: Date.now(),
      });
      this.status((copy) => copy.inputFailed);
    } finally {
      this.session.setState({ respondingToInput: false });
    }
  }

  async listModels(refresh = false): Promise<AgentModelCatalog> {
    if (!this.agent) throw new Error("Hermes is not connected.");
    return this.agent.listModels({ refresh });
  }

  async selectModel(provider: string, model: string, confirm = false): Promise<AgentModelSwitchResult> {
    if (!this.agent) throw new Error("Hermes is not connected.");
    if (this.session.getState().busy) {
      throw new Error("Wait for the current Hermes turn to finish before changing models.");
    }
    return this.agent.selectModel({ provider, model }, { confirm });
  }

  // ---- Conversation switches that involve the Hermes session ----

  async createConversation(): Promise<void> {
    const { conversations, stores, voice } = this.deps;
    if (this.session.getState().busy) return;
    voice.flushHeld();
    if (isFreshConversation(conversations.active())) {
      stores.activity.getState().reset();
      this.status((copy) => copy.alreadyNew);
      stores.errors.getState().dismiss();
      return;
    }
    const conversation = conversations.persist(conversations.create(), false);
    conversations.activate(conversation);
    this.tracking.openedId = null;
    stores.errors.getState().dismiss();
  }

  /** Open a Kana session another browser or surface created. */
  async adoptHermesSession(entry: HermesConversationDirectoryEntry): Promise<void> {
    const { conversations, voice } = this.deps;
    if (this.session.getState().busy) return;
    voice.flushHeld();
    const conversation =
      conversations.all().find((item) => item.agent?.persistentSessionId === entry.hermesSessionKey) ??
      conversations.persist(conversationFromHermesEntry(entry, createId("conversation")), false);
    conversations.activate(conversation);
    this.tracking.openedId = null;
    await this.ensure(conversation);
  }

  selectConversation(id: string): void {
    const { conversations, stores, voice, avatar } = this.deps;
    if (this.session.getState().busy || id === stores.conversations.getState().activeConversationId) return;
    const target = conversations.get(id);
    if (!target) return;
    voice.flushHeld();
    conversations.activate(target);
    this.tracking.openedId = null;
    stores.errors.getState().dismiss();
    voice.release();
    avatar.presentEmotion("neutral");
    if (!target.agent?.persistentSessionId) return;
    // Opening the linked session is what emits history.restored; without it a
    // refreshed or fresh browser shows tool activity but no messages.
    void this.ensure(target).catch(() => {
      this.session.setState({
        status: getCopy(this.deps.preferences.current().uiLocale).agentStatus.sessionReopenFailed,
      });
    });
  }

  renameConversation(id: string, title: string): void {
    this.deps.conversations.rename(id, title);
  }

  deleteConversation(id: string): void {
    const { conversations, stores, voice } = this.deps;
    if (this.session.getState().busy) return;
    const wasActive = stores.conversations.getState().activeConversationId === id;
    if (wasActive) voice.discardHeld();
    conversations.remove(id);
    if (!conversations.all().length) conversations.persist(conversations.create(), false);
    if (wasActive) {
      const next = conversations.all()[0];
      if (next) conversations.activate(next);
      else conversations.clearActive();
      this.tracking.openedId = null;
    }
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const agent = this.agent;
    this.agent = null;
    this.tracking.openedId = null;
    this.tracking.openingId = null;
    this.tracking.turnId = null;
    this.session.setState({ openSessionId: null });
    void agent?.disconnect();
  }
}
