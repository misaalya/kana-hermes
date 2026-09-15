import type { AgentAttachment } from "@/lib/agent/attachments";
import { HermesAgentClient } from "@/lib/agent/hermes/hermes-agent-client";
import { AvatarController } from "@/lib/avatar/avatar-controller";
import { IndexedDbAvatarModelStore } from "@/lib/avatar/indexed-db-avatar-model-store";
import { ManagedAvatarProvider } from "@/lib/avatar/managed-avatar-provider";
import { IndexedDbStageBackgroundStore } from "@/lib/background/indexed-db-stage-background-store";
import { classifyKanaError } from "@/lib/diagnostics/safe-diagnostics";
import { LocalPreferencesStore } from "@/lib/preferences/local-preferences-store";
import type { KanaPreferences } from "@/lib/preferences/types";
import { controlHermesRuntime, inspectHermesRuntime } from "@/lib/runtime/hermes-control-client";
import { fetchSetupState, markOnboardingComplete } from "@/lib/runtime/setup-client";
import { createKanaStores, type KanaStores } from "@/lib/store/kana-stores";
import { inspectConfiguredTtsProvider } from "@/lib/voice/tts-relay-contract";
import { TtsRelayProvider } from "@/lib/voice/tts-relay-provider";
import { AvatarService } from "./avatar-service";
import { CommandService } from "./command-service";
import { ConversationService } from "./conversation-service";
import { HermesSessionManager } from "./hermes-session-manager";
import { ModelCatalogService } from "./model-catalog-service";
import { PreferencesAccess } from "./preferences-service";
import { savePreferences } from "./save-preferences";
import { sendMessage } from "./send-message";
import { WorkspaceSetup, type HermesControl } from "./workspace-setup";
import { VoiceService } from "./voice-service";

export type KanaWorkspaceActions = ReturnType<typeof createActions>;

function createActions(parts: {
  stores: KanaStores;
  preferences: PreferencesAccess;
  conversations: ConversationService;
  sessions: HermesSessionManager;
  commands: CommandService;
  models: ModelCatalogService;
  voice: VoiceService;
  avatar: AvatarService;
  setup: WorkspaceSetup;
  hermesControl: HermesControl;
  stageBackgrounds: IndexedDbStageBackgroundStore;
}) {
  const {
    stores,
    preferences,
    conversations,
    sessions,
    commands,
    models,
    voice,
    avatar,
    setup,
    hermesControl,
    stageBackgrounds,
  } = parts;
  const save = (next: KanaPreferences) =>
    savePreferences({ preferences, agentSession: stores.agentSession, voice, avatar }, next);
  return {
    send: (text: string, attachments?: AgentAttachment[]) =>
      sendMessage({ stores, conversations, sessions, preferences, models }, text, attachments),
    savePreferences: save,
    async completeOnboarding(next: KanaPreferences) {
      // Server flag first: it is the source other browsers read.
      await markOnboardingComplete();
      await save({ ...next, onboardingCompleted: true });
      stores.workspace.setState({ wizardMode: null });
    },
    abort: () => sessions.abort(),
    respondToInput: (response: Parameters<HermesSessionManager["respondToInput"]>[0]) =>
      sessions.respondToInput(response),
    listAgentModels: (refresh?: boolean) => models.list(refresh),
    async selectAgentModel(provider: string, model: string, confirm?: boolean) {
      const result = await sessions.selectModel(provider, model, confirm);
      if (!result.confirmationRequired) models.invalidate();
      return result;
    },
    createConversation: () => sessions.createConversation(),
    selectConversation: (id: string) => sessions.selectConversation(id),
    renameConversation: (id: string, title: string) => sessions.renameConversation(id, title),
    deleteConversation: (id: string) => sessions.deleteConversation(id),
    adoptHermesSession: (entry: Parameters<HermesSessionManager["adoptHermesSession"]>[0]) =>
      sessions.adoptHermesSession(entry),
    completeCommands: (input: string) => commands.complete(input),
    clearCommandSuggestions: () => commands.clear(),
    unlockVoice: () => voice.unlock(),
    attachAvatarCanvas: (canvas: HTMLCanvasElement | null) => avatar.attachCanvas(canvas),
    importAvatarFiles: (files: File[]) => avatar.importFiles(files),
    listAvatarModels: () => avatar.listModels(),
    inspectAvatarModel: (id: string) => avatar.inspectModel(id),
    selectAvatarModel: (id: string) => avatar.selectModel(id),
    renameAvatarModel: (id: string, name: string) => avatar.renameModel(id, name),
    deleteAvatarModel: (id: string) => avatar.deleteModel(id),
    previewAvatarEmotion: (next: KanaPreferences, emotion: Parameters<AvatarService["previewEmotion"]>[1]) =>
      avatar.previewEmotion(next, emotion),
    previewAvatarTalking: (next: KanaPreferences) => avatar.previewTalking(next),
    importStageBackground: (file: File) => stageBackgrounds.import(file),
    listStageBackgrounds: () => stageBackgrounds.list(),
    loadStageBackground: (id: string) => stageBackgrounds.load(id),
    deleteStageBackground: (id: string) => stageBackgrounds.delete(id),
    inspectHermesControl: (preferredPort?: number) => hermesControl.inspect(preferredPort),
    startHermesControl: (options: { port?: number; restart?: boolean } = {}) => hermesControl.start(options),
    stopHermesControl: () => hermesControl.stop(),
    connectHermes: () => setup.connectHermes(),
    dismissConnectionGate: () => setup.dismissGate(),
    inspectDependencies: () => setup.inspectDependencies(),
    clearError: () => stores.errors.getState().clear(),
  };
}

