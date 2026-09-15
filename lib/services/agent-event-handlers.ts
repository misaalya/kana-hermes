import type { AgentEvent, AgentHistoryRow, AgentToolKind } from "@/lib/agent/types";
import type { AvatarController } from "@/lib/avatar/avatar-controller";
import { createId, type KanaMessage } from "@/lib/conversation/types";
import { classifyKanaError } from "@/lib/diagnostics/safe-diagnostics";
import type { KanaPreferences } from "@/lib/preferences/types";
import type { KanaStores } from "@/lib/store/kana-stores";
import { getCopy } from "@/lib/ui/copy";
import type { ConversationService } from "./conversation-service";
import type { PreferencesAccess } from "./preferences-service";
import type { VoiceService } from "./voice-service";

export function statusCopy(locale: KanaPreferences["uiLocale"]) {
  return getCopy(locale).status;
}

export function toolTitle(kind: AgentToolKind, tool: string): string {
  if (kind === "command") return `Running ${tool}`;
  if (kind === "file") return `Updating files with ${tool}`;
  return `Using ${tool}`;
}

export function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/**
 * Which conversation the Hermes session is working for. Held by
 * HermesSessionManager; event handling reads and clears it.
 */
export type SessionTracking = {
  /** Conversation whose Hermes session is open on the client. */
  openedId: string | null;
  /** Conversation whose session is being opened. */
  openingId: string | null;
  /** Conversation that started the running turn. */
  turnId: string | null;
  connectionStartedAt: number | null;
  turnStartedAt: number | null;
};

export type AgentEventContext = {
  stores: KanaStores;
  tracking: SessionTracking;
  conversations: ConversationService;
  voice: VoiceService;
  avatar: AvatarController;
  preferences: PreferencesAccess;
  fetchHistory(): Promise<AgentHistoryRow[]>;
};

function eventConversationId(context: AgentEventContext): string | null {
  const { tracking } = context;
  return tracking.turnId ?? tracking.openingId ?? context.stores.conversations.getState().activeConversationId;
}

function setStatus(context: AgentEventContext, status: string) {
  context.stores.agentSession.setState({ status });
}

function locale(context: AgentEventContext) {
  return context.preferences.current().uiLocale;
}

function clearInput(context: AgentEventContext) {
  context.stores.agentSession.setState({ pendingInput: null, respondingToInput: false });
}

function onSessionOpened(context: AgentEventContext, event: Extract<AgentEvent, { type: "session.opened" }>) {
  const conversationId = eventConversationId(context);
  const conversation = context.conversations.get(conversationId);
  if (!conversation || !conversationId) return;
  context.tracking.openingId = null;
  context.tracking.openedId = conversationId;
  context.stores.agentSession.setState({ openSessionId: event.sessionId });
  // A resumed session is stored in Hermes. A newly created one is not until
  // its first prompt, so it must not become the refresh pointer.
  const durable =
    event.resumed ||
    (conversation.agent?.persistentSessionId === event.persistentSessionId &&
      conversation.agent.durable !== false);
  const linked = context.conversations.persist(
    {
      ...conversation,
      agent: {
        provider: "hermes",
        persistentSessionId: event.persistentSessionId,
        ...(durable ? {} : { durable: false }),
        status: "linked",
        relationship: conversation.agent?.relationship ?? "primary",
        ...(conversation.agent?.parentConversationId
          ? { parentConversationId: conversation.agent.parentConversationId }
          : {}),
      },
    },
    false,
  );
  context.conversations.refreshActive(linked);
}

function onSessionUpdated(context: AgentEventContext, event: Extract<AgentEvent, { type: "session.updated" }>) {
  if (!event.title) return;
  const conversation = context.conversations.get(eventConversationId(context));
  if (!conversation) return;
  context.conversations.refreshActive(context.conversations.persist({ ...conversation, title: event.title }, false));
}

