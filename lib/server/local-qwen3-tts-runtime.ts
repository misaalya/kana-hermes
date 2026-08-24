import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

// Server-side custody of the local Qwen3-TTS service process.
//
// Mirrors `local-hermes-runtime.ts`: the browser never talks to the Python
// service directly. Kana's Node server discovers an already-running instance,
// adopts it, or spawns one via `uv run --project services/qwen3-tts`. The
// service binds to loopback only; the only public surface is Kana's own
// `/api/voice/tts/*` relay routes.

export type LocalQwen3TtsRuntimeStatus = {
  state: "stopped" | "starting" | "running" | "stopping" | "failed" | "external";
  managed: boolean;
  pid?: number;
  port: number;
  executable?: string;
  model?: string;
  device?: string;
  message: string;
};

type ManagedRuntime = {
  child: ChildProcess | null;
  state: LocalQwen3TtsRuntimeStatus["state"];
  executable?: string;
  port: number;
  lastMessage: string;
  stderrTail: string[];
};

const DEFAULT_TTS_PORT = Number(process.env.KANA_TTS_PORT ?? "7860");
const PROJECT_DIR = path.resolve(process.cwd(), "services/qwen3-tts");

const runtimeKey = Symbol.for("kana.localQwen3TtsRuntime");
type RuntimeGlobal = typeof globalThis & { [runtimeKey]?: ManagedRuntime };

function runtime(): ManagedRuntime {
  const shared = globalThis as RuntimeGlobal;
  shared[runtimeKey] ??= {
    child: null,
    state: "stopped",
    port: DEFAULT_TTS_PORT,
    lastMessage: "The Qwen3-TTS service is not running under Kana.",
    stderrTail: [],
  };
  return shared[runtimeKey];
}

/** Test hook: install a known port without spawning a process. */
export const __setTestTtsPort = (port: number): void => {
  runtime().port = port;
};

function publicStatus(current: ManagedRuntime): LocalQwen3TtsRuntimeStatus {
  return {
    state: current.state,
    managed: current.child !== null && current.child.exitCode === null,
    pid: current.child?.pid,
    port: current.port,
    executable: current.executable,
    model: process.env.KANA_TTS_MODEL,
    device: process.env.KANA_TTS_DEVICE ?? "cpu",
    message: current.lastMessage,
  };
}

function resolveUv(): string | null {
  if (process.env.KANA_TTS_UV_BIN) return process.env.KANA_TTS_UV_BIN;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "uv");
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- sync check at spawn time
      require("node:fs").accessSync(candidate);
      return candidate;
    } catch {
      // keep scanning
    }
  }
  return null;
}

async function probe(port: number, timeoutMs = 750): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      signal: controller.signal,
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function inspectLocalQwen3TtsRuntime(
  preferredPort?: number,
): Promise<LocalQwen3TtsRuntimeStatus> {
  const current = runtime();

  // A managed child owns its port exclusively.
  if (current.child && current.child.exitCode === null) {
    if (await probe(current.port)) {
      current.state = "running";
      current.lastMessage = "Qwen3-TTS is running under Kana.";
      return publicStatus(current);
    }
    if (current.state === "starting" || current.state === "stopping") {
      return publicStatus(current);
    }
    current.state = "failed";
    current.lastMessage =
      current.lastMessage || "The managed Qwen3-TTS process stopped responding.";
    return publicStatus(current);
  }

  // External instance already running on the default (or preferred) port?
  const candidates = [preferredPort, DEFAULT_TTS_PORT, current.port].filter(
    (value): value is number =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1024 &&
      value <= 65_535,
  );
  for (const port of new Set(candidates)) {
    if (await probe(port)) {
      current.port = port;
      current.child = null;
      current.state = "external";
      current.lastMessage = `A Qwen3-TTS service was found on port ${port}.`;
      current.stderrTail = [];
      return publicStatus(current);
    }
  }

  if (current.state !== "starting" && current.state !== "stopping") {
    current.state = current.child && current.child.exitCode !== null ? "failed" : "stopped";
  }
  if (!resolveUv()) {
    current.lastMessage =
      "The uv tool was not found on this machine; install uv or set KANA_TTS_UV_BIN.";
  } else if (current.state === "stopped") {
    current.lastMessage = "No running Qwen3-TTS service was detected on this machine.";
  }
  return publicStatus(current);
}

async function waitUntilReady(
  current: ManagedRuntime,
  deadlineMs: number,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (current.child && current.child.exitCode !== null) {
      throw new Error(
        current.lastMessage ||
          `The Qwen3-TTS process exited before becoming ready.${
            current.stderrTail.length ? ` Last output: ${current.stderrTail.join(" ").slice(-800)}` : ""
          }`,
      );
    }
    if (await probe(current.port, 1_000)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `The Qwen3-TTS service did not become ready within ${Math.round(deadlineMs / 1000)} seconds. First-time model downloads can take much longer; check the server logs.`,
  );
}

