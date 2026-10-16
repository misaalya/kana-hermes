// Process-level registry of long-lived response streams (Kana's SSE relay).
//
// Next's production shutdown path is `server.close(callback)`: it stops
// accepting connections and then waits for every open one to finish. Unlike
// the dev server it never calls `closeAllConnections`
// (node_modules/next/dist/server/lib/start-server.js), so a tab holding
// GET /api/hermes/events open — a stream that only ends when the Hermes
// gateway connection drops — would keep the process alive forever after a
// stop request. `closeLiveStreams()` ends those streams so the shutdown can
// finish; whatever is left is bounded by the server's keep-alive timeout.
//
// State lives on `globalThis` behind a Symbol (the same pattern as
// lib/server/hermes-bridge.ts and lib/server/activity-store.ts) so a dev
// hot-reload of a route module still sees the streams another module
// registered.

type LiveStreamState = {
  cleanups: Set<() => void>;
  /** A stop is in progress: every stream, including a later one, must end. */
  shuttingDown: boolean;
};

const registryKey = Symbol.for("kana.liveStreams");
type LiveStreamGlobal = typeof globalThis & { [registryKey]?: LiveStreamState };

function liveStreams(): LiveStreamState {
  const shared = globalThis as LiveStreamGlobal;
  shared[registryKey] ??= { cleanups: new Set(), shuttingDown: false };
  return shared[registryKey];
}

/** Test seam: drop the process-wide registry (see resetActivityStoreForTests). */
export function resetLiveStreamsForTests(): void {
  delete (globalThis as LiveStreamGlobal)[registryKey];
}

/**
 * Registers the cleanup of one long-lived stream. The returned function
 * unregisters it (safe to call more than once, and safe to call after the
 * registry was closed).
 *
 * Once `closeLiveStreams()` has run in this process, registering a stream
 * closes it immediately: a browser reconnecting its SSE stream during the
 * stop window must not be able to hold the server open again.
 */
export function registerLiveStream(cleanup: () => void): () => void {
  const state = liveStreams();
  if (state.shuttingDown) {
    runCleanup(cleanup);
    return () => {};
  }
  state.cleanups.add(cleanup);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    state.cleanups.delete(cleanup);
  };
}

/**
 * Ends every registered stream, exactly once each, and refuses to keep a new
 * one alive afterwards. Idempotent, and safe when nothing is registered.
 */
export function closeLiveStreams(): void {
  const state = liveStreams();
  state.shuttingDown = true;
  const pending = [...state.cleanups];
  state.cleanups.clear();
  for (const cleanup of pending) runCleanup(cleanup);
}

function runCleanup(cleanup: () => void): void {
  try {
    cleanup();
  } catch {
    // One stream that is already gone must not stop the others.
  }
}