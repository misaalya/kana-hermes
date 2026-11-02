// Server-side bridge to `hermes serve`.
//
// Kana's Next.js server holds ONE WebSocket connection to the local Hermes
// gateway and fans gateway events out to authenticated browser clients over
// SSE. The Hermes session token never leaves this process: the browser only
// ever talks to /api/hermes/* with its Kana session cookie.
//
// Multiplexing model:
// - Each browser tab opens GET /api/hermes/events (SSE) and receives every
//   gateway event frame Kana receives (JSON-RPC "event" frames).
// - Browser RPCs go through POST /api/hermes/rpc, which forwards a single
//   JSON-RPC request over the shared socket and returns the correlated
//   response. Request ids are namespaced per caller.
// - Hermes gates most RPCs to one active session per connection; Kana is a
//   single-user surface, so one shared connection matches the product model.

import { LOCAL_HERMES_RUNTIME_ID } from "@/lib/runtime/runtime-identity";
import {
  inspectLocalHermesRuntime,
  managedRuntimePort,
  managedRuntimeToken,
  refreshHermesRuntimeTarget,
} from "./local-hermes-runtime";
import {
  remoteHermesConnection,
  remoteHermesIntent,
  remoteRuntimeId,
  remoteWebSocketUrl,
} from "./remote-hermes";
import { remoteWsTicket } from "./remote-hermes-auth";

type BridgeState = {
  socket: WebSocket | null;
  /** Which target the open socket belongs to, so status cannot cross modes. */
  target: "local" | "remote" | null;
  /** Opaque identity of the connected runtime, for per-Hermes browser state. */
  runtimeId: string | null;
  connectPromise: Promise<WebSocket> | null;
  listeners: Set<(frame: unknown) => void>;
  /** Server-to-client requests Hermes is waiting on, by JSON-RPC id. */
  serverRequests: Map<string, HermesServerRequest>;
  serverRequestListeners: Set<(request: HermesServerRequest) => void>;
  /** Told when the gateway connection drops (Hermes stopped or restarted). */
  lostListeners: Set<() => void>;
  pending: Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  requestId: number;
  /** Incremented for every lost gateway socket; cached sessions from an older epoch are dead. */
  epoch: number;
};

export type HermesServerRequest = {
  id: string;
  method: string;
  sessionId: string;
  params: Record<string, unknown>;
};

export type HermesServerResponse =
  | { result: Record<string, unknown> }
  | { error: { code: number; message: string } };

const bridgeKey = Symbol.for("kana.hermesBridge");
type BridgeGlobal = typeof globalThis & { [bridgeKey]?: BridgeState };

function bridge(): BridgeState {
  const shared = globalThis as BridgeGlobal;
  shared[bridgeKey] ??= {
    socket: null,
    target: null,
    runtimeId: null,
    connectPromise: null,
    listeners: new Set(),
    serverRequests: new Map(),
    serverRequestListeners: new Set(),
    lostListeners: new Set(),
    pending: new Map(),
    requestId: 0,
    epoch: 0,
  };
  // A bridge created by an older build (dev hot reload) lacks newer fields.
  shared[bridgeKey].lostListeners ??= new Set();
  shared[bridgeKey].target ??= null;
  shared[bridgeKey].runtimeId ??= null;
  shared[bridgeKey].serverRequests ??= new Map();
  shared[bridgeKey].serverRequestListeners ??= new Set();
  shared[bridgeKey].epoch ??= 0;
  return shared[bridgeKey];
}

const CONNECT_TIMEOUT_MS = 15_000;
// Login, ticket, and upgrade share one deadline so a remote that accepts a
// connection but stops answering cannot pin the shared gateway attempt.
const REMOTE_CONNECT_BUDGET_MS = 12_000;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

function gatewayUrl(port: number, token: string): string {
  const url = new URL(`ws://127.0.0.1:${port}/api/ws`);
  url.searchParams.set("token", token);
  return url.toString();
}

function handleFrame(state: BridgeState, raw: unknown): void {
  let frame: {
    id?: unknown;
    method?: unknown;
    params?: unknown;
    error?: { message?: string };
    result?: unknown;
  };
  try {
    frame = JSON.parse(typeof raw === "string" ? raw : String(raw));
  } catch {
    return;
  }
  // JSON-RPC is peer-to-peer: the gateway also sends requests to us. A frame
  // with a method and an id is one of those (a response carries result/error
  // and no method); forward it to the browser instead of treating it as ours.
  if (frame.method !== undefined && frame.id !== undefined && frame.id !== null) {
    const method = String(frame.method);
    if (method !== "event") {
      const params =
        frame.params && typeof frame.params === "object" && !Array.isArray(frame.params)
          ? (frame.params as Record<string, unknown>)
          : {};
      const request: HermesServerRequest = {
        id: String(frame.id),
        method,
        sessionId: typeof params.session_id === "string" ? params.session_id : "",
        params,
      };
      state.serverRequests.set(request.id, request);
      for (const listener of state.serverRequestListeners) listener(request);
      return;
    }
  }
  if (frame.id !== undefined && frame.id !== null) {
    const key = String(frame.id);
    const pending = state.pending.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    state.pending.delete(key);
    if (frame.error) {
      pending.reject(new Error(frame.error.message || "Hermes RPC failed."));
    } else {
      pending.resolve(frame.result);
    }
    return;
  }
  if (frame.method === "event") {
    const params = frame.params ?? null;
    // A withdrawn request must not be answered after its wait ended.
    if (params && typeof params === "object" && !Array.isArray(params)) {
      const event = params as Record<string, unknown>;
      const payload = event.payload;
      if (
        event.type === "request.cancel" &&
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload)
      ) {
        const id = (payload as Record<string, unknown>).id;
        if (typeof id === "string") state.serverRequests.delete(id);
      }
    }
    for (const listener of state.listeners) listener(params);
  }
}

