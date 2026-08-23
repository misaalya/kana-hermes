"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HermesAgentClient } from "@/lib/agent/hermes/hermes-agent-client";
import type {
  AgentClient,
  AgentCommandSuggestion,
  AgentConnectionState,
  AgentEvent,
  AgentInputRequest,
  AgentInputResponse,
  AgentToolKind,
} from "@/lib/agent/types";
import { AvatarController } from "@/lib/avatar/avatar-controller";
import { OFFICIAL_HARU_MODEL_URL } from "@/lib/avatar/defaults";
import { ManagedAvatarProvider } from "@/lib/avatar/managed-avatar-provider";
import { IndexedDbAvatarModelStore } from "@/lib/avatar/indexed-db-avatar-model-store";
import {
  createKanaBackup,
  parseKanaBackup,
  serializeKanaBackup,
} from "@/lib/backup/kana-backup";
import { IndexedDbConversationStore } from "@/lib/conversation/indexed-db-conversation-store";
import {
  createId,
  type Conversation,
  type KanaMessage,
} from "@/lib/conversation/types";
import {
  classifyKanaError,
  serializeKanaDiagnostics,
} from "@/lib/diagnostics/safe-diagnostics";
import type {
  KanaErrorCategory,
  KanaErrorRecord,
  KanaErrorSource,
  KanaRuntimeMetrics,
} from "@/lib/diagnostics/types";
import {
  DEFAULT_PREFERENCES,
  LocalPreferencesStore,
  normalizeKanaPreferences,
} from "@/lib/preferences/local-preferences-store";
import type { KanaPreferences } from "@/lib/preferences/types";
import {
  controlHermesRuntime,
  inspectHermesRuntime,
} from "@/lib/runtime/hermes-control-client";
// websocketUrl/token imports retired: the browser reaches Hermes only through
// the Kana server relay and holds no credentials.
import { useAvatarController } from "./use-avatar-controller";
import { useVoiceController } from "./use-voice-controller";

export type ActivityItem = {
  id: string;
  tool?: string;
  kind: AgentToolKind | "status" | "input";
  title: string;
  detail?: string;
  state: "running" | "complete" | "attention";
  timestamp: number;
  durationMs?: number;
};

const KANA_COMMAND_SUGGESTIONS: AgentCommandSuggestion[] = [
  {
    text: "/new",
    display: "/new",
    description: "Start a new Kana conversation and Hermes session",
    group: "Kana & session",
    kind: "command",
  },
  {
    text: "/sessions",
    display: "/sessions",
    description: "List locally stored Kana conversations",
    group: "Kana & session",
    kind: "command",
  },
  {
    text: "/resume",
    display: "/resume",
    description: "Resume a Kana conversation by title or ID",
    group: "Kana & session",
    kind: "command",
  },
  {
    text: "/approve",
    display: "/approve",
    description: "Approve a pending Hermes request",
    group: "Hermes controls",
    kind: "command",
  },
  {
    text: "/deny",
    display: "/deny",
    description: "Deny a pending Hermes request",
    group: "Hermes controls",
    kind: "command",
  },
  {
    text: "/commands",
    display: "/commands",
    description: "Show commands and installed skills",
    group: "Hermes controls",
    kind: "command",
  },
];

function recentFirst(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}

function createUserMessage(text: string): KanaMessage {
  return {
    id: createId("message"),
    role: "user",
    text,
    timestamp: Date.now(),
  };
}

function createSystemMessage(text: string, command?: string): KanaMessage {
  return {
    id: createId("message"),
    role: "system",
    text,
    command,
    timestamp: Date.now(),
  };
}

function withoutLastUserTurn(messages: KanaMessage[]): KanaMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages.slice(0, index);
  }
  return messages;
}

