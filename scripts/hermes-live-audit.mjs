const endpoint = process.env.KANA_HERMES_WS_URL || "ws://127.0.0.1:9127/api/ws";
const token = process.env.KANA_HERMES_TOKEN || "";

if (!token) {
  throw new Error("Set KANA_HERMES_TOKEN to the temporary hermes serve token.");
}

const url = new URL(endpoint);
url.searchParams.set("token", token);

const socket = new WebSocket(url);
const pending = new Map();
let nextId = 0;
let runtimeSessionId = "";

function request(method, params = {}, timeoutMs = 30_000) {
  if (socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Hermes audit socket is not open."));
  }
  const id = `kana-live-audit-${++nextId}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Hermes live audit timed out: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("Hermes did not emit gateway.ready.")),
    15_000,
  );
  socket.addEventListener("message", (event) => {
    let frame;
    try {
      frame = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (frame.method === "event" && frame.params?.type === "gateway.ready") {
      clearTimeout(timeout);
      resolve();
      return;
    }
    if (frame.id !== undefined && frame.id !== null) {
      const entry = pending.get(String(frame.id));
      if (!entry) return;
      clearTimeout(entry.timeout);
      pending.delete(String(frame.id));
      if (frame.error) entry.reject(new Error(frame.error.message || "Hermes RPC failed."));
      else entry.resolve(frame.result);
    }
  });
  socket.addEventListener("error", () => {
    clearTimeout(timeout);
    reject(new Error("Could not connect to temporary hermes serve."));
  });
  socket.addEventListener("close", (event) => {
    clearTimeout(timeout);
    const error = new Error(
      `Temporary Hermes socket closed (${event.code || "unknown"}).`,
    );
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
    pending.clear();
  });
});

try {
  await ready;
  const session = await request("session.create", {
    title: `Kana live audit ${new Date().toISOString()}`,
    source: "kana",
    close_on_disconnect: true,
    messages: [],
  });
  runtimeSessionId = String(session.session_id || "");
  if (!runtimeSessionId) throw new Error("Hermes did not return a runtime session ID.");

  const [catalog, completion, status] = await Promise.all([
    request("commands.catalog", { session_id: runtimeSessionId }),
    request("complete.slash", { text: "/reasoning " }),
    request("session.status", { session_id: runtimeSessionId }),
  ]);
  const closed = await request("session.close", { session_id: runtimeSessionId });
  runtimeSessionId = "";

  const catalogCount = Array.isArray(catalog.pairs)
    ? catalog.pairs.length
    : Array.isArray(catalog.commands)
      ? catalog.commands.length
      : 0;
  const categoryCount = Array.isArray(catalog.categories)
    ? catalog.categories.length
    : 0;
  const completionCount = Array.isArray(completion.items)
    ? completion.items.length
    : 0;

  process.stdout.write(
    `${JSON.stringify(
      {
        gatewayReady: true,
        categoryCount,
        catalogCount,
        completionCount,
        sessionStatusAvailable: Boolean(status),
        sessionClosed: closed.closed === true,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (runtimeSessionId && socket.readyState === WebSocket.OPEN) {
    try {
      await request("session.close", { session_id: runtimeSessionId }, 10_000);
    } catch {
      // close_on_disconnect ensures this temporary, unprompted session is reaped.
    }
  }
  socket.close(1000, "Kana live audit complete");
}
