import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  QWEN3_TTS_API_VERSION,
  QWEN3_TTS_SERVICE_NAME,
} from "@/lib/voice/qwen3-tts-contract";

// Server-side custody of the local Qwen3-TTS service process.
//
// Mirrors `local-hermes-runtime.ts`: the browser never talks to the engine
// directly. Kana's Node server discovers an already-running instance, adopts
// it, or spawns `services/qwen3-tts/server.mjs` — a zero-dependency adapter
// that drives the pure-C qwen3-tts engine (no Python/PyTorch). The adapter
// binds to loopback only; the only public surface is Kana's own
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
const PROJECT_DIR_ENV = "KANA_QWEN3_TTS_PROJECT_DIR";

function moduleDirectory(): string | null {
  try {
    if (typeof __dirname === "string" && __dirname.length > 0) return __dirname;
  } catch {
    // ESM: __dirname does not exist here.
  }
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
}

// Resolution order: KANA_QWEN3_TTS_PROJECT_DIR → this module's location →
// cwd. Each candidate must contain server.mjs so a bundled/standalone
// module path never wins over a real checkout, and a systemd unit with a
// different WorkingDirectory still resolves the service source.
async function resolveProjectDir(): Promise<string> {
  const fromEnv = process.env[PROJECT_DIR_ENV]?.trim();
  const moduleDir = moduleDirectory();
  const candidates = [
    ...(fromEnv ? [path.resolve(fromEnv)] : []),
    ...(moduleDir
      ? [path.resolve(moduleDir, "..", "..", "services", "qwen3-tts")]
      : []),
    path.resolve(process.cwd(), "services", "qwen3-tts"),
  ];
  for (const candidate of candidates) {
    try {
      accessSync(path.join(candidate, "server.mjs"), constants.R_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  // Nothing verified: fail against the most explicit candidate so the start
  // error names the misconfiguration instead of silently probing elsewhere.
  return candidates[0];
}

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

/** Test hook: install a known port without spawning a process. Passing null
 * also removes the DEFAULT_TTS_PORT fallback candidate so tests stay
 * independent of whatever happens to listen on the host's real 7860. */
export const __setTestTtsPort = (port: number | null): void => {
  runtime().port = port ?? 0;
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

// Same resolution rules as services/qwen3-tts/server.mjs so the supervisor's
// "configured?" check cannot disagree with what the adapter will actually use.
function engineConfigured(): boolean {
  const engineDir =
    process.env.KANA_TTS_ENGINE_DIR?.trim() ||
    path.join(os.homedir(), ".local/share/kana/qwen3-tts-engine");
  const engineBin =
    process.env.KANA_TTS_ENGINE_BIN?.trim() || path.join(engineDir, "qwen_tts");
  const modelDir =
    process.env.KANA_TTS_MODEL_DIR?.trim() ||
    path.join(engineDir, "qwen3-tts-0.6b-base");
  try {
    return (
      existsSync(engineBin) &&
      statSync(engineBin).isFile() &&
      existsSync(path.join(modelDir, "model.safetensors"))
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type Qwen3TtsHealthProbe =
  | { kind: "ready" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "foreign" }
  | { kind: "unreachable" };

// Classifies /v1/health instead of trusting any HTTP 200: only a payload that
// identifies itself as this Kana service (D6 adoption guard) can be adopted,
// and "loading"/"error" statuses stay distinct from "ready" (D5 cold start).
async function probeHealth(
  port: number,
  timeoutMs = 750,
): Promise<Qwen3TtsHealthProbe> {  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return { kind: "foreign" };
    const value: unknown = await response.json();
    if (
      !isRecord(value) ||
      value.service !== QWEN3_TTS_SERVICE_NAME ||
      value.api_version !== QWEN3_TTS_API_VERSION
    ) {
      return { kind: "foreign" };
    }
    if (value.status === "ready") return { kind: "ready" };
    if (value.status === "loading") return { kind: "loading" };
    if (value.status === "error") {
      return {
        kind: "error",
        message:
          typeof value.error === "string" && value.error.length > 0
            ? value.error
            : "The Qwen3-TTS model failed to load.",
      };
    }
    return { kind: "foreign" };
  } catch {
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function adoptableHealth(probe: Qwen3TtsHealthProbe): boolean {
  return probe.kind === "ready" || probe.kind === "loading" || probe.kind === "error";
}

function externalServiceMessage(probe: Qwen3TtsHealthProbe, port: number): string {
  switch (probe.kind) {
    case "ready":
      return `A Qwen3-TTS service was found on port ${port}.`;
    case "loading":
      return `A Qwen3-TTS service was found on port ${port}; the model is still loading.`;
    case "error":
      return `A Qwen3-TTS service was found on port ${port} but its model failed to load.`;
    case "foreign":
    case "unreachable":
      return "";
  }
}

function managedServiceMessage(probe: Qwen3TtsHealthProbe): string {
  switch (probe.kind) {
    case "ready":
      return "Qwen3-TTS is running under Kana.";
    case "loading":
      return "Qwen3-TTS is running under Kana; the model is still loading.";
    case "error":
      return `Qwen3-TTS is running under Kana but failed to load: ${probe.message}`;
    case "foreign":
    case "unreachable":
      return "Qwen3-TTS is running under Kana.";
  }
}

export async function inspectLocalQwen3TtsRuntime(
  preferredPort?: number,
): Promise<LocalQwen3TtsRuntimeStatus> {
  const current = runtime();

  // A managed child owns its port exclusively.
  if (current.child && current.child.exitCode === null) {
    const health = await probeHealth(current.port);
    if (adoptableHealth(health)) {
      current.state = "running";
      current.lastMessage = managedServiceMessage(health);
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

  // External instance already running on the preferred or configured port?
  // When a test nulls the configured port (0), the DEFAULT_TTS_PORT fallback
  // is skipped so tests stay independent of the host's real 7860.
  const candidates = [
    preferredPort,
    current.port >= 1024 ? current.port : undefined,
    // DEFAULT_TTS_PORT only applies while the configured port is untouched;
    // a test that nulls it (port 0) must never probe the host's real 7860.
    runtime().port === DEFAULT_TTS_PORT ? DEFAULT_TTS_PORT : undefined,
  ].filter(
    (value): value is number =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1024 &&
      value <= 65_535,
  );
  for (const port of new Set(candidates)) {
    const health = await probeHealth(port);
    if (!adoptableHealth(health)) continue;
    current.port = port;
    current.child = null;
    current.state = "external";
    current.lastMessage = externalServiceMessage(health, port);
    current.stderrTail = [];
    return publicStatus(current);
  }

  if (current.state !== "starting" && current.state !== "stopping") {
    current.state = current.child && current.child.exitCode !== null ? "failed" : "stopped";
  }
  if (!engineConfigured()) {
    current.lastMessage =
      "The qwen3-tts engine was not found; run scripts/setup-qwen3-tts-engine.sh or set KANA_TTS_ENGINE_DIR.";
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
    // The adapter answers 200 with status "ready" only after the engine and
    // model files exist; a reported load error fails fast instead of burning
    // the whole deadline.
    const health = await probeHealth(current.port, 1_000);
    if (health.kind === "ready") return;
    if (health.kind === "error") throw new Error(health.message);
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
  const existing = await probeHealth(port);
  if (adoptableHealth(existing)) {
    current.port = port;
    current.child = null;
    current.state = "external";
    current.lastMessage = externalServiceMessage(existing, port);
    return publicStatus(current);
  }
  if (!engineConfigured()) {
    current.state = "failed";
    current.lastMessage =
      "The qwen3-tts engine was not found on this machine; run scripts/setup-qwen3-tts-engine.sh or set KANA_TTS_ENGINE_DIR.";
    throw new Error(current.lastMessage);
  }
  const projectDir = await resolveProjectDir();
  try {
    accessSync(path.join(projectDir, "server.mjs"), constants.R_OK);
  } catch {
    current.state = "failed";
    current.lastMessage = `The Qwen3-TTS adapter script is missing: ${projectDir}`;
    throw new Error(current.lastMessage);
  }

  current.port = port;
  current.state = "starting";
  current.stderrTail = [];
  current.lastMessage = "Starting the Qwen3-TTS service…";

  const child = spawn(process.execPath, [path.join(projectDir, "server.mjs")], {
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

export type Qwen3TtsServiceReadiness =
  | { ready: true; port: number }
  | { ready: false; reason: "loading" | "error" | "stopped" };

/** Cheap readiness probe: adopts an already-running service but never spawns. */
export async function getQwen3TtsServiceReadiness(): Promise<Qwen3TtsServiceReadiness> {
  const inspected = await inspectLocalQwen3TtsRuntime();
  if (inspected.state !== "running" && inspected.state !== "external") {
    return { ready: false, reason: "stopped" };
  }
  const health = await probeHealth(inspected.port);
  switch (health.kind) {
    case "ready":
      return { ready: true, port: inspected.port };
    case "loading":
      return { ready: false, reason: "loading" };
    case "error":
      return { ready: false, reason: "error" };
    default:
      return { ready: false, reason: "stopped" };
  }
}

export type Qwen3TtsHealthKind = Qwen3TtsHealthProbe["kind"];

/** Raw health classification for one candidate port (no adoption, no spawn). */
export async function probeQwen3TtsHealthKind(port: number): Promise<Qwen3TtsHealthKind> {
  return (await probeHealth(port)).kind;
}

export type EnsureQwen3TtsResult =
  | { ok: true; status: LocalQwen3TtsRuntimeStatus }
  | { ok: false; status: LocalQwen3TtsRuntimeStatus };

const ensureKey = Symbol.for("kana.localQwen3TtsEnsure");
type EnsureGlobal = typeof globalThis & {
  [ensureKey]?: Promise<EnsureQwen3TtsResult>;
};

// Ensure-on-use with a single-flight guard: concurrent relay requests share
// one discovery/spawn attempt instead of racing to spawn two children. This
// is the ONLY spawn entry point — control start/restart and status kicks use
// this same flight, never startLocalQwen3TtsRuntime directly.
export async function ensureQwen3TTSService(): Promise<EnsureQwen3TtsResult> {
  const shared = globalThis as EnsureGlobal;
  shared[ensureKey] ??= (async (): Promise<EnsureQwen3TtsResult> => {
    const inspected = await inspectLocalQwen3TtsRuntime();
    if (inspected.state === "running" || inspected.state === "external") {
      return { ok: true, status: inspected };
    }
    try {
      return { ok: true, status: await startLocalQwen3TtsRuntime({}) };
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
