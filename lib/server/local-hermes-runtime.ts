import { spawn, type ChildProcess } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

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
  lastMessage: string;
};

const DEFAULT_HERMES_PORT = 9119;

const runtimeKey = Symbol.for("kana.localHermesRuntime");
type RuntimeGlobal = typeof globalThis & { [runtimeKey]?: ManagedRuntime };

function runtime(): ManagedRuntime {
  const shared = globalThis as RuntimeGlobal;
  shared[runtimeKey] ??= {
    child: null,
    state: "stopped",
    port: DEFAULT_HERMES_PORT,
    lastMessage: "Hermes is not running under Kana.",
  };
  return shared[runtimeKey];
}

export function localRuntimeControlEnabled(): boolean {
  return true;
}

async function resolveHermesExecutable(): Promise<string | null> {
  const explicit = process.env.KANA_HERMES_BIN?.trim();
  const windowsLocalAppData = process.env.LOCALAPPDATA?.trim();
  const windowsUserProfile = process.env.USERPROFILE?.trim();
  const unixHome = process.env.HOME?.trim();
  const candidates = [
    explicit,
    windowsLocalAppData
      ? path.join(windowsLocalAppData, "hermes", "bin", "hermes.exe")
      : undefined,
    windowsUserProfile
      ? path.join(windowsUserProfile, ".local", "bin", "hermes.exe")
      : undefined,
    unixHome ? path.join(unixHome, ".local", "bin", "hermes") : undefined,
    "/usr/local/bin/hermes",
    "/usr/bin/hermes",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through known user-local and system locations.
    }
  }
  return null;
}

function endpoint(port: number): string {
  return `ws://127.0.0.1:${port}/api/ws`;
}

async function probe(port: number, timeoutMs = 750): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/status`, {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
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

  // No managed child: detect an existing `hermes serve` on the user's machine.
  // Probe the preferred port first (the configured WebSocket URL), then the
  // Hermes default, then whatever port a previous inspection used.
  const candidates: number[] = [];
  for (const port of [preferredPort, DEFAULT_HERMES_PORT, current.port]) {
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
    current.lastMessage = `A Hermes gateway is already running on port ${detectedPort}. Enter its session token to connect.`;
    return publicStatus(current, true);
  }

  if (current.state !== "starting" && current.state !== "stopping") {
    current.state = current.child && current.child.exitCode !== null ? "failed" : "stopped";
  }
  if (!current.executable) {
    current.lastMessage = "Hermes was not found. Install Hermes or set KANA_HERMES_BIN.";
  } else if (current.state === "stopped") {
    current.lastMessage = "No running Hermes gateway was detected on this machine.";
  }
  return publicStatus(current, true);
}

async function waitUntilReady(current: ManagedRuntime): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (current.child?.exitCode !== null) {
      throw new Error(current.lastMessage || "Hermes exited before becoming ready.");
    }
    if (await probe(current.port, 1_000)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Hermes did not become ready within 30 seconds.");
}

export async function startLocalHermesRuntime(options: {
  port: number;
  token: string;
  cwd?: string;
}): Promise<LocalHermesRuntimeStatus> {
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65_535) {
    throw new Error("Hermes port must be an integer between 1024 and 65535.");
  }
  if (options.token.length < 12 || options.token.length > 512) {
    throw new Error("Hermes session token must contain between 12 and 512 characters.");
  }
  const current = runtime();
  if (current.child && current.child.exitCode === null) {
    throw new Error("Kana already manages a running Hermes process.");
  }
  if (await probe(options.port)) {
    current.port = options.port;
    current.state = "running";
    current.lastMessage =
      "This port already has a Hermes server. Kana will connect without taking ownership.";
    return publicStatus(current, true);
  }
  const executable = await resolveHermesExecutable();
  if (!executable) throw new Error("Hermes executable was not found on this machine.");
  let workingDirectory: string | undefined;
  if (options.cwd?.trim()) {
    workingDirectory = path.resolve(options.cwd.trim());
    const details = await stat(workingDirectory);
    if (!details.isDirectory()) throw new Error("Hermes working folder is not a directory.");
  }

  current.state = "starting";
  current.port = options.port;
  current.executable = executable;
  current.lastMessage = "Starting the official Hermes UI gateway…";
  const child = spawn(
    executable,
    ["serve", "--host", "127.0.0.1", "--port", String(options.port)],
    {
      cwd: workingDirectory,
      env: {
        ...process.env,
        HERMES_DASHBOARD_SESSION_TOKEN: options.token,
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
    current.state = code === 0 || signal === "SIGTERM" ? "stopped" : "failed";
    current.lastMessage =
      code === 0 || signal === "SIGTERM"
        ? "Hermes stopped."
        : `Hermes exited unexpectedly (${signal ?? `code ${code ?? "unknown"}`}).`;
  });
  child.once("error", (error) => {
    current.state = "failed";
    current.lastMessage = error.message;
  });

  try {
    await waitUntilReady(current);
    current.state = "running";
    current.lastMessage = "Hermes UI gateway is ready.";
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    current.state = "failed";
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
    new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  current.child = null;
  current.state = "stopped";
  current.lastMessage = "Hermes stopped.";
  return publicStatus(current, true);
}
