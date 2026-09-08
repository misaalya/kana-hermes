type EventStreamDependencies = {
  connect: () => Promise<unknown>;
  subscribe: (listener: (params: unknown) => void) => () => void;
  authorized: () => Promise<boolean>;
};

const HEARTBEAT_MS = 25_000;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/** Own all downstream resources, including cancellation while connect is pending. */
export function createHermesEventStream(
  signal: AbortSignal,
  dependencies: EventStreamDependencies,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      cleanup = () => {
        if (closed) return;
        closed = true;
        signal.removeEventListener("abort", cleanup);
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try { controller.close(); } catch { /* Already cancelled by the reader. */ }
      };
      signal.addEventListener("abort", cleanup, { once: true });
      if (signal.aborted) {
        cleanup();
        return;
      }

      const write = (text: string) => {
        if (closed) return;
        const bytes = encoder.encode(text);
        if (bytes.byteLength > (controller.desiredSize ?? 0)) {
          // A slow/disconnected client must not accumulate an unbounded queue.
          // Error discards pending frames and lets the client reconnect/restore.
          controller.error(new Error("Hermes event consumer is too slow. Reconnect to restore history."));
          cleanup();
          return;
        }
        try { controller.enqueue(bytes); } catch { cleanup(); }
      };
      const send = (event: string, data: unknown) =>
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      send("open", { ok: true });
      // Do not make start() await the shared connection: reader cancellation
      // must be handled immediately, even when discovery takes many seconds.
      void (async () => {
        try {
          await dependencies.connect();
          if (closed) return;
          send("gateway", { connected: true });
        } catch (error) {
          if (closed) return;
          send("gateway", {
            connected: false,
            message: error instanceof Error ? error.message : "Hermes gateway is unreachable.",
          });
        }
        if (closed) return;
        unsubscribe = dependencies.subscribe((params) =>
          send("hermes", { jsonrpc: "2.0", method: "event", params }),
        );
        heartbeat = setInterval(() => {
          void dependencies.authorized().then((authorized) => {
            if (!authorized) cleanup();
            else write(": heartbeat\n\n");
          }).catch(cleanup);
        }, HEARTBEAT_MS);
      })().catch(cleanup);
    },
    cancel() { cleanup(); },
  }, {
    highWaterMark: MAX_BUFFER_BYTES,
    size: (chunk) => chunk.byteLength,
  });
}
