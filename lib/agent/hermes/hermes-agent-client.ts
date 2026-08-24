import { classifyHermesTool } from "@/lib/agent/tool-kind";
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
} from "@/lib/agent/types";
import { buildKanaSystemPrompt, buildKanaUserPrompt } from "@/lib/presentation/persona";
import {
  KanaProtocolError,
  parseKanaResponse,
} from "@/lib/presentation/response-parser";
import type {
  HermesCommandDispatch,
  HermesCompletionResponse,
  HermesCommandsCatalogResponse,
  HermesGatewayEvent,
  HermesJsonRpcFrame,
  HermesSessionResponse,
  HermesSlashExecResponse,
  HermesToolPayload,
} from "./gateway-types";
import {
  kanaUnavailableMessage,
  kanaUnavailableReason,
} from "./kana-command-surface";

// Kana's agent client, relayed through the Kana server.
//
// The browser never dials `hermes serve` and never holds its session token.
// Requests go to POST /api/hermes/rpc (same-origin, Kana session cookie) and
// gateway events arrive on the /api/hermes/events SSE stream. The Kana server
// owns the single upstream WebSocket and the credential.

type HermesRelayOptions = {
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
  reconnectDelaysMs?: readonly number[];
};

const DEFAULT_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;

function inputRequest(
  type: string,
  payload: Record<string, unknown>,
): AgentInputRequest | null {
  if (type === "approval.request") {
    return {
      kind: "approval",
      command: typeof payload.command === "string" ? payload.command : "",
      description:
        typeof payload.description === "string"
          ? payload.description
          : "Hermes requested permission for a protected action.",
      choices: Array.isArray(payload.choices)
        ? payload.choices.filter((choice): choice is string => typeof choice === "string")
        : undefined,
      allowPermanent: payload.allow_permanent !== false,
      smartDenied: payload.smart_denied === true,
    };
  }
  if (type === "clarify.request") {
    if (
      typeof payload.request_id !== "string" ||
      typeof payload.question !== "string"
    ) {
      return null;
    }
    return {
      kind: "clarification",
      requestId: payload.request_id,
      question: payload.question,
      choices: Array.isArray(payload.choices)
        ? payload.choices.filter((choice): choice is string => typeof choice === "string")
        : null,
    };
  }
  if (type === "sudo.request" && typeof payload.request_id === "string") {
    return { kind: "sudo", requestId: payload.request_id };
  }
  if (type === "secret.request" && typeof payload.request_id === "string") {
    return {
      kind: "secret",
      requestId: payload.request_id,
      envVar: typeof payload.env_var === "string" ? payload.env_var : "",
      prompt: typeof payload.prompt === "string" ? payload.prompt : "",
    };
  }
  return null;
}

