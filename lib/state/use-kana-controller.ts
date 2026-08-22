"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HermesAgentClient } from "@/lib/agent/hermes/hermes-agent-client";
import { MockAgentClient } from "@/lib/agent/mock-agent-client";
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
import { Live2DAvatarProvider } from "@/lib/avatar/live2d-avatar-provider";
import { ManagedAvatarProvider } from "@/lib/avatar/managed-avatar-provider";
import { live2DModelBindings } from "@/lib/avatar/model-bindings";
import { MockAvatarProvider } from "@/lib/avatar/mock-avatar-provider";
import { PixiLive2DRuntimeAdapter } from "@/lib/avatar/pixi-live2d-runtime-adapter";
import { IndexedDbAvatarModelStore } from "@/lib/avatar/indexed-db-avatar-model-store";
import type { AvatarSnapshot } from "@/lib/avatar/types";
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
  DEFAULT_PREFERENCES,
  LocalPreferencesStore,
  normalizeKanaPreferences,
} from "@/lib/preferences/local-preferences-store";
import type { KanaPreferences } from "@/lib/preferences/types";
import {
  controlHermesRuntime,
  inspectHermesRuntime,
} from "@/lib/runtime/hermes-control-client";
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
import { MockVoiceProvider } from "@/lib/voice/mock-voice-provider";
import {
  createQwen3VoiceClone,
  deleteQwen3VoiceClone,
  inspectQwen3TTSService,
  type CreateVoiceCloneInput,
} from "@/lib/voice/qwen3-tts-contract";
import { Qwen3TTSProvider } from "@/lib/voice/qwen3-tts-provider";
import type { VoiceProvider, VoiceProviderStatus } from "@/lib/voice/types";

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

