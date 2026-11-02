import {
  hermesGatewayConnected,
  hermesGatewayEpoch,
  listHermesServerRequests,
  onHermesConnectionLost,
  subscribeHermesEvents,
} from "./hermes-bridge";

// Server-held snapshots of sessions Hermes already opened for this gateway.
//
// A browser refresh used to call session.resume again, which made Hermes
// reopen the same session for every load. The registry mirrors the open
// session while the shared gateway socket is alive: the open response supplies
// the transcript, and prompt/terminal events keep it current. An attach then
// costs Hermes nothing. On any doubt (gateway loss, compression, bounded
// history, idle expiry) attach misses and the browser falls back to the real
// session.resume, so Hermes stays the transcript authority.

const MAX_SESSIONS = 8;
const MAX_MESSAGES = 500;
const MAX_MESSAGE_CHARS = 1_000_000;
const IDLE_TTL_MS = 30 * 60_000;

type MessageRow = Record<string, unknown>;

type Entry = {
  runtimeSessionId: string;
  persistentSessionId: string;
  messages: MessageRow[];
  messageChars: number;
  running: boolean;
  /** The mirror is no longer trustworthy; force a real resume. */
  needsResume: boolean;
  terminalSignature: string | null;
  epoch: number;
  updatedAt: number;
};

type RegistryState = {
  byPersistent: Map<string, Entry>;
  byRuntime: Map<string, Entry>;
  started: boolean;
  stop: (() => void) | null;
};

const registryKey = Symbol.for("kana.hermesSessionRegistry");
const shared = globalThis as typeof globalThis & { [registryKey]?: RegistryState };

function state(): RegistryState {
  shared[registryKey] ??= {
    byPersistent: new Map(),
    byRuntime: new Map(),
    started: false,
    stop: null,
  };
  return shared[registryKey];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function rowChars(row: MessageRow): number {
  return typeof row.text === "string" ? row.text.length : JSON.stringify(row).length;
}

function normalizeMessages(value: unknown): MessageRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is MessageRow => Boolean(record(row)))
    .map((row) => ({ ...row }));
}

function deleteEntry(entry: Entry): void {
  const reg = state();
  if (reg.byPersistent.get(entry.persistentSessionId) === entry) {
    reg.byPersistent.delete(entry.persistentSessionId);
  }
  if (reg.byRuntime.get(entry.runtimeSessionId) === entry) {
    reg.byRuntime.delete(entry.runtimeSessionId);
  }
}

function prune(): void {
  const reg = state();
  const epoch = hermesGatewayEpoch();
  const now = Date.now();
  for (const entry of [...reg.byPersistent.values()]) {
    if (entry.epoch !== epoch || (!entry.running && now - entry.updatedAt > IDLE_TTL_MS)) {
      deleteEntry(entry);
    }
  }
}

function appendMessage(entry: Entry, row: MessageRow): void {
  entry.messages.push(row);
  entry.messageChars += rowChars(row);
  while (
    entry.messages.length > MAX_MESSAGES
    || entry.messageChars > MAX_MESSAGE_CHARS
  ) {
    const removed = entry.messages.shift();
    if (!removed) break;
    entry.messageChars -= rowChars(removed);
    // A trimmed transcript is not the whole conversation; resume instead.
    entry.needsResume = true;
  }
}

function runtimeEntry(value: unknown): Entry | null {
  const runtime = text(value);
  return runtime ? state().byRuntime.get(runtime) ?? null : null;
}

function upsertSession(
  runtimeSessionId: string,
  persistentSessionId: string,
  messages: MessageRow[],
  running: boolean,
): void {
  const reg = state();
  prune();
  let entry = reg.byPersistent.get(persistentSessionId)
    ?? reg.byRuntime.get(runtimeSessionId);
  if (entry) {
    deleteEntry(entry);
  } else {
    entry = {
      runtimeSessionId,
      persistentSessionId,
      messages: [],
      messageChars: 0,
      running: false,
      needsResume: false,
      terminalSignature: null,
      epoch: hermesGatewayEpoch(),
      updatedAt: Date.now(),
    };
  }
  entry.runtimeSessionId = runtimeSessionId;
  entry.persistentSessionId = persistentSessionId;
  entry.messages = [];
  entry.messageChars = 0;
  entry.needsResume = false;
  for (const message of messages) appendMessage(entry, message);
  entry.running = running;
  entry.terminalSignature = null;
  entry.epoch = hermesGatewayEpoch();
  entry.updatedAt = Date.now();
  reg.byPersistent.set(persistentSessionId, entry);
  reg.byRuntime.set(runtimeSessionId, entry);

  if (reg.byPersistent.size > MAX_SESSIONS) {
    const oldest = [...reg.byPersistent.values()]
      .sort((left, right) => left.updatedAt - right.updatedAt)[0];
    if (oldest && oldest !== entry) deleteEntry(oldest);
  }
}

