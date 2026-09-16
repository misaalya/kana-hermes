import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  findHermesExecutable,
  HERMES_DEFAULT_PORT,
  HERMES_TOKEN_ENV,
  hermesCandidateInputFromEnv,
  readHermesProcessToken,
  scanHermesServeProcesses,
} from "@/shared/hermes-discovery.mjs";
import { readKanaUserConfig } from "./user-config";

export { hermesExecutableCandidates } from "@/shared/hermes-discovery.mjs";

// Server-side custody of the Hermes dashboard session token.
//
// The browser never receives the token: Kana's server relay is the only party
// that dials `hermes serve`, so the credential lives in process memory here
// and is never serialized into an API response or client storage.

export type LocalHermesRuntimeStatus = {
  controlAvailable: boolean;
  state: "disabled" | "stopped" | "starting" | "running" | "stopping" | "failed";
  managed: boolean;
  executable?: string;
  pid?: number;
  port: number;
  websocketUrl: string;
  message: string;
};

type ManagedRuntime = {
  child: ChildProcess | null;
  state: LocalHermesRuntimeStatus["state"];
  executable?: string;
  port: number;
  token: string | null;
  lastMessage: string;
};

const PROBE_TIMEOUT_MS = 750;
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 250;
const STOP_GRACE_MS = 8_000;

function configuredHermesPort(): number {
  return readKanaUserConfig().hermes?.port ?? HERMES_DEFAULT_PORT;
}

const runtimeKey = Symbol.for("kana.localHermesRuntime");
type RuntimeGlobal = typeof globalThis & { [runtimeKey]?: ManagedRuntime };

function runtime(): ManagedRuntime {
  const shared = globalThis as RuntimeGlobal;
  shared[runtimeKey] ??= {
    child: null,
    state: "stopped",
    port: configuredHermesPort(),
    token: null,
    lastMessage: "Hermes is not running under Kana.",
  };
  return shared[runtimeKey];
}

/** The server-held session token for the gateway Kana connects to, if known. */
export function managedRuntimeToken(): string | null {
  return runtime().token;
}

// Test/acceptance-script hook: install a token+port pair without spawning a
// process. Never used by application code paths.
export const __setTestToken = (token: string, port: number): void => {
  const current = runtime();
  current.token = token;
  current.port = port;
  current.state = "running";
};

/** The port of the gateway Kana currently targets. */
export function managedRuntimePort(): number {
  return runtime().port;
}

async function resolveHermesExecutable(): Promise<string | null> {
  const fromEnvironment = process.env.KANA_HERMES_BIN?.trim();
  if (fromEnvironment && !path.isAbsolute(fromEnvironment)) {
    throw new Error("KANA_HERMES_BIN must be an absolute path.");
  }
  return findHermesExecutable(
    hermesCandidateInputFromEnv(process.env, {
      configured: readKanaUserConfig().hermes?.executable,
      home: homedir(),
    }),
  );
}

/** Best-effort: find the session token of a `hermes serve` on a given port. */
async function discoverProcessTokenByPort(port: number): Promise<string | null> {
  for (const proc of await scanHermesServeProcesses()) {
    if (proc.port === port) {
      const token = await readHermesProcessToken(proc.pid);
      if (token) return token;
    }
  }
  return null;
}

function mintSessionToken(): string {
  return randomBytes(24).toString("hex");
}

function endpoint(port: number): string {
  return `ws://127.0.0.1:${port}/api/ws`;
}

