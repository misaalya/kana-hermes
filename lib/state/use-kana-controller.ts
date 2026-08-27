"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HermesAgentClient } from "@/lib/agent/hermes/hermes-agent-client";
import { classifyHermesTool } from "@/lib/agent/tool-kind";
import type {
  AgentClient,
  AgentCommandSuggestion,
  AgentConnectionState,
  AgentEvent,
  AgentHistoryRow,
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
import { MemoryConversationStore } from "@/lib/conversation/memory-conversation-store";
import {
  clearActiveConversationPointer,
  conversationFromHermesEntry,
  freshConversationFromPointer,
  pointerFromConversation,
  readActiveConversationPointer,
  rememberedHermesEntry,
  writeActiveConversationPointer,
  type ActiveConversationPointer,
  type HermesConversationDirectoryEntry,
} from "@/lib/conversation/active-conversation";
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
import { getCopy } from "@/lib/ui/copy";
import {
  controlHermesRuntime,
  inspectHermesRuntime,
} from "@/lib/runtime/hermes-control-client";
// websocketUrl/token imports retired: the browser reaches Hermes only through
// the Kana server relay and holds no credentials.
import { useAvatarController } from "./use-avatar-controller";
import { useVoiceController } from "./use-voice-controller";

export type { ActivityItem } from "@/lib/agent/types";
import type { ActivityItem } from "@/lib/agent/types";

function kanaCommandSuggestions(
  locale: KanaPreferences["uiLocale"],
): AgentCommandSuggestion[] {
  const copy = getCopy(locale).slash;
  return [
    { text: "/new", display: "/new", description: copy.newDescription, group: copy.kanaSessionGroup, kind: "command" },
    { text: "/sessions", display: "/sessions", description: copy.sessionsDescription, group: copy.kanaSessionGroup, kind: "command" },
    { text: "/resume", display: "/resume", description: copy.resumeDescription, group: copy.kanaSessionGroup, kind: "command" },
    { text: "/approve", display: "/approve", description: copy.approveDescription, group: copy.hermesControlsGroup, kind: "command" },
    { text: "/deny", display: "/deny", description: copy.denyDescription, group: copy.hermesControlsGroup, kind: "command" },
    { text: "/commands", display: "/commands", description: copy.commandsDescription, group: copy.hermesControlsGroup, kind: "command" },
  ];
}

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

// A conversation with zero displayed messages is still "fresh": either no
// Hermes session was opened for it yet, or the opened one is empty. Both are
// equivalent — clicking "new" while on one must reuse it, not mint another.
function isFreshConversation(
  conversation: Conversation | undefined,
): boolean {
  return Boolean(conversation && conversation.messages.length === 0);
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

function statusCopy(locale: KanaPreferences["uiLocale"]) {
  return getCopy(locale).status;
}

type RestoredTurn = {
  turnIndex: number;
  anchorMs: number;
  activities: ActivityItem[];
};

/**
 * Rebuild Kana's display model from Hermes display rows (session.resume
 * messages, or session.history as fallback). The projection carries NO
 * timestamps, so rows get synthetic strictly-increasing timestamps that
 * preserve transcript order, and every turn is numbered by its
 * assistant-reply ordinal — the cross-browser identity used by the
 * server-side activity store.
 */
function parseHermesTranscript(rows: AgentHistoryRow[]): {
  messages: KanaMessage[];
  turns: RestoredTurn[];
} {
  const messages: KanaMessage[] = [];
  const turns: RestoredTurn[] = [];
  let pendingActivities: ActivityItem[] = [];
  let assistantOrdinal = 0;
  const baseTimestamp = Date.now() - rows.length - 1;

  rows.forEach((row, rowIndex) => {
    const timestamp = baseTimestamp + rowIndex;
    if (row.role === "system") return;
    if (row.role === "tool") {
      const tool = row.name ?? "tool";
      pendingActivities.push({
        id: createId("activity"),
        tool,
        kind: classifyHermesTool(tool),
        title: row.context || `${tool} finished`,
        state: "complete",
        timestamp,
      });
      return;
    }
    if (row.role === "user") {
      let text = row.text ?? "";
      // Unwrap the kana_request wrapper: extract the raw user message
      // from the metadata envelope (string value, JSON-escaped).
      const match = /"user_message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
      if (match) {
        try {
          text = JSON.parse(`"${match[1]}"`) as string;
        } catch {
          /* keep raw text */
        }
      }
      messages.push({ ...createUserMessage(text), timestamp });
      return;
    }
    if (row.role !== "assistant" || !row.text?.trim()) return;
    const turnIndex = assistantOrdinal;
    assistantOrdinal += 1;
    let turn: RestoredTurn | undefined;
    if (pendingActivities.length) {
      // Anchor just after the LAST tool so the block sorts between the
      // tools and Kana's reply.
      turn = {
        turnIndex,
        anchorMs:
          Math.max(...pendingActivities.map((activity) => activity.timestamp)) +
          1,
        activities: pendingActivities,
      };
      turns.push(turn);
      pendingActivities = [];
    }
    let speech_ja = "";
    let subtitle: KanaMessage["subtitle"] = undefined;
    let emotion: KanaMessage["emotion"] = "neutral";
    try {
      const envelope = JSON.parse(row.text) as {
        speech_ja?: string;
        subtitle?: { text?: string; language?: string };
        emotion?: KanaMessage["emotion"];
      };
      speech_ja = envelope.speech_ja ?? "";
      if (envelope.subtitle?.text) {
        subtitle = {
          text: envelope.subtitle.text,
          language: envelope.subtitle.language ?? "id",
        };
      }
      emotion = envelope.emotion ?? "neutral";
    } catch {
      speech_ja = row.text;
      subtitle = { text: row.text, language: "id" };
    }
    messages.push({
      id: createId("message"),
      role: "assistant",
      speech_ja,
      subtitle,
      emotion,
      timestamp,
      activities: turn ? [...turn.activities] : undefined,
    });
  });

  return { messages, turns };
}

function restoredMessageMatches(
  local: KanaMessage,
  restored: KanaMessage,
): boolean {
  if (local.role !== restored.role) return false;
  if (restored.role === "user") return local.text === restored.text;
  if (restored.role === "assistant") {
    return (
      local.speech_ja === restored.speech_ja &&
      local.subtitle?.text === restored.subtitle?.text
    );
  }
  return false;
}

/**
 * Hermes rows are authoritative, but local-only rows must survive the
 * replace: the just-typed message that triggered the session open, queued
 * prompts, and system notices never exist in Hermes display rows. Each
 * restored row consumes at most one matching local copy; leftovers are
 * appended after the restored block.
 */
function mergeRestoredMessages(
  restored: KanaMessage[],
  local: KanaMessage[],
): KanaMessage[] {
  const kept = [...local];
  for (const message of restored) {
    const index = kept.findIndex((candidate) =>
      restoredMessageMatches(candidate, message),
    );
    if (index !== -1) kept.splice(index, 1);
  }
  return [...restored, ...kept];
}

export function useKanaController(appVersion: string) {
  // ---- Stable instances ----
  const conversationStore = useMemo(
    () => new MemoryConversationStore(),
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
  const [status, setStatus] = useState(() => statusCopy(DEFAULT_PREFERENCES.uiLocale).ready);
  const [error, setError] = useState<string | null>(null);
  const [lastError, setLastError] = useState<KanaErrorRecord | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  // Server-side activity logs (SQLite via /api/kana/activities) for the open
  // Hermes session — the cross-browser source of truth for past turns.
  const [serverActivityTurns, setServerActivityTurns] = useState<
    Array<{
      turnAnchorMs: number;
      turnIndex: number | null;
      activities: ActivityItem[];
    }>
  >([]);
  // Kana sessions known to Hermes but not yet present in this browser.
  // Debug visibility: true while any history/session/activity fetch runs.
  const [fetchingFromServer, setFetchingFromServer] = useState(false);
  const [fetchDebugRecords, setFetchDebugRecords] = useState<
    Array<{ id: number; label: string; url: string; status: number | string; body: unknown }>
  >([]);
  const fetchDebugIdRef = useRef(0);
  const [hermesSessions, setHermesSessions] = useState<
    HermesConversationDirectoryEntry[]
  >([]);
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
  const activeConversationPointerRef = useRef<ActiveConversationPointer | null>(null);
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
    storedPointer: ActiveConversationPointer | null;
  }> | null>(null);
  const completionRequestRef = useRef(0);
  const lastErrorMessageRef = useRef<string | null>(null);
  const connectionStartedAtRef = useRef<number | null>(null);
  const turnStartedAtRef = useRef<number | null>(null);
  // Activities captured during the current turn; snapshotted onto the assistant
  // message when the turn completes so tool history survives a page refresh.
  const turnActivitiesRef = useRef<ActivityItem[]>([]);
  const activitySessionKeyRef = useRef<string | null>(null);
  // True while a transcript restore is being applied: live assistant events
  // arriving in that window must skip last-message dedup, or restored history
  // can be mistaken for a duplicate of the incoming reply.
  const transcriptRestoreRef = useRef(false);

  const resetConversationActivities = useCallback(() => {
    activitySessionKeyRef.current = null;
    turnActivitiesRef.current = [];
    setActivities([]);
    setServerActivityTurns([]);
  }, []);

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

  const recordFetchDebug = useCallback(
    (label: string, url: string, status: number | string, body: unknown) => {
      setFetchDebugRecords((current) => [
        ...current,
        { id: ++fetchDebugIdRef.current, label, url, status, body },
      ]);
    },
    [],
  );

  const persistConversation = useCallback(
    async (conversation: Conversation, touchRecency: boolean) => {
      const updated = touchRecency
        ? { ...conversation, updatedAt: Date.now() }
        : conversation;
      const next = conversationsRef.current.some(
        (item) => item.id === updated.id,
      )
        ? conversationsRef.current.map((item) =>
            item.id === updated.id ? updated : item,
          )
        : [...conversationsRef.current, updated];
      commitConversations(next);
      // IndexedDB is a metadata handle only now (title, agent link,
      // timestamps). The transcript itself lives in Hermes; persisting
      // messages here made fresh browsers show empty/partial history.
      await conversationStore.save({
        ...updated,
        messages: [],
      });
      return updated;
    },
    [commitConversations, conversationStore],
  );

  const saveConversation = useCallback(
    async (conversation: Conversation) => {
      const saved = await persistConversation(conversation, true);
      if (activeConversationIdRef.current === saved.id) {
        activeConversationPointerRef.current = {
          version: 1,
          conversationId: saved.id,
          title: saved.title,
          subtitleLanguageAtCreation: saved.subtitleLanguageAtCreation,
          createdAt: saved.createdAt,
          ...(saved.agent?.persistentSessionId
            ? { persistentSessionId: saved.agent.persistentSessionId }
            : {}),
        };
        writeActiveConversationPointer(saved);
      }
      return saved;
    },
    [persistConversation],
  );

  const rememberConversation = useCallback(
    (conversation: Conversation) => {
      if (activeConversationIdRef.current !== conversation.id) {
        resetConversationActivities();
      }
      activeConversationPointerRef.current = {
        version: 1,
        conversationId: conversation.id,
        title: conversation.title,
        subtitleLanguageAtCreation: conversation.subtitleLanguageAtCreation,
        createdAt: conversation.createdAt,
        ...(conversation.agent?.persistentSessionId
          ? { persistentSessionId: conversation.agent.persistentSessionId }
          : {}),
      };
      activeConversationIdRef.current = conversation.id;
      setActiveConversationId(conversation.id);
      writeActiveConversationPointer(conversation);
    },
    [resetConversationActivities],
  );

  // Hold-UX plumbing: a reply stays invisible while its voice synthesizes.
  // heldMessageRef is the single pending reply (abort/disconnect flush it);
  // the chain serializes turns so two replies can never interleave commits.
  const heldMessageRef = useRef<{ conversationId: string; message: KanaMessage } | null>(null);
  const ttsChainRef = useRef<Promise<void>>(Promise.resolve());

  const commitAssistantMessage = useCallback(
    async (conversationId: string, message: KanaMessage) => {
      const conversation = conversationsRef.current.find(
        (item) => item.id === conversationId,
      );
      if (!conversation) return;
      await saveConversation({
        ...conversation,
        messages: [...conversation.messages, message],
      });
      const hermesSessionKey = conversation.agent?.persistentSessionId;
      const turnActivities = message.activities ?? [];
      if (hermesSessionKey && turnActivities.length) {
        const lastToolTs = Math.max(
          ...turnActivities.map((activity) => activity.timestamp),
        );
        void fetch("/api/kana/activities", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            session: hermesSessionKey,
            turnAnchorMs: Math.min(lastToolTs + 1, message.timestamp),
            turnIndex: conversation.messages.filter(
              (item) => item.role === "assistant",
            ).length,
            activities: turnActivities,
          }),
        }).catch(() => {});
      }
    },
    [saveConversation],
  );

  const flushHeldMessage = useCallback(() => {
    const held = heldMessageRef.current;
    if (!held) return;
    heldMessageRef.current = null;
    void commitAssistantMessage(held.conversationId, held.message);
  }, [commitAssistantMessage]);

  // ---- Activities ----
  const addActivity = useCallback((activity: ActivityItem) => {
    // Mirror into the per-turn log: the snapshot lands on the assistant
    // message at turn end, so tool history survives page refreshes.
    const existingIndex = turnActivitiesRef.current.findIndex(
      (item) => item.id === activity.id,
    );
    if (existingIndex === -1) {
      turnActivitiesRef.current.push(activity);
    } else {
      turnActivitiesRef.current[existingIndex] = activity;
    }
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

  /**
   * Apply a restored Hermes transcript to one conversation.
   *
   * Primary source: the messages array already returned by session.resume
   * (delivered through the history.restored event after openSession). The
   * session.history RPC is a fallback only — it resolves runtime session ids,
   * never durable keys, and runs against the client's currently open session.
   * When neither source yields rows the outcome is surfaced as a visible
   * status/error, never as a silent empty transcript.
   */
  const restoreConversationTranscript = useCallback(
    async (
      conversationId: string,
      hermesSessionKey: string,
      resumedRows: AgentHistoryRow[],
    ) => {
      transcriptRestoreRef.current = true;
      queueMicrotask(() => setFetchingFromServer(true));
      try {
        let rows = resumedRows;
        if (!rows.length) {
          try {
            const agent = agentRef.current;
            if (!agent) throw new Error("Hermes client is not connected.");
            const result = await agent.fetchHistory();
            rows = result.messages ?? [];
            recordFetchDebug(
              "chat transcript fallback (session.history)",
              "session.history (open runtime session)",
              "ok",
              result,
            );
          } catch (historyError) {
            const message =
              historyError instanceof Error
                ? historyError.message
                : String(historyError);
            recordFetchDebug(
              "chat transcript fallback failed",
              "session.history (open runtime session)",
              "ERR",
              message,
            );
            reportError("agent", historyError);
          }
        }

        const { messages, turns } = parseHermesTranscript(rows);
        // Fresh read: rows appended while the fallback fetch was in flight
        // must not be clobbered by a stale conversation snapshot.
        const target = conversationsRef.current.find(
          (item) => item.id === conversationId,
        );
        if (!target) return;

        if (!messages.length) {
          if (!target.messages.length) {
            setStatus(
              "Hermes returned no stored transcript for this conversation.",
            );
          }
          return;
        }

        await persistConversation({
          ...target,
          messages: mergeRestoredMessages(messages, target.messages),
        }, false);
        for (const turn of turns) {
          void fetch("/api/kana/activities", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              session: hermesSessionKey,
              turnAnchorMs: turn.anchorMs,
              turnIndex: turn.turnIndex,
              activities: turn.activities,
            }),
          }).catch(() => {});
        }
      } finally {
        transcriptRestoreRef.current = false;
        setFetchingFromServer(false);
      }
    },
    [persistConversation, recordFetchDebug, reportError],
  );

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
        const linked = await persistConversation({
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
        }, false);
        if (activeConversationIdRef.current === linked.id) {
          rememberConversation(linked);
        }
        return;
      }

      if (event.type === "session.updated" && event.title) {
        const titled = await persistConversation(
          { ...conversation, title: event.title },
          false,
        );
        if (activeConversationIdRef.current === titled.id) {
          rememberConversation(titled);
        }
        return;
      }

      if (event.type === "assistant.message") {
        // While a transcript restore is mid-flight the last local assistant
        // row may be a just-restored history row; comparing against it would
        // swallow or duplicate the incoming reply. Skip dedup in that window.
        if (!transcriptRestoreRef.current) {
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
        }
        const assistantMessage: KanaMessage = {
          id: createId("message"),
          role: "assistant",
          speech_ja: event.response.speech_ja,
          subtitle: { ...event.response.subtitle },
          emotion: event.response.emotion ?? "neutral",
          timestamp: Date.now(),
          activities: [...turnActivitiesRef.current],
        };

        if (!preferencesRef.current.voiceEnabled) {
          avatarController.presentEmotion(assistantMessage.emotion);
          await commitAssistantMessage(conversation.id, assistantMessage);
          return;
        }

        // Hold-UX: synthesis runs FIRST; the reply only becomes visible the
        // moment her voice actually starts (or as text-only fallback when
        // synthesis fails or is aborted). heldMessageRef lets abort and
        // disconnect flush the text so a reply can never be lost.
        heldMessageRef.current = {
          conversationId: conversation.id,
          message: assistantMessage,
        };
        setStatus(statusCopy(preferencesRef.current.uiLocale).preparingVoice);
        const previousChain = ttsChainRef.current ?? Promise.resolve();
        ttsChainRef.current = previousChain.then(async () => {
          // Let React flush the held status before the long synth.
          await new Promise((resolve) => setTimeout(resolve, 0));
          const commitOnce = async () => {
            if (heldMessageRef.current?.message.id !== assistantMessage.id) return;
            heldMessageRef.current = null;
            await commitAssistantMessage(conversation.id, assistantMessage);
          };
          // Voice may have been switched off while a previous spoken reply
          // was still finishing. In text-only mode never instantiate or call
          // the TTS provider; release this response immediately instead.
          if (!preferencesRef.current.voiceEnabled) {
            avatarController.presentEmotion(assistantMessage.emotion);
            await commitOnce();
            setStatus(statusCopy(preferencesRef.current.uiLocale).ready);
            return;
          }
          return getVoice()
            .speak({
              text: event.response.speech_ja,
              language: "ja",
              emotion: assistantMessage.emotion,
              voiceId: preferencesRef.current.qwen3Tts.voiceId || undefined,
              onAudioStart: () => {
                avatarController.presentEmotion(assistantMessage.emotion);
                setStatus(statusCopy(preferencesRef.current.uiLocale).speaking);
                void commitOnce();
              },
            })
            .then(async () => {
              await commitOnce();
              setStatus(statusCopy(preferencesRef.current.uiLocale).ready);
            })
            .catch(async (voiceError) => {
              if (!isAbortError(voiceError)) {
                reportError(
                  "voice",
                  voiceError instanceof Error
                    ? voiceError.message
                    : "Voice playback failed.",
                );
              }
              avatarController.presentEmotion(assistantMessage.emotion);
              await commitOnce();
              setStatus(statusCopy(preferencesRef.current.uiLocale).ready);
            });
        });
      }
    },
    [
      avatarController,
      commitAssistantMessage,
      getVoice,
      persistConversation,
      rememberConversation,
      reportError,
    ],
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
          setStatus(statusCopy(preferencesRef.current.uiLocale).connected);
          return;
        }
        if (event.state === "reconnecting" || event.state === "error") {
          setPendingInput(null);
          setRespondingToInput(false);
          openedConversationRef.current = null;
          openingConversationRef.current = null;
          flushHeldMessage();
          setBusy(false);
          setStatus(statusCopy(preferencesRef.current.uiLocale).reconnecting);
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
          flushHeldMessage();
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

      if (event.type === "history.restored") {
        // Emitted by openSession AFTER session.opened: the agent session for
        // this conversation is really open here, not merely connected.
        const conversationId =
          openingConversationRef.current ?? activeConversationIdRef.current;
        const conversation = conversationsRef.current.find(
          (item) => item.id === conversationId,
        );
        if (!conversation) return;
        if (conversation.agent?.persistentSessionId !== event.persistentSessionId) {
          return;
        }
        void restoreConversationTranscript(
          conversation.id,
          event.persistentSessionId,
          event.messages,
        );
        return;
      }

      if (event.type === "agent.started") {
        turnStartedAtRef.current = monotonicNow();
        // Fresh activity log for this turn.
        turnActivitiesRef.current = [];
        setBusy(true);
        setError(null);
        setStatus(statusCopy(preferencesRef.current.uiLocale).thinking);
        avatarController.presentEmotion("thinking");
        return;
      }

      if (event.type === "assistant.delta") {
        setStatus(statusCopy(preferencesRef.current.uiLocale).answering);
        return;
      }

      if (event.type === "assistant.message") {
        void updateConversationFromEvent(event);
        setStatus(statusCopy(preferencesRef.current.uiLocale).responseReceived);
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
        // Mirror the completion into the per-turn log first: the snapshot that
        // lands on the assistant message must carry final states, not the
        // stale "running" rows from tool.start.
        turnActivitiesRef.current = turnActivitiesRef.current.map((activity) =>
          activity.id === event.id
            ? {
                ...activity,
                state: "complete" as const,
                title: event.summary || `${event.tool} finished`,
                durationMs: event.durationMs,
              }
            : activity,
        );
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
        const isId = preferencesRef.current.uiLocale === "id";
        const inputKind = isId
          ? ({ approval: "persetujuan", clarification: "klarifikasi", sudo: "kata sandi sudo", secret: "nilai rahasia" } as const)[event.request.kind]
          : event.request.kind;
        setPendingInput(event.request);
        setRespondingToInput(false);
        setStatus(isId ? `Hermes memerlukan ${inputKind}` : `Hermes needs ${inputKind}`);
        addActivity({
          id: createId("input"),
          kind: "input",
          title: isId ? `Hermes meminta ${inputKind}` : `Hermes requested ${inputKind}`,
          detail:
            event.request.kind === "approval"
              ? event.request.description
              : event.request.kind === "clarification"
                ? event.request.question
                : isId ? "Input aman sedang menunggu di Kana." : "Secure input is waiting in Kana.",
          state: "attention",
          timestamp: Date.now(),
        });
        return;
      }

      if (event.type === "input.expired") {
        const isId = preferencesRef.current.uiLocale === "id";
        setPendingInput((current) =>
          current?.kind === event.kind &&
          "requestId" in current &&
          current.requestId === event.requestId
            ? null
            : current,
        );
        setRespondingToInput(false);
        setStatus(isId ? `Permintaan ${event.kind} telah kedaluwarsa` : `${event.kind} request expired`);
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
        // Don't overwrite "Kana menyiapkan suara…" / "Kana berbicara…" when
        // the reply is being held for synthesis — it will resolve to "Ready
        // when you are" once speech finishes or fails.
        if (!heldMessageRef.current) {
          setStatus(statusCopy(preferencesRef.current.uiLocale).ready);
        }
        turnConversationRef.current = null;
        return;
      }

      if (event.type === "agent.aborted") {
        turnStartedAtRef.current = null;
        setPendingInput(null);
        setRespondingToInput(false);
        setBusy(false);
        flushHeldMessage();
        setStatus(statusCopy(preferencesRef.current.uiLocale).stopped);
        avatarController.presentEmotion("neutral");
        turnConversationRef.current = null;
        return;
      }

      if (event.type === "agent.error") {
        turnStartedAtRef.current = null;
        setPendingInput(null);
        setRespondingToInput(false);
        setBusy(false);
        setStatus(statusCopy(preferencesRef.current.uiLocale).attention);
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
            void persistConversation(
              {
                ...conversation,
                agent: { ...conversation.agent, status: "missing" },
              },
              false,
            );
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
      flushHeldMessage,
      persistConversation,
      reportError,
      restoreConversationTranscript,
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
    let fellBack = false;
    const storedPreferences = preferencesStore.load();

    initializationRef.current ??= (async () => {
      // Hermes remains transcript authority. The browser stores only which
      // conversation was selected so refresh can return to that exact session;
      // a fresh, not-yet-linked conversation is reconstructed as an empty
      // local placeholder until Hermes opens it.
      let storedPointer = readActiveConversationPointer();
      const storedFreshConversation = freshConversationFromPointer(storedPointer);
      let storedConversations: Conversation[];
      if (storedFreshConversation) {
        storedConversations = [storedFreshConversation];
      } else if (storedPointer?.persistentSessionId) {
        // Restore the selected linked conversation as a lightweight local
        // handle immediately. Its authoritative transcript is still loaded
        // from Hermes after the automatic connection succeeds, but the local
        // composer must remain editable while that connection is starting.
        storedConversations = [{
          id: storedPointer.conversationId,
          title: storedPointer.title,
          messages: [],
          subtitleLanguageAtCreation:
            storedPointer.subtitleLanguageAtCreation,
          agent: {
            provider: "hermes",
            persistentSessionId: storedPointer.persistentSessionId,
            status: "linked",
            relationship: "primary",
          },
          createdAt: storedPointer.createdAt,
          updatedAt: storedPointer.createdAt,
        }];
      } else {
        // A brand-new browser still needs a local conversation before Hermes
        // is available. Previously activeConversationId stayed null here,
        // making the controlled message box discard every typed character.
        const conversation = await conversationStore.create({
          subtitleLanguage: storedPreferences.subtitleLanguage,
        });
        storedPointer = pointerFromConversation(conversation);
        writeActiveConversationPointer(conversation);
        storedConversations = [conversation];
      }
      const storageWarning = [
        preferencesStore.consumeWarning(),
        conversationStore.consumeWarning(),
      ]
        .filter(Boolean)
        .join(" ") || null;
      return { storedConversations, storageWarning, storedPointer };
    })();

    const timeout = globalThis.setTimeout(() => {
      if (!mounted) return;
      fellBack = true;
      preferencesRef.current = storedPreferences;
      setPreferences(storedPreferences);
      commitConversations([]);
      setActiveConversationId(null);
      setReady(true);
    }, 30_000);

    void initializationRef.current!.then(
      ({ storedConversations, storageWarning, storedPointer }) => {
        if (!mounted || fellBack) return;
        globalThis.clearTimeout(timeout);
        const initialConversationId = storedConversations[0]?.id ?? null;
        preferencesRef.current = storedPreferences;
        activeConversationPointerRef.current = storedPointer;
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
        if (!mounted || fellBack) return;
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
      if (
        !cleanText ||
        !activeConversationId
      )
        return;
      const wasBusy = busy;

      const conversation = conversationsRef.current.find(
        (item) => item.id === activeConversationId,
      );
      if (!conversation) return;

      // Telegram-parity: a plain message typed while Kana is mid-turn is
      // queued and submitted automatically when the current turn completes,
      // instead of being silently dropped.
      if (busy && !commandName) {
        agentRef.current?.enqueuePrompt(
          cleanText,
          preferencesRef.current.subtitleLanguage,
        );
        await saveConversation({
          ...conversation,
          messages: [
            ...conversation.messages,
            {
              ...createUserMessage(cleanText),
              text: cleanText,
            },
          ],
        });
        setStatus(statusCopy(preferencesRef.current.uiLocale).queued);
        return;
      }

      if (commandName === "new") {
        if (isFreshConversation(conversation)) {
          // Reuse the blank conversation instead of stacking another one.
          // An explicit title argument still applies to it.
          if (commandArg) {
            await saveConversation({ ...conversation, title: commandArg });
          }
          resetConversationActivities();
          setStatus(statusCopy(preferencesRef.current.uiLocale).alreadyNew);
          setCommandSuggestions([]);
          return;
        }
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
        rememberConversation(next);
        openedConversationRef.current = null;
        setStatus(statusCopy(preferencesRef.current.uiLocale).newReady);
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
            rememberConversation(target);
            openedConversationRef.current = null;
            setStatus(preferencesRef.current.uiLocale === "id" ? `Melanjutkan ${target.title}` : `Resumed ${target.title}`);
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
      setStatus(statusCopy(preferencesRef.current.uiLocale).opening);

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
              setStatus(statusCopy(preferencesRef.current.uiLocale).commandComplete);
              turnConversationRef.current = null;
            } else {
              setStatus(statusCopy(preferencesRef.current.uiLocale).continuing);
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
            rememberConversation(savedBranch);
            openedConversationRef.current = savedBranch.id;
            turnConversationRef.current = null;
            setBusy(false);
            setStatus(preferencesRef.current.uiLocale === "id" ? `Membuat cabang ke ${savedBranch.title}` : `Branched to ${savedBranch.title}`);
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
            setStatus(statusCopy(preferencesRef.current.uiLocale).draftReady);
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
            ? statusCopy(preferencesRef.current.uiLocale).stillWorking
            : statusCopy(preferencesRef.current.uiLocale).sendFailed,
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
      rememberConversation,
      reportError,
      resetConversationActivities,
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
        : kanaCommandSuggestions(preferencesRef.current.uiLocale).filter((item) =>
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
            void persistConversation(
              {
                ...current,
                agent: { ...current.agent, status: "missing" },
              },
              false,
            );
          }
        }
      } finally {
        if (completionRequestRef.current === requestId) {
          setCommandSuggestionsLoading(false);
        }
      }
    },
    [ensureAgent, persistConversation],
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
    const current = conversationsRef.current.find(
      (item) => item.id === activeConversationIdRef.current,
    );
    if (isFreshConversation(current)) {
      resetConversationActivities();
      setStatus(statusCopy(preferencesRef.current.uiLocale).alreadyNew);
      setError(null);
      return;
    }
    const conversation = await conversationStore.create({
      subtitleLanguage: preferencesRef.current.subtitleLanguage,
    });
    commitConversations([...conversationsRef.current, conversation]);
    rememberConversation(conversation);
    openedConversationRef.current = null;
    setError(null);
  }, [busy, commitConversations, conversationStore, rememberConversation, resetConversationActivities]);

  // ---- Cross-browser Hermes sessions ----
  // Sessions created on other surfaces/browsers have no local IndexedDB
  // record. They are listed from Hermes (source=kana) and "adopted" into a
  // lightweight local record on first open, linked via persistentSessionId.
  const adoptHermesSession = useCallback(
    async (entry: HermesConversationDirectoryEntry) => {
      if (busy) return;
      const existing = conversationsRef.current.find(
        (item) => item.agent?.persistentSessionId === entry.hermesSessionKey,
      );
      if (existing) {
        rememberConversation(existing);
        openedConversationRef.current = null;
        await ensureAgent(existing);
        return;
      }
      const saved = await persistConversation(
        conversationFromHermesEntry(
          entry,
          preferencesRef.current.subtitleLanguage,
          createId("conversation"),
        ),
        false,
      );
      rememberConversation(saved);
      openedConversationRef.current = null;
      await ensureAgent(saved);
    },
    [busy, ensureAgent, persistConversation, rememberConversation],
  );

  const selectConversation = useCallback(
    (id: string) => {
      if (busy || id === activeConversationId) return;
      const target = conversationsRef.current.find((item) => item.id === id);
      if (!target) return;
      rememberConversation(target);
      openedConversationRef.current = null;
      setError(null);
      cleanupVoice();
      avatarController.presentEmotion("neutral");
      if (!target?.agent?.persistentSessionId) return;
      // Opening the linked session is what makes openSession emit
      // history.restored — without it selection shows tool activity but no
      // messages after a refresh or in a fresh browser.
      void (async () => {
        try {
          await ensureAgent(target);
        } catch {
          setStatus(preferencesRef.current.uiLocale === "id" ? "Sesi Hermes untuk percakapan ini tidak dapat dibuka kembali." : "Could not reopen the Hermes session for this conversation.");
        }
      })();
    },
    [
      activeConversationId,
      avatarController,
      busy,
      cleanupVoice,
      ensureAgent,
      rememberConversation,
    ],
  );

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      const existing = conversationsRef.current.find((item) => item.id === id);
      if (!existing) return;
      const renamed = await persistConversation(
        { ...existing, title },
        false,
      );
      if (activeConversationIdRef.current === id) {
        rememberConversation(renamed);
      }
    },
    [persistConversation, rememberConversation],
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
        const nextConversation = remaining[0] ?? null;
        if (nextConversation) {
          rememberConversation(nextConversation);
        } else {
          activeConversationIdRef.current = null;
          activeConversationPointerRef.current = null;
          setActiveConversationId(null);
          clearActiveConversationPointer();
        }
        openedConversationRef.current = null;
      }
    },
    [
      activeConversationId,
      busy,
      commitConversations,
      conversationStore,
      rememberConversation,
    ],
  );

  // ---- Preferences management ----
  const savePreferences = useCallback(
    async (next: KanaPreferences) => {
      next = normalizeKanaPreferences(next);
      const previous = preferencesRef.current;
      preferencesRef.current = next;
      setPreferences(next);
      preferencesStore.save(next);
      if (previous.uiLocale !== next.uiLocale && !busy) {
        setStatus(statusCopy(next.uiLocale).ready);
      }

      const voiceChanged =
        previous.voiceEnabled !== next.voiceEnabled ||
        previous.qwen3Tts.baseUrl !== next.qwen3Tts.baseUrl ||
        previous.qwen3Tts.voiceId !== next.qwen3Tts.voiceId ||
        previous.qwen3Tts.deliveryMode !== next.qwen3Tts.deliveryMode;
      if (voiceChanged) cleanupVoice();
      if (previous.voiceEnabled && !next.voiceEnabled) {
        // Turning voice off is an immediate text-only transition: stop any
        // active synthesis/playback and reveal a response that was waiting
        // for audio instead of leaving the chat behind the TTS pipeline.
        flushHeldMessage();
        setStatus(statusCopy(preferencesRef.current.uiLocale).ready);
      }

      const avatarChanged =
        previous.avatarMode !== next.avatarMode ||
        JSON.stringify(previous.live2d) !== JSON.stringify(next.live2d);
      if (avatarChanged) await configureAvatar(next, undefined, true);
    },
    [busy, cleanupVoice, configureAvatar, flushHeldMessage, preferencesStore],
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
      // Selection and recency are separate concerns. The stored pointer says
      // which conversation the user was viewing; Hermes last_active controls
      // the history ordering. Merely opening/restoring a session never makes
      // it the most recently interacted conversation.
      let remote: HermesConversationDirectoryEntry[] = [];
      let directoryLoaded = false;
      try {
        const directory = (await fetch("/api/kana/sessions", {
          credentials: "same-origin",
        }).then((response) => (response.ok ? response.json() : null))) as {
          sessions?: HermesConversationDirectoryEntry[];
        } | null;
        remote = [...(directory?.sessions ?? [])].sort(
          (a, b) => b.lastActive - a.lastActive,
        );
        directoryLoaded = directory !== null;
        setHermesSessions(remote);
      } catch {
        /* directory hydration is best-effort */
      }

      let conversation = activeConversationIdRef.current
        ? conversationsRef.current.find(
            (item) => item.id === activeConversationIdRef.current,
          ) ?? null
        : null;

      if (!conversation) {
        const pointer = activeConversationPointerRef.current;
        const selectedEntry = rememberedHermesEntry(pointer, remote);
        const fallbackEntry = remote.find((entry) => entry.messageCount > 0);
        const entry = selectedEntry ?? fallbackEntry;

        if (entry) {
          const existing = conversationsRef.current.find(
            (item) =>
              item.agent?.persistentSessionId === entry.hermesSessionKey,
          );
          if (existing) {
            conversation = existing;
          } else {
            conversation = await persistConversation(
              conversationFromHermesEntry(
                entry,
                preferencesRef.current.subtitleLanguage,
                pointer?.persistentSessionId === entry.hermesSessionKey
                  ? pointer.conversationId
                  : createId("conversation"),
              ),
              false,
            );
          }
          rememberConversation(conversation);
          openedConversationRef.current = null;
        } else {
          if (pointer?.persistentSessionId && !directoryLoaded) {
            conversation = {
              id: pointer.conversationId,
              title: pointer.title,
              messages: [],
              subtitleLanguageAtCreation:
                pointer.subtitleLanguageAtCreation,
              agent: {
                provider: "hermes",
                persistentSessionId: pointer.persistentSessionId,
                status: "linked",
                relationship: "primary",
              },
              createdAt: pointer.createdAt,
              updatedAt: pointer.createdAt,
            };
            await persistConversation(conversation, false);
          } else if (pointer?.persistentSessionId) {
            activeConversationPointerRef.current = null;
            clearActiveConversationPointer();
          }
          if (!conversation) {
            const fresh = freshConversationFromPointer(pointer);
            if (fresh) {
              conversation = fresh;
              await persistConversation(conversation, false);
            } else {
              conversation = await conversationStore.create({
                subtitleLanguage: preferencesRef.current.subtitleLanguage,
              });
            }
          }
          rememberConversation(conversation);
          openedConversationRef.current = null;
        }
      }

      await ensureAgent(conversation);

      const known = new Set(
        conversationsRef.current
          .map((item) => item.agent?.persistentSessionId)
          .filter(Boolean) as string[],
      );
      for (const entry of remote) {
        if (known.has(entry.hermesSessionKey)) continue;
        await persistConversation(
          conversationFromHermesEntry(
            entry,
            preferencesRef.current.subtitleLanguage,
            createId("conversation"),
          ),
          false,
        );
      }
      setStatus(statusCopy(preferencesRef.current.uiLocale).connected);
    } catch (connectError) {
      reportError(
        "agent",
        connectError instanceof Error
          ? connectError.message
          : "Could not connect to the agent.",
      );
    }
  }, [
    conversationStore,
    ensureAgent,
    persistConversation,
    rememberConversation,
    reportError,
  ]);

  const disconnectAgent = useCallback(async () => {
    unsubscribeAgentRef.current?.();
    unsubscribeAgentRef.current = null;
    await agentRef.current?.disconnect();
    agentRef.current = null;
    agentKeyRef.current = "";
    openedConversationRef.current = null;
    openingConversationRef.current = null;
    turnConversationRef.current = null;
    flushHeldMessage();
    setPendingInput(null);
    setRespondingToInput(false);
    setBusy(false);
    setConnectionState("disconnected");
    setStatus(statusCopy(preferencesRef.current.uiLocale).disconnected);
  }, [flushHeldMessage]);

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
        setStatus(statusCopy(preferencesRef.current.uiLocale).inputSent);
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
        setStatus(statusCopy(preferencesRef.current.uiLocale).inputFailed);
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

  // Load the server-side activity log whenever the open conversation's Hermes
  // session changes. Best-effort: an empty result just means no stored turns.
  const serverSessionKey = activeConversation?.agent?.persistentSessionId ?? null;
  useEffect(() => {
    if (!serverSessionKey) return;
    activitySessionKeyRef.current = serverSessionKey;
    let cancelled = false;
    queueMicrotask(() => setFetchingFromServer(true));
    void fetch(`/api/kana/activities?session=${encodeURIComponent(serverSessionKey)}`, {
      credentials: "same-origin",
    })
      .then(async (response) => ({
        status: response.status,
        data: response.ok ? await response.json() : await response.text(),
      }))
      .then(({ status, data }) => {
        if (!cancelled) {
          recordFetchDebug(
            "activity turns",
            `/api/kana/activities?session=${serverSessionKey}`,
            status,
            data,
          );
          const typed = data as {
            turns?: Array<{
              turnAnchorMs: number;
              turnIndex: number | null;
              activities: ActivityItem[];
            }>;
          } | null;
          if (
            typed?.turns &&
            activitySessionKeyRef.current === serverSessionKey
          ) {
            // Merge by ordinal: at most one row per turn_index reaches the
            // feed, so a legacy anchor row and its indexed successor can
            // never render the same turn twice.
            const seenIndexes = new Set<number>();
            setServerActivityTurns(
              typed.turns.filter((turn) => {
                if (typeof turn.turnIndex !== "number") return true;
                if (seenIndexes.has(turn.turnIndex)) return false;
                seenIndexes.add(turn.turnIndex);
                return true;
              }),
            );
          }
        }
      })
      .catch((error) => {
        if (!cancelled)
          recordFetchDebug(
            "activity turns (network error)",
            `/api/kana/activities?session=${serverSessionKey}`,
            "ERR",
            String(error),
          );
      });
    // Refresh the cross-browser Hermes session directory too.
    void fetch("/api/kana/sessions", { credentials: "same-origin" })
      .then(async (response) => ({
        status: response.status,
        data: response.ok ? await response.json() : await response.text(),
      }))
      .then(({ status, data }) => {
        if (!cancelled) {
          recordFetchDebug("hermes session directory", "/api/kana/sessions", status, data);
          const typed = data as {
            sessions?: Array<{
              hermesSessionKey: string;
              title: string;
              messageCount: number;
              startedAt: number;
              lastActive: number;
            }>;
          } | null;
          if (typed?.sessions) setHermesSessions(typed.sessions);
        }
      })
      .catch((error) => {
        if (!cancelled)
          recordFetchDebug(
            "hermes sessions (network error)",
            "/api/kana/sessions",
            "ERR",
            String(error),
          );
      })
      .finally(() => {
        if (!cancelled) setFetchingFromServer(false);
      });
    return () => {
      cancelled = true;
      setFetchingFromServer(false);
    };
  }, [recordFetchDebug, serverSessionKey]);

  // Transcript restore is event-driven: openSession emits history.restored
  // (carrying the session.resume transcript) only after the agent session for
  // the conversation is actually opened, and handleAgentEvent routes it to
  // restoreConversationTranscript. A connection alone never triggers a fetch,
  // and the durable key is never sent to session.history.

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
    serverActivityTurns,
    fetchingFromServer,
    fetchDebugRecords,
    clearFetchDebugRecords: () => setFetchDebugRecords([]),
    hermesSessions,
    adoptHermesSession,
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