function resetSocket(state: BridgeState): void {
  state.socket = null;
  state.target = null;
  state.runtimeId = null;
  state.epoch += 1;
  state.serverRequests.clear();
  const error = new Error("Hermes gateway disconnected.");
  for (const [, pending] of state.pending) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  state.pending.clear();
  for (const listener of [...state.lostListeners]) listener();
}

/**
 * Called once when the gateway connection drops. Every Hermes session opened
 * on it is gone, so event streams end and their browsers reconnect and resume.
 */
export function onHermesConnectionLost(listener: () => void): () => void {
  const state = bridge();
  state.lostListeners.add(listener);
  return () => state.lostListeners.delete(listener);
}

/** The gateway generation; a new socket starts a new epoch with no live sessions. */
export function hermesGatewayEpoch(): number {
  return bridge().epoch;
}

/** Test hook: advance the gateway generation without a real socket. */
export function __bumpHermesGatewayEpochForTests(): void {
  bridge().epoch += 1;
}

export function subscribeHermesEvents(listener: (frame: unknown) => void): () => void {
  const state = bridge();
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

/** Server-to-client requests still waiting on this gateway socket. */
export function listHermesServerRequests(): HermesServerRequest[] {
  return [...bridge().serverRequests.values()];
}

export function subscribeHermesServerRequests(
  listener: (request: HermesServerRequest) => void,
): () => void {
  const state = bridge();
  state.serverRequestListeners.add(listener);
  return () => state.serverRequestListeners.delete(listener);
}

/**
 * Answer one open server request with the standard JSON-RPC response frame.
 * Only an id the gateway actually asked about is accepted, so the browser
 * cannot inject arbitrary frames.
 */
export function answerHermesServerRequest(
  id: string,
  response: HermesServerResponse,
): "ok" | "unknown" | "disconnected" {
  const state = bridge();
  if (!state.serverRequests.has(id)) return "unknown";
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return "disconnected";
  state.serverRequests.delete(id);
  try {
    state.socket.send(JSON.stringify({ jsonrpc: "2.0", id, ...response }));
    return "ok";
  } catch {
    return "disconnected";
  }
}

const MISSING_TOKEN_MESSAGE =
  "Kana is not managing a Hermes gateway with a known session token. Start Hermes from Kana first.";

let capabilitySequence = 0;

/**
 * Hermes 0.22+ asks the client questions (clarify, approval, sudo, secret) as
 * server-to-client JSON-RPC requests, but only after the client advertises that
 * it answers them. Without this an old client silently receives nothing and
 * Hermes fails the request immediately.
 */
function advertiseServerRequests(socket: WebSocket): void {
  try {
    socket.send(JSON.stringify({
      jsonrpc: "2.0",
      id: `kana-capabilities-${++capabilitySequence}`,
      method: "client.capabilities",
      params: { server_requests: true },
    }));
  } catch {
    // The socket may have closed between open and this write.
  }
}

function openSocket(
  state: BridgeState,
  url: string,
  remote: boolean,
  timeoutMs = CONNECT_TIMEOUT_MS,
): Promise<WebSocket> {
  const socket = new WebSocket(url);
  (socket as unknown as { binaryType?: string }).binaryType = "arraybuffer";
  const label = remote ? "remote Hermes" : "Hermes";

  const opened = new Promise<WebSocket>((resolve, reject) => {
    const fail = (message: string) => {
      clearTimeout(timer);
      try { socket.close(); } catch {}
      reject(new Error(message));
    };
    const timer = setTimeout(
      () => fail(`Timed out connecting to the ${label} gateway.`),
      timeoutMs,
    );
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      advertiseServerRequests(socket);
      resolve(socket);
    }, { once: true });
    // Hermes rejects a wrong token during the upgrade, which surfaces here as
    // a generic error/close; the caller re-discovers and retries once.
    socket.addEventListener("error", () => fail(`Could not connect to the ${label} gateway.`), { once: true });
  });

  socket.addEventListener("message", (event: MessageEvent) => {
    const data = event.data;
    if (typeof data === "string") {
      if (data.length > MAX_FRAME_BYTES) return;
      handleFrame(state, data);
    } else if (data instanceof ArrayBuffer) {
      if (data.byteLength > MAX_FRAME_BYTES) return;
      handleFrame(state, new TextDecoder().decode(data));
    }
  });
  socket.addEventListener("close", () => {
    if (state.socket === socket) resetSocket(state);
  });
  socket.addEventListener("error", () => {
    if (state.socket === socket) resetSocket(state);
  });
  return opened;
}

