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

const runtimeKey = Symbol.for("kana.localHermesRuntime");
type RuntimeGlobal = typeof globalThis & { [runtimeKey]?: ManagedRuntime };

function runtime(): ManagedRuntime {
  const shared = globalThis as RuntimeGlobal;
  shared[runtimeKey] ??= {
    child: null,
    state: "stopped",
    port: 9119,
    lastMessage: "Hermes is not running under Kana.",
  };
  return shared[runtimeKey];
}

export function localRuntimeControlEnabled(): boolean {
  return process.env.KANA_LOCAL_RUNTIME_CONTROL === "1";
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

export async function inspectLocalHermesRuntime(): Promise<LocalHermesRuntimeStatus> {
  const current = runtime();
  const enabled = localRuntimeControlEnabled();
  if (!enabled) return publicStatus(current, false);
  current.executable ??= (await resolveHermesExecutable()) ?? undefined;
  if (current.child && current.child.exitCode === null && await probe(current.port)) {
    current.state = "running";
    current.lastMessage = "Hermes UI gateway is running under Kana.";
  } else if (!current.child && await probe(current.port)) {
    current.state = "running";
    current.lastMessage =
      "A Hermes server is already using this port. Kana can connect to it but will not stop it.";
  } else if (current.state !== "starting" && current.state !== "stopping") {
    current.state = current.child && current.child.exitCode !== null ? "failed" : "stopped";
  }
  if (!current.executable) {
    current.lastMessage = "Hermes was not found. Install Hermes or set KANA_HERMES_BIN.";
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
  if (!localRuntimeControlEnabled()) {
    throw new Error("Start Kana through the `kana` launcher to control Hermes here.");
  }
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
  if (!localRuntimeControlEnabled()) {
    throw new Error("Start Kana through the `kana` launcher to control Hermes here.");
  }
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