export async function startLocalQwen3TtsRuntime(options: {
  port?: number;
  readyTimeoutMs?: number;
}): Promise<LocalQwen3TtsRuntimeStatus> {
  const port =
    options.port ??
    (Number.isInteger(DEFAULT_TTS_PORT) && DEFAULT_TTS_PORT >= 1024
      ? DEFAULT_TTS_PORT
      : 7860);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("The TTS port must be an integer between 1024 and 65535.");
  }
  const current = runtime();
  if (current.child && current.child.exitCode === null) {
    throw new Error("Kana already manages a running Qwen3-TTS process.");
  }
  if (await probe(port)) {
    current.port = port;
    current.child = null;
    current.state = "external";
    current.lastMessage = `A Qwen3-TTS service is already running on port ${port}.`;
    return publicStatus(current);
  }
  const uv = resolveUv();
  if (!uv) {
    current.state = "failed";
    current.lastMessage =
      "The uv tool was not found on this machine; install uv or set KANA_TTS_UV_BIN.";
    throw new Error(current.lastMessage);
  }
  try {
    await access(PROJECT_DIR, constants.R_OK);
  } catch {
    current.state = "failed";
    current.lastMessage = `The Qwen3-TTS project directory is missing: ${PROJECT_DIR}`;
    throw new Error(current.lastMessage);
  }

  current.port = port;
  current.state = "starting";
  current.stderrTail = [];
  current.lastMessage = "Starting the Qwen3-TTS service…";

  const child = spawn(uv, ["run", "--project", PROJECT_DIR, "kana-qwen3-tts"], {
    env: {
      ...process.env,
      KANA_TTS_HOST: "127.0.0.1",
      KANA_TTS_PORT: String(port),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  current.child = child;
  child.stderr?.on("data", (chunk: Buffer) => {
    current.stderrTail.push(chunk.toString());
    if (current.stderrTail.length > 50) current.stderrTail.shift();
  });
  child.once("exit", (code) => {
    if (runtime().child === child) {
      current.state = code === 0 ? "stopped" : "failed";
      current.lastMessage =
        current.lastMessage ||
        `The Qwen3-TTS process exited with code ${code}.`;
    }
  });

  try {
    await waitUntilReady(current, options.readyTimeoutMs ?? 120_000);
  } catch (error) {
    current.lastMessage =
      error instanceof Error ? error.message : "The Qwen3-TTS service failed to start.";
    try {
      current.child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
    current.state = current.state === "starting" ? "failed" : current.state;
    throw error;
  }
  current.state = "running";
  current.lastMessage = "Qwen3-TTS is running under Kana.";
  return publicStatus(current);
}

export async function stopLocalQwen3TtsRuntime(): Promise<LocalQwen3TtsRuntimeStatus> {
  const current = runtime();
  if (current.child && current.child.exitCode === null) {
    current.state = "stopping";
    const child = current.child;
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
        resolve();
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });
      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(killTimer);
        resolve();
      }
    });
    current.state = "stopped";
    current.child = null;
    current.lastMessage = "The managed Qwen3-TTS process was stopped.";
    return publicStatus(current);
  }
  current.state = "stopped";
  current.lastMessage = "No managed Qwen3-TTS process was running.";
  return publicStatus(current);
}

export type EnsureQwen3TtsResult =
  | { ok: true; port: number; state: "running" | "external" }
  | { ok: false; status: LocalQwen3TtsRuntimeStatus };

const ensureKey = Symbol.for("kana.localQwen3TtsEnsure");
type EnsureGlobal = typeof globalThis & {
  [ensureKey]?: Promise<EnsureQwen3TtsResult>;
};

// Ensure-on-use with a single-flight guard: concurrent relay requests share
// one discovery/spawn attempt instead of racing to spawn two children.
export async function ensureQwen3TTSService(): Promise<EnsureQwen3TtsResult> {
  const shared = globalThis as EnsureGlobal;
  shared[ensureKey] ??= (async (): Promise<EnsureQwen3TtsResult> => {
    const inspected = await inspectLocalQwen3TtsRuntime();
    if (inspected.state === "running" || inspected.state === "external") {
      return { ok: true, port: inspected.port, state: inspected.state };
    }
    try {
      const started = await startLocalQwen3TtsRuntime();
      if (started.state === "external") {
        return { ok: true, port: started.port, state: "external" };
      }
      return { ok: true, port: started.port, state: "running" };
    } catch (error) {
      const status = await inspectLocalQwen3TtsRuntime();
      status.message =
        error instanceof Error ? error.message : status.message;
      return { ok: false, status };
    }
  })();
  try {
    return await shared[ensureKey];
  } finally {
    shared[ensureKey] = undefined;
  }
}