function onAssistantMessage(context: AgentEventContext, event: Extract<AgentEvent, { type: "assistant.message" }>) {
  const conversation = context.conversations.get(eventConversationId(context));
  if (!conversation) return;
  // While a restore is being applied the last local row may be restored
  // history; comparing against it would swallow the incoming reply.
  if (!context.conversations.restoringTranscript) {
    // A new user turn may legitimately get the same short answer. Only an
    // adjacent identical reply is a duplicate (e.g. reconnect recovery).
    const lastMessage = conversation.messages.at(-1);
    const previousAssistant = lastMessage?.role === "assistant" ? lastMessage : undefined;
    if (
      previousAssistant?.speech_ja === event.response.speech_ja &&
      previousAssistant.subtitle?.text === event.response.subtitle.text &&
      previousAssistant.subtitle.language === event.response.subtitle.language
    ) {
      return;
    }
  }
  const message: KanaMessage = {
    id: createId("message"),
    role: "assistant",
    speech_ja: event.response.speech_ja,
    subtitle: { ...event.response.subtitle },
    emotion: event.response.emotion ?? "neutral",
    timestamp: Date.now(),
    activities: [...context.stores.activity.getState().turnLog],
  };
  const reveal = async () => context.conversations.commitAssistantMessage(conversation.id, message);

  if (!context.preferences.current().voiceEnabled) {
    context.avatar.presentEmotion(message.emotion);
    void reveal();
    return;
  }

  // The reply stays hidden until its audio starts; failure or Stop reveals it.
  setStatus(context, statusCopy(locale(context)).preparingVoice);
  const queue = context.voice.spokenReplies;
  queue.enqueue({
    id: message.id,
    reveal,
    speak: async (showReply) => {
      const preferences = context.preferences.current();
      if (!preferences.voiceEnabled) return;
      setStatus(context, statusCopy(preferences.uiLocale).preparingVoice);
      await context.voice.getProvider().speak({
        text: event.response.speech_ja,
        language: "ja",
        emotion: message.emotion,
        voiceId: preferences.voice.voiceId || undefined,
        deliveryMode: preferences.voice.deliveryMode,
        onAudioStart: () => {
          context.avatar.presentEmotion(message.emotion);
          setStatus(context, statusCopy(locale(context)).speaking);
          showReply();
        },
      });
    },
    onError: (voiceError) => context.stores.errors.getState().report("voice", voiceError, "voice"),
    onFinished: () => {
      context.avatar.presentEmotion(message.emotion);
      if (!queue.active) setStatus(context, statusCopy(locale(context)).ready);
    },
  });
}

function onConnectionChanged(context: AgentEventContext, event: Extract<AgentEvent, { type: "connection.changed" }>) {
  const { stores, tracking } = context;
  const errors = stores.errors.getState();
  stores.agentSession.setState({ connectionState: event.state });
  if (event.state === "connecting" || event.state === "reconnecting") {
    tracking.connectionStartedAt ??= monotonicNow();
  }
  if (event.retryAttempt !== undefined) {
    errors.accumulateMetrics({ reconnectCount: stores.errors.getState().metrics.reconnectCount + 1 });
  }
  if (event.state === "connected") {
    if (tracking.connectionStartedAt !== null) {
      const duration = Math.round(monotonicNow() - tracking.connectionStartedAt);
      tracking.connectionStartedAt = null;
      errors.accumulateMetrics({ lastConnectDurationMs: duration });
    }
    setStatus(context, statusCopy(locale(context)).connected);
    return;
  }
  if (event.state === "reconnecting" || event.state === "error") {
    clearInput(context);
    tracking.openedId = null;
    tracking.openingId = null;
    context.voice.flushHeld();
    stores.agentSession.setState({
      busy: false,
      openSessionId: null,
      status: statusCopy(locale(context)).reconnecting,
    });
    if (event.message) errors.record(classifyKanaError(event.message, "agent", "connection"));
    return;
  }
  if (event.state === "disconnected" || event.state === "authentication_failed" || event.state === "incompatible") {
    clearInput(context);
    tracking.openedId = null;
    tracking.openingId = null;
    tracking.turnId = null;
    context.voice.flushHeld();
    stores.agentSession.setState({
      busy: false,
      openSessionId: null,
      status:
        event.state === "authentication_failed"
          ? "Hermes authentication failed"
          : event.state === "incompatible"
            ? "Hermes connection is incompatible"
            : "Agent disconnected",
    });
    if (event.message) {
      errors.report(
        "agent",
        event.message,
        event.state === "authentication_failed"
          ? "authentication"
          : event.state === "incompatible"
            ? "protocol"
            : "connection",
      );
    }
  }
}

function onAgentError(context: AgentEventContext, event: Extract<AgentEvent, { type: "agent.error" }>) {
  const { stores, tracking } = context;
  tracking.turnStartedAt = null;
  clearInput(context);
  stores.agentSession.setState({ busy: false });
  const sessionMissing = /session (?:not found|no longer exists)/i.test(event.message);
  const conversation = context.conversations.get(eventConversationId(context));
  if (sessionMissing && conversation?.agent?.durable === false) {
    // Hermes restarted before this session's first prompt, so it was never
    // stored and no history was lost. Unlink quietly; the conversation stays
    // selected and the next prompt opens a new session.
    const { agent: _unstored, ...unlinked } = conversation;
    void _unstored;
    context.conversations.refreshActive(context.conversations.persist(unlinked, false));
    tracking.openingId = null;
    tracking.openedId = null;
    tracking.turnId = null;
    stores.agentSession.setState({ openSessionId: null });
    setStatus(context, statusCopy(locale(context)).newReady);
    return;
  }
  setStatus(context, statusCopy(locale(context)).attention);
  stores.errors.getState().report("agent", event.message);
  if (sessionMissing) {
    context.conversations.markMissing(conversation?.id);
    tracking.openingId = null;
    tracking.openedId = null;
    stores.agentSession.setState({ openSessionId: null });
  }
  context.avatar.presentEmotion("confused");
  tracking.turnId = null;
}