async function connectWithDiscovery(state: BridgeState): Promise<WebSocket> {
  // An explicit remote block replaces local discovery entirely: a failed
  // remote must never silently connect to (or start) a Hermes on this machine.
  // Read that intent without validating unrelated settings, so a bad TTS key
  // cannot take a healthy local gateway down.
  const intent = remoteHermesIntent();
  if (intent === "unknown") {
    throw new Error("Kana could not read config.json; fix it and reconnect.");
  }
  if (intent === "remote") {
    const remote = remoteHermesConnection();
    if (!remote) throw new Error("The remote Hermes configuration is incomplete.");
    const startedAt = Date.now();
    const ticket = await remoteWsTicket(remote, REMOTE_CONNECT_BUDGET_MS);
    const remaining = Math.max(1, REMOTE_CONNECT_BUDGET_MS - (Date.now() - startedAt));
    const socket = await openSocket(
      state,
      remoteWebSocketUrl(remote.config, ticket),
      true,
      remaining,
    );
    state.target = "remote";
    state.runtimeId = remoteRuntimeId(remote.config);
    return socket;
  }

  let port = managedRuntimePort();
  let token = managedRuntimeToken();
  if (!token) {
    // Hermes may have been started outside Kana (e.g. manually via
    // `hermes serve`). Discovery adopts its port + session token.
    await inspectLocalHermesRuntime();
    port = managedRuntimePort();
    token = managedRuntimeToken();
  }
  if (!token) throw new Error(MISSING_TOKEN_MESSAGE);

  try {
    const socket = await openSocket(state, gatewayUrl(port, token), false);
    state.target = "local";
    state.runtimeId = LOCAL_HERMES_RUNTIME_ID;
    return socket;
  } catch (error) {
    // An adopted Hermes may have restarted with a new token or port since it
    // was discovered. Re-discover once instead of retrying a stale credential
    // forever; give up if discovery yields the same target.
    const next = await refreshHermesRuntimeTarget();
    if (!next.token || (next.token === token && next.port === port)) throw error;
    const socket = await openSocket(state, gatewayUrl(next.port, next.token), false);
    state.target = "local";
    state.runtimeId = LOCAL_HERMES_RUNTIME_ID;
    return socket;
  }
}

let connectedForTests: boolean | null = null;

/** Test hook: pretend the shared socket is open (or closed without an epoch bump). */
export function __setHermesGatewayConnectedForTests(value: boolean | null): void {
  connectedForTests = value;
}

/** Whether the shared upstream socket is open, optionally to one target kind. */
export function hermesGatewayConnected(target?: "local" | "remote"): boolean {
  if (connectedForTests !== null) return connectedForTests;
  const state = bridge();
  if (target && state.target !== target) return false;
  return state.socket?.readyState === WebSocket.OPEN;
}

/**
 * The connected runtime's opaque identity, or null while no socket is open.
 * The browser keys per-Hermes model defaults by it.
 */
export function hermesGatewayRuntimeId(): string | null {
  const state = bridge();
  return state.socket?.readyState === WebSocket.OPEN ? state.runtimeId : null;
}

export async function ensureHermesConnection(): Promise<WebSocket> {
  const state = bridge();
  if (state.socket && state.socket.readyState === WebSocket.OPEN) return state.socket;
  if (state.connectPromise) return state.connectPromise;

  state.connectPromise = connectWithDiscovery(state).then((socket) => {
    state.socket = socket;
    return socket;
  });
  try {
    return await state.connectPromise;
  } finally {
    state.connectPromise = null;
  }
}

export async function hermesRpc(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
  options: { retireOnTimeout?: boolean } = {},
): Promise<unknown> {
  const state = bridge();
  const socket = await ensureHermesConnection();
  const id = `kana-relay-${++state.requestId}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(id);
      // A read that never answered may sit on a half-open socket left by a
      // paused VM or a dropped link; retire it so the next request redials
      // instead of reusing a socket that can no longer answer.
      if (options.retireOnTimeout && state.socket === socket) resetSocket(state);
      reject(new Error(`Hermes request timed out: ${method}`));
    }, timeoutMs);
    state.pending.set(id, { resolve, reject, timer });
    try {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    } catch (error) {
      clearTimeout(timer);
      state.pending.delete(id);
      reject(error instanceof Error ? error : new Error(`Could not send Hermes request: ${method}`));
    }
  });
}
