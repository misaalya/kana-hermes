import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { remoteHealthUrl, remoteHermesConnection } from "./remote-hermes";
import type { KanaInstaboxWakeConfig, KanaRemoteHermesConfig } from "./user-config";

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

function wakeConfig(remote: KanaRemoteHermesConfig): KanaInstaboxWakeConfig {
  if (!remote.wake) {
    throw new InstaboxWakeError(
      "No Instabox wake is configured for the remote Hermes gateway.",
      "unavailable",
      400,
    );
  }
  return remote.wake;
}

async function runWake(
  remote: KanaRemoteHermesConfig,
  wake: KanaInstaboxWakeConfig,
  startedAt: number,
  deadline: number,
): Promise<InstaboxWakeResult> {
  const healthUrl = remoteHealthUrl(remote);
  const executable = wake.executable ?? "instabox";
  const resumeBudget = Math.min(COMMAND_TIMEOUT_MS, Math.max(1, deadline - Date.now()));
  // An idle Instabox is paused; `resume` restores it with its processes. A
  // stopped sandbox needs `start`. The CLI has no `wake` subcommand.
  const resumeResult = await runCommand(
    executable,
    ["resume", wake.machineId],
    resumeBudget,
    wake.env ?? [],
  );
  let reachable = resumeResult !== "unavailable";
  if (resumeResult !== "ok" && Date.now() < deadline) {
    const startBudget = Math.min(COMMAND_TIMEOUT_MS, Math.max(1, deadline - Date.now()));
    const startResult = await runCommand(
      executable,
      ["start", wake.machineId],
      startBudget,
      wake.env ?? [],
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
  const wake = wakeConfig(connection.config);
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
  const deadline = startedAt + (wake.timeoutSeconds ?? 120) * 1_000;
  const running = runWake(connection.config, wake, startedAt, deadline).then(
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
