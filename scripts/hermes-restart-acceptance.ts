import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer, Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { HermesAgentClient } from "@/lib/agent/hermes/hermes-agent-client";
import type { AgentEvent } from "@/lib/agent/types";

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

function waitForEvent(
  events: AgentEvent[],
  predicate: (event: AgentEvent) => boolean,
  timeoutMs: number,
): Promise<AgentEvent> {
  const existing = events.find(predicate);
  if (existing) return Promise.resolve(existing);
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const event = events.find(predicate);
      if (event) {
        clearInterval(timer);
        resolve(event);
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for the expected Hermes adapter event."));
      }
    }, 25);
  });
}

async function main(): Promise<void> {
await access(HERMES_BINARY);
const isolatedHome = await mkdtemp(path.join(tmpdir(), "kana-hermes-restart-"));
const port = await openPort();
const token = randomBytes(32).toString("hex");
const endpoint = `ws://127.0.0.1:${port}/api/ws`;
const serverLogs: string[] = [];
let server: ChildProcessWithoutNullStreams | null = null;
let client: HermesAgentClient | null = null;

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
  const events: AgentEvent[] = [];
  client = new HermesAgentClient({
    websocketUrl: endpoint,
    token,
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 20_000,
    reconnectDelaysMs: [100, 250, 500, 1_000],
  });
  client.subscribe((event) => events.push(event));
  await client.connect();
  const initial = await client.openSession({
    title: "Kana restart acceptance",
    subtitleLanguage: "en",
  });
  const title = `Kana isolated restart audit ${new Date().toISOString()}`;
  await client.executeCommand({ command: `/title ${title}`, subtitleLanguage: "en" });

  // Reconstruct the adapter before the server restart. This mirrors a page
  // refresh: no in-memory session object survives, and Kana must resume only
  // from the durable Hermes session ID stored with the conversation.
  await client.disconnect();
  client = new HermesAgentClient({
    websocketUrl: endpoint,
    token,
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 20_000,
    reconnectDelaysMs: [100, 250, 500, 1_000],
  });
  client.subscribe((event) => events.push(event));
  await client.connect();
  const freshClientSession = await client.openSession({
    persistentSessionId: initial.persistentSessionId,
    subtitleLanguage: "en",
  });
  const freshClientResumeBeforeRestart =
    freshClientSession.resumed &&
    freshClientSession.persistentSessionId === initial.persistentSessionId;

  const firstServer = server;
  await stopServer(firstServer);
  await waitForEvent(
    events,
    (event) => event.type === "connection.changed" && event.state === "reconnecting",
    10_000,
  );

  const eventOffset = events.length;
  server = startServer();
  await waitForPort(port, server);
  const resumedEvent = await waitForEvent(
    events,
    (event) =>
      events.indexOf(event) >= eventOffset &&
      event.type === "session.opened" &&
      event.resumed === true,
    30_000,
  );
  const status = await client.executeCommand({
    command: "/status",
    subtitleLanguage: "en",
  });
  const resumedPersistentId =
    resumedEvent.type === "session.opened" ? resumedEvent.persistentSessionId : "";
  const states = events.flatMap((event) =>
    event.type === "connection.changed" ? [event.state] : [],
  );
  const report = {
    isolatedHermesHome: true,
    userHermesDataTouched: false,
    initialConnection: states.includes("connected"),
    freshClientResumeBeforeRestart,
    reconnectObserved: states.includes("reconnecting"),
    resumedAfterRestart: resumedPersistentId === initial.persistentSessionId,
    persistentSessionIdStable: resumedPersistentId === initial.persistentSessionId,
    statusCommandAfterRestart: status.type === "output",
    connectionStates: states,
    temporaryHomeRemovedOnExit: true,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (
    !report.initialConnection ||
    !report.freshClientResumeBeforeRestart ||
    !report.reconnectObserved ||
    !report.resumedAfterRestart ||
    !report.statusCommandAfterRestart
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
  await client?.disconnect().catch(() => undefined);
  if (server) await stopServer(server);
  await rm(isolatedHome, { recursive: true, force: true });
}
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