/** Mirror one gateway event into the session it belongs to. */
function handleEvent(frame: unknown): void {
  const event = record(frame);
  if (!event) return;
  const entry = runtimeEntry(event.session_id);
  if (!entry || entry.epoch !== hermesGatewayEpoch()) return;
  const type = typeof event.type === "string" ? event.type : "";
  const payload = record(event.payload) ?? {};
  if (type === "message.start") {
    entry.running = true;
    entry.terminalSignature = null;
  } else if (type === "message.complete") {
    const status = typeof payload.status === "string" ? payload.status : "complete";
    const reply = typeof payload.text === "string" ? payload.text : "";
    const signature = `${status}\u0000${reply}`;
    if (entry.terminalSignature === signature) return;
    entry.terminalSignature = signature;
    entry.running = false;
    if (reply.trim()) appendMessage(entry, { role: "assistant", text: reply });
  } else if (type === "error") {
    entry.running = false;
  }
  entry.updatedAt = Date.now();
}

function start(): void {
  const reg = state();
  if (reg.started) return;
  reg.started = true;
  const stopEvents = subscribeHermesEvents(handleEvent);
  const stopLost = onHermesConnectionLost(() => clearCachedHermesSessions());
  reg.stop = () => {
    stopEvents();
    stopLost();
  };
}

export function clearCachedHermesSessions(): void {
  const reg = state();
  reg.byPersistent.clear();
  reg.byRuntime.clear();
}

/** Called by the relay after Hermes accepted an RPC and before media rewriting. */
export function noteHermesRpcResult(
  method: string,
  params: Record<string, unknown>,
  result: unknown,
): void {
  start();
  const value = record(result);
  if (!value) return;
  if (method === "session.create" || method === "session.resume") {
    const runtimeSessionId = text(value.session_id);
    const persistentSessionId =
      text(value.stored_session_id) ??
      text(value.session_key) ??
      text(value.resumed) ??
      text(params.persistentSessionId);
    // A brand-new session has no durable id until Hermes stores it; never key
    // the registry by a runtime id.
    if (!runtimeSessionId || !persistentSessionId) return;
    upsertSession(
      runtimeSessionId,
      persistentSessionId,
      normalizeMessages(value.messages),
      value.running === true,
    );
    return;
  }
  if (method === "prompt.submit") {
    const entry = runtimeEntry(params.session_id);
    if (!entry) return;
    const status = text(value.status) ?? "";
    if (status === "steered" || status === "queued") {
      // Steered text leaves no stored row, and a queued turn starts later;
      // the mirror cannot prove the transcript, so attach must resume.
      entry.needsResume = true;
      entry.updatedAt = Date.now();
      return;
    }
    const prompt = text(params.text);
    if (prompt !== null) appendMessage(entry, { role: "user", text: prompt });
    entry.running = true;
    entry.terminalSignature = null;
    entry.updatedAt = Date.now();
    return;
  }
  if (method === "session.interrupt") {
    const entry = runtimeEntry(params.session_id);
    if (entry) {
      entry.running = false;
      entry.updatedAt = Date.now();
    }
    return;
  }
  if (method === "session.compress") {
    const entry = runtimeEntry(params.session_id);
    if (entry) {
      entry.needsResume = true;
      entry.updatedAt = Date.now();
    }
  }
}

export type AttachedHermesSession = {
  session_id: string;
  stored_session_id: string;
  resumed: string;
  messages: MessageRow[];
  running: boolean;
  open_requests?: Array<{ id: string; method: string; params: Record<string, unknown> }>;
};

/**
 * A live snapshot for one durable session, or null when the browser must call
 * session.resume. Only sessions Hermes itself opened on the current gateway
 * are served; the body never selects an arbitrary runtime session.
 */
export function attachCachedHermesSession(
  persistentSessionId: string,
): AttachedHermesSession | null {
  start();
  prune();
  if (!hermesGatewayConnected()) return null;
  const entry = state().byPersistent.get(persistentSessionId);
  if (!entry || entry.needsResume || entry.epoch !== hermesGatewayEpoch()) return null;
  const liveRequests = listHermesServerRequests();
  // A request without a session id cannot be attributed; let a real resume
  // restore it with Hermes's own scoping instead of dropping the prompt.
  if (liveRequests.some((request) => !request.sessionId)) return null;
  const openRequests = liveRequests
    .filter((request) => request.sessionId === entry.runtimeSessionId)
    .map((request) => ({ id: request.id, method: request.method, params: request.params }));
  return {
    session_id: entry.runtimeSessionId,
    stored_session_id: entry.persistentSessionId,
    resumed: entry.persistentSessionId,
    messages: entry.messages.map((message) => ({ ...message })),
    running: entry.running,
    ...(openRequests.length ? { open_requests: openRequests } : {}),
  };
}

/** Test-only: drop the subscriptions and every cached session. */
export function __resetHermesSessionRegistryForTests(): void {
  const reg = state();
  reg.stop?.();
  reg.stop = null;
  reg.started = false;
  clearCachedHermesSessions();
}

/** Test-only: deliver a gateway event as the bridge would. */
export function __applyHermesEventForTests(frame: unknown): void {
  handleEvent(frame);
}
