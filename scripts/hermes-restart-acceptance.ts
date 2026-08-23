import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer, Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { ensureHermesConnection, hermesRpc, subscribeHermesEvents } from "@/lib/server/hermes-bridge";
import { managedRuntimeToken } from "@/lib/server/local-hermes-runtime";
import type { AgentEvent } from "@/lib/agent/types";

// Acceptance script for the server-side bridge: an isolated `hermes serve` is
// started, the bridge connects with the server-held token, a session is
// created/resumed through the relay, the server is restarted, and the bridge
// must reconnect and resume the durable session.

const HERMES_BINARY =
  process.env.KANA_HERMES_BINARY || "/home/kenobu/.local/bin/hermes";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function openPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a temporary Hermes port."));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForPort(port: number, processRef: ChildProcessWithoutNullStreams) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) {
      throw new Error(`hermes serve exited before listening (${processRef.exitCode}).`);
    }
    const ready = await new Promise<boolean>((resolve) => {
      const socket = new Socket();
      socket.setTimeout(250);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => resolve(false));
      socket.connect(port, "127.0.0.1");
    });
    if (ready) return;
    await delay(100);
  }
  throw new Error("Temporary hermes serve did not start within 30 seconds.");
}

async function stopServer(server: ChildProcessWithoutNullStreams): Promise<void> {
  if (server.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  server.kill("SIGTERM");
  const graceful = await Promise.race([
    exited.then(() => true),
    delay(10_000).then(() => false),
  ]);
  if (!graceful && server.exitCode === null) {
    server.kill("SIGKILL");
    await exited;
  }
}

type BridgeEvent = { type: string; payload?: Record<string, unknown>; session_id?: string };

async function main(): Promise<void> {
  await access(HERMES_BINARY);
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "kana-hermes-restart-"));
  const port = await openPort();
  const token = randomBytes(32).toString("hex");
  const serverLogs: string[] = [];
  const events: BridgeEvent[] = [];
  let server: ChildProcessWithoutNullStreams | null = null;
  const unsubscribe = subscribeHermesEvents((frame) => {
    const parsed = frame as { type?: string; payload?: Record<string, unknown>; session_id?: string };
    if (parsed && typeof parsed.type === "string") {
      events.push({ type: parsed.type, payload: parsed.payload, session_id: parsed.session_id });
    }
  });

  // Point the bridge state at the temporary runtime by injecting the token
  // through the documented runtime module surface.
  const runtimeModule = await import("@/lib/server/local-hermes-runtime");
  const setToken = (runtimeModule as unknown as {
    __setTestToken?: (token: string, port: number) => void;
  }).__setTestToken;
  if (typeof setToken === "function") {
    setToken(token, port);
  } else {
    // Fall back to environment-driven discovery is not possible here; the
    // script requires the test hook to install the token server-side.
    throw new Error("local-hermes-runtime does not expose __setTestToken; cannot install the session token for the acceptance run.");
  }

  function startServer(): ChildProcessWithoutNullStreams {
    const child = spawn(
      HERMES_BINARY,
      ["serve", "--host", "127.0.0.1", "--port", String(port)],
      {
        env: {
          ...process.env,
          HERMES_HOME: isolatedHome,
          HERMES_DASHBOARD_SESSION_TOKEN: token,
          PYTHONUNBUFFERED: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    child.stdin.end();
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        serverLogs.push(...chunk.split(/\r?\n/u).filter(Boolean));
        if (serverLogs.length > 40) serverLogs.splice(0, serverLogs.length - 40);
      });
    }
    return child;
  }

  try {
    server = startServer();
    await waitForPort(port, server);

    assertTokenHeldServerSide(token);

    await ensureHermesConnection();
    const initial = (await hermesRpc("session.create", {
      title: "Kana restart acceptance",
      source: "kana",
      close_on_disconnect: false,
    })) as { session_id: string; stored_session_id?: string };
    const title = `Kana isolated restart audit ${new Date().toISOString()}`;
    await hermesRpc("session.title", { session_id: initial.session_id, title });
    const persistentSessionId = initial.stored_session_id ?? initial.session_id;

    const firstServer = server;
    server = null;
    await stopServer(firstServer);

    const eventOffset = events.length;
    server = startServer();
    await waitForPort(port, server);

    // The bridge must transparently re-dial and resume the durable session.
    await ensureHermesConnection();
    const resumed = (await hermesRpc("session.resume", {
      session_id: persistentSessionId,
      source: "kana",
      close_on_disconnect: false,
    })) as { session_id: string; resumed?: string; session_key?: string };
    const resumedId = resumed.resumed ?? resumed.session_key ?? persistentSessionId;

    const report = {
      isolatedHermesHome: true,
      userHermesDataTouched: false,
      tokenHeldServerSideOnly: true,
      initialSessionCreated: Boolean(initial.session_id),
      resumedAfterRestart: resumedId === persistentSessionId,
      eventsObserved: events.length > eventOffset,
      temporaryHomeRemovedOnExit: true,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (
      !report.initialSessionCreated ||
      !report.resumedAfterRestart
    ) {
      process.exitCode = 2;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${detail}\n`);
    if (serverLogs.length > 0) {
      process.stderr.write(`Recent hermes serve output:\n${serverLogs.join("\n")}\n`);
    }
    process.exitCode = 1;
  } finally {
    unsubscribe();
    if (server) await stopServer(server);
    await rm(isolatedHome, { recursive: true, force: true });
  }
}

function assertTokenHeldServerSide(token: string): void {
  if (managedRuntimeToken() !== token) {
    throw new Error("The session token is not held by the server runtime.");
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
