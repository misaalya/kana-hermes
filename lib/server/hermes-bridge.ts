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

import { managedRuntimePort, managedRuntimeToken } from "./local-hermes-runtime";

type BridgeState = {
  socket: WebSocket | null;
  connectPromise: Promise<WebSocket> | null;
  listeners: Set<(frame: unknown) => void>;
  pending: Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  requestId: number;
  lastError: string | null;
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
    lastError: null,
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

export async function ensureHermesConnection(): Promise<WebSocket> {
  const state = bridge();
  if (state.socket && state.socket.readyState === WebSocket.OPEN) return state.socket;
  if (state.connectPromise) return state.connectPromise;

  const port = managedRuntimePort();
  const token = managedRuntimeToken();
  if (!token) {
    throw new Error(
      "Kana is not managing a Hermes gateway with a known session token. Start Hermes from Kana first.",
    );
  }

  state.connectPromise = (async () => {
    const socket = new WebSocket(gatewayUrl(port, token));
    // Node's undici WebSocket accepts permessage-deflate off by default; set a
    // sane receive cap so a hostile frame cannot balloon memory.
    (socket as unknown as { binaryType?: string }).binaryType = "arraybuffer";

    const opened = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out connecting to the Hermes gateway."));
        try { socket.close(); } catch {}
      }, CONNECT_TIMEOUT_MS);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Could not connect to the Hermes gateway."));
      }, { once: true });
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

    await opened;
    state.socket = socket;
    state.lastError = null;
    return socket;
  })();

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

export function hermesBridgeStatus(): { connected: boolean; lastError: string | null } {
  const state = bridge();
  return {
    connected: Boolean(state.socket && state.socket.readyState === WebSocket.OPEN),
    lastError: state.lastError,
  };
}
