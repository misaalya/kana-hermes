import type { AgentCommandSuggestion } from "@/lib/agent/types";
import type { KanaPreferences } from "@/lib/preferences/types";
import type { KanaStores } from "@/lib/store/kana-stores";
import { getCopy } from "@/lib/ui/copy";
import type { ConversationService } from "./conversation-service";
import type { HermesSessionManager } from "./hermes-session-manager";
import type { ModelCatalogService } from "./model-catalog-service";
import type { PreferencesAccess } from "./preferences-service";

/** Commands Kana answers itself, listed ahead of Hermes's live catalog. */
export function kanaCommandSuggestions(locale: KanaPreferences["uiLocale"]): AgentCommandSuggestion[] {
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

function sameSuggestions(a: AgentCommandSuggestion[], b: AgentCommandSuggestion[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export type CommandServiceDependencies = {
  stores: Pick<KanaStores, "commands" | "conversations">;
  conversations: ConversationService;
  sessions: HermesSessionManager;
  preferences: PreferencesAccess;
  models: Pick<ModelCatalogService, "get">;
};

/** Slash-command menu: Kana's own commands plus Hermes completions. */
export class CommandService {
  /** Only the newest completion request may change the menu. */
  private request = 0;

  constructor(private readonly deps: CommandServiceDependencies) {}

  private get store() {
    return this.deps.stores.commands;
  }

  async complete(input: string): Promise<void> {
    const requestId = ++this.request;
    if (!input.startsWith("/")) {
      this.clearMenu();
      return;
    }
    const conversationId = this.deps.stores.conversations.getState().activeConversationId;
    const conversation = this.deps.conversations.get(conversationId);
    if (!conversation) return;

    const localSuggestions = input.includes(" ")
      ? []
      : kanaCommandSuggestions(this.deps.preferences.current().uiLocale).filter((item) =>
          item.text.startsWith(input.toLowerCase()),
        );

    // Narrow what is already on screen instead of collapsing to the short
    // local list; collapsing made the menu flip on every refresh.
    const lowerInput = input.toLowerCase();
    const current = this.store.getState().suggestions;
    const narrowed = [
      ...localSuggestions,
      ...current
        .filter((item) => item.text.toLowerCase().startsWith(lowerInput))
        .filter((item) => !localSuggestions.some((local) => local.text.toLowerCase() === item.text.toLowerCase())),
    ];
    if (!sameSuggestions(narrowed, current)) this.store.setState({ suggestions: narrowed });

    // A conversation whose Hermes session is gone cannot answer completions;
    // retrying the resume on every keystroke made the menu glitch forever.
    if (conversation.agent?.status === "missing") return;

    this.store.setState({ loading: true });
    try {
      const agent = await this.deps.sessions.ensure(conversation);
      // Model arguments come from the cached catalog, not a model.options call per keystroke.
      const models = /^\/model\s+/i.test(input) ? await this.deps.models.get() : undefined;
      const remoteSuggestions = await agent.completeCommands(input, { models });
      const normalizedInput = input.trim().toLowerCase();
      const completingArguments = /\s$/u.test(input);
      const seen = new Set<string>();
      const suggestions = [...localSuggestions, ...remoteSuggestions].filter((item) => {
        const normalized = item.text.trim().toLowerCase();
        if (completingArguments && normalized === normalizedInput) return false;
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });
      if (this.request !== requestId) return;
      if (!sameSuggestions(suggestions, this.store.getState().suggestions)) this.store.setState({ suggestions });
    } catch (completionError) {
      // A vanished Hermes session is marked instead of being retried for every
      // keystroke; the sidebar shows the "Session missing" badge.
      const message = completionError instanceof Error ? completionError.message : String(completionError);
      if (/no longer exists|session not found/i.test(message)) this.deps.conversations.markMissing(conversationId);
    } finally {
      if (this.request === requestId) this.store.setState({ loading: false });
    }
  }

  clear(): void {
    this.request += 1;
    this.clearMenu();
  }

  private clearMenu(): void {
    const state = this.store.getState();
    if (state.suggestions.length || state.loading) this.store.setState({ suggestions: [], loading: false });
  }
}
