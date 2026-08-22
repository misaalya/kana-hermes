import { createId } from "@/lib/conversation/types";
import type { KanaResponse, SubtitleLanguage } from "@/lib/presentation/types";
import type {
  AgentClient,
  AgentCommandInput,
  AgentCommandResult,
  AgentCommandSuggestion,
  AgentConnectionState,
  AgentEvent,
  AgentInputRequest,
  AgentInputResponse,
  AgentMessageInput,
  AgentSession,
  AgentSessionOptions,
} from "./types";

const MOCK_COMMANDS = [
  ["/help", "Show available Hermes commands"],
  ["/new", "Start a fresh session"],
  ["/stop", "Stop background processes"],
  ["/status", "Show session and model status"],
  ["/resume", "Resume a previous session"],
  ["/sessions", "Browse previous sessions"],
  ["/model", "Show or switch the model"],
  ["/commands", "Browse all commands and skills"],
  ["/approve", "Approve a pending request"],
  ["/deny", "Deny a pending request"],
  ["/queue", "Queue a prompt for the next turn"],
  ["/steer", "Steer an active Hermes turn"],
  ["/background", "Run a prompt in the background"],
  ["/reasoning", "Configure reasoning effort"],
  ["/usage", "Show token usage"],
  ["/profile", "Show the active Hermes profile"],
  ["/title", "Show or set the session title"],
  ["/compress", "Compress conversation context"],
  ["/agents", "Show active agents and tasks"],
  ["/goal", "Set or inspect a standing goal"],
  ["/personality", "Set the Hermes personality"],
  ["/yolo", "Toggle automatic approvals"],
  ["/approvals", "Configure approval mode"],
  ["/fast", "Toggle fast processing"],
  ["/memory", "Manage memory approvals"],
  ["/bundles", "Browse skill bundles"],
  ["/reload_mcp", "Reload MCP servers"],
  ["/reload_skills", "Reload installed skills"],
] as const;

const MOCK_RESPONSES: Record<
  "ready" | "working" | "complete",
  Record<string, string>
> = {
  ready: {
    en: "I’m here. What shall we work on?",
    id: "Aku di sini. Kita mau mengerjakan apa?",
    ja: "ここにいるよ。何をしようか？",
  },
  working: {
    en: "I’ll check that carefully and keep you posted.",
    id: "Aku akan memeriksanya dengan teliti dan memberi kabar.",
    ja: "丁寧に確認して、進み具合を伝えるね。",
  },
  complete: {
    en: "All set. The mock agent flow is working from start to finish.",
    id: "Selesai. Alur agen tiruan sudah bekerja dari awal sampai akhir.",
    ja: "できたよ。モックのエージェントフローは最初から最後まで動いているよ。",
  },
};

function subtitleFor(
  key: keyof typeof MOCK_RESPONSES,
  language: SubtitleLanguage,
): { text: string; language: string } {
  const table = MOCK_RESPONSES[key];
  if (table[language]) {
    return { text: table[language], language };
  }
  return { text: table.en, language: "en" };
}

