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
import type { AgentModelChoice, KanaPreferences } from "@/lib/preferences/types";
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

function sameModelChoice(a: AgentModelChoice | null, b: AgentModelChoice | null): boolean {
  if (!a || !b) return a === b;
  return a.provider === b.provider && a.model === b.model;
}

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
  /** A session open under way, so concurrent callers join it instead of creating another. */
  private opening: { conversationId: string; promise: Promise<unknown> } | null = null;
  /** The Kana default the open fresh session was created with; null means Hermes's own. */
  private openedDefault: AgentModelChoice | null = null;
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
      this.openedDefault = null;
      this.unsubscribe = agent.subscribe((event) => handleAgentEvent(this.eventContext, event));
    }
    const agent = this.agent;
    if (agent.connectionState !== "connected") await agent.connect();
    if (this.tracking.openedId !== conversation.id) {
      // The model chip and a new conversation can ask at the same time; the
      // second caller joins the first open rather than creating a session.
      if (this.opening?.conversationId !== conversation.id) {
        this.tracking.openingId = conversation.id;
        const promise = this.openConversationSession(agent, conversation).finally(() => {
          if (this.opening?.promise === promise) this.opening = null;
        });
        this.opening = { conversationId: conversation.id, promise };
      }
      await this.opening.promise;
    }
    return agent;
  }

  /**
   * Open the conversation's Hermes session, applying Kana's default model for
   * this conversation only. The default belongs to the connected runtime and
   * must exist in its live catalog first: `session.create` accepts a provider
   * before the deferred agent build rejects it, so a stale default would break
   * the first turn rather than the open.
   */
  private async openConversationSession(agent: AgentClient, conversation: Conversation) {
    const preferences = this.deps.preferences.current();
    const persistentSessionId = resumableSessionId(conversation);
    const openOptions = {
      // Automatic titles (the default, or the first message) are left to
      // Hermes, which names the session itself.
      title: conversation.titleChosen ? conversation.title : undefined,
      // A session Hermes never stored cannot be resumed; open a new one.
      persistentSessionId,
      cwd: preferences.hermes.cwd || undefined,
    };
    const defaultModel = persistentSessionId
      ? null
      : await this.runtimeDefaultModel(agent, preferences);
    this.openedDefault = defaultModel;
    if (!defaultModel) return agent.openSession(openOptions);
    try {
      return await agent.openSession({
        ...openOptions,
        model: defaultModel.model,
        provider: defaultModel.provider,
      });
    } catch {
      // A saved default can outlive its provider or model. Never let that
      // block the conversation: open with Hermes's own default and say what
      // happened.
      const opened = await agent.openSession(openOptions);
      this.openedDefault = null;
      this.reportDefaultFallback(preferences.uiLocale, defaultModel.model);
      return opened;
    }
  }

  /** The connected runtime's saved default, if its catalog still lists it. */
  private async runtimeDefaultModel(
    agent: AgentClient,
    preferences: KanaPreferences,
  ): Promise<AgentModelChoice | null> {
    const runtimeId = agent.runtimeId;
    const saved = runtimeId ? preferences.agentModelDefaults[runtimeId] ?? null : null;
    if (!saved) return null;
    let catalog: AgentModelCatalog;
    try {
      catalog = await agent.listModels({ forNewSession: true });
    } catch {
      this.reportDefaultFallback(preferences.uiLocale, saved.model);
      return null;
    }
    const available = catalog.providers.some(
      (provider) => provider.slug === saved.provider && provider.models.includes(saved.model),
    );
    if (!available) {
      this.reportDefaultFallback(preferences.uiLocale, saved.model);
      return null;
    }
    return saved;
  }

  private reportDefaultFallback(locale: KanaPreferences["uiLocale"], model: string): void {
    this.deps.stores.errors
      .getState()
      .report("agent", getCopy(locale).composer.defaultModelFallback(model), "session");
  }

  /**
   * The active conversation no longer matches the open Hermes session; the
   * next prompt opens its own. Until then no session counts as open, so the
   * model chip stops showing the previous session's model.
   */
  forgetOpenedSession(): void {
    this.tracking.openedId = null;
    this.openedDefault = null;
    if (this.session.getState().openSessionId) this.session.setState({ openSessionId: null });
  }

  /**
   * Open the active conversation's Hermes session now, as connect() does for
   * the first one, so the composer shows that session's own model (Hermes's
   * default for a new session). Hermes stores nothing until the first prompt;
   * if this fails, the next prompt opens it.
   */
  async openActiveSession(): Promise<void> {
    const active = this.deps.conversations.active();
    if (!active || this.agent?.connectionState !== "connected" || this.session.getState().busy) return;
    await this.ensure(active).catch(() => undefined);
  }

  /**
   * Apply the current Kana default to a blank conversation. An already-open
   * session is reopened only when the default changed after it opened:
   * pressing New again must not create a second Hermes session, whose empty
   * predecessor would return from the directory after a refresh as a
   * duplicate Untitled conversation.
   */
  async syncFreshConversationDefault(): Promise<void> {
    const active = this.deps.conversations.active();
    const agent = this.agent;
    if (!active || !agent || agent.connectionState !== "connected" || this.session.getState().busy) return;
    if (this.tracking.openedId !== active.id) {
      await this.openActiveSession();
      return;
    }
    const desired = await this.runtimeDefaultModel(agent, this.deps.preferences.current());
    if (sameModelChoice(desired, this.openedDefault)) return;
    this.forgetOpenedSession();
    await this.openActiveSession();
  }

  /**
   * Hermes was restarted under Kana: reconnect and resume the open session at
   * once instead of after the reconnect delay. True when Kana is connected again.
   */
  async reconnect(): Promise<boolean> {
    await this.agent?.reconnectNow?.();
    return this.agent?.connectionState === "connected";
  }

  /** Model reads and switches act on the active conversation's own session, opening it first. */
  private async activeAgent(): Promise<AgentClient> {
    if (!this.agent) throw new Error("Hermes is not connected.");
    const active = this.deps.conversations.active();
    return active ? this.ensure(active) : this.agent;
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
        this.openedDefault = null;
      }

      await this.ensure(conversation);

      const known = new Set(conversations.all().map((item) => item.agent?.persistentSessionId).filter(Boolean));
      for (const entry of remote) {
        if (known.has(entry.hermesSessionKey)) continue;
        conversations.persist(conversationFromHermesEntry(entry, createId("conversation")), false);
      }
      this.status((copy) => copy.connected);
    } catch (connectError) {
      // While the relay is down the gate owns the failure and the workspace is
      // unmounted; a connected client that cannot open its conversation still
      // needs the banner, because the workspace is what the user is using.
      if (this.agent?.connectionState === "connected") {
        stores.errors
          .getState()
          .report("agent", connectError instanceof Error ? connectError.message : "Could not connect to the agent.");
      }
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
    const agent = await this.activeAgent();
    return agent.listModels({ refresh });
  }

  async selectModel(provider: string, model: string, confirm = false): Promise<AgentModelSwitchResult> {
    if (!this.agent) throw new Error("Hermes is not connected.");
    if (this.session.getState().busy) {
      throw new Error("Wait for the current Hermes turn to finish before changing models.");
    }
    const agent = await this.activeAgent();
    return agent.selectModel({ provider, model }, { confirm });
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
      // The blank conversation may have opened before the user chose a
      // default, so New applies the current one; an unchanged default keeps
      // the open session instead of opening a second one.
      await this.syncFreshConversationDefault();
      return;
    }
    const conversation = conversations.persist(conversations.create(), false);
    conversations.activate(conversation);
    this.forgetOpenedSession();
    stores.errors.getState().dismiss();
    await this.openActiveSession();
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
    this.openedDefault = null;
    await this.ensure(conversation);
  }

  selectConversation(id: string): void {
    const { conversations, stores, voice, avatar } = this.deps;
    if (this.session.getState().busy || id === stores.conversations.getState().activeConversationId) return;
    const target = conversations.get(id);
    if (!target) return;
    voice.flushHeld();
    conversations.activate(target);
    this.forgetOpenedSession();
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
      this.forgetOpenedSession();
    }
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const agent = this.agent;
    this.agent = null;
    this.opening = null;
    this.tracking.openedId = null;
    this.openedDefault = null;
    this.tracking.openingId = null;
    this.tracking.turnId = null;
    this.session.setState({ openSessionId: null });
    void agent?.disconnect();
  }
}