const EMPTY_AVATAR: AvatarSnapshot = {
  loaded: false,
  renderMode: "mock",
  emotion: "neutral",
  emotionIntensity: 0.2,
  mouthOpen: 0,
  talking: false,
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
  return title.length > 42 ? `${title.slice(0, 42)}…` : title;
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
  const conversationStore = useMemo(() => new IndexedDbConversationStore(), []);
  const avatarModelStore = useMemo(() => new IndexedDbAvatarModelStore(), []);
  const preferencesStore = useMemo(() => new LocalPreferencesStore(), []);
  const avatarProvider = useMemo(() => new ManagedAvatarProvider(), []);
  const avatarController = useMemo(
    () => new AvatarController(avatarProvider),
    [avatarProvider],
  );

  const [ready, setReady] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );
  const [preferences, setPreferences] =
    useState<KanaPreferences>(DEFAULT_PREFERENCES);
  const [connectionState, setConnectionState] =
    useState<AgentConnectionState>("disconnected");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Ready when you are");
  const [error, setError] = useState<string | null>(null);
  const [lastError, setLastError] = useState<KanaErrorRecord | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [avatar, setAvatar] = useState<AvatarSnapshot>(EMPTY_AVATAR);
  const [commandSuggestions, setCommandSuggestions] = useState<
    AgentCommandSuggestion[]
  >([]);
  const [commandSuggestionsLoading, setCommandSuggestionsLoading] = useState(false);
  const [pendingInput, setPendingInput] = useState<AgentInputRequest | null>(null);
  const [respondingToInput, setRespondingToInput] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceProviderStatus | null>(null);
  const [voiceRuntimeState, setVoiceRuntimeState] = useState("idle");
  const [voiceCanReplay, setVoiceCanReplay] = useState(false);
  const [metrics, setMetrics] = useState<KanaRuntimeMetrics>({
    reconnectCount: 0,
  });

  const conversationsRef = useRef<Conversation[]>([]);
  const activeConversationIdRef = useRef<string | null>(null);
  const preferencesRef = useRef<KanaPreferences>(DEFAULT_PREFERENCES);
  const agentRef = useRef<AgentClient | null>(null);
  const agentKeyRef = useRef("");
  const openedConversationRef = useRef<string | null>(null);
  const openingConversationRef = useRef<string | null>(null);
  const turnConversationRef = useRef<string | null>(null);
  const unsubscribeAgentRef = useRef<(() => void) | null>(null);
  const voiceRef = useRef<VoiceProvider | null>(null);
  const unsubscribeVoiceRef = useRef<(() => void) | null>(null);
  const voiceKeyRef = useRef("");
  const initializationRef = useRef<Promise<{
    storedPreferences: KanaPreferences;
    storedConversations: Conversation[];
    storageWarning: string | null;
  }> | null>(null);
  const completionRequestRef = useRef(0);
  const avatarCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const avatarKeyRef = useRef("");
  const connectionStartedAtRef = useRef<number | null>(null);
  const turnStartedAtRef = useRef<number | null>(null);
  const avatarPreviewTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const commitConversations = useCallback((next: Conversation[]) => {
    const sorted = recentFirst(next);
    conversationsRef.current = sorted;
    setConversations(sorted);
  }, []);

  const saveConversation = useCallback(
    async (conversation: Conversation) => {
      const updated = { ...conversation, updatedAt: Date.now() };
      const next = conversationsRef.current.some((item) => item.id === updated.id)
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

  const addActivity = useCallback((activity: ActivityItem) => {
    setActivities((current) => {
      const existing = current.find((item) => item.id === activity.id);
      if (!existing) return [activity, ...current].slice(0, 40);
      if (existing.state === "complete" && activity.state === "running") {
        return current;
      }
      return current.map((item) => (item.id === activity.id ? activity : item));
    });
  }, []);

  const reportError = useCallback(
    (
      source: KanaErrorSource,
      value: unknown,
      category?: KanaErrorCategory,
    ) => {
      const record = classifyKanaError(value, source, category);
      setLastError(record);
      setError(record.message);
      return record;
    },
    [],
  );

  const configureAvatar = useCallback(
    async (next: KanaPreferences, selectedModelFiles?: File[]) => {
      const canvas = avatarCanvasRef.current;
      if (!canvas) return false;
      const startedAt = monotonicNow();
      setError(null);
      try {
        let modelFiles = selectedModelFiles;
        if (
          !modelFiles?.length &&
          next.avatarMode === "live2d" &&
          next.live2d.modelId
        ) {
          modelFiles =
            (await avatarModelStore.load(next.live2d.modelId)) ?? undefined;
          if (!modelFiles?.length) {
            throw new Error(
              `The saved Live2D model “${next.live2d.modelName || next.live2d.modelId}” is no longer available.`,
            );
          }
        }

        const bindings = live2DModelBindings(next.live2d);
        const key = modelFiles?.length
          ? `files:${modelFiles
              .map(
                (file) =>
                  `${file.webkitRelativePath}:${file.size}:${file.lastModified}`,
              )
              .join("|")}:${JSON.stringify(bindings)}`
          : next.avatarMode === "live2d"
            ? `live2d:${next.live2d.coreScriptUrl}:${next.live2d.modelId || next.live2d.modelUrl}:${JSON.stringify(bindings)}`
            : "mock";
        if (avatarKeyRef.current === key) return true;

        if (next.avatarMode === "mock" && !modelFiles?.length) {
          await avatarProvider.use(new MockAvatarProvider(), {
            id: "kana-mock",
            name: "Kana preview",
          });
        } else {
          const runtime = new PixiLive2DRuntimeAdapter(
            next.live2d.coreScriptUrl.trim(),
          );
          const provider = new Live2DAvatarProvider(runtime, bindings);
          await avatarProvider.use(provider, {
            id: modelFiles?.length ? "imported-live2d" : "configured-live2d",
            name: modelFiles?.length ? "Imported Live2D model" : "Live2D model",
            canvas,
            modelFiles,
            modelUrl: modelFiles?.length
              ? undefined
              : next.live2d.modelUrl.trim(),
          });
        }
        avatarKeyRef.current = key;
        avatarController.presentEmotion("neutral");
        setMetrics((current) => ({
          ...current,
          lastAvatarLoadDurationMs: Math.round(monotonicNow() - startedAt),
        }));
        return true;
      } catch (avatarError) {
        avatarKeyRef.current = "mock-fallback";
        reportError(
          "avatar",
          avatarError instanceof Error
            ? `Live2D could not load: ${avatarError.message}`
            : "Live2D could not load. Kana is using the CSS preview.",
          "avatar",
        );
        return false;
      }
    },
    [avatarController, avatarModelStore, avatarProvider, reportError],
  );

  const attachAvatarCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      avatarCanvasRef.current = canvas;
      if (canvas) void configureAvatar(preferencesRef.current);
    },
    [configureAvatar],
  );

  const importAvatarFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) throw new Error("Choose a Live2D model folder first.");
      const previous = preferencesRef.current;
      const imported = await avatarModelStore.import(files);
      const next = {
        ...preferencesRef.current,
        avatarMode: "live2d" as const,
        live2d: {
          ...preferencesRef.current.live2d,
          modelId: imported.id,
          modelName: imported.name,
        },
      };
      avatarKeyRef.current = "";
      const loaded = await configureAvatar(next, files);
      if (!loaded) {
        await avatarModelStore.delete(imported.id);
        avatarKeyRef.current = "";
        await configureAvatar(previous);
        throw new Error(
          "The selected folder could not be loaded. Include the model3.json file and every referenced asset.",
        );
      }
      preferencesRef.current = next;
      setPreferences(next);
      preferencesStore.save(next);
      return imported;
    },
    [avatarModelStore, configureAvatar, preferencesStore],
  );

  const listAvatarModels = useCallback(
    () => avatarModelStore.list(),
    [avatarModelStore],
  );

  const selectAvatarModel = useCallback(
    async (id: string) => {
      const previous = preferencesRef.current;
      const model = (await avatarModelStore.list()).find((item) => item.id === id);
      if (!model) throw new Error("The selected Live2D model no longer exists.");
      const files = await avatarModelStore.load(id);
      if (!files?.length) throw new Error("The selected Live2D package is empty.");
      const next: KanaPreferences = {
        ...previous,
        avatarMode: "live2d",
        live2d: {
          ...previous.live2d,
          modelId: model.id,
          modelName: model.name,
        },
      };
      avatarKeyRef.current = "";
      if (!(await configureAvatar(next, files))) {
        avatarKeyRef.current = "";
        await configureAvatar(previous);
        throw new Error(
          "The saved Live2D package could not be loaded. Kana restored the previous avatar.",
        );
      }
      preferencesRef.current = next;
      setPreferences(next);
      preferencesStore.save(next);
      return model;
    },
    [avatarModelStore, configureAvatar, preferencesStore],
  );

  const renameAvatarModel = useCallback(
    async (id: string, name: string) => {
      const renamed = await avatarModelStore.rename(id, name);
      if (!renamed) throw new Error("The selected Live2D model no longer exists.");
      if (preferencesRef.current.live2d.modelId === id) {
        const next = {
          ...preferencesRef.current,
          live2d: {
            ...preferencesRef.current.live2d,
            modelName: renamed.name,
          },
        };
        preferencesRef.current = next;
        setPreferences(next);
        preferencesStore.save(next);
      }
      return renamed;
    },
    [avatarModelStore, preferencesStore],
  );

  const deleteAvatarModel = useCallback(
    async (id: string) => {
      if (preferencesRef.current.live2d.modelId === id) {
        throw new Error("Switch to another avatar before deleting the active model.");
      }
      await avatarModelStore.delete(id);
    },
    [avatarModelStore],
  );

  const getVoice = useCallback((): VoiceProvider => {
    const prefs = preferencesRef.current;
    const key = `${prefs.voiceMode}:${prefs.qwen3Tts.baseUrl}:${prefs.qwen3Tts.voiceId}:${prefs.qwen3Tts.deliveryMode}`;
    if (voiceRef.current && voiceKeyRef.current === key) {
      return voiceRef.current;
    }

    voiceRef.current?.stop();
    unsubscribeVoiceRef.current?.();
    const provider =
      prefs.voiceMode === "qwen3"
        ? new Qwen3TTSProvider(
            {
              baseUrl: prefs.qwen3Tts.baseUrl,
              voiceId: prefs.qwen3Tts.voiceId,
              deliveryMode: prefs.qwen3Tts.deliveryMode,
            },
            avatarController,
          )
        : new MockVoiceProvider(avatarController);
    voiceRef.current = provider;
    const applySnapshot = (snapshot: ReturnType<VoiceProvider["getSnapshot"]>) => {
      setVoiceRuntimeState(snapshot.state);
      setVoiceCanReplay(snapshot.canReplay);
      const totalDuration =
        (snapshot.lastSynthesisDurationMs ?? 0) +
        (snapshot.lastPlaybackDurationMs ?? 0);
      if (totalDuration > 0) {
        setMetrics((current) => ({
          ...current,
          lastVoiceDurationMs: totalDuration,
          lastVoiceSynthesisDurationMs: snapshot.lastSynthesisDurationMs,
          lastVoicePlaybackDurationMs: snapshot.lastPlaybackDurationMs,
          lastVoiceTimeToFirstAudioMs: snapshot.timeToFirstAudioMs,
        }));
      }
    };
    applySnapshot(provider.getSnapshot());
    unsubscribeVoiceRef.current = provider.subscribe(applySnapshot);
    voiceKeyRef.current = key;
    return provider;
  }, [avatarController]);

  const inspectVoiceService = useCallback(async (baseUrl: string) => {
    setVoiceRuntimeState("checking");
    const inspection = await inspectQwen3TTSService(baseUrl);
    setVoiceStatus(inspection);
    setVoiceRuntimeState(inspection.state);
    if (inspection.state === "error" || inspection.state === "unavailable") {
      setLastError(
        classifyKanaError(
          inspection.message || "Qwen3-TTS is unavailable.",
          "voice",
          "voice",
        ),
      );
    }
    return inspection;
  }, []);

  const cloneVoice = useCallback(
    async (baseUrl: string, input: CreateVoiceCloneInput) => {
      const voice = await createQwen3VoiceClone(baseUrl, input);
      const inspection = await inspectQwen3TTSService(baseUrl);
      setVoiceStatus(inspection);
      return voice;
    },
    [],
  );

  const deleteClonedVoice = useCallback(
    async (baseUrl: string, voiceId: string) => {
      await deleteQwen3VoiceClone(baseUrl, voiceId);
      const inspection = await inspectQwen3TTSService(baseUrl);
      setVoiceStatus(inspection);
      return inspection;
    },
    [],
  );

  const inspectHermesControl = useCallback(() => inspectHermesRuntime(), []);
  const startHermesControl = useCallback(
    (options: { port: number; token: string; cwd?: string; restart?: boolean }) =>
      controlHermesRuntime({
        action: options.restart ? "restart" : "start",
        port: options.port,
        token: options.token,
        cwd: options.cwd,
      }),
    [],
  );
  const stopHermesControl = useCallback(
    () => controlHermesRuntime({ action: "stop" }),
    [],
  );

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
        if (preferencesRef.current.agentMode === "hermes") {
          await saveConversation({
            ...conversation,
            agent: {
              provider: "hermes",
              persistentSessionId: event.persistentSessionId,
              status: "linked",
              relationship: conversation.agent?.relationship ?? "primary",
              ...(conversation.agent?.parentConversationId
                ? { parentConversationId: conversation.agent.parentConversationId }
                : {}),
            },
          });
        }
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
          previousAssistant.subtitle?.text === event.response.subtitle.text &&
          previousAssistant.subtitle.language === event.response.subtitle.language
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
          setStatus(
            preferencesRef.current.agentMode === "hermes"
              ? "Connected to Hermes"
              : "Mock agent connected",
          );
          return;
        }
        if (event.state === "reconnecting" || event.state === "error") {
          setPendingInput(null);
          setRespondingToInput(false);
          openedConversationRef.current = null;
          openingConversationRef.current = null;
          setBusy(false);
          setStatus("Reconnecting to Hermes…");
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

      if (event.type === "session.opened" || event.type === "session.updated") {
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
          const existing = current.some((activity) => activity.id === event.id);
          if (!existing) {
            return [
              {
                id: event.id,
                tool: event.tool,
                kind: event.kind,
                title: event.summary || `${event.tool} finished`,
                state: "complete" as const,
                timestamp: Date.now(),
                durationMs: event.durationMs,
              },
              ...current,
            ].slice(0, 40);
          }
          return current.map((activity) =>
            activity.id === event.id
              ? {
                  ...activity,
                  title: event.summary || `${event.tool} finished`,
                  state: "complete" as const,
                  durationMs: event.durationMs,
                }
              : activity,
          );
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
          const duration = Math.round(monotonicNow() - turnStartedAtRef.current);
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

  const ensureAgent = useCallback(
    async (conversation: Conversation): Promise<AgentClient> => {
      const prefs = preferencesRef.current;
      const key =
        prefs.agentMode === "hermes"
          ? `hermes:${prefs.hermes.websocketUrl}:${prefs.hermes.token}`
          : "mock";

      if (!agentRef.current || agentKeyRef.current !== key) {
        unsubscribeAgentRef.current?.();
        await agentRef.current?.disconnect();
        agentRef.current =
          prefs.agentMode === "hermes"
            ? new HermesAgentClient({
                websocketUrl: prefs.hermes.websocketUrl,
                token: prefs.hermes.token,
              })
            : new MockAgentClient();
        agentKeyRef.current = key;
        openedConversationRef.current = null;
        unsubscribeAgentRef.current = agentRef.current.subscribe(handleAgentEvent);
      }

      const agent = agentRef.current;
      if (agent.connectionState !== "connected") await agent.connect();
      if (openedConversationRef.current !== conversation.id) {
        openingConversationRef.current = conversation.id;
        await agent.openSession({
          title: conversation.title,
          subtitleLanguage: prefs.subtitleLanguage,
          persistentSessionId:
            prefs.agentMode === "hermes"
              ? conversation.agent?.persistentSessionId
              : undefined,
          cwd: prefs.hermes.cwd || undefined,
        });
      }
      return agent;
    },
    [handleAgentEvent],
  );

  useEffect(() => {
    let mounted = true;
    const unsubscribeAvatar = avatarProvider.subscribe(setAvatar);

    initializationRef.current ??= (async () => {
      const storedPreferences = preferencesStore.load();
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
      ].filter(Boolean).join(" ") || null;
      return { storedPreferences, storedConversations, storageWarning };
    })();

    void initializationRef.current.then(
      ({ storedPreferences, storedConversations, storageWarning }) => {
        if (!mounted) return;
        const initialConversationId = storedConversations[0]?.id ?? null;
        preferencesRef.current = storedPreferences;
        activeConversationIdRef.current = initialConversationId;
        setPreferences(storedPreferences);
        commitConversations(storedConversations);
        setActiveConversationId(initialConversationId);
        if (storageWarning) {
          const record = classifyKanaError(storageWarning, "application", "storage");
          setLastError(record);
          setError(record.message);
        }
        setReady(true);
      },
    );

    return () => {
      mounted = false;
      unsubscribeAvatar();
      unsubscribeAgentRef.current?.();
      unsubscribeVoiceRef.current?.();
      void agentRef.current?.disconnect();
      voiceRef.current?.stop();
      for (const timer of avatarPreviewTimersRef.current) globalThis.clearTimeout(timer);
      avatarPreviewTimersRef.current = [];
      avatarProvider.unload();
    };
  }, [avatarProvider, commitConversations, conversationStore, preferencesStore]);

  const sendMessage = useCallback(
    async (text: string) => {
      const cleanText = text.trim();
      const commandMatch = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(cleanText);
      const commandName = commandMatch?.[1]?.toLowerCase().replaceAll("_", "-");
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
      if (!cleanText || (busy && !canRunWhileBusy) || !activeConversationId) return;
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
          .map((item, index) => `${index + 1}. ${item.title} — ${item.id.slice(0, 18)}`)
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
          conversation.messages.length === 0 && conversation.title === "New conversation"
            ? shortTitle(cleanText)
            : conversation.title,
        messages: [...conversation.messages, createUserMessage(cleanText)],
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
              ...(preferencesRef.current.agentMode === "hermes"
                ? {
                    agent: {
                      provider: "hermes" as const,
                      persistentSessionId: result.session.persistentSessionId,
                      status: "linked" as const,
                      relationship: "branch" as const,
                      parentConversationId: nextConversation.id,
                    },
                  }
                : {}),
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
        setStatus(wasBusy ? "Hermes is still working" : "Could not send the message");
        reportError(
          "agent",
          sendError instanceof Error ? sendError.message : "Could not send message.",
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

  const completeCommands = useCallback(
    async (input: string) => {
      const requestId = ++completionRequestRef.current;
      if (!input.startsWith("/")) {
        setCommandSuggestions([]);
        setCommandSuggestionsLoading(false);
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
      setCommandSuggestions(localSuggestions);
      setCommandSuggestionsLoading(true);
      try {
        const agent = await ensureAgent(conversation);
        const remoteSuggestions = await agent.completeCommands(input);
        const normalizedInput = input.trim().toLowerCase();
        const completingArguments = /\s$/u.test(input);
        const suggestions = [...localSuggestions, ...remoteSuggestions].filter(
          (item, index, items) => {
            const normalizedSuggestion = item.text.trim().toLowerCase();
            // Some completion surfaces echo the exact command when asked for
            // arguments. Showing that echo after Tab makes a quick Enter
            // select the same command twice instead of executing it.
            if (completingArguments && normalizedSuggestion === normalizedInput) {
              return false;
            }
            return items.findIndex(
              (candidate) => candidate.text.toLowerCase() === item.text.toLowerCase(),
            ) === index;
          },
        );
        if (completionRequestRef.current === requestId) {
          setCommandSuggestions(suggestions);
        }
      } catch {
        if (completionRequestRef.current === requestId) {
          setCommandSuggestions(localSuggestions);
        }
      } finally {
        if (completionRequestRef.current === requestId) {
          setCommandSuggestionsLoading(false);
        }
      }
    },
    [ensureAgent],
  );

  const clearCommandSuggestions = useCallback(() => {
    completionRequestRef.current += 1;
    setCommandSuggestions([]);
    setCommandSuggestionsLoading(false);
  }, []);

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
      voiceRef.current?.stop();
      unsubscribeVoiceRef.current?.();
      unsubscribeVoiceRef.current = null;
      voiceRef.current = null;
      voiceKeyRef.current = "";
      setVoiceRuntimeState("idle");
      setVoiceCanReplay(false);
      avatarController.presentEmotion("neutral");
    },
    [activeConversationId, avatarController, busy],
  );

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      const renamed = await conversationStore.rename(id, title);
      if (!renamed) return;
      commitConversations(
        conversationsRef.current.map((item) => (item.id === id ? renamed : item)),
      );
    },
    [commitConversations, conversationStore],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      if (busy) return;
      await conversationStore.delete(id);
      let remaining = conversationsRef.current.filter((item) => item.id !== id);
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

  const savePreferences = useCallback(
    async (next: KanaPreferences) => {
      next = normalizeKanaPreferences(next);
      const oldAgentKey = `${preferencesRef.current.agentMode}:${preferencesRef.current.hermes.websocketUrl}:${preferencesRef.current.hermes.token}`;
      const nextAgentKey = `${next.agentMode}:${next.hermes.websocketUrl}:${next.hermes.token}`;
      preferencesRef.current = next;
      setPreferences(next);
      preferencesStore.save(next);
      if (oldAgentKey !== nextAgentKey) {
        unsubscribeAgentRef.current?.();
        unsubscribeAgentRef.current = null;
        await agentRef.current?.disconnect();
        agentRef.current = null;
        agentKeyRef.current = "";
        openedConversationRef.current = null;
        openingConversationRef.current = null;
        turnConversationRef.current = null;
        setBusy(false);
        setPendingInput(null);
        setRespondingToInput(false);
        setStatus("Ready when you are");
        setConnectionState("disconnected");
      }
      voiceRef.current?.stop();
      setVoiceRuntimeState("idle");
      setVoiceCanReplay(false);
      unsubscribeVoiceRef.current?.();
      unsubscribeVoiceRef.current = null;
      voiceRef.current = null;
      voiceKeyRef.current = "";
      avatarKeyRef.current = "";
      await configureAvatar(next);
    },
    [configureAvatar, preferencesStore],
  );

  const exportLocalBackup = useCallback(() => {
    return serializeKanaBackup(
      createKanaBackup(preferencesRef.current, conversationsRef.current),
    );
  }, []);

  const importLocalBackup = useCallback(
    async (text: string) => {
      const backup = parseKanaBackup(text);
      const currentById = new Map(
        conversationsRef.current.map((conversation) => [conversation.id, conversation]),
      );
      for (const conversation of backup.conversations) {
        await conversationStore.save(conversation);
        currentById.set(conversation.id, conversation);
      }
      const merged = [...currentById.values()];
      commitConversations(merged);
      await savePreferences({
        ...backup.preferences,
        onboardingCompleted: true,
        hermes: {
          ...backup.preferences.hermes,
          token: preferencesRef.current.hermes.token,
        },
      });
      return {
        importedConversations: backup.conversations.length,
        totalConversations: merged.length,
      };
    },
    [commitConversations, conversationStore, savePreferences],
  );

  const connectAgent = useCallback(async () => {
    if (!activeConversationId) return;
    const conversation = conversationsRef.current.find(
      (item) => item.id === activeConversationId,
    );
    if (!conversation) return;
    setError(null);
    try {
      await ensureAgent(conversation);
      setStatus(
        preferencesRef.current.agentMode === "hermes"
          ? "Connected to Hermes"
          : "Mock agent connected",
      );
    } catch (connectError) {
      reportError(
        "agent",
        connectError instanceof Error
          ? connectError.message
          : "Could not connect to the agent.",
      );
    }
  }, [activeConversationId, ensureAgent, reportError]);

  const testAgentConnection = useCallback(async (next: KanaPreferences) => {
    if (next.agentMode === "mock") {
      const client = new MockAgentClient();
      await client.connect();
      await client.disconnect();
      return "Mock agent is ready. No external service is required.";
    }
    const client = new HermesAgentClient({
      websocketUrl: next.hermes.websocketUrl,
      token: next.hermes.token,
      reconnectDelaysMs: [],
      connectTimeoutMs: 10_000,
    });
    try {
      await client.connect();
      return "Hermes gateway.ready received. The connection is compatible.";
    } finally {
      await client.disconnect();
    }
  }, []);

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

  const abort = useCallback(async () => {
    voiceRef.current?.stop();
    setVoiceRuntimeState("idle");
    await agentRef.current?.abort();
  }, []);

  const replayVoice = useCallback(async () => {
    const voice = voiceRef.current;
    if (!voice || !voice.getSnapshot().canReplay) {
      reportError("voice", "There is no generated speech to replay yet.", "voice");
      return;
    }
    setError(null);
    try {
      await voice.replay();
    } catch (replayError) {
      if (isAbortError(replayError)) return;
      reportError("voice", replayError, "voice");
    }
  }, [reportError]);

  const stopVoice = useCallback(() => {
    voiceRef.current?.stop();
  }, []);

  const previewAvatarEmotion = useCallback(
    async (next: KanaPreferences, emotion: KanaMessage["emotion"]) => {
      if (!emotion || !(await configureAvatar(next))) return;
      avatarController.presentEmotion(emotion);
    },
    [avatarController, configureAvatar],
  );

  const previewAvatarMotion = useCallback(
    async (next: KanaPreferences, motion: string) => {
      if (!(await configureAvatar(next))) return;
      avatarController.provider.playMotion(motion);
    },
    [avatarController, configureAvatar],
  );

  const previewAvatarTalking = useCallback(
    async (next: KanaPreferences) => {
      if (!(await configureAvatar(next))) return;
      for (const timer of avatarPreviewTimersRef.current) globalThis.clearTimeout(timer);
      avatarPreviewTimersRef.current = [];
      avatarController.setTalking(true);
      avatarController.setMouthOpen(0.8);
      avatarPreviewTimersRef.current.push(
        globalThis.setTimeout(() => avatarController.setMouthOpen(0.25), 300),
        globalThis.setTimeout(() => avatarController.setMouthOpen(0.7), 520),
        globalThis.setTimeout(() => avatarController.setTalking(false), 850),
      );
    },
    [avatarController, configureAvatar],
  );

  const respondToInput = useCallback(async (response: AgentInputResponse) => {
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
        if (current.kind === "approval" || response.kind === "approval") return null;
        return current.requestId === response.requestId ? null : current;
      });
      setStatus("Input sent to Hermes");
    } catch (responseError) {
      reportError(
        "agent",
        responseError instanceof Error
          ? responseError.message
          : "Could not send input to Hermes.",
      );
    } finally {
      setRespondingToInput(false);
    }
  }, [reportError]);

  const activeConversation =
    conversations.find((item) => item.id === activeConversationId) ?? null;
  const diagnostics = useMemo(
    () =>
      serializeKanaDiagnostics({
        appVersion,
        agent: {
          mode: preferences.agentMode,
          state: connectionState,
          websocketUrl: preferences.hermes.websocketUrl,
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
          source:
            preferences.avatarMode === "mock"
              ? "mock"
              : preferences.live2d.modelId
                ? "imported-folder"
                : preferences.live2d.modelUrl === OFFICIAL_HARU_MODEL_URL
                  ? "official-sample"
                  : "hosted-url",
        },
        storage: {
          provider: "indexeddb",
          conversationCount: conversations.length,
          messageCount: conversations.reduce(
            (count, conversation) => count + conversation.messages.length,
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
    inspectHermesControl,
    startHermesControl,
    stopHermesControl,
    abort,
    replayVoice,
    stopVoice,
    previewAvatarEmotion,
    previewAvatarMotion,
    previewAvatarTalking,
    clearError: () => setError(null),
  };
}
