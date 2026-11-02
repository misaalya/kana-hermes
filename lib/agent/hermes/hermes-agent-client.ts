import { classifyHermesTool } from "@/lib/agent/tool-kind";
import { isInterruptionNotice } from "@/lib/agent/interruption-notice";
import { commandArgumentHint, commandArgumentPolicy } from "@/lib/agent/command-arguments";
import { AttachmentUploadError, MAX_ATTACHMENTS, MAX_ATTACHMENT_TOTAL_BYTES, validateAttachment } from "@/lib/agent/attachments";
import type {
  AgentBusyDelivery,
  AgentClient,
  AgentCommandInput,
  AgentCommandResult,
  AgentCommandSuggestion,
  AgentConnectionState,
  AgentEvent,
  AgentHistoryRow,
  AgentInputRequest,
  AgentInputResponse,
  AgentMessageInput,
  AgentModelCatalog,
  AgentModelSelection,
  AgentModelSwitchResult,
  AgentSession,
  AgentSessionOptions,
  ClarificationQuestion,
} from "@/lib/agent/types";
import {
  clearPendingInput,
  readPendingInput,
  rememberPendingInput,
} from "@/lib/agent/pending-input-cache";
import {
  buildKanaUserPrompt,
} from "@/lib/presentation/persona";
import {
  PROMPT_GUARDRAIL_BLOCKED,
  PROMPT_GUARDRAIL_UNAVAILABLE,
  PromptGuardrailError,
} from "@/lib/guardrails/protocol";
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
  HermesModelOptionsResponse,
  HermesModelSwitchResponse,
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
  /**
   * Whether Kana's voice is on, read when each prompt is sent: the Kana note
   * asks for Japanese speech only while something will read it. Defaults to
   * on.
   */
  voiceEnabled?: () => boolean;
  /**
   * Focus mode (the avatar is hidden). Read with the voice state: focus plus a
   * silent Kana consumes no speech, emotion, or language header, so the note
   * asks for plain chat instead.
   */
  plainChat?: () => boolean;
  /** Interface language used when the user's first message is ambiguous. */
  uiLocale?: () => "id" | "en";
};

const DEFAULT_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;

/** Hermes's "session not found", or Kana's refusal to replace a missing session. */
function isMissingSession(error: unknown): boolean {
  return /no longer exists|session not found/i.test(error instanceof Error ? error.message : String(error));
}

/**
 * A session-scoped `/model` switch as Hermes reads it. Its parser splits on
 * whitespace and never unquotes (`parse_model_flags_detailed` in
 * hermes_cli/model_switch.py), so shell quoting would reach it as part of the
 * name: `'custom:9router'` is an unknown provider.
 */
function modelSwitchArguments(model: string, provider: string): string {
  return `${model} --provider ${provider} --session`;
}

/**
 * The warning Kana shows after a model switch that succeeded. Hermes joins
 * its warnings with " | ". Its model-catalog checks add "Note: …" parts
 * ("`x` was not found in … listing", "could not reach … model listing") that
 * ride on switches Hermes accepted anyway, often only because a slow or
 * private /models endpoint timed out; they read like a failure, so they are
 * dropped. Other warnings (an auto-correction, a non-agentic model) stay. A
 * switch Hermes rejects still reports its reason as an error.
 */
function switchWarning(warning: unknown): string | undefined {
  if (typeof warning !== "string") return undefined;
  const kept = warning
    .split(" | ")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("Note: "));
  return kept.length ? kept.join(" | ") : undefined;
}

function stringChoices(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const choices = value.filter((choice): choice is string => typeof choice === "string");
  return choices;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The Kana dialog kind behind a Hermes 0.22+ server request. */
function serverRequestKind(method: string): "approval" | "clarification" | "sudo" | "secret" | null {
  if (method === "approval") return "approval";
  if (method === "clarify") return "clarification";
  if (method === "sudo") return "sudo";
  if (method === "secret") return "secret";
  return null;
}

/** One-string server requests Kana can skip without showing a dialog. */
const SKIPPABLE_SERVER_REQUESTS = new Set([
  "terminal.read",
  "preview.read",
  "window.read",
  "vault.unlock_prompt",
  "vault.save_login",
  "vault.code",
  "display.install.sudo",
]);

/** The session-scoped levels Hermes accepts from `/reasoning`. */
const REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "reset",
]);

/**
 * Normalize a Hermes clarify payload into Kana's clarification request.
 *
 * Two wire shapes exist: the legacy flat `{request_id, question, choices}`
 * (Hermes ≤ 0.20, one question) and the batch `{request_id, questions:
 * [{qid, question, choices, multi_select}]}` (Hermes 0.21+, up to five
 * questions answered with per-question locks). A reconnect replay may also
 * carry `answers` already locked server-side, used to prefill the dialog.
 */