function responseFor(input: AgentMessageInput, withTool: boolean): KanaResponse {
  return {
    speech_ja: withTool
      ? "できたよ。モックのエージェントフローは最初から最後まで動いているよ。"
      : "ここにいるよ。何をしようか？",
    subtitle: subtitleFor(withTool ? "complete" : "ready", input.subtitleLanguage),
    emotion: withTool ? "happy" : "neutral",
  };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export class MockAgentClient implements AgentClient {
  readonly id = "mock";
  private listeners = new Set<(event: AgentEvent) => void>();
  private state: AgentConnectionState = "disconnected";
  private session: AgentSession | null = null;
  private turnController: AbortController | null = null;
  private readonly queuedTurns: AgentMessageInput[] = [];
  private pendingInput: {
    request: AgentInputRequest;
    resolve: () => void;
  } | null = null;

  get connectionState(): AgentConnectionState {
    return this.state;
  }

  async connect(): Promise<void> {
    this.setConnection("connecting");
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    this.setConnection("connected");
  }

  async disconnect(): Promise<void> {
    this.turnController?.abort();
    this.turnController = null;
    this.pendingInput = null;
    this.queuedTurns.length = 0;
    this.session = null;
    this.setConnection("disconnected");
  }

  async openSession(
    options: AgentSessionOptions,
  ): Promise<AgentSession> {
    if (this.state !== "connected") {
      await this.connect();
    }

    const persistentSessionId =
      options.persistentSessionId ?? createId("mock-hermes");
    this.session = {
      sessionId: createId("mock-runtime"),
      persistentSessionId,
      resumed: Boolean(options.persistentSessionId),
    };
    this.emit({ type: "session.opened", ...this.session });
    return this.session;
  }

  async sendMessage(input: AgentMessageInput): Promise<void> {
    if (!this.session) {
      throw new Error("Open a mock session before sending a message.");
    }
    if (this.turnController) {
      throw new Error("The mock agent is already responding.");
    }

    const controller = new AbortController();
    this.turnController = controller;
    void this.runTurn(input, controller);
  }

  async executeCommand(input: AgentCommandInput): Promise<AgentCommandResult> {
    if (!this.session) {
      throw new Error("Open a mock session before running a command.");
    }

    const command = input.command.trim();
    const [name = "", ...argParts] = command.replace(/^\/+/, "").split(/\s+/);
    const arg = argParts.join(" ");

    if (name === "help" || name === "commands") {
      return {
        type: "output",
        output: MOCK_COMMANDS.map(([item, description]) => `${item} — ${description}`).join("\n"),
      };
    }
    if (name === "status") {
      return {
        type: "output",
        output: "Mock Hermes status\nModel: mock/kana\nAgent running: No\nGateway: connected",
      };
    }
    if (name === "usage") {
      return { type: "output", output: "Mock usage\nInput tokens: 0\nOutput tokens: 0" };
    }
    if (name === "undo") {
      return {
        type: "prefill",
        message: "Edit the previous message here",
        notice: "Mock undo prepared the previous prompt for editing.",
      };
    }
    if (name === "branch") {
      const session = {
        sessionId: createId("mock-runtime"),
        persistentSessionId: createId("mock-hermes"),
        resumed: false,
      };
      this.session = session;
      return {
        type: "session",
        action: "branch",
        session,
        title: arg || "Conversation branch",
        output: `Mock Hermes session branched to ${arg || "Conversation branch"}.`,
      };
    }
    if (["goal", "queue", "steer", "moa", "learn", "init", "refine"].includes(name) && arg) {
      if (this.turnController) {
        this.queuedTurns.push({
          text: arg,
          subtitleLanguage: input.subtitleLanguage,
        });
        return {
          type: "output",
          output: `Mock /${name} prompt queued for the next turn.`,
        };
      }
      await this.sendMessage({ text: arg, subtitleLanguage: input.subtitleLanguage });
      return { type: "submitted", notice: `Mock /${name} submitted to Hermes.` };
    }
    return {
      type: "output",
      output: arg
        ? `Mock command /${name} accepted with: ${arg}`
        : `Mock command /${name} accepted.`,
    };
  }

  async completeCommands(input: string): Promise<AgentCommandSuggestion[]> {
    const rawQuery = input.toLowerCase();
    if (!rawQuery.startsWith("/") || /\s/u.test(rawQuery)) return [];
    const query = rawQuery.trim();
    return MOCK_COMMANDS.filter(([command, description]) =>
      command.startsWith(query) || description.toLowerCase().includes(query.slice(1)),
    ).map(([command, description]) => ({
      text: command,
      display: command,
      description,
      group: "Commands",
      kind: "command" as const,
    }));
  }

  async respondToInput(response: AgentInputResponse): Promise<void> {
    const pending = this.pendingInput;
    if (!pending || pending.request.kind !== response.kind) {
      throw new Error("No matching mock input request is pending.");
    }
    if (
      pending.request.kind !== "approval" &&
      response.kind !== "approval" &&
      pending.request.requestId !== response.requestId
    ) {
      throw new Error("The mock input request has expired.");
    }

    this.pendingInput = null;
    pending.resolve();
    this.emit({ type: "status.updated", status: "input received" });
  }

  async abort(): Promise<void> {
    this.turnController?.abort();
  }

  subscribe(callback: (event: AgentEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private async runTurn(
    input: AgentMessageInput,
    controller: AbortController,
  ): Promise<void> {
    const withTool = /(inspect|check|file|build|code|project|terminal)/i.test(
      input.text,
    );

    try {
      this.emit({ type: "agent.started" });
      this.emit({ type: "status.updated", status: "thinking" });
      await wait(420, controller.signal);
      await this.waitForMockInput(input.text, controller.signal);

      if (withTool) {
        const toolId = createId("tool");
        this.emit({
          type: "tool.started",
          id: toolId,
          tool: "project_inspect",
          kind: "tool",
          input: { query: input.text },
          summary: "Inspecting the project",
        });
        this.emit({
          type: "status.updated",
          status: "working",
          detail: subtitleFor("working", input.subtitleLanguage).text,
        });
        await wait(650, controller.signal);
        this.emit({
          type: "tool.finished",
          id: toolId,
          tool: "project_inspect",
          kind: "tool",
          output: { filesChecked: 8, result: "ok" },
          summary: "Project inspection complete",
          durationMs: 650,
        });
      }

      await wait(340, controller.signal);
      const response = responseFor(input, withTool);
      this.emit({
        type: "assistant.delta",
        text: JSON.stringify(response).slice(0, 42),
      });
      this.emit({
        type: "assistant.message",
        response,
        rawResponse: JSON.stringify(response),
      });
      this.emit({ type: "agent.finished" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        this.emit({ type: "agent.aborted" });
      } else {
        this.emit({
          type: "agent.error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (this.turnController === controller) {
        this.turnController = null;
        const queued = this.queuedTurns.shift();
        if (queued && this.session) {
          queueMicrotask(() => void this.sendMessage(queued));
        }
      }
    }
  }

  private async waitForMockInput(text: string, signal: AbortSignal): Promise<void> {
    const lower = text.toLowerCase();
    let request: AgentInputRequest | null = null;
    if (lower.includes("mock clarification")) {
      request = {
        kind: "clarification",
        requestId: createId("mock-clarify"),
        question: "Which mock path should Hermes use?",
        choices: ["Inspect only", "Inspect and continue"],
      };
    } else if (lower.includes("mock approval")) {
      request = {
        kind: "approval",
        command: "echo mock-protected-action",
        description: "Run a protected mock command",
        choices: ["once", "session", "always", "deny"],
        allowPermanent: true,
        smartDenied: false,
      };
    } else if (lower.includes("mock sudo")) {
      request = { kind: "sudo", requestId: createId("mock-sudo") };
    } else if (lower.includes("mock secret")) {
      request = {
        kind: "secret",
        requestId: createId("mock-secret"),
        envVar: "MOCK_API_KEY",
        prompt: "Enter a temporary mock API key.",
      };
    }
    if (!request) return;

    this.emit({ type: "input.requested", request });
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        if (this.pendingInput?.request === request) this.pendingInput = null;
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.pendingInput = {
        request,
        resolve: () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        },
      };
    });
  }

  private setConnection(state: AgentConnectionState, message?: string): void {
    this.state = state;
    this.emit({ type: "connection.changed", state, message });
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
