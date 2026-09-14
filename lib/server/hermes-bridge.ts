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

import {
  inspectLocalHermesRuntime,
  managedRuntimePort,
  managedRuntimeToken,
  refreshHermesRuntimeTarget,
} from "./local-hermes-runtime";

type BridgeState = {
  socket: WebSocket | null;
  connectPromise: Promise<WebSocket> | null;
  listeners: Set<(frame: unknown) => void>;
  pending: Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  requestId: number;
};

const bridgeKey = Symbol.for("kana.hermesBridge");
type BridgeGlobal = typeof globalThis & { [bridgeKey]?: BridgeState };

function bridge(): BridgeState {
  const shared = globalThis as BridgeGlobal;
  shared[bridgeKey] ??= {
    socket: null,
    connectPromise: null,
    listeners: new Set(),
    pending: new Map(),
    requestId: 0,
  };
  return shared[bridgeKey];
}

const CONNECT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

function gatewayUrl(port: number, token: string): string {
  const url = new URL(`ws://127.0.0.1:${port}/api/ws`);
  url.searchParams.set("token", token);
  return url.toString();
}

function handleFrame(state: BridgeState, raw: unknown): void {
  let frame: { id?: unknown; method?: unknown; params?: unknown; error?: { message?: string }; result?: unknown };
  try {
    frame = JSON.parse(typeof raw === "string" ? raw : String(raw));
  } catch {
    return;
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
    for (const listener of state.listeners) listener(frame.params ?? null);
  }
}

function resetSocket(state: BridgeState): void {
  state.socket = null;
  const error = new Error("Hermes gateway disconnected.");
  for (const [, pending] of state.pending) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  state.pending.clear();
}

export function subscribeHermesEvents(listener: (frame: unknown) => void): () => void {
  const state = bridge();
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

const MISSING_TOKEN_MESSAGE =
  "Kana is not managing a Hermes gateway with a known session token. Start Hermes from Kana first.";

function openSocket(state: BridgeState, port: number, token: string): Promise<WebSocket> {
  const socket = new WebSocket(gatewayUrl(port, token));
  (socket as unknown as { binaryType?: string }).binaryType = "arraybuffer";

  const opened = new Promise<WebSocket>((resolve, reject) => {
    const fail = (message: string) => {
      clearTimeout(timer);
      try { socket.close(); } catch {}
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail("Timed out connecting to the Hermes gateway."), CONNECT_TIMEOUT_MS);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(socket);
    }, { once: true });
    // Hermes rejects a wrong token during the upgrade, which surfaces here as
    // a generic error/close; the caller re-discovers and retries once.
    socket.addEventListener("error", () => fail("Could not connect to the Hermes gateway."), { once: true });
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
    return await openSocket(state, port, token);
  } catch (error) {
    // An adopted Hermes may have restarted with a new token or port since it
    // was discovered. Re-discover once instead of retrying a stale credential
    // forever; give up if discovery yields the same target.
    const next = await refreshHermesRuntimeTarget();
    if (!next.token || (next.token === token && next.port === port)) throw error;
    return openSocket(state, next.port, next.token);
  }
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
): Promise<unknown> {
  const state = bridge();
  const socket = await ensureHermesConnection();
  const id = `kana-relay-${++state.requestId}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(id);
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
