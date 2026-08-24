import type { KanaResponse, SubtitleLanguage } from "@/lib/presentation/types";

export type AgentConnectionState =
  | "idle"
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "authentication_failed"
  | "incompatible"
  | "error";

export type AgentToolKind = "tool" | "command" | "file";

export type AgentActivityState = "running" | "complete" | "attention";

/** One Hermes tool/input event inside a turn, rendered in the live-chat feed. */
export type ActivityItem = {
  id: string;
  tool?: string;
  kind: AgentToolKind | "status" | "input";
  title: string;
  detail?: string;
  state: AgentActivityState;
  timestamp: number;
  durationMs?: number;
};

export type AgentInputRequestKind =
  | "approval"
  | "clarification"
  | "sudo"
  | "secret";

export type AgentInputRequest =
  | {
      kind: "approval";
      command: string;
      description: string;
      choices?: string[];
      allowPermanent: boolean;
      smartDenied: boolean;
    }
  | {
      kind: "clarification";
      requestId: string;
      question: string;
      choices: string[] | null;
    }
  | {
      kind: "sudo";
      requestId: string;
    }
  | {
      kind: "secret";
      requestId: string;
      envVar: string;
      prompt: string;
    };

export type AgentInputResponse =
  | {
      kind: "approval";
      choice: string;
      all?: boolean;
    }
  | {
      kind: "clarification";
      requestId: string;
      answer: string;
    }
  | {
      kind: "sudo";
      requestId: string;
      password: string;
    }
  | {
      kind: "secret";
      requestId: string;
      value: string;
    };

export type AgentEvent =
  | {
      type: "connection.changed";
      state: AgentConnectionState;
      message?: string;
      retryAttempt?: number;
      retryAt?: number;
    }
  | {
      type: "session.opened";
      sessionId: string;
      persistentSessionId: string;
      resumed: boolean;
    }
  | {
      type: "session.updated";
      title?: string;
      persistentSessionId?: string;
    }
  | { type: "agent.started" }
  | { type: "assistant.delta"; text: string }
  | {
      type: "assistant.message";
      response: KanaResponse;
      rawResponse: string;
    }
  | {
      type: "tool.started";
      id: string;
      tool: string;
      kind: AgentToolKind;
      input?: unknown;
      summary?: string;
    }
  | {
      type: "tool.progress";
      id?: string;
      tool?: string;
      message?: string;
      detail?: unknown;
    }
  | {
      type: "tool.finished";
      id: string;
      tool: string;
      kind: AgentToolKind;
      output?: unknown;
      summary?: string;
      durationMs?: number;
    }
  | { type: "status.updated"; status: string; detail?: string }
  | {
      type: "input.requested";
      request: AgentInputRequest;
    }
  | {
      type: "input.expired";
      kind: "sudo" | "secret";
      requestId: string;
    }
  | { type: "agent.finished" }
  | { type: "agent.aborted" }
  | { type: "agent.error"; message: string; rawResponse?: string };

export type AgentSessionOptions = {
  title?: string;
  subtitleLanguage: SubtitleLanguage;
  persistentSessionId?: string;
  cwd?: string;
};

export type AgentMessageInput = {
  text: string;
  subtitleLanguage: SubtitleLanguage;
};

export type AgentCommandSuggestion = {
  text: string;
  display: string;
  description?: string;
  group?: string;
  kind: "command" | "skill";
  availability?: "available" | "unavailable";
  unavailableReason?: string;
};

export type AgentCommandInput = {
  command: string;
  subtitleLanguage: SubtitleLanguage;
};

export type AgentCommandResult =
  | {
      type: "output";
      output: string;
      warning?: string;
    }
  | {
      type: "submitted";
      notice?: string;
      display?: string;
    }
  | {
      type: "prefill";
      message: string;
      notice?: string;
    }
  | {
      type: "session";
      action: "branch";
      session: AgentSession;
      title: string;
      output: string;
    };

export type AgentSession = {
  sessionId: string;
  persistentSessionId: string;
  resumed: boolean;
};

export interface AgentClient {
  readonly id: string;
  readonly connectionState: AgentConnectionState;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  openSession(options: AgentSessionOptions): Promise<AgentSession>;
  /**
   * Queue a plain message while a turn is running; it is submitted
   * automatically when the current turn completes (Telegram-parity).
   */
  enqueuePrompt(message: string, subtitleLanguage: string): void;
  /**
   * Fetch the persisted transcript of a stored Hermes session
   * (session.history relayed server-side).
   */
  fetchHistory(hermesSessionKey: string): Promise<{
    messages?: Array<{
      role: string;
      text?: string;
      name?: string;
      context?: string;
      timestamp?: number;
    }>;
  }>;
  sendMessage(input: AgentMessageInput): Promise<void>;
  executeCommand(input: AgentCommandInput): Promise<AgentCommandResult>;
  completeCommands(input: string): Promise<AgentCommandSuggestion[]>;
  respondToInput(response: AgentInputResponse): Promise<void>;
  abort(): Promise<void>;
  subscribe(callback: (event: AgentEvent) => void): () => void;
}