function shortTitle(text: string): string {
  const title = text.replace(/\s+/g, " ").trim();
  return title.length > 42 ? `${title.slice(0, 42)}\u2026` : title;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function toolTitle(kind: AgentToolKind, tool: string): string {
  if (kind === "command") return `Running ${tool}`;
  if (kind === "file") return `Updating files with ${tool}`;
  return `Using ${tool}`;
}

export function useKanaController(appVersion: string) {
  // ---- Stable instances ----
  const conversationStore = useMemo(
    () => new IndexedDbConversationStore(),
    [],
  );
  const avatarModelStore = useMemo(
    () => new IndexedDbAvatarModelStore(),
    [],
  );
  const preferencesStore = useMemo(() => new LocalPreferencesStore(), []);
  const avatarProvider = useMemo(() => new ManagedAvatarProvider(), []);
  const avatarController = useMemo(
    () => new AvatarController(avatarProvider),
    [avatarProvider],
  );

  // ---- State ----
  const [ready, setReady] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<KanaPreferences>(DEFAULT_PREFERENCES);
  const [connectionState, setConnectionState] = useState<AgentConnectionState>("disconnected");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Ready when you are");
  const [error, setError] = useState<string | null>(null);
  const [lastError, setLastError] = useState<KanaErrorRecord | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [commandSuggestions, setCommandSuggestions] = useState<AgentCommandSuggestion[]>([]);
  const [commandSuggestionsLoading, setCommandSuggestionsLoading] = useState(false);
  const [pendingInput, setPendingInput] = useState<AgentInputRequest | null>(null);
  const [respondingToInput, setRespondingToInput] = useState(false);
  const [metrics, setMetrics] = useState<KanaRuntimeMetrics>({
    reconnectCount: 0,
  });

  // ---- Refs ----
  const conversationsRef = useRef<Conversation[]>([]);
  const activeConversationIdRef = useRef<string | null>(null);
  const preferencesRef = useRef<KanaPreferences>(DEFAULT_PREFERENCES);
  const agentRef = useRef<AgentClient | null>(null);
  const agentKeyRef = useRef("");
  const openedConversationRef = useRef<string | null>(null);
  const openingConversationRef = useRef<string | null>(null);
  const turnConversationRef = useRef<string | null>(null);
  const unsubscribeAgentRef = useRef<(() => void) | null>(null);
  const initializationRef = useRef<Promise<{
    storedConversations: Conversation[];
    storageWarning: string | null;
  }> | null>(null);
  const completionRequestRef = useRef(0);
  const lastErrorMessageRef = useRef<string | null>(null);
  const connectionStartedAtRef = useRef<number | null>(null);
  const turnStartedAtRef = useRef<number | null>(null);

  // ---- Error reporting (shared across hooks) ----
  const reportError = useCallback(
    (
      source: KanaErrorSource,
      value: unknown,
      category?: KanaErrorCategory,
    ) => {
      const message =
        value instanceof Error
          ? value.message
          : typeof value === "string"
            ? value
            : "Something went wrong.";
      if (lastErrorMessageRef.current === message) return null;
      lastErrorMessageRef.current = message;
      const record = classifyKanaError(value, source, category);
      setLastError(record);
      setError(record.message);
      return record;
    },
    [],
  );

  // ---- Metrics accumulation (shared across hooks) ----
  const accumulateMetrics = useCallback(
    (partial: Partial<KanaRuntimeMetrics>) => {
      setMetrics((current) => ({ ...current, ...partial }));
    },
    [],
  );

  // ---- Avatar controller (extracted) ----
  const {
    avatar,
    configureAvatar,
    attachAvatarCanvas,
    importAvatarFiles,
    listAvatarModels,
    selectAvatarModel,
    renameAvatarModel,
    deleteAvatarModel,
    previewAvatarEmotion,
    previewAvatarMotion,
    previewAvatarTalking,
  } = useAvatarController(
    avatarProvider,
    avatarModelStore,
    avatarController,
    () => preferencesRef.current,
    (next) => {
      preferencesRef.current = next;
      setPreferences(next);
      preferencesStore.save(next);
    },
    reportError,
    accumulateMetrics,
  );

  // ---- Voice controller (extracted) ----
  const {
    voiceRuntimeState,
    voiceCanReplay,
    voiceStatus,
    getVoice,
    inspectVoiceService,
    cloneVoice,
    deleteClonedVoice,
    replayVoice,
    stopVoice,
    cleanupVoice,
  } = useVoiceController(
    avatarController,
    () => preferencesRef.current,
    accumulateMetrics,
    reportError,
  );

  // ---- Conversation management ----
  const commitConversations = useCallback(
    (next: Conversation[]) => {
      const sorted = recentFirst(next);
      conversationsRef.current = sorted;
      setConversations(sorted);
    },
    [],
  );

  const saveConversation = useCallback(
    async (conversation: Conversation) => {
      const updated = { ...conversation, updatedAt: Date.now() };
      const next = conversationsRef.current.some(
        (item) => item.id === updated.id,
      )
        ? conversationsRef.current.map((item) =>
            item.id === updated.id ? updated : item,
          )
        : [...conversationsRef.current, updated];
      commitConversations(next);
      await conversationStore.save(updated);
      return updated;
    },
    [commitConversations, conversationStore],
  );

  // ---- Activities ----
  const addActivity = useCallback((activity: ActivityItem) => {
    setActivities((current) => {
      const existing = current.find((item) => item.id === activity.id);
      if (!existing) return [activity, ...current].slice(0, 40);
      if (existing.state === "complete" && activity.state === "running") {
        return current;
      }
      return current.map((item) =>
        item.id === activity.id ? activity : item,
      );
    });
  }, []);

  // ---- Agent event handling ----
  const updateConversationFromEvent = useCallback(
    async (event: AgentEvent) => {
      const conversationId =
        turnConversationRef.current ??
        openingConversationRef.current ??
        activeConversationIdRef.current;
      if (!conversationId) return;

      const conversation = conversationsRef.current.find(
        (item) => item.id === conversationId,
      );
      if (!conversation) return;

      if (event.type === "session.opened") {
        openingConversationRef.current = null;
        openedConversationRef.current = conversationId;
        await saveConversation({
          ...conversation,
          agent: {
            provider: "hermes",
            persistentSessionId: event.persistentSessionId,
            status: "linked",
            relationship: conversation.agent?.relationship ?? "primary",
            ...(conversation.agent?.parentConversationId
              ? {
                  parentConversationId:
                    conversation.agent.parentConversationId,
                }
              : {}),
          },
        });
        return;
      }

      if (event.type === "session.updated" && event.title) {
        await saveConversation({ ...conversation, title: event.title });
        return;
      }

      if (event.type === "assistant.message") {
        const previousAssistant = [...conversation.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        if (
          previousAssistant?.speech_ja === event.response.speech_ja &&
          previousAssistant.subtitle?.text ===
            event.response.subtitle.text &&
          previousAssistant.subtitle.language ===
            event.response.subtitle.language
        ) {
          return;
        }
        const assistantMessage: KanaMessage = {
          id: createId("message"),
          role: "assistant",
          speech_ja: event.response.speech_ja,
          subtitle: { ...event.response.subtitle },
          emotion: event.response.emotion ?? "neutral",
          timestamp: Date.now(),
        };
        await saveConversation({
          ...conversation,
          messages: [...conversation.messages, assistantMessage],
        });
        avatarController.presentEmotion(assistantMessage.emotion);
        if (preferencesRef.current.voiceEnabled) {
          void getVoice()
            .speak({
              text: event.response.speech_ja,
              language: "ja",
              emotion: assistantMessage.emotion,
              voiceId: preferencesRef.current.qwen3Tts.voiceId || undefined,
            })
            .catch((voiceError) => {
              if (isAbortError(voiceError)) return;
              reportError(
                "voice",
                voiceError instanceof Error
                  ? voiceError.message
                  : "Voice playback failed.",
                "voice",
              );
            });
        }
      }
    },
    [avatarController, getVoice, reportError, saveConversation],
  );

  const handleAgentEvent = useCallback(
    (event: AgentEvent) => {
      if (event.type === "connection.changed") {
        setConnectionState(event.state);
        if (event.state === "connecting" || event.state === "reconnecting") {
          connectionStartedAtRef.current ??= monotonicNow();
        }
        if (event.retryAttempt !== undefined) {
          setMetrics((current) => ({
            ...current,
            reconnectCount: current.reconnectCount + 1,
          }));
        }
        if (event.state === "connected") {
          if (connectionStartedAtRef.current !== null) {
            const duration = Math.round(
              monotonicNow() - connectionStartedAtRef.current,
            );
            connectionStartedAtRef.current = null;
            setMetrics((current) => ({
              ...current,
              lastConnectDurationMs: duration,
            }));
          }
          setStatus("Connected to Hermes");
          return;
        }
        if (event.state === "reconnecting" || event.state === "error") {
          setPendingInput(null);
          setRespondingToInput(false);
          openedConversationRef.current = null;
          openingConversationRef.current = null;
          setBusy(false);
          setStatus("Reconnecting\u2026");
          if (event.message) {
            setLastError(
              classifyKanaError(event.message, "agent", "connection"),
            );
          }
          return;
        }
        if (
          event.state === "disconnected" ||
          event.state === "authentication_failed" ||
          event.state === "incompatible"
        ) {
          setPendingInput(null);
          setRespondingToInput(false);
          openedConversationRef.current = null;
          openingConversationRef.current = null;
          turnConversationRef.current = null;
          setBusy(false);
          setStatus(
            event.state === "authentication_failed"
              ? "Hermes authentication failed"
              : event.state === "incompatible"
                ? "Hermes connection is incompatible"
                : "Agent disconnected",
          );
          if (event.message) {
            reportError(
              "agent",
              event.message,
              event.state === "authentication_failed"
                ? "authentication"
                : event.state === "incompatible"
                  ? "protocol"
                  : "connection",
            );
          }
          return;
        }
        return;
      }

      if (
        event.type === "session.opened" ||
        event.type === "session.updated"
      ) {
        void updateConversationFromEvent(event);
        return;
      }

      if (event.type === "agent.started") {
        turnStartedAtRef.current = monotonicNow();
        setBusy(true);
        setError(null);
        setStatus("Kana is thinking");
        avatarController.presentEmotion("thinking");
        return;
      }

      if (event.type === "assistant.delta") {
        setStatus("Kana is answering");
        return;
      }

      if (event.type === "assistant.message") {
        void updateConversationFromEvent(event);
        setStatus("Response received");
        return;
      }

      if (event.type === "tool.started") {
        setStatus(event.summary || toolTitle(event.kind, event.tool));
        addActivity({
          id: event.id,
          tool: event.tool,
          kind: event.kind,
          title: toolTitle(event.kind, event.tool),
          detail: event.summary,
          state: "running",
          timestamp: Date.now(),
        });
        return;
      }

      if (event.type === "tool.finished") {
        setActivities((current) => {
          const existing = current.some(
            (activity) => activity.id === event.id,
          );
          if (!existing) {
            const newActivity: ActivityItem = {
              id: event.id,
              tool: event.tool,
              kind: event.kind,
              title: event.summary || `${event.tool} finished`,
              state: "complete",
              timestamp: Date.now(),
              durationMs: event.durationMs,
            };
            return [newActivity, ...current].slice(0, 40);
          }
          return current.map((activity) => {
            if (activity.id !== event.id) return activity;
            return {
              ...activity,
              state: "complete" as const,
              title: event.summary || `${event.tool} finished`,
              durationMs: event.durationMs,
            };
          });
        });
        setStatus(event.summary || `${event.tool} finished`);
        return;
      }

      if (event.type === "tool.progress") {
        if (event.message) setStatus(event.message);
        return;
      }

      if (event.type === "status.updated") {
        setStatus(event.detail || event.status);
        return;
      }

      if (event.type === "input.requested") {
        setPendingInput(event.request);
        setRespondingToInput(false);
        setStatus(`Hermes needs ${event.request.kind}`);
        addActivity({
          id: createId("input"),
          kind: "input",
          title: `Hermes requested ${event.request.kind}`,
          detail:
            event.request.kind === "approval"
              ? event.request.description
              : event.request.kind === "clarification"
                ? event.request.question
                : "Secure input is waiting in Kana.",
          state: "attention",
          timestamp: Date.now(),
        });
        return;
      }

      if (event.type === "input.expired") {
        setPendingInput((current) =>
          current?.kind === event.kind &&
          "requestId" in current &&
          current.requestId === event.requestId
            ? null
            : current,
        );
        setRespondingToInput(false);
        setStatus(`${event.kind} request expired`);
        return;
      }

      if (event.type === "agent.finished") {
        if (turnStartedAtRef.current !== null) {
          const duration = Math.round(
            monotonicNow() - turnStartedAtRef.current,
          );
          turnStartedAtRef.current = null;
          setMetrics((current) => ({
            ...current,
            lastAgentTurnDurationMs: duration,
          }));
        }
        setPendingInput(null);
        setRespondingToInput(false);
        setBusy(false);
        setStatus("Ready when you are");
        turnConversationRef.current = null;
        return;
      }

      if (event.type === "agent.aborted") {
        turnStartedAtRef.current = null;
        setPendingInput(null);
        setRespondingToInput(false);
        setBusy(false);
        setStatus("Turn stopped");
        avatarController.presentEmotion("neutral");
        turnConversationRef.current = null;
        return;
      }

      if (event.type === "agent.error") {
        turnStartedAtRef.current = null;
        setPendingInput(null);
        setRespondingToInput(false);
        setBusy(false);
        setStatus("Something needs attention");
        reportError("agent", event.message);
        if (/session (?:not found|no longer exists)/i.test(event.message)) {
          const conversationId =
            turnConversationRef.current ??
            openingConversationRef.current ??
            activeConversationIdRef.current;
          const conversation = conversationsRef.current.find(
            (item) => item.id === conversationId,
          );
          if (conversation?.agent) {
            void saveConversation({
              ...conversation,
              agent: { ...conversation.agent, status: "missing" },
            });
          }
          openingConversationRef.current = null;
          openedConversationRef.current = null;
        }
        avatarController.presentEmotion("confused");
        turnConversationRef.current = null;
      }
    },
    [
      addActivity,
      avatarController,
      reportError,
      saveConversation,
      updateConversationFromEvent,
    ],
  );

  // ---- Agent lifecycle ----
  const ensureAgent = useCallback(
    async (conversation: Conversation): Promise<AgentClient> => {
      // The agent connects through the Kana server relay: the browser never
      // dials a Hermes WebSocket and never holds a session token.
      const key = "hermes:relay";

      if (!agentRef.current || agentKeyRef.current !== key) {
        unsubscribeAgentRef.current?.();
        await agentRef.current?.disconnect();
        agentRef.current = new HermesAgentClient();
        agentKeyRef.current = key;
        openedConversationRef.current = null;
        unsubscribeAgentRef.current =
          agentRef.current.subscribe(handleAgentEvent);
      }

      const agent = agentRef.current;
      if (agent.connectionState !== "connected") await agent.connect();
      if (openedConversationRef.current !== conversation.id) {
        openingConversationRef.current = conversation.id;
        await agent.openSession({
          title: conversation.title,
          subtitleLanguage: preferencesRef.current.subtitleLanguage,
          persistentSessionId: conversation.agent?.persistentSessionId,
          cwd: preferencesRef.current.hermes.cwd || undefined,
        });
      }
      return agent;
    },
    [handleAgentEvent],
  );

  // ---- Initialization ----
  useEffect(() => {
    let mounted = true;
    const storedPreferences = preferencesStore.load();

    initializationRef.current ??= (async () => {
      let storedConversations = await conversationStore.list();
      if (!storedConversations.length) {
        storedConversations = [
          await conversationStore.create({
            title: "First meeting",
            subtitleLanguage: storedPreferences.subtitleLanguage,
          }),
        ];
      }
      const storageWarning = [
        preferencesStore.consumeWarning(),
        conversationStore.consumeWarning(),
      ]
        .filter(Boolean)
        .join(" ") || null;
      return { storedConversations, storageWarning };
    })();

    const timeout = globalThis.setTimeout(() => {
      if (!mounted) return;
      preferencesRef.current = storedPreferences;
      setPreferences(storedPreferences);
      commitConversations([]);
      setActiveConversationId(null);
      setReady(true);
    }, 30_000);

    void initializationRef.current!.then(
      ({ storedConversations, storageWarning }) => {
        if (!mounted) return;
        globalThis.clearTimeout(timeout);
        const initialConversationId = storedConversations[0]?.id ?? null;
        preferencesRef.current = storedPreferences;
        activeConversationIdRef.current = initialConversationId;
        setPreferences(storedPreferences);
        commitConversations(storedConversations);
        setActiveConversationId(initialConversationId);
        if (storageWarning) {
          const record = classifyKanaError(
            storageWarning,
            "application",
            "storage",
          );
          setLastError(record);
          setError(record.message);
        }
        setReady(true);
      },
      () => {
        if (!mounted) return;
        globalThis.clearTimeout(timeout);
        preferencesRef.current = storedPreferences;
        setPreferences(storedPreferences);
        commitConversations([]);
        setActiveConversationId(null);
        setReady(true);
      },
    );

    return () => {
      mounted = false;
      globalThis.clearTimeout(timeout);
      cleanupVoice();
      unsubscribeAgentRef.current?.();
      void agentRef.current?.disconnect();
      avatarProvider.unload();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- sendMessage ----
  const sendMessage = useCallback(
    async (text: string) => {
      const cleanText = text.trim();
      const commandMatch = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(cleanText);
      const commandName = commandMatch?.[1]
        ?.toLowerCase()
        .replaceAll("_", "-");
      const commandArg = commandMatch?.[2]?.trim() || "";
      const canRunWhileBusy = Boolean(
        commandName &&
          [
            "approve",
            "deny",
            "queue",
            "steer",
            "status",
            "agents",
            "goal",
            "heartbeat",
            "background",
          ].includes(commandName),
      );
      if (
        !cleanText ||
        (busy && !canRunWhileBusy) ||
        !activeConversationId
      )
        return;
      const wasBusy = busy;

      const conversation = conversationsRef.current.find(
        (item) => item.id === activeConversationId,
      );
      if (!conversation) return;

      if (commandName === "new") {
        const created = await conversationStore.create({
          title: commandArg || "New conversation",
          subtitleLanguage: preferencesRef.current.subtitleLanguage,
        });
        const next = await saveConversation({
          ...created,
          messages: [
            createUserMessage(cleanText),
            createSystemMessage(
              "Fresh Kana conversation created. A new Hermes session will open with the next prompt.",
              cleanText,
            ),
          ],
        });
        activeConversationIdRef.current = next.id;
        setActiveConversationId(next.id);
        openedConversationRef.current = null;
        setActivities([]);
        setStatus("New conversation ready");
        setCommandSuggestions([]);
        return;
      }

      if (commandName === "sessions" || commandName === "resume") {
        if (commandName === "resume" && commandArg) {
          const needle = commandArg.toLowerCase();
          const target = conversationsRef.current.find(
            (item) =>
              item.id.toLowerCase().startsWith(needle) ||
              item.title.toLowerCase() === needle ||
              item.title.toLowerCase().includes(needle),
          );
          if (target) {
            activeConversationIdRef.current = target.id;
            setActiveConversationId(target.id);
            openedConversationRef.current = null;
            setActivities([]);
            setStatus(`Resumed ${target.title}`);
            setCommandSuggestions([]);
            return;
          }
        }

        const listing = conversationsRef.current
          .map(
            (item, index) =>
              `${index + 1}. ${item.title} \u2014 ${item.id.slice(0, 18)}`,
          )
          .join("\n");
        await saveConversation({
          ...conversation,
          messages: [
            ...conversation.messages,
            createUserMessage(cleanText),
            createSystemMessage(
              `${listing || "No Kana conversations found."}\n\nUse /resume <title or id> to switch.`,
              cleanText,
            ),
          ],
        });
        setCommandSuggestions([]);
        return;
      }

      setBusy(true);
      setStatus("Opening the conversation");

      const nextConversation = await saveConversation({
        ...conversation,
        title:
          conversation.messages.length === 0 &&
          conversation.title === "New conversation"
            ? shortTitle(cleanText)
            : conversation.title,
        messages: [
          ...conversation.messages,
          createUserMessage(cleanText),
        ],
      });

      turnConversationRef.current = nextConversation.id;
      try {
        const agent = await ensureAgent(nextConversation);
        if (commandName) {
          const result = await agent.executeCommand({
            command: cleanText,
            subtitleLanguage: preferencesRef.current.subtitleLanguage,
          });

          if (result.type === "output") {
            if (
              (commandName === "approve" || commandName === "deny") &&
              pendingInput?.kind === "approval"
            ) {
              setPendingInput(null);
            }
            const output = result.warning
              ? `Warning: ${result.warning}\n${result.output}`
              : result.output;
            const titledConversation =
              commandName === "title" && commandArg
                ? { ...nextConversation, title: commandArg }
                : nextConversation;
            await saveConversation({
              ...titledConversation,
              messages: [
                ...titledConversation.messages,
                createSystemMessage(output, cleanText),
              ],
            });
            if (!wasBusy) {
              setBusy(false);
              setStatus("Command complete");
              turnConversationRef.current = null;
            } else {
              setStatus("Hermes is continuing");
            }
          } else if (result.type === "session") {
            const branched = await conversationStore.create({
              title: result.title,
              subtitleLanguage: preferencesRef.current.subtitleLanguage,
            });
            const savedBranch = await saveConversation({
              ...branched,
              messages: [
                ...nextConversation.messages,
                createSystemMessage(result.output, cleanText),
              ],
              agent: {
                provider: "hermes",
                persistentSessionId: result.session.persistentSessionId,
                status: "linked",
                relationship: "branch",
                parentConversationId: nextConversation.id,
              },
            });
            activeConversationIdRef.current = savedBranch.id;
            setActiveConversationId(savedBranch.id);
            openedConversationRef.current = savedBranch.id;
            turnConversationRef.current = null;
            setBusy(false);
            setStatus(`Branched to ${savedBranch.title}`);
            setActivities([]);
          } else if (result.type === "prefill") {
            if (result.notice) {
              const baseMessages =
                commandName === "undo"
                  ? [
                      ...withoutLastUserTurn(conversation.messages),
                      createUserMessage(cleanText),
                    ]
                  : nextConversation.messages;
              await saveConversation({
                ...nextConversation,
                messages: [
                  ...baseMessages,
                  createSystemMessage(result.notice, cleanText),
                ],
              });
            }
            if (!wasBusy) setBusy(false);
            setStatus("Command prepared a draft");
            if (!wasBusy) turnConversationRef.current = null;
            return result.message;
          } else if (result.notice) {
            await saveConversation({
              ...nextConversation,
              messages: [
                ...nextConversation.messages,
                createSystemMessage(result.notice, cleanText),
              ],
            });
          }
        } else {
          await agent.sendMessage({
            text: cleanText,
            subtitleLanguage: preferencesRef.current.subtitleLanguage,
          });
        }
        setCommandSuggestions([]);
      } catch (sendError) {
        if (!wasBusy) setBusy(false);
        setStatus(
          wasBusy
            ? "Hermes is still working"
            : "Could not send the message",
        );
        reportError(
          "agent",
          sendError instanceof Error
            ? sendError.message
            : "Could not send message.",
        );
        if (!wasBusy) turnConversationRef.current = null;
      }
    },
    [
      activeConversationId,
      busy,
      conversationStore,
      ensureAgent,
      pendingInput,
      reportError,
      saveConversation,
    ],
  );

  // ---- Command completion ----
  const completeCommands = useCallback(
    async (input: string) => {
      const requestId = ++completionRequestRef.current;
      if (!input.startsWith("/")) {
        setCommandSuggestions((current) =>
          current.length ? [] : current,
        );
        setCommandSuggestionsLoading((current) =>
          current ? false : current,
        );
        return;
      }
      const conversationId = activeConversationIdRef.current;
      const conversation = conversationsRef.current.find(
        (item) => item.id === conversationId,
      );
      if (!conversation) return;

      const localSuggestions = input.includes(" ")
        ? []
        : KANA_COMMAND_SUGGESTIONS.filter((item) =>
            item.text.startsWith(input.toLowerCase()),
          );

      // Optimistic pass: narrow what is already on screen instead of
      // collapsing to the short local list — collapsing made the menu flip
      // between two states on every refresh.
      const lowerInput = input.toLowerCase();
      const applyNarrowing = () => {
        setCommandSuggestions((current) => {
          const matching = current.filter((item) =>
            item.text.toLowerCase().startsWith(lowerInput),
          );
          const next = [
            ...localSuggestions,
            ...matching.filter(
              (item) =>
                !localSuggestions.some(
                  (local) =>
                    local.text.toLowerCase() === item.text.toLowerCase(),
                ),
            ),
          ];
          const changed =
            next.length !== current.length ||
            next.some((item, index) => item !== current[index]);
          return changed ? next : current;
        });
      };

      // A conversation whose Hermes session is gone cannot answer completions;
      // retrying the resume on every keystroke made the menu glitch forever.
      if (conversation.agent?.status === "missing") {
        applyNarrowing();
        return;
      }

      applyNarrowing();
      setCommandSuggestionsLoading(true);
      try {
        const agent = await ensureAgent(conversation);
        const remoteSuggestions = await agent.completeCommands(input);
        const normalizedInput = input.trim().toLowerCase();
        const completingArguments = /\s$/u.test(input);
        const seen = new Set<string>();
        const suggestions = [
          ...localSuggestions,
          ...remoteSuggestions,
        ].filter((item) => {
          const normalizedSuggestion = item.text.trim().toLowerCase();
          if (
            completingArguments &&
            normalizedSuggestion === normalizedInput
          ) {
            return false;
          }
          if (seen.has(normalizedSuggestion)) return false;
          seen.add(normalizedSuggestion);
          return true;
        });
        if (completionRequestRef.current !== requestId) return;
        setCommandSuggestions((current) =>
          suggestions.length === current.length &&
          suggestions.every((item, index) => item === current[index])
            ? current
            : suggestions,
        );
      } catch (completionError) {
        // Surface a vanished Hermes session instead of silently retrying it
        // for every keystroke; the sidebar shows the "Session missing" badge.
        const message =
          completionError instanceof Error
            ? completionError.message
            : String(completionError);
        if (/no longer exists|session not found/i.test(message)) {
          const current = conversationsRef.current.find(
            (item) => item.id === conversationId,
          );
          if (current?.agent && current.agent.status !== "missing") {
            void saveConversation({
              ...current,
              agent: { ...current.agent, status: "missing" },
            });
          }
        }
      } finally {
        if (completionRequestRef.current === requestId) {
          setCommandSuggestionsLoading(false);
        }
      }
    },
    [ensureAgent, saveConversation],
  );

  const clearCommandSuggestions = useCallback(() => {
    completionRequestRef.current += 1;
    setCommandSuggestions((current) => (current.length ? [] : current));
    setCommandSuggestionsLoading((current) =>
      current ? false : current,
    );
  }, []);

  // ---- Conversation CRUD ----
  const createConversation = useCallback(async () => {
    if (busy) return;
    const conversation = await conversationStore.create({
      subtitleLanguage: preferencesRef.current.subtitleLanguage,
    });
    commitConversations([...conversationsRef.current, conversation]);
    activeConversationIdRef.current = conversation.id;
    setActiveConversationId(conversation.id);
    openedConversationRef.current = null;
    setActivities([]);
    setError(null);
  }, [busy, commitConversations, conversationStore]);

  const selectConversation = useCallback(
    (id: string) => {
      if (busy || id === activeConversationId) return;
      activeConversationIdRef.current = id;
      setActiveConversationId(id);
      openedConversationRef.current = null;
      setActivities([]);
      setError(null);
      cleanupVoice();
      avatarController.presentEmotion("neutral");
    },
    [activeConversationId, avatarController, busy, cleanupVoice],
  );

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      const renamed = await conversationStore.rename(id, title);
      if (!renamed) return;
      commitConversations(
        conversationsRef.current.map((item) =>
          item.id === id ? renamed : item,
        ),
      );
    },
    [commitConversations, conversationStore],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      if (busy) return;
      await conversationStore.delete(id);
      let remaining = conversationsRef.current.filter(
        (item) => item.id !== id,
      );
      if (!remaining.length) {
        remaining = [
          await conversationStore.create({
            subtitleLanguage: preferencesRef.current.subtitleLanguage,
          }),
        ];
      }
      commitConversations(remaining);
      if (activeConversationId === id) {
        const nextConversationId = remaining[0]?.id ?? null;
        activeConversationIdRef.current = nextConversationId;
        setActiveConversationId(nextConversationId);
        openedConversationRef.current = null;
      }
    },
    [activeConversationId, busy, commitConversations, conversationStore],
  );

  // ---- Preferences management ----
  const savePreferences = useCallback(
    async (next: KanaPreferences) => {
      next = normalizeKanaPreferences(next);
      preferencesRef.current = next;
      setPreferences(next);
      preferencesStore.save(next);
      cleanupVoice();
      await configureAvatar(next, undefined, true);
    },
    [cleanupVoice, configureAvatar, preferencesStore],
  );

  // ---- Backup ----
  const exportLocalBackup = useCallback(() => {
    return serializeKanaBackup(
      createKanaBackup(preferencesRef.current, conversationsRef.current),
    );
  }, []);

  const importLocalBackup = useCallback(
    async (text: string) => {
      const backup = parseKanaBackup(text);
      const currentById = new Map(
        conversationsRef.current.map((c) => [c.id, c]),
      );
      for (const conversation of backup.conversations) {
        await conversationStore.save(conversation);
        currentById.set(conversation.id, conversation);
      }
      const merged = [...currentById.values()];
      commitConversations(merged);
      const next = {
        ...backup.preferences,
        onboardingCompleted: true,
      };
      preferencesRef.current = next;
      setPreferences(next);
      preferencesStore.save(next);
      return {
        importedConversations: backup.conversations.length,
        totalConversations: merged.length,
      };
    },
    [commitConversations, conversationStore, preferencesStore],
  );

  // ---- Agent connection ----
  const connectAgent = useCallback(async () => {
    setError(null);
    try {
      let conversation = activeConversationId
        ? conversationsRef.current.find(
            (item) => item.id === activeConversationId,
          ) ?? null
        : null;

      if (!conversation) {
        conversation = await conversationStore.create({
          subtitleLanguage: preferencesRef.current.subtitleLanguage,
        });
        commitConversations([...conversationsRef.current, conversation]);
        activeConversationIdRef.current = conversation.id;
        setActiveConversationId(conversation.id);
        openedConversationRef.current = null;
      }

      await ensureAgent(conversation);
      setStatus("Connected to Hermes");
    } catch (connectError) {
      reportError(
        "agent",
        connectError instanceof Error
          ? connectError.message
          : "Could not connect to the agent.",
      );
    }
  }, [activeConversationId, commitConversations, conversationStore, ensureAgent, reportError]);

  const disconnectAgent = useCallback(async () => {
    unsubscribeAgentRef.current?.();
    unsubscribeAgentRef.current = null;
    await agentRef.current?.disconnect();
    agentRef.current = null;
    agentKeyRef.current = "";
    openedConversationRef.current = null;
    openingConversationRef.current = null;
    turnConversationRef.current = null;
    setPendingInput(null);
    setRespondingToInput(false);
    setBusy(false);
    setConnectionState("disconnected");
    setStatus("Agent disconnected");
  }, []);

  // ---- Abort ----
  const abort = useCallback(async () => {
    stopVoice();
    await agentRef.current?.abort();
  }, [stopVoice]);

  // ---- Input responses ----
  const respondToInput = useCallback(
    async (response: AgentInputResponse) => {
      const agent = agentRef.current;
      if (!agent) {
        reportError("agent", "Hermes is not connected.", "connection");
        return;
      }
      setRespondingToInput(true);
      setError(null);
      try {
        await agent.respondToInput(response);
        setPendingInput((current) => {
          if (!current || current.kind !== response.kind) return current;
          if (
            current.kind === "approval" ||
            response.kind === "approval"
          )
            return null;
          return current.requestId === response.requestId
            ? null
            : current;
        });
        setStatus("Input sent to Hermes");
      } catch (responseError) {
        const message =
          responseError instanceof Error
            ? responseError.message
            : "Could not send input to Hermes.";
        reportError("agent", message);
        // Never trap the user behind an unanswerable modal: close the
        // prompt and surface the failure in the activity stack instead.
        setPendingInput((current) => {
          if (!current || current.kind !== response.kind) return current;
          if (current.kind === "approval" || response.kind === "approval") {
            return null;
          }
          return current.requestId === response.requestId ? null : current;
        });
        addActivity({
          id: createId("activity"),
          kind: "input",
          title: "Hermes input could not be delivered",
          detail: message,
          state: "attention",
          timestamp: Date.now(),
        });
        setStatus("Input could not be sent");
      } finally {
        setRespondingToInput(false);
      }
    },
    [addActivity, reportError],
  );

  const testAgentConnection = useCallback(
    async () => {
      const client = new HermesAgentClient({
        reconnectDelaysMs: [],
        connectTimeoutMs: 10_000,
      });
      try {
        await client.connect();
        return "Hermes relay connected. The gateway is reachable through the Kana server.";
      } finally {
        await client.disconnect();
      }
    },
    [],
  );

  // ---- Diagnostics ----
  const activeConversation =
    conversations.find((item) => item.id === activeConversationId) ?? null;
  const diagnostics = useMemo(
    () =>
      serializeKanaDiagnostics({
        appVersion,
        agent: {
          mode: preferences.agentMode,
          state: connectionState,
          websocketUrl: "kana-relay",
        },
        voice: {
          mode: preferences.voiceMode,
          enabled: preferences.voiceEnabled,
          state: voiceRuntimeState,
          service: voiceStatus?.service,
          model: voiceStatus?.model,
          device: voiceStatus?.device,
          deliveryMode: preferences.qwen3Tts.deliveryMode,
        },
        avatar: {
          mode: preferences.avatarMode,
          renderMode: avatar.renderMode,
          loaded: avatar.loaded,
          source: preferences.live2d.modelId
            ? "imported-folder"
            : preferences.live2d.modelUrl === OFFICIAL_HARU_MODEL_URL
              ? "official-sample"
              : "hosted-url",
        },
        storage: {
          provider: "indexeddb",
          conversationCount: conversations.length,
          messageCount: conversations.reduce(
            (count, c) => count + c.messages.length,
            0,
          ),
          linkedHermesSession: Boolean(activeConversation?.agent),
        },
        metrics,
        lastError,
      }),
    [
      activeConversation?.agent,
      appVersion,
      avatar.loaded,
      avatar.renderMode,
      connectionState,
      conversations,
      lastError,
      metrics,
      preferences,
      voiceRuntimeState,
      voiceStatus,
    ],
  );

  return {
    ready,
    conversations,
    activeConversation,
    preferences,
    connectionState,
    busy,
    status,
    error,
    diagnostics,
    voiceRuntimeState,
    voiceCanReplay,
    activities,
    avatar,
    commandSuggestions,
    commandSuggestionsLoading,
    pendingInput,
    respondingToInput,
    sendMessage,
    completeCommands,
    clearCommandSuggestions,
    createConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    exportLocalBackup,
    importLocalBackup,
    savePreferences,
    connectAgent,
    testAgentConnection,
    disconnectAgent,
    respondToInput,
    attachAvatarCanvas,
    importAvatarFiles,
    listAvatarModels,
    selectAvatarModel,
    renameAvatarModel,
    deleteAvatarModel,
    inspectVoiceService,
    cloneVoice,
    deleteClonedVoice,
    inspectHermesControl: (preferredPort?: number) => inspectHermesRuntime(preferredPort),
    startHermesControl: (options: {
      port: number;
      cwd?: string;
      restart?: boolean;
    }) =>
      controlHermesRuntime({
        action: options.restart ? "restart" : "start",
        port: options.port,
        cwd: options.cwd,
      }),
    stopHermesControl: () => controlHermesRuntime({ action: "stop" }),
    abort,
    replayVoice,
    stopVoice,
    previewAvatarEmotion,
    previewAvatarMotion,
    previewAvatarTalking,
    clearError: () => {
      lastErrorMessageRef.current = null;
      setError(null);
    },
  };
}