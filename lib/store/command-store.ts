import { createStore, type StoreApi } from "zustand/vanilla";
import type { AgentCommandSuggestion } from "@/lib/agent/types";

export type CommandState = {
  suggestions: AgentCommandSuggestion[];
  loading: boolean;
};

export type CommandStore = StoreApi<CommandState>;

export function createCommandStore(): CommandStore {
  return createStore<CommandState>()(() => ({
    suggestions: [],
    loading: false,
  }));
}