async function probe(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return Boolean(
      body
      && typeof body === "object"
      && "ok" in body
      && body.ok === true
      && "version" in body
      && typeof body.version === "string"
      && body.version.length > 0,
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function publicStatus(current: ManagedRuntime, available: boolean): LocalHermesRuntimeStatus {
  return {
    controlAvailable: available,
    state: available ? current.state : "disabled",
    managed: Boolean(current.child && !current.child.killed),
    ...(current.executable ? { executable: current.executable } : {}),
    ...(current.child?.pid ? { pid: current.child.pid } : {}),
    port: current.port,
    websocketUrl: endpoint(current.port),
    message: available
      ? current.lastMessage
      : "Local process control is available only through the Kana launcher.",
  };
}

export async function inspectLocalHermesRuntime(
  preferredPort?: number,
): Promise<LocalHermesRuntimeStatus> {
  const current = runtime();
  const configuredPort = configuredHermesPort();
  if (!current.child && current.state === "stopped") current.port = configuredPort;
  current.executable ??= (await resolveHermesExecutable()) ?? undefined;

  // A managed child owns its port exclusively.
  if (current.child && current.child.exitCode === null) {
    if (await probe(current.port)) {
      current.state = "running";
      current.lastMessage = "Hermes UI gateway is running under Kana.";
      return publicStatus(current, true);
    }
    if (current.state === "starting" || current.state === "stopping") {
      return publicStatus(current, true);
    }
    current.state = "failed";
    current.lastMessage = current.lastMessage || "The managed Hermes process stopped responding.";
    return publicStatus(current, true);
  }

  // Auto-discovery: scan running processes and capture their tokens
  // server-side. This catches non-default ports and removes manual token
  // entry entirely — the browser connects through the Kana relay instead.
  const processes = await scanHermesServeProcesses();
  for (const proc of processes) {
    if (proc.port === current.port && (await probe(proc.port))) {
      current.state = "running";
      current.child = null;
      current.token = (await readHermesProcessToken(proc.pid)) ?? current.token;
      current.lastMessage = `Hermes already running on port ${proc.port}.`;
      return publicStatus(current, true);
    }
  }
  for (const proc of processes) {
    if (await probe(proc.port)) {
      current.port = proc.port;
      current.state = "running";
      current.child = null;
      current.token = (await readHermesProcessToken(proc.pid)) ?? current.token;
      current.lastMessage = `A Hermes gateway was found on port ${proc.port}.`;
      return publicStatus(current, true);
    }
  }

  // Fallback: probe candidate ports.
  const candidates: number[] = [];
  for (const port of [preferredPort, configuredPort, current.port, HERMES_DEFAULT_PORT]) {
    if (
      typeof port === "number" &&
      Number.isInteger(port) &&
      port >= 1024 &&
      port <= 65_535 &&
      !candidates.includes(port)
    ) {
      candidates.push(port);
    }
  }
  const probes = await Promise.all(candidates.map((port) => probe(port)));
  const detectedIndex = probes.findIndex((alive) => alive);
  if (detectedIndex !== -1) {
    const detectedPort = candidates[detectedIndex];
    current.port = detectedPort;
    current.state = "running";
    current.child = null;
    current.token = await discoverProcessTokenByPort(detectedPort);
    current.lastMessage = current.token
      ? `A Hermes gateway is already running on port ${detectedPort}.`
      : `A Hermes gateway is running on port ${detectedPort}, but its session token could not be read. Restart it from Kana to connect.`;
    return publicStatus(current, true);
  }

  if (current.state !== "starting" && current.state !== "stopping") {
    current.state = current.child && current.child.exitCode !== null ? "failed" : "stopped";
    current.token = null;
  }
  if (!current.executable) {
    current.lastMessage =
      "Hermes was not found automatically. Run `kana doctor`, then set hermes.executable in Kana's config.json if Hermes is installed in a custom location.";
  } else if (current.state === "stopped") {
    current.lastMessage = "No running Hermes gateway was detected on this machine.";
  }
  return publicStatus(current, true);
}

async function waitUntilReady(current: ManagedRuntime): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (current.child?.exitCode !== null) {
      throw new Error(current.lastMessage || "Hermes exited before becoming ready.");
    }
    if (await probe(current.port, 1_000)) return;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(`Hermes did not become ready within ${READY_TIMEOUT_MS / 1000} seconds.`);
}

export async function startLocalHermesRuntime(options: {
  /** Omit to use hermes.port from config.json (or Hermes's default). */
  port?: number;
} = {}): Promise<LocalHermesRuntimeStatus> {
  const port = options.port ?? configuredHermesPort();
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("Hermes port must be an integer between 1024 and 65535.");
  }
  const current = runtime();
  if (current.child && current.child.exitCode === null) {
    throw new Error("Kana already manages a running Hermes process.");
  }
  if (await probe(port)) {
    current.port = port;
    current.state = "running";
    current.token = await discoverProcessTokenByPort(port);
    current.lastMessage = current.token
      ? "This port already has a Hermes server. Kana will connect without taking ownership."
      : "This port already has a Hermes server, but its session token could not be read. Restart it from Kana to connect.";
    return publicStatus(current, true);
  }
  const executable = await resolveHermesExecutable();
  if (!executable) {
    throw new Error(
      "Hermes executable was not found automatically. Run `kana doctor`, then set hermes.executable in Kana's config.json if needed.",
    );
  }
  // The working folder is server configuration only; browsers cannot choose it.
  // Without one, Hermes works from the user's home rather than inheriting the
  // Kana server's cwd, which for the npm launcher is the package's own runtime
  // directory inside node_modules (replaced on every update).
  let workingDirectory = homedir();
  const configuredWorkingDirectory = readKanaUserConfig().hermes?.workingDirectory;
  if (configuredWorkingDirectory) {
    workingDirectory = path.resolve(configuredWorkingDirectory);
    const details = await stat(workingDirectory);
    if (!details.isDirectory()) throw new Error("Hermes working folder is not a directory.");
  }

  // Kana mints the session token itself. Callers cannot inject one, and the
  // value never leaves this process: the browser reaches Hermes only through
  // the server-side relay (/api/hermes/*).
  const token = mintSessionToken();
  current.state = "starting";
  current.port = port;
  current.executable = executable;
  current.token = token;
  current.lastMessage = "Starting the official Hermes UI gateway…";
  const child = spawn(
    /* turbopackIgnore: true */ executable,
    ["serve", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: workingDirectory,
      env: {
        ...process.env,
        [HERMES_TOKEN_ENV]: token,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  current.child = child;
  const updateMessage = (chunk: Buffer) => {
    const line = chunk.toString("utf8").trim().split(/\r?\n/).at(-1);
    if (line) current.lastMessage = line.slice(0, 300);
  };
  child.stdout?.on("data", updateMessage);
  child.stderr?.on("data", updateMessage);
  child.once("exit", (code, signal) => {
    current.child = null;
    current.token = null;
    current.state = code === 0 || signal === "SIGTERM" ? "stopped" : "failed";
    current.lastMessage =
      code === 0 || signal === "SIGTERM"
        ? "Hermes stopped."
        : `Hermes exited unexpectedly (${signal ?? `code ${code ?? "unknown"}`}).`;
  });
  child.once("error", (error) => {
    current.state = "failed";
    current.token = null;
    current.lastMessage = error.message;
  });

  try {
    await waitUntilReady(current);
    current.state = "running";
    current.lastMessage = "Hermes UI gateway is ready.";
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    current.state = "failed";
    current.token = null;
    current.lastMessage = error instanceof Error ? error.message : "Hermes failed to start.";
    throw error;
  }
  return publicStatus(current, true);
}

export async function stopLocalHermesRuntime(): Promise<LocalHermesRuntimeStatus> {
  const current = runtime();
  const child = current.child;
  if (!child || child.exitCode !== null) {
    current.child = null;
    current.state = (await probe(current.port)) ? "running" : "stopped";
    current.lastMessage =
      current.state === "running"
        ? "This Hermes server was not started by Kana, so Kana will not stop it."
        : "Hermes is already stopped.";
    return publicStatus(current, true);
  }
  current.state = "stopping";
  current.lastMessage = "Stopping the Hermes process started by Kana…";
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, STOP_GRACE_MS)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  current.child = null;
  current.token = null;
  current.state = "stopped";
  current.lastMessage = "Hermes stopped.";
  return publicStatus(current, true);
}

/**
 * Re-discover the gateway after a failed connection. A Hermes that Kana did
 * not start may have been restarted with a new token (or on another port)
 * since it was adopted; a child Kana manages keeps its own minted token.
 */
export async function refreshHermesRuntimeTarget(): Promise<{ port: number; token: string | null }> {
  const current = runtime();
  if (current.child && current.child.exitCode === null) {
    return { port: current.port, token: current.token };
  }
  current.token = null;
  await inspectLocalHermesRuntime();
  return { port: current.port, token: current.token };
}