function clarifyRequest(payload: Record<string, unknown>): {
  requestId: string;
  questions: ClarificationQuestion[];
  batch: boolean;
  lockedAnswers?: Record<string, string>;
} | null {
  if (typeof payload.request_id !== "string" || !payload.request_id) return null;
  const requestId = payload.request_id;

  let lockedAnswers: Record<string, string> | undefined;
  if (payload.answers && typeof payload.answers === "object" && !Array.isArray(payload.answers)) {
    const entries = Object.entries(payload.answers as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([qid, answer]): [string, string] => [qid, answer]);
    if (entries.length) lockedAnswers = Object.fromEntries(entries);
  }

  if (Array.isArray(payload.questions)) {
    const questions: ClarificationQuestion[] = [];
    payload.questions.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      const entry = item as Record<string, unknown>;
      if (typeof entry.question !== "string" || !entry.question.trim()) return;
      questions.push({
        qid: typeof entry.qid === "string" && entry.qid ? entry.qid : `q${index}`,
        question: entry.question,
        choices: stringChoices(entry.choices),
        multiSelect: entry.multi_select === true && Array.isArray(entry.choices),
      });
    });
    if (!questions.length) return null;
    return { requestId, questions, batch: true, ...(lockedAnswers ? { lockedAnswers } : {}) };
  }

  if (typeof payload.question !== "string" || !payload.question.trim()) return null;
  return {
    requestId,
    questions: [
      {
        qid: "q0",
        question: payload.question,
        choices: stringChoices(payload.choices),
        multiSelect: false,
      },
    ],
    batch: false,
  };
}

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
    const request = clarifyRequest(payload);
    if (!request) return null;
    return {
      kind: "clarification",
      ...request,
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
    const value = (await response.json()) as { result?: T; error?: string; code?: string };
    if (!response.ok || value.error) {
      const message = value.error || `Hermes relay failed (${response.status}).`;
      // Kana's own decision, not a relay failure: the caller answers it with
      // Kana's fixed wording instead of a send-failure banner.
      if (value.code === PROMPT_GUARDRAIL_BLOCKED) {
        throw new PromptGuardrailError("blocked", message);
      }
      if (value.code === PROMPT_GUARDRAIL_UNAVAILABLE) {
        throw new PromptGuardrailError("unavailable", message);
      }
      throw new Error(message);
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
  private runtimeIdValue: string | null = null;
  private eventSource: EventSource | null = null;
  private openingSessions = 0;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private connectedOnce = false;
  private session: AgentSession | null = null;
  private sessionOptions: AgentSessionOptions | null = null;
  // One-shot flag: the first prompt after a session opens (new or resumed)
  // carries the full response contract; later prompts carry the short one.
  private needsFullContract = false;
  // The voice state the last full contract described; turning the voice on
  // or off sends the full contract again.
  private contractVoice: boolean | null = null;
  private contractPlain: boolean | null = null;
  private intentionallyClosing = false;
  private running = false;
  private attachmentUpload: AbortController | null = null;
  private recoveringTurn = false;
  // Whether Hermes has stored the open session: it was resumed, or took a
  // prompt. One it never stored does not survive a Hermes restart.
  private sessionStored = false;
  // The reconnect in progress; a second request joins it instead of resuming twice.
  private restoring: Promise<void> | null = null;
  // Hermes 0.22+ asks the client questions as server→client requests; this is
  // the one still waiting for the dialog, answered with a JSON-RPC response.
  private pendingServerRequest: { id: string; method: string } | null = null;
  // The last terminal frame of the current turn. A reconnect replay is
  // ignored, while a genuine terminal after a bare warning still lands.
  private terminalSignature: string | null = null;
  private readonly queuedPrompts: Array<{ message: string }> = [];

  constructor(private readonly options: HermesRelayOptions = {}) {}

  get connectionState(): AgentConnectionState {
    return this.state;
  }

  get runtimeId(): string | null {
    return this.runtimeIdValue;
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

    this.connectPromise = connectPromise
      .catch((error: unknown) => {
        // First-connect failures must land in a terminal state: rejecting
        // alone parked the connection in "connecting" forever (endless gate
        // spinner, and the manual button disabled itself as a transition).
        if (!this.connectedOnce && !this.intentionallyClosing) {
          const message =
            error instanceof Error
              ? error.message
              : "Could not reach the Hermes relay.";
          this.setConnection("error", message);
        }
        throw error;
      })
      .finally(() => {
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
      this.runtimeIdValue = null;

      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for the Hermes event stream."));
        this.closeEventStream();
      }, this.options.connectTimeoutMs ?? 15_000);

      const onGateway = (event: MessageEvent) => {
        try {
          const value = JSON.parse(event.data) as {
            connected?: boolean;
            message?: string;
            runtimeId?: string | null;
          };
          if (value.connected) {
            this.runtimeIdValue =
              typeof value.runtimeId === "string" && value.runtimeId ? value.runtimeId : null;
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
      source.addEventListener("server-request", ((event: MessageEvent) => {
        try {
          const frame = JSON.parse(event.data) as {
            id?: unknown;
            method?: unknown;
            params?: unknown;
          };
          this.handleServerRequestFrame(frame);
        } catch {
          /* ignore malformed server requests */
        }
      }) as EventListener);
      source.addEventListener("open", () => {
        // The relay accepted the stream; wait for the gateway status before
        // resolving a first connection.
      });
      source.addEventListener("error", () => {
        clearTimeout(timeout);
        this.runtimeIdValue = null;
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
    this.attachmentUpload?.abort();
    this.intentionallyClosing = true;
    this.cancelReconnect();
    this.session = null;
    this.sessionOptions = null;
    this.sessionStored = false;
    this.running = false;
    this.recoveringTurn = false;
    this.connectedOnce = false;
    this.reconnectAttempt = 0;
    this.runtimeIdValue = null;
    this.pendingServerRequest = null;
    this.terminalSignature = null;
    this.queuedPrompts.length = 0;
    this.closeEventStream();
    this.rejectPending(new Error("Kana disconnected from Hermes."));
    this.setConnection("disconnected");
  }

  async openSession(options: AgentSessionOptions): Promise<AgentSession> {
    this.openingSessions += 1;
    try {
      return await this.openSessionOnce(options);
    } finally {
      this.openingSessions -= 1;
    }
  }

  /**
   * The server-held snapshot of a session Hermes already opened. A miss, a
   * wrapped gateway, or any doubt returns null so the caller resumes normally.
   */
  private async attachSession(persistentSessionId: string): Promise<HermesSessionResponse | null> {
    try {
      const response = await fetch("/api/hermes/session/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistentSessionId }),
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const value = (await response.json()) as {
        attached?: boolean;
        session?: HermesSessionResponse;
      };
      if (
        value.attached !== true
        || !value.session
        || typeof value.session.session_id !== "string"
      ) {
        return null;
      }
      return value.session;
    } catch {
      return null;
    }
  }

  private async openSessionOnce(options: AgentSessionOptions): Promise<AgentSession> {
    this.attachmentUpload?.abort();
    if (this.state !== "connected") {
      await this.connect();
    }
    let response: HermesSessionResponse;
    let attached = false;
    if (options.persistentSessionId) {
      const cached = await this.attachSession(options.persistentSessionId);
      if (cached) {
        response = cached;
        attached = true;
      } else {
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
      }
    } else {
      response = await this.request<HermesSessionResponse>("session.create", {
        title: options.title,
        source: "kana",
        close_on_disconnect: false,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        // Kana's default model for new conversations: Hermes applies it as a
        // per-session override and never writes it to config.
        ...(options.model ? { model: options.model } : {}),
        ...(options.provider ? { provider: options.provider } : {}),
        // No system-role seed: Hermes sends it as a second system message,
        // which some routes drop, and never stores it. The contract rides in
        // the user turn instead (see lib/presentation/persona.ts).
      });
    }
    this.needsFullContract = true;

    const persistentSessionId =
      response.stored_session_id ??
      response.session_key ??
      response.resumed ??
      options.persistentSessionId ??
      response.session_id;

    this.pendingServerRequest = null;
    this.session = {
      sessionId: response.session_id,
      persistentSessionId,
      resumed: Boolean(options.persistentSessionId),
    };
    this.sessionOptions = {
      ...options,
      persistentSessionId,
    };
    this.sessionStored = Boolean(options.persistentSessionId);
    this.emit({ type: "session.opened", ...this.session });
    if (options.persistentSessionId) {
      // The resume response or the server's live snapshot already carries
      // the full display transcript; no second RPC restores it.
      this.emit({
        type: "history.restored",
        sessionId: this.session.sessionId,
        persistentSessionId,
        messages: (response.messages ?? []).map((message) => ({
          ...message,
          role: message.role ?? "",
        })),
        running: response.running === true,
      });
      if (!attached) {
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
    }
    this.recoverResumedTurn(response);
    if (options.persistentSessionId) {
      this.restorePendingInput(response, persistentSessionId);
    }
    return this.session;
  }

  /**
   * Re-show the input dialog after a refresh while Hermes is still waiting.
   * Server replays come first (`pending_approval`/`pending_clarify` on Hermes
   * 0.21+); when Hermes replays nothing — sudo/secret prompts, or older
   * Hermes with no replay at all — the client's own memory of the request
   * fills in, since a blocked agent thread survives a browser refresh. When
   * the turn is no longer running, anything remembered is stale and dropped.
   */
  private restorePendingInput(response: HermesSessionResponse, persistentSessionId: string): void {
    // Hermes 0.22+ replays server→client requests here; they are authoritative,
    // so the client's older event-shaped memory would only double-restore.
    if (Array.isArray(response.open_requests)) {
      clearPendingInput(persistentSessionId);
      for (const entry of response.open_requests) {
        const item = record(entry);
        if (item) this.handleServerRequestFrame(item);
      }
      return;
    }
    if (response.running !== true) {
      clearPendingInput(persistentSessionId);
      return;
    }
    let replayed = false;
    const replay = (request: AgentInputRequest | null) => {
      if (!request) return;
      this.emit({ type: "input.requested", request });
      replayed = true;
    };
    const pendingApproval = response.pending_approval;
    if (pendingApproval && typeof pendingApproval === "object" && !Array.isArray(pendingApproval)) {
      const payload = pendingApproval as Record<string, unknown>;
      const command = typeof payload.command === "string" ? payload.command : "";
      const description = typeof payload.description === "string" ? payload.description : "";
      if (command.trim() || description.trim()) {
        replay(inputRequest("approval.request", payload));
      }
    }
    if (response.pending_clarify && typeof response.pending_clarify === "object") {
      const pending = clarifyRequest(response.pending_clarify as Record<string, unknown>);
      if (pending) {
        replay({ kind: "clarification", ...pending });
      }
    }
    if (!replayed) {
      replay(readPendingInput(persistentSessionId));
    }
  }

  /** The durable session id behind the open session, for pending-input memory. */
  private pendingInputKey(): string | null {
    return this.sessionOptions?.persistentSessionId ?? this.session?.persistentSessionId ?? null;
  }

  private rememberPending(request: AgentInputRequest): void {
    const key = this.pendingInputKey();
    if (key) rememberPendingInput(key, request);
  }

  private forgetPending(): void {
    const key = this.pendingInputKey();
    if (key) clearPendingInput(key);
  }

  /**
   * Hermes 0.22+ asks the client questions as server→client requests instead
   * of `*.request` events. Map the supported ones onto the same dialogs; a
   * request Kana cannot show is declined at once so the agent never waits for
   * a card that will not appear.
   */
  private handleServerRequestFrame(frame: {
    id?: unknown;
    method?: unknown;
    params?: unknown;
  }): void {
    if (typeof frame.id !== "string" || typeof frame.method !== "string") return;
    const id = frame.id;
    const method = frame.method;
    const params = record(frame.params) ?? {};
    const sessionId = typeof params.session_id === "string" ? params.session_id : "";
    if (
      sessionId &&
      (this.session ? sessionId !== this.session.sessionId : this.openingSessions === 0)
    ) {
      return;
    }
    // The same request can arrive live, in an SSE replay, and on resume.
    if (this.pendingServerRequest?.id === id) return;
    const kind = serverRequestKind(method);
    if (!kind) {
      void this.answerServerRequest(
        id,
        SKIPPABLE_SERVER_REQUESTS.has(method)
          ? { result: { value: "" } }
          : { error: { code: -32601, message: `Kana does not handle the ${method} request.` } },
      ).catch(() => undefined);
      return;
    }
    const request =
      kind === "clarification"
        ? (() => {
            const parsed = clarifyRequest({ ...params, request_id: id });
            return parsed ? { kind: "clarification" as const, ...parsed } : null;
          })()
        : inputRequest(
            kind === "approval"
              ? "approval.request"
              : kind === "sudo"
                ? "sudo.request"
                : "secret.request",
            { ...params, request_id: id },
          );
    if (!request || request.kind !== kind) {
      void this.answerServerRequest(id, {
        error: { code: -32602, message: `Hermes sent an invalid ${method} request.` },
      }).catch(() => undefined);
      return;
    }
    this.pendingServerRequest = { id, method };
    this.emit({ type: "input.requested", request });
    if (kind === "approval" && typeof params.request_id === "string" && this.session) {
      // Starts the approval's own timeout clock now that the card is on screen.
      void this.request("approval.received", {
        session_id: this.session.sessionId,
        request_id: params.request_id,
      }).catch(() => undefined);
    }
  }

  /** Write the JSON-RPC response frame through the relay. */
  private async answerServerRequest(
    id: string,
    response:
      | { result: Record<string, unknown> }
      | { error: { code: number; message: string } },
  ): Promise<void> {
    const res = await fetch("/api/hermes/server-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...response }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return;
    const value = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(
      typeof value?.error === "string"
        ? value.error
        : `Could not answer the Hermes request (${res.status}).`,
    );
  }

  private serverResponseMatches(method: string, response: AgentInputResponse): boolean {
    const pending = this.pendingServerRequest;
    if (method === "approval") return response.kind === "approval";
    if (method === "clarify") {
      return response.kind === "clarification" && response.requestId === pending?.id;
    }
    if (method === "sudo") return response.kind === "sudo" && response.requestId === pending?.id;
    if (method === "secret") return response.kind === "secret" && response.requestId === pending?.id;
    return false;
  }

  private serverResponseResult(
    method: string,
    response: AgentInputResponse,
  ): { result: Record<string, unknown> } {
    if (method === "approval" && response.kind === "approval") {
      return { result: { choice: response.choice, all: response.all === true } };
    }
    if (method === "clarify" && response.kind === "clarification") {
      if (response.cancelled || response.answers.length === 0) {
        return { result: { outcome: "cancelled" } };
      }
      return {
        result: {
          answers: Object.fromEntries(
            response.answers.map((answer) => [answer.qid, answer.answer]),
          ),
          outcome: "submitted",
        },
      };
    }
    if (method === "sudo" && response.kind === "sudo") {
      return { result: { value: response.password } };
    }
    if (method === "secret" && response.kind === "secret") {
      return { result: { value: response.value } };
    }
    return { result: {} };
  }

  async sendMessage(input: AgentMessageInput): Promise<void> {
    if (!this.session) {
      throw new Error("Open a Hermes session before sending a message.");
    }

    if (this.attachmentUpload) throw new Error("An attachment upload is already in progress.");
    const attachments = (input.attachments ?? []).map(validateAttachment);
    if (attachments.length > MAX_ATTACHMENTS || attachments.reduce((sum, file) => sum + file.dataUrl.split(",")[1].length * 3 / 4, 0) > MAX_ATTACHMENT_TOTAL_BYTES + 2 * MAX_ATTACHMENTS) {
      throw new Error("Choose up to 5 files, at most 20 MiB combined.");
    }
    if (!attachments.length) {
      await this.submitPrompt(input.text);
      return;
    }
    const session = this.session;
    const controller = new AbortController();
    this.attachmentUpload = controller;
    const refs: string[] = [];
    let submittingPrompt = false;
    try {
      for (const file of attachments) {
        controller.signal.throwIfAborted();
        const response = await fetch("/api/hermes/attachments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: session.sessionId, ...file }),
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
        });
        const value = await response.json() as { result?: { attached?: boolean; ref_text?: string }; error?: string };
        if (!response.ok || value.error || !value.result?.attached || !value.result.ref_text?.startsWith("@file:")) {
          throw new Error(value.error || `Could not attach ${file.name}. Update Hermes if file.attach is unavailable.`);
        }
        refs.push(value.result.ref_text);
      }
      controller.signal.throwIfAborted();
      if (this.session !== session) throw new Error("The conversation changed during upload. Please send again.");
      submittingPrompt = true;
      await this.submitPrompt(input.text, refs);
    } catch (error) {
      if (!submittingPrompt) throw new AttachmentUploadError(error);
      throw error;
    } finally {
      if (this.attachmentUpload === controller) this.attachmentUpload = null;
    }
  }

  /**
   * Queue a plain message while a turn is running. It is submitted
   * automatically when the current turn completes — matching the Telegram /
   * TUI behavior where a follow-up message lands after the active loop.
   */
  enqueuePrompt(message: string): void {
    if (!this.session) {
      throw new Error("Open a Hermes session before queueing a message.");
    }
    this.queuedPrompts.push({ message });
  }

  async fetchHistory(): Promise<{
    messages?: AgentHistoryRow[];
  }> {
    // Hermes resolves session.history ONLY by runtime session id; a durable
    // key fails with JSON-RPC 4001 ("session not found"). The runtime id
    // exists after openSession, so refuse instead of sending a doomed call.
    const sessionId = this.session?.sessionId;
    if (!sessionId) {
      throw new Error("Open a Hermes session before fetching its history.");
    }
    return this.request<{ messages?: AgentHistoryRow[] }>(
      "session.history",
      { session_id: sessionId },
      60_000,
    );
  }

  async executeCommand(input: AgentCommandInput): Promise<AgentCommandResult> {
    if (!this.session) {
      throw new Error("Open a Hermes session before running a command.");
    }

    return this.executeCommandInternal(input, 0);
  }

  async completeCommands(
    input: string,
    options: { models?: AgentModelCatalog } = {},
  ): Promise<AgentCommandSuggestion[]> {
    if (this.state !== "connected" || !input.startsWith("/")) return [];

    if (/^\/model\s+/i.test(input)) {
      const query = input.replace(/^\/model\s+/i, "").trim().toLowerCase();
      const catalog = options.models ?? (await this.listModels());
      return catalog.providers
        .flatMap((provider) =>
          provider.models.map((model) => ({ provider, model })),
        )
        .filter(({ provider, model }) =>
          !query || `${provider.slug} ${provider.name} ${model}`.toLowerCase().includes(query),
        )
        .slice(0, 60)
        .map(({ provider, model }) => ({
          text: `/model ${modelSwitchArguments(model, provider.slug)}`,
          display: model,
          description: provider.name,
          group: `Models · ${provider.name}`,
          kind: "command" as const,
          availability: "available" as const,
        }));
    }

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
      const description =
        !completingArgument && kanaUnavailableMessage(commandText)
          ? kanaUnavailableMessage(commandText) ?? undefined
          : item.meta
            ? String(item.meta)
            : undefined;
      const kind = item.kind === "skill" ? "skill" : "command";
      const hint =
        !completingArgument && kind === "command"
          ? commandArgumentHint(commandText, description)
          : null;
      const argument =
        !completingArgument && kind === "command"
          ? commandArgumentPolicy(commandText, hint)
          : null;
      return {
        text: commandText,
        display: display || commandText,
        description,
        group:
          !completingArgument && kanaUnavailableReason(commandText)
            ? "Unavailable in Kana"
            : completingArgument
              ? "Options"
              : kind === "skill"
                ? "Skills"
                : "Commands",
        kind,
        availability:
          !completingArgument && kanaUnavailableReason(commandText)
            ? "unavailable"
            : "available",
        unavailableReason:
          !completingArgument && kanaUnavailableMessage(commandText)
            ? kanaUnavailableMessage(commandText) ?? undefined
            : undefined,
        argumentHint: argument?.hint ?? undefined,
        requiresArgument: argument?.required ? true : undefined,
      };
    });
  }

  async listModels(options: { refresh?: boolean; forNewSession?: boolean } = {}): Promise<AgentModelCatalog> {
    if (this.state !== "connected") {
      throw new Error("Connect to Hermes before listing models.");
    }
    const response = await this.request<HermesModelOptionsResponse>(
      "model.options",
      {
        ...(this.session && options.forNewSession !== true
          ? { session_id: this.session.sessionId }
          : {}),
        explicit_only: true,
        refresh: options.refresh === true,
      },
      120_000,
    );
    return {
      provider: typeof response.provider === "string" ? response.provider : "",
      model: typeof response.model === "string" ? response.model : "",
      providers: (response.providers ?? [])
        .map((provider) => ({
          slug: typeof provider.slug === "string" ? provider.slug : "",
          name:
            typeof provider.name === "string" && provider.name.trim()
              ? provider.name
              : typeof provider.slug === "string"
                ? provider.slug
                : "Provider",
          models: Array.isArray(provider.models)
            ? provider.models.filter(
                (model): model is string => typeof model === "string" && Boolean(model.trim()),
              )
            : [],
          current: provider.is_current === true,
          authenticated: provider.authenticated !== false,
          warning: typeof provider.warning === "string" ? provider.warning : undefined,
        }))
        .filter((provider) => provider.slug && provider.models.length),
    };
  }

  async selectModel(
    selection: AgentModelSelection,
    options: { confirm?: boolean } = {},
  ): Promise<AgentModelSwitchResult> {
    if (!this.session) {
      throw new Error("Open a Hermes session before changing models.");
    }
    const provider = selection.provider.trim();
    const model = selection.model.trim();
    if (!provider || !model) throw new Error("Choose both a provider and a model.");
    const response = await this.request<HermesModelSwitchResponse>("config.set", {
      session_id: this.session.sessionId,
      key: "model",
      value: modelSwitchArguments(model, provider),
      confirm_expensive_model: options.confirm === true,
    }, 120_000);
    return {
      provider,
      model: typeof response.value === "string" && response.value ? response.value : model,
      confirmationRequired: response.confirm_required === true,
      deferred: response.deferred === true,
      message:
        (typeof response.confirm_message === "string" && response.confirm_message) ||
        switchWarning(response.warning),
    };
  }

  async respondToInput(response: AgentInputResponse): Promise<void> {
    if (!this.session) {
      throw new Error("Open a Hermes session before responding to input.");
    }

    const server = this.pendingServerRequest;
    if (server && this.serverResponseMatches(server.method, response)) {
      this.pendingServerRequest = null;
      this.forgetPending();
      await this.answerServerRequest(server.id, this.serverResponseResult(server.method, response));
      return;
    }

    if (response.kind === "approval") {
      await this.request("approval.respond", {
        session_id: this.session.sessionId,
        choice: response.choice,
        all: response.all ?? false,
      });
      this.forgetPending();
      return;
    }
    if (response.kind === "clarification") {
      if (response.cancelled || response.answers.length === 0) {
        // Cancel-all: no question_id resolves the whole batch as a plain
        // cancel instead of a partial per-question result.
        await this.checkResponded(
          "clarify.respond",
          {
            request_id: response.requestId,
            answer: "",
          },
          "clarification",
        );
        return;
      }
      // Batch locks (Hermes 0.21+): each answer lands under its qid and the
      // final lock unblocks the agent. Locked answers stay editable
      // server-side until the batch completes, so order does not matter.
      for (const answer of response.answers) {
        await this.checkResponded(
          "clarify.respond",
          {
            request_id: response.requestId,
            question_id: answer.qid,
            answer: answer.answer,
          },
          "clarification",
        );
      }
      return;
    }
    if (response.kind === "sudo") {
      await this.checkResponded(
        "sudo.respond",
        {
          request_id: response.requestId,
          password: response.password,
        },
        "sudo password",
      );
      return;
    }
    await this.checkResponded(
      "secret.respond",
      {
        request_id: response.requestId,
        value: response.value,
      },
      "secret",
    );
  }

  /**
   * One blocking answer round-trip. Hermes answers `{status: "expired"}` when
   * the prompt timed out while the dialog was still open (e.g. answered after
   * a refresh restored a dead request): that must surface as a failure, never
   * as a delivered answer, and the remembered request is dropped either way.
   */
  private async checkResponded(
    method: string,
    params: Record<string, unknown>,
    label: string,
  ): Promise<void> {
    try {
      const result = await this.request<{ status?: string }>(method, params);
      if (result && typeof result === "object" && result.status === "expired") {
        throw new Error(`That Hermes ${label} request already expired before the answer arrived.`);
      }
      this.forgetPending();
    } catch (error) {
      if (error instanceof Error && /already expired/.test(error.message)) {
        this.forgetPending();
      }
      throw error;
    }
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
        const kind = skillNames.has(text.toLowerCase()) ? "skill" : "command";
        const hint = kind === "command" && !unavailable ? commandArgumentHint(text, description) : null;
        const argument = kind === "command" && !unavailable ? commandArgumentPolicy(text, hint) : null;
        categorized.add(text.toLowerCase());
        suggestions.push({
          text,
          display: text,
          description: unavailable || description,
          group: unavailable ? "Unavailable in Kana" : category.name || "Commands",
          kind,
          availability: unavailable ? "unavailable" : "available",
          unavailableReason: unavailable || undefined,
          argumentHint: argument?.hint ?? undefined,
          requiresArgument: argument?.required ? true : undefined,
        });
      }
    }

    for (const [text, description] of catalog.pairs ?? []) {
      if (categorized.has(text.toLowerCase())) continue;
      const unavailable = kanaUnavailableMessage(text);
      const kind = skillNames.has(text.toLowerCase()) ? "skill" : "command";
      const hint = kind === "command" && !unavailable ? commandArgumentHint(text, description) : null;
      const argument = kind === "command" && !unavailable ? commandArgumentPolicy(text, hint) : null;
      suggestions.push({
        text,
        display: text,
        description: unavailable || description,
        group: unavailable
          ? "Unavailable in Kana"
          : kind === "skill"
            ? "Skills"
            : "Commands",
        kind,
        availability: unavailable ? "unavailable" : "available",
        unavailableReason: unavailable || undefined,
        argumentHint: argument?.hint ?? undefined,
        requiresArgument: argument?.required ? true : undefined,
      });
    }

    return suggestions;
  }

  async abort(): Promise<void> {
    this.attachmentUpload?.abort();
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
      // A reconnect resumes the branch, which Hermes stored with its history.
      this.sessionOptions = { ...this.sessionOptions, persistentSessionId: response.stored_session_id };
      this.sessionStored = true;
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

    // The reload commands act on the gateway process, as Hermes's own TUI runs
    // them. slash.exec would run them in its separate command worker, which
    // reports success while hermes serve keeps the old keys, servers, skills.
    if (name === "reload") {
      const response = await this.request<{ updated?: number }>("reload.env", {});
      const updated = Number(response.updated ?? 0);
      return {
        type: "output",
        output: `Reloaded ~/.hermes/.env into Hermes (${updated} ${updated === 1 ? "variable" : "variables"} updated).`,
      };
    }

    if (name === "reload-mcp") {
      const choice = arg.trim().toLowerCase();
      const confirm = ["now", "approve", "once", "yes", "always"].includes(choice);
      const response = await this.request<{ status?: string; message?: string }>(
        "reload.mcp",
        {
          session_id: this.session.sessionId,
          ...(confirm ? { confirm: true } : {}),
          ...(choice === "always" ? { always: true } : {}),
        },
        180_000,
      );
      return {
        type: "output",
        output:
          response.status === "confirm_required"
            ? response.message || "Reply /reload-mcp now to reload Hermes's MCP servers."
            : choice === "always"
              ? "Reloaded Hermes's MCP servers. /reload-mcp will not ask again."
              : "Reloaded Hermes's MCP servers.",
      };
    }

    if (name === "reload-skills") {
      const response = await this.request<{ output?: string }>("skills.reload", {});
      return { type: "output", output: response.output || "Reloaded Hermes's skills." };
    }

    // /reasoning acts on the serving session, as Hermes's TUI does. Through
    // slash.exec it changes only the separate command worker, which reports
    // success while the gateway keeps sending the old effort.
    if (name === "reasoning") {
      const value = arg.trim().toLowerCase();
      if (REASONING_EFFORTS.has(value)) {
        const response = await this.request<{ value?: string }>("config.set", {
          session_id: this.session.sessionId,
          key: "reasoning",
          value,
          scope: "session",
        });
        return {
          type: "output",
          output:
            value === "reset"
              ? "Reasoning effort reset to the configured default for this conversation."
              : `Reasoning effort set to '${response.value ?? value}' for this conversation.`,
        };
      }
      if (value.includes("--global")) {
        return {
          type: "output",
          output:
            "Kana changes reasoning for this conversation only. Change agent.reasoning_effort in Hermes's config for a global default.",
        };
      }
    }

    let raw: HermesSlashExecResponse;
    try {
      raw = await this.request<HermesSlashExecResponse>("slash.exec", {
        session_id: this.session.sessionId,
        command,
      });
    } catch (slashError) {
      // A guardrail refusal is Kana's own decision about this text, and
      // command.dispatch would send the same words to be screened again: the
      // fallback could only spend a second request, and in an outage a second
      // timeout, to arrive at the same refusal.
      if (slashError instanceof PromptGuardrailError) throw slashError;
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
        this.queuedPrompts.push({ message: dispatch.message });
        return {
          type: "output",
          output:
            ("notice" in dispatch ? dispatch.notice : undefined) ||
            "Hermes command prompt queued for the next turn.",
        };
      }
      await this.submitPrompt(dispatch.message);
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
    attachmentRefs: string[] = [],
  ): Promise<void> {
    if (!this.session) {
      throw new Error("Open a Hermes session before sending a message.");
    }
    this.running = true;
    this.terminalSignature = null;
    this.emit({ type: "agent.started" });
    try {
      await this.postPrompt(message, attachmentRefs);
    } catch (error) {
      this.running = false;
      throw error;
    }
  }

  /**
   * Hand a plain message to Hermes while a turn is running and let its
   * `display.busy_input_mode` decide: redirect the live turn (default),
   * steer after the next tool call, or queue the next turn. The turn is
   * already running, so no local `agent.started` is emitted; a server-queued
   * turn announces itself later with `message.start`.
   */
  async sendWhileBusy(message: string): Promise<AgentBusyDelivery> {
    if (!this.session) {
      throw new Error("Open a Hermes session before sending a message.");
    }
    const status = await this.postPrompt(message);
    if (status === "redirected" || status === "steered" || status === "queued") return status;
    return "started";
  }

  private async postPrompt(
    message: string,
    attachmentRefs: string[] = [],
  ): Promise<string | undefined> {
    if (!this.session) {
      throw new Error("Open a Hermes session before sending a message.");
    }
    const voice = this.options.voiceEnabled?.() ?? true;
    const plain = !voice && (this.options.plainChat?.() ?? false);
    const full = this.needsFullContract
      || this.contractVoice !== voice
      || this.contractPlain !== plain;
    const text = buildKanaUserPrompt(message, {
      full,
      voice,
      plain,
      uiLocale: this.options.uiLocale?.() ?? "id",
    });
    const response = await this.request<{ status?: string }>("prompt.submit", {
      session_id: this.session.sessionId,
      // References go after the Kana note: Hermes's context-reference
      // parser reads them anywhere, and transcript restore drops them
      // together with the note.
      text: attachmentRefs.length ? `${text}\n\n${attachmentRefs.join("\n")}` : text,
    });
    // Cleared only once Hermes took the prompt, so a failed submit retries
    // with the full contract.
    this.needsFullContract = false;
    this.sessionStored = true;
    if (full) {
      this.contractVoice = voice;
      this.contractPlain = plain;
    }
    return response.status;
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

  private handleFrame(frame: HermesJsonRpcFrame): void {
    if (frame.method === "event" && frame.params) {
      this.handleGatewayEvent(frame.params);
    }
  }

  private handleGatewayEvent(event: HermesGatewayEvent): void {
    // The relay shares one gateway connection between browser tabs, so a
    // session-scoped event may belong to another tab. Without an open session
    // only accept them while this client is opening one: Hermes emits the new
    // session's first session.info before session.create returns its id.
    if (
      event.session_id &&
      (this.session
        ? event.session_id !== this.session.sessionId
        : this.openingSessions === 0)
    ) {
      return;
    }

    const payload = event.payload ?? {};
    const pendingInput = inputRequest(event.type, payload);
    if (pendingInput) {
      this.emit({ type: "input.requested", request: pendingInput });
      this.rememberPending(pendingInput);
      return;
    }

    if (event.type === "request.cancel") {
      const id = typeof payload.id === "string" ? payload.id : "";
      const method = typeof payload.method === "string" ? payload.method : "";
      if (id && this.pendingServerRequest?.id === id) {
        this.pendingServerRequest = null;
        this.forgetPending();
        const kind = serverRequestKind(method);
        if (kind) this.emit({ type: "input.expired", kind, requestId: id });
      }
      return;
    }

    if (event.type === "approval.cancelled") {
      const requestIds = Array.isArray(payload.request_ids)
        ? payload.request_ids.filter((id): id is string => typeof id === "string")
        : [];
      if (this.pendingServerRequest?.method === "approval") {
        this.pendingServerRequest = null;
        this.forgetPending();
      }
      this.emit({
        type: "input.expired",
        kind: "approval",
        requestId: requestIds[0] ?? "",
      });
      return;
    }

    if (
      (event.type === "sudo.expire" || event.type === "secret.expire" || event.type === "clarify.expire") &&
      typeof payload.request_id === "string"
    ) {
      this.forgetPending();
      this.emit({
        type: "input.expired",
        kind:
          event.type === "sudo.expire"
            ? "sudo"
            : event.type === "secret.expire"
              ? "secret"
              : "clarification",
        requestId: payload.request_id,
      });
      return;
    }

    if (event.type === "message.start") {
      // A turn Hermes started on its own, such as a prompt drained from its
      // server-side busy queue. Kana's own submits mark the turn running
      // before they reach Hermes, so only a turn this client has not seen
      // begin is announced here; without it that turn's message.complete
      // would be discarded as terminal.
      if (!this.running) {
        this.running = true;
        this.terminalSignature = null;
        this.emit({ type: "agent.started" });
      }
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
      // A bare error is a warning frame, not always the end of the turn: an
      // API retry or compression failure continues and ends with a terminal
      // `message.complete`. Stop the visible turn but let that terminal land;
      // the queue drains when it does, never beside a still-running Hermes.
      this.running = false;
      this.pendingServerRequest = null;
      this.forgetPending();
      const message =
        typeof payload.message === "string" ? payload.message : "Hermes reported an error.";
      // These two are emitted beside a turn that continues to a terminal;
      // every other bare error is its only termination.
      const midTurnWarning = /compression failed|could not switch to configured model/i.test(
        message,
      );
      this.emit({ type: "agent.error", message, terminal: !midTurnWarning });
    }
  }

  private handleMessageComplete(payload: Record<string, unknown>): void {
    this.pendingServerRequest = null;
    const status = String(payload.status || "complete");
    const rawResponse = typeof payload.text === "string" ? payload.text : "";
    // Hermes may replay a terminal around reconnect boundaries. Identical
    // repeats are ignored; a different terminal still lands even when a bare
    // error already stopped the visible turn.
    const signature = `${status}\u0000${rawResponse}`;
    if (signature === this.terminalSignature) return;
    this.terminalSignature = signature;

    const notice = isInterruptionNotice(rawResponse);
    if (status === "interrupted" || (status !== "error" && (notice || !rawResponse.trim()))) {
      this.running = false;
      this.forgetPending();
      let replyShown = false;
      // Stop can race the last API call: Hermes persists the final response and
      // still reports the turn as interrupted. Show that reply (and keep its
      // tools attached), but never show Hermes's retry/cancellation control
      // notice as a chat bubble.
      if (!notice && rawResponse.trim()) {
        try {
          const response = parseKanaResponse(rawResponse);
          this.emit({ type: "assistant.message", response, rawResponse });
          replyShown = true;
        } catch {
          // A partial that is not a Kana response stays out of the transcript.
        }
      }
      this.emit({ type: "agent.aborted", replyShown });
      this.drainQueuedPrompt();
      return;
    }

    if (status === "error") {
      this.running = false;
      this.forgetPending();
      this.emit({
        type: "agent.error",
        message:
          typeof payload.error === "string" ? payload.error : rawResponse || "Hermes turn failed.",
        terminal: true,
      });
      this.drainQueuedPrompt();
      return;
    }

    try {
      const response = parseKanaResponse(rawResponse);
      this.running = false;
      this.forgetPending();
      this.emit({ type: "assistant.message", response, rawResponse });
      this.emit({ type: "agent.finished" });
      this.drainQueuedPrompt();
    } catch (error) {
      this.running = false;
      this.forgetPending();
      this.emit({
        type: "agent.error",
        message:
          error instanceof Error ? error.message : "Kana response validation failed.",
        rawResponse:
          error instanceof KanaProtocolError ? error.rawResponse : rawResponse,
        terminal: true,
      });
      this.drainQueuedPrompt();
    }
  }

  private drainQueuedPrompt(): void {
    const queued = this.queuedPrompts.shift();
    if (!queued || !this.session || this.state !== "connected") return;
    queueMicrotask(() => {
      void this.submitPrompt(queued.message).catch((error) => {
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
      this.terminalSignature = null;
      this.emit({ type: "agent.started", resumed: true });
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
        this.emit({ type: "agent.error", message: inflightError, terminal: true });
      } else {
        // openSession already delivered `history.restored`; the restored
        // transcript is authoritative, including the final reply and its
        // tools. Picking the last raw assistant row here would show a
        // tool-call narration or a retry notice as the answer.
        this.emit({ type: "agent.finished" });
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

  /**
   * Reconnect and reopen the open session now instead of after the reconnect
   * delay, for when Kana has just restarted hermes serve. Resolves once the
   * attempt is over; `connectionState` says whether it worked.
   */
  async reconnectNow(): Promise<void> {
    if (this.intentionallyClosing || !this.connectedOnce) return;
    this.cancelReconnect();
    if (this.state === "connected") {
      // The relay stream may not have ended yet; its sessions are gone either way.
      this.closeEventStream();
      this.setConnection("reconnecting", "Hermes restarted.");
    }
    await this.reconnectAndRestore();
  }

  private reconnectAndRestore(): Promise<void> {
    this.restoring ??= this.restore().finally(() => {
      this.restoring = null;
    });
    return this.restoring;
  }

  private async restore(): Promise<void> {
    const resume = this.sessionOptions
      ? { ...this.sessionOptions }
      : this.session
        ? { persistentSessionId: this.session.persistentSessionId }
        : null;
    const stored = this.sessionStored;

    try {
      await this.connect();
      if (resume?.persistentSessionId && this.state === "connected") {
        try {
          await this.openSession(resume);
        } catch (error) {
          if (stored || !isMissingSession(error)) throw error;
          // Hermes restarted before this session's first prompt, so it never
          // stored it and nothing was lost. Stay connected; the next prompt
          // opens a new session.
          this.session = null;
          this.sessionOptions = null;
        }
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
      if (isMissingSession(error)) {
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