/** Translate one Hermes event into store updates. */
export function handleAgentEvent(context: AgentEventContext, event: AgentEvent): void {
  const { stores, tracking } = context;
  const session = stores.agentSession;

  switch (event.type) {
    case "connection.changed":
      onConnectionChanged(context, event);
      return;
    case "session.opened":
      onSessionOpened(context, event);
      return;
    case "session.updated":
      onSessionUpdated(context, event);
      return;
    case "history.restored": {
      // Emitted by openSession after session.opened: the session for this
      // conversation is really open here, not merely connected.
      const conversation = context.conversations.get(
        tracking.openingId ?? stores.conversations.getState().activeConversationId,
      );
      if (!conversation || conversation.agent?.persistentSessionId !== event.persistentSessionId) return;
      void context.conversations.restoreTranscript(
        conversation.id,
        event.persistentSessionId,
        event.messages,
        context.fetchHistory,
      );
      return;
    }
    case "agent.started":
      tracking.turnStartedAt = monotonicNow();
      stores.activity.getState().startTurn();
      session.setState({ busy: true, status: statusCopy(locale(context)).thinking });
      stores.errors.getState().dismiss();
      context.avatar.presentEmotion("thinking");
      return;
    case "assistant.delta":
      session.setState({ status: statusCopy(locale(context)).answering });
      return;
    case "assistant.message":
      onAssistantMessage(context, event);
      return;
    case "tool.started":
      session.setState({ status: event.summary || toolTitle(event.kind, event.tool) });
      stores.activity.getState().add({
        id: event.id,
        tool: event.tool,
        kind: event.kind,
        title: toolTitle(event.kind, event.tool),
        detail: event.summary,
        state: "running",
        timestamp: Date.now(),
      });
      return;
    case "tool.finished": {
      const title = event.summary || `${event.tool} finished`;
      stores.activity.getState().finish({
        id: event.id,
        tool: event.tool,
        kind: event.kind,
        title,
        durationMs: event.durationMs,
      });
      session.setState({ status: title });
      return;
    }
    case "tool.progress":
      if (event.message) session.setState({ status: event.message });
      return;
    case "status.updated":
      session.setState({ status: event.detail || event.status });
      return;
    case "input.requested": {
      const copy = getCopy(locale(context)).agentStatus;
      const inputKind = copy.inputKinds[event.request.kind];
      session.setState({
        pendingInput: event.request,
        respondingToInput: false,
        status: copy.inputNeeded(inputKind),
      });
      stores.activity.getState().add({
        id: createId("input"),
        kind: "input",
        title: copy.inputRequested(inputKind),
        detail:
          event.request.kind === "approval"
            ? event.request.description
            : event.request.kind === "clarification"
              ? event.request.question
              : copy.secureInputWaiting,
        state: "attention",
        timestamp: Date.now(),
      });
      return;
    }
    case "input.expired": {
      const copy = getCopy(locale(context)).agentStatus;
      const current = session.getState().pendingInput;
      const expired =
        current?.kind === event.kind && "requestId" in current && current.requestId === event.requestId;
      session.setState({
        ...(expired ? { pendingInput: null } : {}),
        respondingToInput: false,
        status: copy.inputExpired(copy.inputKinds[event.kind]),
      });
      return;
    }
    case "agent.finished":
      if (tracking.turnStartedAt !== null) {
        const duration = Math.round(monotonicNow() - tracking.turnStartedAt);
        tracking.turnStartedAt = null;
        stores.errors.getState().accumulateMetrics({ lastAgentTurnDurationMs: duration });
      }
      session.setState({
        pendingInput: null,
        respondingToInput: false,
        busy: false,
        // A reply held for speech keeps its voice status until audio settles.
        ...(context.voice.spokenReplies.active ? {} : { status: statusCopy(locale(context)).ready }),
      });
      tracking.turnId = null;
      return;
    case "agent.aborted":
      tracking.turnStartedAt = null;
      session.setState({ pendingInput: null, respondingToInput: false, busy: false });
      context.voice.flushHeld();
      session.setState({ status: statusCopy(locale(context)).stopped });
      context.avatar.presentEmotion("neutral");
      tracking.turnId = null;
      return;
    case "agent.error":
      onAgentError(context, event);
      return;
  }
}
