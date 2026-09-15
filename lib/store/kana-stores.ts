import { createActivityStore, type ActivityStore } from "./activity-store";
import { createAgentSessionStore, type AgentSessionStore } from "./agent-session-store";
import { createAvatarStore, type AvatarStore } from "./avatar-store";
import { createCommandStore, type CommandStore } from "./command-store";
import { createConversationStore, type ConversationStateStore } from "./conversation-store";
import { createErrorStore, type ErrorStore } from "./error-store";
import { createModelCatalogStore, type ModelCatalogStore } from "./model-catalog-store";
import { createPreferencesStore, type PreferencesStore } from "./preferences-store";
import { createVoiceStore, type VoiceStore } from "./voice-store";
import { createWorkspaceStore, type WorkspaceStore } from "./workspace-store";

/**
 * One set of stores per mounted workspace. Stores are never module singletons:
 * two workspaces (or a remount) never share conversation or session state.
 */
export type KanaStores = {
  preferences: PreferencesStore;
  conversations: ConversationStateStore;
  agentSession: AgentSessionStore;
  activity: ActivityStore;
  commands: CommandStore;
  errors: ErrorStore;
  models: ModelCatalogStore;
  voice: VoiceStore;
  avatar: AvatarStore;
  workspace: WorkspaceStore;
};

export function createKanaStores(): KanaStores {
  return {
    preferences: createPreferencesStore(),
    conversations: createConversationStore(),
    agentSession: createAgentSessionStore(),
    activity: createActivityStore(),
    commands: createCommandStore(),
    errors: createErrorStore(),
    models: createModelCatalogStore(),
    voice: createVoiceStore(),
    avatar: createAvatarStore(),
    workspace: createWorkspaceStore(),
  };
}
