import { randomBytes } from "node:crypto";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import { readKanaUserConfig } from "./user-config";

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

const DEFAULT_HERMES_PORT = 9119;

function configuredHermesPort(): number {
  return readKanaUserConfig().hermes?.port ?? DEFAULT_HERMES_PORT;
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

export type HermesExecutableCandidateInput = {
  explicit?: string | null;
  configured?: string | null;
  pathValue?: string | null;
  home?: string | null;
  hermesHome?: string | null;
  installDirectory?: string | null;
  prefix?: string | null;
  localAppData?: string | null;
  userProfile?: string | null;
  operatingSystem?: NodeJS.Platform;
};

/** Ordered, absolute candidates shared by source, deployment, and npm starts. */
export function hermesExecutableCandidates(
  input: HermesExecutableCandidateInput,
): string[] {
  const operatingSystem = input.operatingSystem ?? platform();
  const windows = operatingSystem === "win32";
  const executableName = windows ? "hermes.exe" : "hermes";
  const home = input.home?.trim() || null;
  const hermesHome = input.hermesHome?.trim()
    || (home ? path.join(home, ".hermes") : null);
  const installDirectory = input.installDirectory?.trim() || null;
  const candidates: Array<string | null | undefined> = [
    input.explicit?.trim(),
    input.configured?.trim(),
    ...(input.pathValue || "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((directory) => path.join(directory, executableName)),
    hermesHome ? path.join(hermesHome, "bin", executableName) : null,
    hermesHome ? path.join(hermesHome, "venv", "bin", executableName) : null,
    hermesHome
      ? path.join(hermesHome, "hermes-agent", "venv", "bin", executableName)
      : null,
    installDirectory
      ? path.join(
          /* turbopackIgnore: true */ installDirectory,
          "venv",
          "bin",
          executableName,
        )
      : null,
    installDirectory
      ? path.join(/* turbopackIgnore: true */ installDirectory, executableName)
      : null,
    home ? path.join(home, ".local", "bin", executableName) : null,
    input.prefix?.trim()
      ? path.join(input.prefix.trim(), "bin", executableName)
      : null,
    windows && input.localAppData?.trim()
      ? path.join(input.localAppData.trim(), "hermes", "bin", executableName)
      : null,
    windows && input.userProfile?.trim()
      ? path.join(input.userProfile.trim(), ".local", "bin", executableName)
      : null,
    windows ? null : "/usr/local/bin/hermes",
    windows ? null : "/usr/bin/hermes",
  ];
  return [...new Set(
    candidates
      .filter((value): value is string => Boolean(value))
      .map((value) => path.resolve(value)),
  )];
}

async function resolveHermesExecutable(): Promise<string | null> {
  const fromEnvironment = process.env.KANA_HERMES_BIN?.trim();
  if (fromEnvironment && !path.isAbsolute(fromEnvironment)) {
    throw new Error("KANA_HERMES_BIN must be an absolute path.");
  }
  const configured = readKanaUserConfig().hermes?.executable;
  const candidates = hermesExecutableCandidates({
    explicit: fromEnvironment,
    configured,
    pathValue: process.env.PATH,
    home: process.env.HOME?.trim() || homedir(),
    hermesHome: process.env.HERMES_HOME,
    installDirectory: process.env.HERMES_INSTALL_DIR,
    prefix: process.env.PREFIX,
    localAppData: process.env.LOCALAPPDATA,
    userProfile: process.env.USERPROFILE,
  });
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

async function scanRunningHermesProcesses(): Promise<Array<{ pid: number; port: number }>> {
  try {
    const output = execSync("pgrep -af 'hermes serve'", {
      encoding: "utf8",
      timeout: 2_000,
    });
    const results: Array<{ pid: number; port: number }> = [];
    for (const line of output.trim().split("\n")) {
      if (!line.trim()) continue;
      const match = line.match(/^(\d+)\s+.+--port\s+(\d+)/);
      if (match) {
        const pid = Number(match[1]);
        const port = Number(match[2]);
        if (pid > 0 && port >= 1024 && port <= 65535 && !results.some((r) => r.port === port)) {
          results.push({ pid, port });
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function readProcessToken(pid: number): Promise<string | null> {
  try {
    const env = await readFile(`/proc/${pid}/environ`, "utf8");
    for (const entry of env.split("\0")) {
      if (entry.startsWith("HERMES_DASHBOARD_SESSION_TOKEN=")) {
        const value = entry.slice("HERMES_DASHBOARD_SESSION_TOKEN=".length);
        return value.length > 0 ? value : null;
      }
    }
  } catch {}
  return null;
}

/** Best-effort: find the session token of a `hermes serve` on a given port. */
async function discoverProcessTokenByPort(port: number): Promise<string | null> {
  for (const proc of await scanRunningHermesProcesses()) {
    if (proc.port === port) return readProcessToken(proc.pid);
  }
  return null;
}

function mintSessionToken(): string {
  return randomBytes(24).toString("hex");
}

function endpoint(port: number): string {
  return `ws://127.0.0.1:${port}/api/ws`;
}

async function probe(port: number, timeoutMs = 750): Promise<boolean> {
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
  const processes = await scanRunningHermesProcesses();
  for (const proc of processes) {
    if (proc.port === current.port && (await probe(proc.port))) {
      current.state = "running";
      current.child = null;
      current.token = (await readProcessToken(proc.pid)) ?? current.token;
      current.lastMessage = `Hermes already running on port ${proc.port}.`;
      return publicStatus(current, true);
    }
  }
  for (const proc of processes) {
    if (await probe(proc.port)) {
      current.port = proc.port;
      current.state = "running";
      current.child = null;
      current.token = (await readProcessToken(proc.pid)) ?? current.token;
      current.lastMessage = `A Hermes gateway was found on port ${proc.port}.`;
      return publicStatus(current, true);
    }
  }

  // Fallback: probe candidate ports.
  const candidates: number[] = [];
  for (const port of [preferredPort, configuredPort, current.port, DEFAULT_HERMES_PORT]) {
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
  cwd?: string;
}): Promise<LocalHermesRuntimeStatus> {
  const configuredPort = configuredHermesPort();
  const port = options.port === DEFAULT_HERMES_PORT ? configuredPort : options.port;
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
  let workingDirectory: string | undefined;
  const configuredWorkingDirectory = readKanaUserConfig().hermes?.workingDirectory;
  const requestedWorkingDirectory = options.cwd?.trim() || configuredWorkingDirectory;
  if (requestedWorkingDirectory) {
    workingDirectory = path.resolve(requestedWorkingDirectory);
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
        HERMES_DASHBOARD_SESSION_TOKEN: token,
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
    new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  current.child = null;
  current.token = null;
  current.state = "stopped";
  current.lastMessage = "Hermes stopped.";
  return publicStatus(current, true);
}