/**
 * Everything one mounted Kana workspace needs: its stores and the services
 * that change them. Each concern keeps its own service; this only wires them.
 */
export type KanaWorkspace = {
  stores: KanaStores;
  preferences: PreferencesAccess;
  conversations: ConversationService;
  sessions: HermesSessionManager;
  commands: CommandService;
  models: ModelCatalogService;
  voice: VoiceService;
  avatar: AvatarService;
  setup: WorkspaceSetup;
  hermesControl: HermesControl;
  stageBackgrounds: IndexedDbStageBackgroundStore;
  /** Stable callbacks for components; identities never change for this workspace. */
  actions: KanaWorkspaceActions;
  /** Load local state and follow the open session. Safe to call again after dispose. */
  start(): void;
  dispose(): void;
};

export function createKanaWorkspace(): KanaWorkspace {
  const stores = createKanaStores();
  const preferences = new PreferencesAccess(stores.preferences, new LocalPreferencesStore());
  const avatarProvider = new ManagedAvatarProvider();
  const avatarController = new AvatarController(avatarProvider);
  const voice = new VoiceService({
    voice: stores.voice,
    errors: stores.errors,
    avatarController,
    createProvider: (controller) => new TtsRelayProvider({}, controller),
    inspectProvider: inspectConfiguredTtsProvider,
  });
  const avatar = new AvatarService({
    avatar: stores.avatar,
    errors: stores.errors,
    preferences,
    provider: avatarProvider,
    controller: avatarController,
    models: new IndexedDbAvatarModelStore(),
  });
  const conversations = new ConversationService({ stores, fetch: (...args) => fetch(...args) });
  const sessions = new HermesSessionManager({
    stores,
    conversations,
    voice,
    avatar: avatarController,
    preferences,
    createAgent: () => new HermesAgentClient(),
  });
  const models = new ModelCatalogService({
    store: stores.models,
    agentSession: stores.agentSession,
    listModels: (refresh) => sessions.listModels(refresh),
  });
  const commands = new CommandService({ stores, conversations, sessions, preferences, models });
  const hermesControl: HermesControl = {
    inspect: (preferredPort) => inspectHermesRuntime(preferredPort),
    start: (options = {}) =>
      controlHermesRuntime({ action: options.restart ? "restart" : "start", port: options.port }),
    stop: () => controlHermesRuntime({ action: "stop" }),
  };
  const setup = new WorkspaceSetup({
    workspace: stores.workspace,
    agentSession: stores.agentSession,
    preferences,
    hermesControl,
    inspectVoice: () => voice.inspect(),
    connect: () => sessions.connect(),
    fetchSetupState,
    sessionStorage: typeof window === "undefined" ? undefined : window.sessionStorage,
    settle: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  const stageBackgrounds = new IndexedDbStageBackgroundStore();
  const parts = {
    stores,
    preferences,
    conversations,
    sessions,
    commands,
    models,
    voice,
    avatar,
    setup,
    hermesControl,
    stageBackgrounds,
  };

  let started = false;

  return {
    ...parts,
    actions: createActions(parts),
    start() {
      avatar.start();
      if (!started) {
        started = true;
        preferences.adopt(preferences.load());
        conversations.initialize();
        const warning = preferences.consumeWarning();
        if (warning) {
          const record = classifyKanaError(warning, "application", "storage");
          stores.errors.setState({ lastError: record, error: record.message });
        }
        stores.conversations.setState({ ready: true });
      }
      conversations.start();
      models.start();
    },
    dispose() {
      setup.stop();
      commands.clear();
      models.dispose();
      voice.dispose();
      sessions.dispose();
      conversations.dispose();
      avatar.dispose();
    },
  };
}
