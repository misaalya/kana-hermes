import { createStore, type StoreApi } from "zustand/vanilla";
import type { AgentConnectionState, AgentInputRequest } from "@/lib/agent/types";
import { DEFAULT_PREFERENCES } from "@/lib/preferences/local-preferences-store";
import { getCopy } from "@/lib/ui/copy";

export type AgentSessionState = {
  connectionState: AgentConnectionState;
  /** A Hermes turn or a command is running. */
  busy: boolean;
  /** One-line status shown in the chat feed. */
  status: string;
  /** Approval, clarification, sudo, or secret request awaiting the user. */
  pendingInput: AgentInputRequest | null;
  respondingToInput: boolean;
  /** Runtime id of the Hermes session open on the client; Hermes scopes the active model to it. */
  openSessionId: string | null;
};

export type AgentSessionStore = StoreApi<AgentSessionState>;

export function createAgentSessionStore(): AgentSessionStore {
  return createStore<AgentSessionState>()(() => ({
    connectionState: "disconnected",
    busy: false,
    status: getCopy(DEFAULT_PREFERENCES.uiLocale).status.ready,
    pendingInput: null,
    respondingToInput: false,
    openSessionId: null,
  }));
}
