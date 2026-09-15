import type {
  AgentClient,
  AgentCommandResult,
  AgentCommandSuggestion,
  AgentConnectionState,
  AgentEvent,
  AgentHistoryRow,
  AgentInputResponse,
  AgentModelCatalog,
  AgentSessionOptions,
} from "@/lib/agent/types";
import type { AvatarController } from "@/lib/avatar/avatar-controller";
import { DEFAULT_PREFERENCES } from "@/lib/preferences/local-preferences-store";
import type { KanaPreferences } from "@/lib/preferences/types";
import { CommandService } from "@/lib/services/command-service";
import { ConversationService, type PointerStorage } from "@/lib/services/conversation-service";
import { HermesSessionManager } from "@/lib/services/hermes-session-manager";
import { ModelCatalogService } from "@/lib/services/model-catalog-service";
import { PreferencesAccess } from "@/lib/services/preferences-service";
import { sendMessage } from "@/lib/services/send-message";
import { VoiceService } from "@/lib/services/voice-service";
import { createKanaStores } from "@/lib/store/kana-stores";
import type { VoiceProvider, VoiceSpeakOptions } from "@/lib/voice/types";

export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export function envelope(text: string, speech = "はい。") {
  return { speech_ja: speech, subtitle: { text, language: "en" }, emotion: "happy" as const };
}

export class MemoryStorage implements PointerStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

/** Records calls and lets a test emit Hermes events. */
export class FakeAgent implements AgentClient {
  readonly id = "fake-hermes";
  connectionState: AgentConnectionState = "disconnected";
  readonly opened: AgentSessionOptions[] = [];
  readonly sent: string[] = [];
  readonly queued: string[] = [];
  readonly commands: string[] = [];
  readonly responses: AgentInputResponse[] = [];
  history: AgentHistoryRow[] = [];
  commandResult: AgentCommandResult = { type: "output", output: "ok" };
  completions: AgentCommandSuggestion[] = [];
  completionError: Error | null = null;
  sendError: Error | null = null;
  respondError: Error | null = null;
  /** Session key session.opened reports; resumes report the requested key. */
  nextSessionKey = "hermes-session-1";
  private listeners = new Set<(event: AgentEvent) => void>();

  emit(event: AgentEvent) {
    for (const listener of this.listeners) listener(event);
  }
  get listenerCount() {
    return this.listeners.size;
  }
  async connect() {
    this.connectionState = "connected";
    this.emit({ type: "connection.changed", state: "connected" });
  }
  async disconnect() {
    this.connectionState = "disconnected";
  }
  async openSession(options: AgentSessionOptions) {
    this.opened.push(options);
    const persistentSessionId = options.persistentSessionId ?? this.nextSessionKey;
    const session = { sessionId: `runtime-${this.opened.length}`, persistentSessionId, resumed: Boolean(options.persistentSessionId) };
    this.emit({ type: "session.opened", ...session });
    return session;
  }
  enqueuePrompt(message: string) {
    this.queued.push(message);
  }
  async fetchHistory() {
    return { messages: this.history };
  }
  async sendMessage(input: { text: string }) {
    if (this.sendError) throw this.sendError;
    this.sent.push(input.text);
  }
  async executeCommand(input: { command: string }) {
    this.commands.push(input.command);
    return this.commandResult;
  }
  /** The catalog completeCommands received, if any. */
  completionModels: AgentModelCatalog | undefined;
  async completeCommands(_input: string, options: { models?: AgentModelCatalog } = {}) {
    this.completionModels = options.models;
    if (this.completionError) throw this.completionError;
    return this.completions;
  }
  /** Catalog model.options returns; each call is counted in modelLists. */
  models: AgentModelCatalog = { provider: "p", model: "m1", providers: [] };
  modelLists: boolean[] = [];
  async listModels(options: { refresh?: boolean } = {}) {
    this.modelLists.push(options.refresh === true);
    return this.models;
  }
  async selectModel() {
    return {} as never;
  }
  async respondToInput(response: AgentInputResponse) {
    if (this.respondError) throw this.respondError;
    this.responses.push(response);
  }
  async abort() {}
  subscribe(callback: (event: AgentEvent) => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}

export class FakeVoice implements VoiceProvider {
  readonly id = "fake-voice";
  readonly spoken: VoiceSpeakOptions[] = [];
  stops = 0;
  /** Resolve to finish the current utterance. */
  finish: () => void = () => {};
  failWith: Error | null = null;
  async inspect() {
    return { state: "ready" } as never;
  }
  async speak(options: VoiceSpeakOptions) {
    this.spoken.push(options);
    if (this.failWith) throw this.failWith;
    await new Promise<void>((resolve) => {
      this.finish = resolve;
    });
  }
  async replay() {}
  stop() {
    this.stops += 1;
    this.finish();
  }
  getSnapshot() {
    return { state: "idle" } as never;
  }
  subscribe() {
    return () => {};
  }
}

type FetchCall = { url: string; init?: RequestInit };

export function createHarness(
  options: {
    preferences?: Partial<KanaPreferences>;
    storage?: MemoryStorage;
    /** Configure each fake agent when it is created. */
    setupAgent?: (agent: FakeAgent) => void;
  } = {},
) {
  const stores = createKanaStores();
  const storage = options.storage ?? new MemoryStorage();
  let saved: KanaPreferences = { ...DEFAULT_PREFERENCES, ...options.preferences };
  const preferences = new PreferencesAccess(stores.preferences, {
    load: () => saved,
    save: (next) => {
      saved = next;
    },
    consumeWarning: () => null,
  });
  preferences.adopt(saved);
  const emotions: string[] = [];
  const avatar = { presentEmotion: (emotion = "neutral") => emotions.push(emotion) } as unknown as AvatarController;
  const voiceProvider = new FakeVoice();
  const voice = new VoiceService({
    voice: stores.voice,
    errors: stores.errors,
    avatarController: avatar,
    createProvider: () => voiceProvider,
    inspectProvider: async () => ({ status: { state: "ready" } as never }),
  });
  const fetchCalls: FetchCall[] = [];
  const fetchResponses = new Map<string, unknown>();
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    const body = [...fetchResponses.entries()].find(([prefix]) => url.startsWith(prefix))?.[1];
    return { ok: body !== undefined, json: async () => body } as Response;
  }) as typeof fetch;
  const conversations = new ConversationService({ stores, fetch: fakeFetch, pointerStorage: storage });
  const agents: FakeAgent[] = [];
  const sessions = new HermesSessionManager({
    stores,
    conversations,
    voice,
    avatar,
    preferences,
    createAgent: () => {
      const agent = new FakeAgent();
      options.setupAgent?.(agent);
      agents.push(agent);
      return agent;
    },
  });
  const models = new ModelCatalogService({
    store: stores.models,
    agentSession: stores.agentSession,
    listModels: (refresh) => sessions.listModels(refresh),
  });
  models.start();
  const commands = new CommandService({ stores, conversations, sessions, preferences, models });
  const send = (text: string) => sendMessage({ stores, conversations, sessions, preferences, models }, text);

  return {
    stores,
    storage,
    preferences,
    voice,
    voiceProvider,
    conversations,
    sessions,
    commands,
    models,
    send,
    emotions,
    fetchCalls,
    fetchResponses,
    /** The agent created by the first ensure(). */
    get agent(): FakeAgent {
      const agent = agents.at(-1);
      if (!agent) throw new Error("No agent was created yet.");
      return agent;
    },
    active() {
      const conversation = conversations.active();
      if (!conversation) throw new Error("No active conversation.");
      return conversation;
    },
    status: () => stores.agentSession.getState().status,
  };
}
