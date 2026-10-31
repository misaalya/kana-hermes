import { createStore, type StoreApi } from "zustand/vanilla";
import type { AgentCommandSuggestion } from "@/lib/agent/types";

export type CommandState = {
  suggestions: AgentCommandSuggestion[];
  loading: boolean;
  /** Normalized command names that Hermes says need an argument, with their usage hint. */
  requiredArguments: Record<string, string>;
};

export type CommandStore = StoreApi<CommandState>;

export function createCommandStore(): CommandStore {
  return createStore<CommandState>()(() => ({
    suggestions: [],
    loading: false,
    requiredArguments: {},
  }));
}
