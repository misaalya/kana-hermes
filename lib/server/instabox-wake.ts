import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { remoteHealthUrl, remoteHermesConnection } from "./remote-hermes";
import type { KanaInstaboxConfig, KanaRemoteHermesConfig } from "./user-config";

// Instabox pauses an idle VM, and the only supported way to wake it is the
// operator-installed `instabox` CLI. Kana runs exactly two fixed subcommands
// with one validated machine id, never a shell and never anything a browser
// supplies. The wake request is authenticated, single-flight, and followed by
// a health poll so a command that exits early cannot report success.

const POLL_INTERVAL_MS = 2_000;
const COMMAND_TIMEOUT_MS = 45_000;
const PROBE_TIMEOUT_MS = 5_000;
const COOLDOWN_MS = 15_000;

export type InstaboxWakeResult = {
  alreadyUp: boolean;
  woke: boolean;
  elapsedMs: number;
};

export type InstaboxMachineStatus = {
  /** The machine is running or starting: a wake would be a no-op. */
  awake: boolean;
  state: string;
  ready: boolean;
};

const STATUS_TIMEOUT_MS = 10_000;
const STATUS_OUTPUT_LIMIT = 64 * 1024;

export type InstaboxWakeErrorCode = "unavailable" | "busy" | "timeout" | "failed";

export class InstaboxWakeError extends Error {
  constructor(
    message: string,
    readonly code: InstaboxWakeErrorCode,
    readonly status: 400 | 429 | 502 | 504,
  ) {
    super(message);
  }
}

type WakeState = {
  running: Promise<InstaboxWakeResult> | null;
  finishedAt: number;
};

const wakeKey = Symbol.for("kana.instaboxWake");
type WakeGlobal = typeof globalThis & { [wakeKey]?: WakeState };

function state(): WakeState {
  const shared = globalThis as WakeGlobal;
  shared[wakeKey] ??= { running: null, finishedAt: 0 };
  return shared[wakeKey];
}

const BASE_WAKE_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TZ",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
];

function wakeEnvironment(
  env: NodeJS.ProcessEnv,
  extra: string[] = [],
): Record<string, string | undefined> {
  const child: Record<string, string | undefined> = {};
  for (const key of new Set([...BASE_WAKE_ENV, ...extra])) {
    if (key.startsWith("KANA_") || key === "HERMES_DASHBOARD_SESSION_TOKEN") continue;
    if (env[key] !== undefined) child[key] = env[key];
  }
  return child;
}

type CommandResult = "ok" | "failed" | "unavailable";

function runCommand(
  executable: string,
  args: string[],
  timeoutMs: number,
  extraEnv: string[],
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        shell: false,
        cwd: homedir(),
        env: wakeEnvironment(process.env, extraEnv) as NodeJS.ProcessEnv,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      finish("unavailable");
      return;
    }
    let forceTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      forceTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        finish("failed");
      }, 2_000);
    }, Math.max(1, timeoutMs));
    child.once("error", () => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      finish("unavailable");
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      finish(code === 0 ? "ok" : "failed");
    });
  });
}

type ReadCommandResult = {
  status: "ok" | "failed" | "unavailable";
  stdout: string;
};

/** Runs one fixed CLI read and captures bounded stdout; never starts a shell. */
function readCommand(
  executable: string,
  args: string[],
  timeoutMs: number,
  extraEnv: string[],
): Promise<ReadCommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let timedOut = false;
    const finish = (status: ReadCommandResult["status"]) => {
      if (settled) return;
      settled = true;
      resolve({ status, stdout });
    };
    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        shell: false,
        cwd: homedir(),
        env: wakeEnvironment(process.env, extraEnv) as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      finish("unavailable");
      return;
    }
    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      stdout += chunk.toString("utf8");
      if (stdout.length > STATUS_OUTPUT_LIMIT) {
        stdout = stdout.slice(0, STATUS_OUTPUT_LIMIT);
        try { child.kill("SIGKILL"); } catch {}
        finish("failed");
      }
    });
    let forceTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch {}
      forceTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        finish("failed");
      }, 2_000);
    }, Math.max(1, timeoutMs));
    child.once("error", () => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      finish("unavailable");
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      finish(code === 0 && !timedOut ? "ok" : "failed");
    });
  });
}