async function relayRpc<T>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 120_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api/hermes/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    const value = (await response.json()) as { result?: T; error?: string };
    if (!response.ok || value.error) {
      throw new Error(value.error || `Hermes relay failed (${response.status}).`);
    }
    return value.result as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Hermes request timed out: ${method}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class HermesAgentClient implements AgentClient {
  readonly id = "hermes-relay";
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private state: AgentConnectionState = "disconnected";
  private eventSource: EventSource | null = null;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private connectedOnce = false;
  private session: AgentSession | null = null;
  private sessionOptions: AgentSessionOptions | null = null;
  private expectedSubtitleLanguage = "en";
  private intentionallyClosing = false;
  private running = false;
  private recoveringTurn = false;
  private readonly queuedPrompts: Array<{
    message: string;
    subtitleLanguage: string;
  }> = [];

  constructor(private readonly options: HermesRelayOptions = {}) {}

  get connectionState(): AgentConnectionState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.state === "connected") return;
    if (this.connectPromise) return this.connectPromise;

    this.cancelReconnect();
    this.intentionallyClosing = false;
    const reconnecting = this.connectedOnce || this.state === "reconnecting";
    this.setConnection(reconnecting ? "reconnecting" : "connecting");

    const connectPromise = (async () => {
      // The SSE "gateway" event already reports upstream reachability: the
      // relay connects to hermes serve server-side before confirming. No
      // extra RPC probe is needed to establish the connection.
      await this.openEventStream();

      this.connectedOnce = true;
      this.reconnectAttempt = 0;
      this.setConnection("connected");
    })();

    this.connectPromise = connectPromise.finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private openEventStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof EventSource === "undefined") {
        reject(new Error("The Hermes relay requires an EventSource implementation."));
        return;
      }
      const source = new EventSource("/api/hermes/events", { withCredentials: true });
      this.eventSource = source;

      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for the Hermes event stream."));
        this.closeEventStream();
      }, this.options.connectTimeoutMs ?? 15_000);

      const onGateway = (event: MessageEvent) => {
        try {
          const value = JSON.parse(event.data) as { connected?: boolean; message?: string };
          if (value.connected) {
            clearTimeout(timeout);
            resolve();
          } else if (!this.connectedOnce) {
            clearTimeout(timeout);
            reject(new Error(value.message || "The Hermes gateway is unreachable through the Kana relay."));
          }
        } catch {
          /* ignore malformed gateway status */
        }
      };
      const onHermes = (event: MessageEvent) => {
        try {
          const frame = JSON.parse(event.data) as HermesJsonRpcFrame;
          if (frame?.method === "event" && frame.params?.type === "gateway.ready") {
            clearTimeout(timeout);
            if (!this.connectedOnce) resolve();
          }
          if (frame) this.handleFrame(frame);
        } catch {
          /* ignore malformed frames */
        }
      };

      source.addEventListener("gateway", onGateway as EventListener);
      source.addEventListener("hermes", onHermes as EventListener);
      source.addEventListener("open", () => {
        // The relay accepted the stream; wait for the gateway status before
        // resolving a first connection.
      });
      source.addEventListener("error", () => {
        clearTimeout(timeout);
        if (this.intentionallyClosing) {
          this.setConnection("disconnected");
          resolve();
          return;
        }
        this.closeEventStream();
        const detail = "Hermes relay stream closed.";
        if (!this.connectedOnce) {
          reject(new Error(detail));
        } else {
          this.recoveringTurn = this.running;
          this.running = false;
          this.rejectPending(new Error("Hermes gateway disconnected."));
          this.scheduleReconnect(detail);
          reject(new Error(detail));
        }
      });
    });
  }

  private closeEventStream(): void {
    if (!this.eventSource) return;
    const source = this.eventSource;
    this.eventSource = null;
    try {
      source.close();
    } catch {
      // The stream may already be dead.
    }
  }

  async disconnect(): Promise<void> {
    this.intentionallyClosing = true;
    this.cancelReconnect();
    this.session = null;
    this.sessionOptions = null;
    this.running = false;
    this.recoveringTurn = false;
    this.connectedOnce = false;
    this.reconnectAttempt = 0;
    this.queuedPrompts.length = 0;
    this.closeEventStream();
    this.rejectPending(new Error("Kana disconnected from Hermes."));
    this.setConnection("disconnected");
  }

  async openSession(options: AgentSessionOptions): Promise<AgentSession> {
    if (this.state !== "connected") {
      await this.connect();
    }
    this.expectedSubtitleLanguage = options.subtitleLanguage;

    let response: HermesSessionResponse;
    if (options.persistentSessionId) {
      try {
        response = await this.request<HermesSessionResponse>("session.resume", {
          session_id: options.persistentSessionId,
          source: "kana",
          close_on_disconnect: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/session not found/i.test(message)) {
          throw new Error(
            "This Kana conversation points to a Hermes session that no longer exists. Start /new to create a fresh Hermes session; Kana will not silently replace the missing history.",
          );
        }
        throw error;
      }
    } else {
      response = await this.request<HermesSessionResponse>("session.create", {
        title: options.title,
        source: "kana",
        close_on_disconnect: false,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        // Best-effort: the gateway currently ignores client-seeded system
        // messages, so the binding contract rides on each user prompt
        // (see buildKanaUserPrompt).
        messages: [
          {
            role: "system",
            content: buildKanaSystemPrompt(options.subtitleLanguage),
          },
        ],
      });
    }

    const persistentSessionId =
      response.stored_session_id ??
      response.session_key ??
      response.resumed ??
      options.persistentSessionId ??
      response.session_id;

    this.session = {
      sessionId: response.session_id,
      persistentSessionId,
      resumed: Boolean(options.persistentSessionId),
    };
    this.sessionOptions = {
      ...options,
      persistentSessionId,
      subtitleLanguage: options.subtitleLanguage,
    };
    this.emit({ type: "session.opened", ...this.session });
    if (options.persistentSessionId) {
      try {
        const title = await this.request<{ title?: string }>("session.title", {
          session_id: this.session.sessionId,
        });
        if (title.title) {
          this.emit({
            type: "session.updated",
            title: title.title,
            persistentSessionId,
          });
        }
      } catch {
        // Title synchronization is non-critical; the resumed session itself is
        // already usable and future session.title events still update Kana.
      }
    }
    this.recoverResumedTurn(response);
    // Plan B contract enforcement: the gateway ignores client-seeded system
    // messages, so the Kana persona rides on Hermes's personality-overlay
    // mechanism instead. The "kana" personality is defined once in the user's
    // config.yaml (agent.personalities.kana); applying it here sets the
    // agent's ephemeral_system_prompt for this session, which Hermes appends
    // to the system prompt at every API call. Best-effort: if it fails (older
    // gateway, missing personality), the per-turn user prompt metadata and
    // the graceful parser degradation still carry the UX.
    void this.request("config.set", {
      key: "personality",
      value: "kana",
      session_id: this.session.sessionId,
    }).catch(() => {});
    return this.session;
  }

  async sendMessage(input: AgentMessageInput): Promise<void> {
    if (!this.session) {
      throw new Error("Open a Hermes session before sending a message.");
    }

    await this.submitPrompt(input.text, input.subtitleLanguage);
  }

  async executeCommand(input: AgentCommandInput): Promise<AgentCommandResult> {
    if (!this.session) {
      throw new Error("Open a Hermes session before running a command.");
    }

    return this.executeCommandInternal(input, 0);
  }

  async completeCommands(input: string): Promise<AgentCommandSuggestion[]> {
    if (this.state !== "connected" || !input.startsWith("/")) return [];

    if (input === "/") {
      const catalog = await this.request<HermesCommandsCatalogResponse>(
        "commands.catalog",
        this.session ? { session_id: this.session.sessionId } : {},
      );
      return this.catalogSuggestions(catalog);
    }

    const response = await this.request<HermesCompletionResponse>(
      "complete.slash",
      { text: input },
    );

    const replaceFrom = response.replace_from ?? 1;
    const completingArgument = replaceFrom > 1;
    const prefix = completingArgument ? input.slice(0, replaceFrom) : "";

    return (response.items ?? []).map((item) => {
      const display = String(item.display || item.text || "").trim();
      const rawText = String(item.text || display).trim();
      const commandText = completingArgument
        ? `${prefix}${rawText}`
        : rawText.startsWith("/")
          ? rawText
          : `/${rawText.replace(/^\/+/, "")}`;
      return {
        text: commandText,
        display: display || commandText,
        description:
          !completingArgument && kanaUnavailableMessage(commandText)
            ? kanaUnavailableMessage(commandText) ?? undefined
            : item.meta
              ? String(item.meta)
              : undefined,
        group:
          !completingArgument && kanaUnavailableReason(commandText)
            ? "Unavailable in Kana"
            : completingArgument
              ? "Options"
              : item.kind === "skill"
                ? "Skills"
                : "Commands",
        kind: item.kind === "skill" ? "skill" : "command",
        availability:
          !completingArgument && kanaUnavailableReason(commandText)
            ? "unavailable"
            : "available",
        unavailableReason:
          !completingArgument && kanaUnavailableMessage(commandText)
            ? kanaUnavailableMessage(commandText) ?? undefined
            : undefined,
      };
    });
  }

  async respondToInput(response: AgentInputResponse): Promise<void> {
    if (!this.session) {
      throw new Error("Open a Hermes session before responding to input.");
    }

    if (response.kind === "approval") {
      await this.request("approval.respond", {
        session_id: this.session.sessionId,
        choice: response.choice,
        all: response.all ?? false,
      });
      return;
    }
    if (response.kind === "clarification") {
      await this.request("clarify.respond", {
        request_id: response.requestId,
        answer: response.answer,
      });
      return;
    }
    if (response.kind === "sudo") {
      await this.request("sudo.respond", {
        request_id: response.requestId,
        password: response.password,
      });
      return;
    }
    await this.request("secret.respond", {
      request_id: response.requestId,
      value: response.value,
    });
  }

  private catalogSuggestions(
    catalog: HermesCommandsCatalogResponse,
  ): AgentCommandSuggestion[] {
    const suggestions: AgentCommandSuggestion[] = [];
    const categorized = new Set<string>();
    const skillNames = new Set(
      Object.keys(catalog.skills ?? {}).map((name) => name.toLowerCase()),
    );

    for (const category of catalog.categories ?? []) {
      for (const [text, description] of category.pairs ?? []) {
        const unavailable = kanaUnavailableMessage(text);
        categorized.add(text.toLowerCase());
        suggestions.push({
          text,
          display: text,
          description: unavailable || description,
          group: unavailable ? "Unavailable in Kana" : category.name || "Commands",
          kind: skillNames.has(text.toLowerCase()) ? "skill" : "command",
          availability: unavailable ? "unavailable" : "available",
          unavailableReason: unavailable || undefined,
        });
      }
    }

    for (const [text, description] of catalog.pairs ?? []) {
      if (categorized.has(text.toLowerCase())) continue;
      const unavailable = kanaUnavailableMessage(text);
      suggestions.push({
        text,
        display: text,
        description: unavailable || description,
        group: unavailable
          ? "Unavailable in Kana"
          : skillNames.has(text.toLowerCase())
            ? "Skills"
            : "Commands",
        kind: skillNames.has(text.toLowerCase()) ? "skill" : "command",
        availability: unavailable ? "unavailable" : "available",
        unavailableReason: unavailable || undefined,
      });
    }

    return suggestions;
  }

  async abort(): Promise<void> {
    if (!this.session || this.state !== "connected") return;
    await this.request("session.interrupt", {
      session_id: this.session.sessionId,
    });
  }

  subscribe(callback: (event: AgentEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private async executeCommandInternal(
    input: AgentCommandInput,
    depth: number,
  ): Promise<AgentCommandResult> {
    if (!this.session) {
      throw new Error("Open a Hermes session before running a command.");
    }
    if (depth > 4) {
      throw new Error("Hermes command alias chain is too deep.");
    }

    const command = input.command.trim().replace(/^\/+/, "");
    const [rawName = "", ...argParts] = command.split(/\s+/);
    const name = rawName.toLowerCase().replaceAll("_", "-");
    const arg = argParts.join(" ");

    const unavailableMessage = kanaUnavailableMessage(name);
    if (unavailableMessage) {
      return { type: "output", output: unavailableMessage };
    }

    if (name === "approve" || name === "deny") {
      const requestedChoice = arg.toLowerCase().split(/\s+/, 1)[0] ?? "";
      const choice =
        name === "deny"
          ? "deny"
          : ["once", "session", "always"].includes(requestedChoice)
            ? requestedChoice
            : "once";
      const response = await this.request<{ resolved?: boolean }>(
        "approval.respond",
        {
          session_id: this.session.sessionId,
          choice,
          all: /(^|\s)all($|\s)/i.test(arg),
        },
      );
      return {
        type: "output",
        output: response.resolved
          ? `${name === "deny" ? "Denied" : "Approved"} pending Hermes request.`
          : "No pending Hermes approval was found.",
      };
    }

    if (name === "title") {
      const response = await this.request<{ title?: string; pending?: boolean }>(
        "session.title",
        {
          session_id: this.session.sessionId,
          ...(arg ? { title: arg } : {}),
        },
      );
      return {
        type: "output",
        output: arg
          ? `Session title set: ${response.title || arg}${response.pending ? " (pending)" : ""}`
          : response.title
            ? `Session title: ${response.title}`
            : "No session title is set.",
      };
    }

    if (name === "branch") {
      const response = await this.request<{
        session_id?: string;
        stored_session_id?: string;
        title?: string;
      }>("session.branch", {
        session_id: this.session.sessionId,
        ...(arg ? { name: arg } : {}),
      });
      if (!response.session_id || !response.stored_session_id) {
        throw new Error("Hermes returned an invalid branch session.");
      }
      this.session = {
        sessionId: response.session_id,
        persistentSessionId: response.stored_session_id,
        resumed: false,
      };
      return {
        type: "session",
        action: "branch",
        session: this.session,
        title: response.title || arg || "Conversation branch",
        output: `Branched Hermes session to ${response.title || arg || "a new branch"}.`,
      };
    }

    if (name === "save") {
      const response = await this.request<{ file?: string }>("session.save", {
        session_id: this.session.sessionId,
      });
      return {
        type: "output",
        output: response.file
          ? `Saved the Hermes conversation to ${response.file}`
          : "Hermes saved the conversation.",
      };
    }

    if (name === "status") {
      const response = await this.request<{ output?: string }>("session.status", {
        session_id: this.session.sessionId,
      });
      return {
        type: "output",
        output: response.output || "Hermes did not return session status.",
      };
    }

    if (name === "compress" || name === "compact") {
      const response = await this.request<{
        status?: string;
        removed?: number;
        summary?: {
          headline?: string;
          token_line?: string;
          note?: string;
          aborted?: boolean;
        };
        host_ack?: { output?: string };
      }>(
        "session.compress",
        {
          session_id: this.session.sessionId,
          ...(arg ? { focus_topic: arg } : {}),
        },
        180_000,
      );
      const summary = response.summary;
      const lines = [summary?.headline, summary?.token_line, summary?.note].filter(
        (line): line is string => Boolean(line),
      );
      return {
        type: "output",
        output:
          lines.join("\n") ||
          response.host_ack?.output ||
          (response.status === "aborted" || summary?.aborted
            ? "Hermes compression was aborted."
            : typeof response.removed === "number" && response.removed > 0
              ? `Compressed ${response.removed} Hermes history messages.`
              : "Hermes found nothing to compress."),
      };
    }

    if (name === "steer") {
      if (!arg) {
        return { type: "output", output: "Usage: /steer <message>" };
      }
      const response = await this.request<{ status?: string }>("session.steer", {
        session_id: this.session.sessionId,
        text: arg,
      });
      return {
        type: "output",
        output:
          response.status === "queued"
            ? "Steering message queued after the next Hermes tool call."
            : `Hermes steer status: ${response.status || "unknown"}`,
      };
    }

    if (name === "handoff") {
      const platform = arg.toLowerCase().split(/\s+/, 1)[0] ?? "";
      if (!platform) {
        return {
          type: "output",
          output: "Usage: /handoff <telegram|discord|slack|matrix|whatsapp|signal>",
        };
      }
      const response = await this.request<{
        queued?: boolean;
        platform?: string;
        home_name?: string;
      }>("handoff.request", {
        session_id: this.session.sessionId,
        platform,
      });
      return {
        type: "output",
        output: response.queued
          ? `Hermes handoff to ${response.platform || platform} queued${response.home_name ? ` for ${response.home_name}` : ""}. The separate messaging gateway will complete it.`
          : `Hermes did not queue the ${platform} handoff.`,
      };
    }

    if (name === "help" || name === "commands") {
      const catalog = await this.request<HermesCommandsCatalogResponse>(
        "commands.catalog",
        { session_id: this.session.sessionId },
      );
      const sections = new Map<string, string[]>();
      for (const suggestion of this.catalogSuggestions(catalog)) {
        const group = suggestion.group || "Commands";
        const lines = sections.get(group) ?? [];
        lines.push(
          `${suggestion.text}${suggestion.description ? ` — ${suggestion.description}` : ""}`,
        );
        sections.set(group, lines);
      }
      const output = [...sections]
        .map(([group, lines]) => `${group}\n${lines.join("\n")}`)
        .join("\n\n");
      return {
        type: "output",
        output: output || "Hermes did not report any available commands.",
        warning: catalog.warning || undefined,
      };
    }

    let raw: HermesSlashExecResponse;
    try {
      raw = await this.request<HermesSlashExecResponse>("slash.exec", {
        session_id: this.session.sessionId,
        command,
      });
    } catch (slashError) {
      try {
        raw = await this.request<HermesSlashExecResponse>("command.dispatch", {
          session_id: this.session.sessionId,
          name,
          arg,
        });
      } catch (dispatchError) {
        const dispatchMessage =
          dispatchError instanceof Error ? dispatchError.message : String(dispatchError);
        if (/not a quick\/plugin\/(?:bundle\/)?skill command/i.test(dispatchMessage)) {
          throw slashError;
        }
        throw dispatchError;
      }
    }

    return this.resolveCommandResponse(raw, input, arg, depth);
  }

  private async resolveCommandResponse(
    raw: HermesSlashExecResponse,
    input: AgentCommandInput,
    originalArg: string,
    depth: number,
  ): Promise<AgentCommandResult> {
    const dispatch = raw as HermesCommandDispatch;

    if (dispatch.type === "exec" || dispatch.type === "plugin") {
      return { type: "output", output: dispatch.output || "(no output)" };
    }

    if (dispatch.type === "alias") {
      if (!dispatch.target) throw new Error("Hermes returned an empty command alias.");
      return this.executeCommandInternal(
        {
          ...input,
          command: `/${dispatch.target}${originalArg ? ` ${originalArg}` : ""}`,
        },
        depth + 1,
      );
    }

    if (dispatch.type === "prefill") {
      if (!dispatch.message) throw new Error("Hermes returned an empty prefill.");
      return {
        type: "prefill",
        message: dispatch.message,
        notice: dispatch.notice,
      };
    }

    if (dispatch.type === "send" || dispatch.type === "skill") {
      if (!dispatch.message) {
        throw new Error("Hermes returned a command without a message payload.");
      }
      if (this.running) {
        this.queuedPrompts.push({
          message: dispatch.message,
          subtitleLanguage: input.subtitleLanguage,
        });
        return {
          type: "output",
          output:
            ("notice" in dispatch ? dispatch.notice : undefined) ||
            "Hermes command prompt queued for the next turn.",
        };
      }
      await this.submitPrompt(dispatch.message, input.subtitleLanguage);
      return {
        type: "submitted",
        notice: "notice" in dispatch ? dispatch.notice : undefined,
        display: dispatch.display,
      };
    }

    return {
      type: "output",
      output: raw.output || "(no output)",
      warning: raw.warning,
    };
  }

  private async submitPrompt(
    message: string,
    subtitleLanguage: string,
  ): Promise<void> {
    if (!this.session) {
      throw new Error("Open a Hermes session before sending a message.");
    }
    this.expectedSubtitleLanguage = subtitleLanguage;
    this.running = true;
    this.emit({ type: "agent.started" });
    try {
      await this.request("prompt.submit", {
        session_id: this.session.sessionId,
        text: buildKanaUserPrompt(message, subtitleLanguage),
      });
    } catch (error) {
      this.running = false;
      throw error;
    }
  }

  private request<T>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = this.options.requestTimeoutMs ?? 120_000,
  ): Promise<T> {
    if (this.state !== "connected") {
      return Promise.reject(new Error("Hermes gateway is not connected."));
    }
    return relayRpc<T>(method, params, timeoutMs);
  }

  private parseFrame(raw: unknown): HermesJsonRpcFrame | null {
    try {
      return JSON.parse(typeof raw === "string" ? raw : String(raw)) as HermesJsonRpcFrame;
    } catch {
      return null;
    }
  }

  private handleFrame(frame: HermesJsonRpcFrame): void {
    if (frame.method === "event" && frame.params) {
      this.handleGatewayEvent(frame.params);
    }
  }

  private handleGatewayEvent(event: HermesGatewayEvent): void {
    if (
      event.session_id &&
      this.session &&
      event.session_id !== this.session.sessionId
    ) {
      return;
    }

    const payload = event.payload ?? {};
    const pendingInput = inputRequest(event.type, payload);
    if (pendingInput) {
      this.emit({ type: "input.requested", request: pendingInput });
      return;
    }

    if (
      (event.type === "sudo.expire" || event.type === "secret.expire") &&
      typeof payload.request_id === "string"
    ) {
      this.emit({
        type: "input.expired",
        kind: event.type === "sudo.expire" ? "sudo" : "secret",
        requestId: payload.request_id,
      });
      return;
    }

    if (event.type === "message.delta" && typeof payload.text === "string") {
      this.emit({ type: "assistant.delta", text: payload.text });
      return;
    }

    if (event.type === "message.complete") {
      this.handleMessageComplete(payload);
      return;
    }

    if (event.type === "tool.start") {
      const tool = payload as HermesToolPayload;
      const name = String(tool.name || "unknown_tool");
      this.emit({
        type: "tool.started",
        id: String(tool.tool_id || `${name}-${Date.now()}`),
        tool: name,
        kind: classifyHermesTool(name),
        input: tool.args,
        summary: tool.context,
      });
      return;
    }

    if (event.type === "tool.progress" || event.type === "tool.generating") {
      const tool = payload as HermesToolPayload;
      this.emit({
        type: "tool.progress",
        id: tool.tool_id,
        tool: tool.name,
        message: tool.summary ?? tool.context,
        detail: payload,
      });
      return;
    }

    if (event.type === "tool.complete") {
      const tool = payload as HermesToolPayload;
      const name = String(tool.name || "unknown_tool");
      this.emit({
        type: "tool.finished",
        id: String(tool.tool_id || `${name}-${Date.now()}`),
        tool: name,
        kind: classifyHermesTool(name),
        output: tool.result,
        summary: tool.summary,
        durationMs:
          typeof tool.duration_s === "number" ? tool.duration_s * 1000 : undefined,
      });
      return;
    }

    if (event.type === "status.update") {
      this.emit({
        type: "status.updated",
        status: String(payload.kind || "working"),
        detail: typeof payload.text === "string" ? payload.text : undefined,
      });
      return;
    }

    if (event.type === "session.title") {
      this.emit({
        type: "session.updated",
        title: typeof payload.title === "string" ? payload.title : undefined,
        persistentSessionId:
          typeof payload.session_id === "string" ? payload.session_id : undefined,
      });
      return;
    }

    if (event.type === "error") {
      this.running = false;
      this.emit({
        type: "agent.error",
        message:
          typeof payload.message === "string" ? payload.message : "Hermes reported an error.",
      });
      this.drainQueuedPrompt();
    }
  }

  private handleMessageComplete(payload: Record<string, unknown>): void {
    // Hermes may replay a terminal event around reconnect boundaries. A turn
    // that is already terminal must not produce a second displayed response.
    if (!this.running) return;
    const status = String(payload.status || "complete");
    const rawResponse = typeof payload.text === "string" ? payload.text : "";

    if (status === "interrupted") {
      this.running = false;
      this.emit({ type: "agent.aborted" });
      this.drainQueuedPrompt();
      return;
    }

    if (status === "error") {
      this.running = false;
      this.emit({
        type: "agent.error",
        message:
          typeof payload.error === "string" ? payload.error : rawResponse || "Hermes turn failed.",
      });
      this.drainQueuedPrompt();
      return;
    }

    try {
      const response = parseKanaResponse(
        rawResponse,
        this.expectedSubtitleLanguage,
      );
      this.running = false;
      this.emit({ type: "assistant.message", response, rawResponse });
      this.emit({ type: "agent.finished" });
      this.drainQueuedPrompt();
    } catch (error) {
      this.running = false;
      this.emit({
        type: "agent.error",
        message:
          error instanceof Error ? error.message : "Kana response validation failed.",
        rawResponse:
          error instanceof KanaProtocolError ? error.rawResponse : rawResponse,
      });
      this.drainQueuedPrompt();
    }
  }

  private drainQueuedPrompt(): void {
    const queued = this.queuedPrompts.shift();
    if (!queued || !this.session || this.state !== "connected") return;
    queueMicrotask(() => {
      void this.submitPrompt(queued.message, queued.subtitleLanguage).catch((error) => {
        this.emit({
          type: "agent.error",
          message:
            error instanceof Error ? error.message : "Queued Hermes prompt failed.",
        });
      });
    });
  }

  private recoverResumedTurn(response: HermesSessionResponse): void {
    const wasRecovering = this.recoveringTurn;
    this.recoveringTurn = false;
    this.running = response.running === true;

    if (this.running) {
      this.emit({ type: "agent.started" });
      this.emit({
        type: "status.updated",
        status: "working",
        detail: "Reconnected to a Hermes turn that is still running.",
      });
      return;
    }

    if (wasRecovering) {
      const inflightError = response.inflight?.error;
      if (inflightError) {
        this.emit({ type: "agent.error", message: inflightError });
      } else {
        const assistant = [...(response.messages ?? [])]
          .reverse()
          .find(
            (message) =>
              message.role === "assistant" && typeof message.text === "string",
          );
        const rawResponse = assistant?.text?.trim() || "";
        if (rawResponse) {
          try {
            const parsed = parseKanaResponse(
              rawResponse,
              this.expectedSubtitleLanguage,
            );
            this.emit({ type: "assistant.message", response: parsed, rawResponse });
            this.emit({ type: "agent.finished" });
          } catch {
            this.emit({
              type: "agent.error",
              message:
                "Kana reconnected, but the completed Hermes response could not be restored through the Kana response protocol.",
              rawResponse,
            });
          }
        } else {
          this.emit({
            type: "agent.error",
            message:
              "Kana reconnected after an interrupted connection, but Hermes did not expose a completed response to restore.",
          });
        }
      }
    }

    this.drainQueuedPrompt();
  }

  private scheduleReconnect(message: string): void {
    if (
      this.intentionallyClosing ||
      this.reconnectTimer ||
      this.state === "authentication_failed" ||
      this.state === "incompatible"
    ) {
      return;
    }

    if (this.state === "error" && !this.connectedOnce) {
      return;
    }

    const delays = this.options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
    if (!delays.length) {
      this.setConnection("error", message);
      return;
    }

    const delayIndex = Math.min(this.reconnectAttempt, delays.length - 1);
    const delay = Math.max(0, delays[delayIndex] ?? delays.at(-1) ?? 1_000);
    const attempt = ++this.reconnectAttempt;
    const retryAt = Date.now() + delay;
    this.setConnection(
      "reconnecting",
      `Hermes disconnected. Reconnect attempt ${attempt} is scheduled.`,
      attempt,
      retryAt,
    );
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnectAndRestore();
    }, delay);
  }

  private async reconnectAndRestore(): Promise<void> {
    const resume = this.sessionOptions
      ? { ...this.sessionOptions }
      : this.session
        ? {
            subtitleLanguage: this.expectedSubtitleLanguage,
            persistentSessionId: this.session.persistentSessionId,
          }
        : null;

    try {
      await this.connect();
      if (resume?.persistentSessionId && this.state === "connected") {
        await this.openSession(resume);
      }
    } catch (error) {
      if (
        this.intentionallyClosing ||
        this.state === "authentication_failed" ||
        this.state === "incompatible"
      ) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/session (?:not found|no longer exists)/i.test(message)) {
        this.setConnection("error", message);
        this.emit({ type: "agent.error", message });
        return;
      }
      this.scheduleReconnect(message);
    }
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      globalThis.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private rejectPending(error: Error): void {
    // With the relay transport there is no pending-request map on the client;
    // in-flight relayRpc promises reject through fetch errors. Kept for the
    // event-emission contract only.
    void error;
  }

  private setConnection(
    state: AgentConnectionState,
    message?: string,
    retryAttempt?: number,
    retryAt?: number,
  ): void {
    this.state = state;
    this.emit({
      type: "connection.changed",
      state,
      message,
      ...(retryAttempt === undefined ? {} : { retryAttempt }),
      ...(retryAt === undefined ? {} : { retryAt }),
    });
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