async function healthy(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
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

async function waitUntilHealthy(url: string, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    if (await healthy(url)) return true;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}

function wakeConfig(remote: KanaRemoteHermesConfig): KanaInstaboxConfig {
  if (!remote.instabox) {
    throw new InstaboxWakeError(
      "No Instabox machine is configured for the remote Hermes gateway.",
      "unavailable",
      400,
    );
  }
  return remote.instabox;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Reads the configured machine without touching it. The gate uses this to
 * gray out a wake that would be a no-op, so only a paused or stopped machine
 * offers the action.
 */
export async function instaboxMachineStatus(): Promise<InstaboxMachineStatus> {
  const connection = remoteHermesConnection();
  if (!connection) {
    throw new InstaboxWakeError(
      "Kana is not configured for a remote Hermes gateway.",
      "unavailable",
      400,
    );
  }
  const instabox = wakeConfig(connection.config);
  const executable = instabox.executable ?? "instabox";
  const result = await readCommand(
    executable,
    ["get", instabox.machineId, "--json"],
    STATUS_TIMEOUT_MS,
    instabox.env ?? [],
  );
  if (result.status === "unavailable") {
    throw new InstaboxWakeError(
      "The Instabox CLI could not be started on the machine running Kana.",
      "failed",
      502,
    );
  }
  if (result.status !== "ok") {
    throw new InstaboxWakeError(
      "The Instabox CLI could not report the machine status.",
      "failed",
      502,
    );
  }
  let body: unknown = null;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    body = null;
  }
  const record = asRecord(body);
  const state = typeof record?.state === "string" ? record.state : "";
  if (!state) {
    throw new InstaboxWakeError(
      "The Instabox CLI returned an unreadable machine status.",
      "failed",
      502,
    );
  }
  const runtime = asRecord(record?.runtime);
  return {
    // A booting machine is already on its way up; only paused or stopped
    // machines have a wake left to run.
    awake: state === "running" || state === "starting" || state === "resuming",
    state,
    ready: runtime?.ready === true,
  };
}

async function runWake(
  remote: KanaRemoteHermesConfig,
  instabox: KanaInstaboxConfig,
  startedAt: number,
  deadline: number,
): Promise<InstaboxWakeResult> {
  const healthUrl = remoteHealthUrl(remote);
  const executable = instabox.executable ?? "instabox";
  const resumeBudget = Math.min(COMMAND_TIMEOUT_MS, Math.max(1, deadline - Date.now()));
  // An idle Instabox is paused; `resume` restores it with its processes. A
  // stopped sandbox needs `start`. The CLI has no `wake` subcommand.
  const resumeResult = await runCommand(
    executable,
    ["resume", instabox.machineId],
    resumeBudget,
    instabox.env ?? [],
  );
  let reachable = resumeResult !== "unavailable";
  if (resumeResult !== "ok" && Date.now() < deadline) {
    const startBudget = Math.min(COMMAND_TIMEOUT_MS, Math.max(1, deadline - Date.now()));
    const startResult = await runCommand(
      executable,
      ["start", instabox.machineId],
      startBudget,
      instabox.env ?? [],
    );
    reachable ||= startResult !== "unavailable";
  }
  if (!reachable) {
    throw new InstaboxWakeError(
      "The Instabox CLI could not be started on the machine running Kana.",
      "failed",
      502,
    );
  }
  const ready = await waitUntilHealthy(healthUrl, deadline);
  return { alreadyUp: false, woke: ready, elapsedMs: Date.now() - startedAt };
}

export async function wakeRemoteHermes(): Promise<InstaboxWakeResult> {
  const connection = remoteHermesConnection();
  if (!connection) {
    throw new InstaboxWakeError(
      "Kana is not configured for a remote Hermes gateway.",
      "unavailable",
      400,
    );
  }
  const instabox = wakeConfig(connection.config);
  const healthUrl = remoteHealthUrl(connection.config);
  if (await healthy(healthUrl)) {
    return { alreadyUp: true, woke: true, elapsedMs: 0 };
  }

  const current = state();
  if (current.running) return current.running;
  if (Date.now() - current.finishedAt < COOLDOWN_MS) {
    throw new InstaboxWakeError(
      "An Instabox wake just finished; wait a moment before trying again.",
      "busy",
      429,
    );
  }

  const startedAt = Date.now();
  const deadline = startedAt + (instabox.timeoutSeconds ?? 120) * 1_000;
  const running = runWake(connection.config, instabox, startedAt, deadline).then(
    (result) => {
      if (!result.woke) {
        throw new InstaboxWakeError(
          "Instabox did not bring Hermes online before the timeout. Make sure `hermes serve` runs on the remote machine.",
          "timeout",
          504,
        );
      }
      return result;
    },
  );
  current.running = running;
  try {
    return await running;
  } finally {
    current.running = null;
    current.finishedAt = Date.now();
  }
}
