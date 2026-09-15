import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { findExecutableSync } from "@/shared/executables.mjs";
import { resolveKanaDataDir } from "@/lib/server/data-dir";
import { readKanaUserConfig } from "@/lib/server/user-config";
import { currentIrodoriPlatform, type IrodoriPlatform } from "./platform";
import {
  IRODORI_ASSET_MEMBERS,
  IRODORI_ASSETS_ARCHIVE,
  IRODORI_ENGINE_ARCHIVE,
  IRODORI_ENGINE_MARKER,
  IRODORI_ENGINE_MEMBERS,
  IRODORI_ENGINE_VERSION,
  IRODORI_MODEL_FILE,
  IRODORI_MODEL_MARKER,
  IRODORI_MODEL_REPOSITORY,
  IRODORI_MODEL_REVISION,
  irodoriEngineInstalled,
  irodoriInstalledModel,
  irodoriInstallPaths,
  type IrodoriArtifact,
} from "./release";

// Lazy, verified installation of the local Irodori voice.
//
// Nothing is downloaded when Kana starts, when voice is off, or when another
// TTS provider is configured. The engine (~480 MB) and model (~3.1 GB) are
// fetched only after an explicit install request, into Kana's data root.
// Downloads resume after interruption, every file is checked against the
// pinned SHA-256 before use, and a matching model already present in the
// Hugging Face cache is reused instead of downloaded again.

export type IrodoriInstallStep = "engine" | "assets" | "model";
export type IrodoriInstallPhase = "downloading" | "verifying" | "extracting";

export type IrodoriInstallStatus = {
  state: "unsupported" | "not_installed" | "installing" | "ready" | "failed";
  engineInstalled: boolean;
  modelInstalled: boolean;
  /** "download" (Kana's copy), "huggingface-cache", or "config" (tts.irodoriLocal.modelPath). */
  modelSource: "download" | "huggingface-cache" | "config" | null;
  step: IrodoriInstallStep | null;
  phase: IrodoriInstallPhase | null;
  /** Bytes finished across the whole install, for one progress bar. */
  completedBytes: number;
  totalBytes: number;
  /** Remaining download size; zero when everything is already present. */
  downloadBytes: number;
  /** Disk space the install still needs, including archive staging. */
  requiredDiskBytes: number;
  freeDiskBytes: number | null;
  /** Bytes of unfinished downloads left behind by a cancelled or failed install. */
  partialDownloadBytes: number;
  int8: boolean;
  message: string;
};

export type IrodoriPaths = {
  root: string;
  engineDirectory: string;
  modelDirectory: string;
  modelFile: string;
  downloads: string;
  temporary: string;
};

const STALL_TIMEOUT_MS = 60_000;
const DISK_MARGIN_BYTES = 256 * 1024 * 1024;

function irodoriConfig() {
  return readKanaUserConfig().tts?.irodoriLocal ?? {};
}

export function irodoriPaths(): IrodoriPaths {
  return irodoriInstallPaths({
    dataRoot: resolveKanaDataDir(),
    installDirectory: irodoriConfig().installDirectory,
  });
}

function fileSize(filePath: string): number {
  try {
    return statSync(/* turbopackIgnore: true */ filePath).size;
  } catch {
    return 0;
  }
}

export function engineInstalled(paths = irodoriPaths()): boolean {
  return irodoriEngineInstalled(paths);
}

/** Hugging Face's own cache location for the pinned model revision. */
export function huggingFaceCachedModel(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME?.trim() || homedir();
  const hubCache =
    env.HF_HUB_CACHE?.trim() ||
    (env.HF_HOME?.trim() ? path.join(env.HF_HOME.trim(), "hub") : path.join(home, ".cache", "huggingface", "hub"));
  return path.join(
    hubCache,
    `models--${IRODORI_MODEL_REPOSITORY.replace("/", "--")}`,
    "snapshots",
    IRODORI_MODEL_REVISION,
    "model.safetensors",
  );
}

type ResolvedModel = { path: string; source: NonNullable<IrodoriInstallStatus["modelSource"]> };

/**
 * The model file speech should use, or null when it still has to be installed.
 * A configured path is trusted as the operator's choice; Kana's own copy and
 * an adopted Hugging Face cache entry must match the pinned checksum.
 */
export function resolveInstalledModel(paths = irodoriPaths()): ResolvedModel | null {
  return irodoriInstalledModel(paths, irodoriConfig().modelPath);
}

function freeDiskBytes(target: string): number | null {
  let candidate = target;
  while (!existsSync(/* turbopackIgnore: true */ candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
  try {
    const stats = statfsSync(/* turbopackIgnore: true */ candidate);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

function notEnoughDisk(paths: IrodoriPaths, requiredBytes: number): Error | null {
  const free = freeDiskBytes(paths.root);
  if (free === null || requiredBytes <= 0 || free >= requiredBytes + DISK_MARGIN_BYTES) return null;
  const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
  return new Error(
    `Not enough disk space for the local voice: ${gib(requiredBytes)} GB needed, ${gib(free)} GB free in ${paths.root}.`,
  );
}

type PendingWork = {
  engine: boolean;
  model: "none" | "adopt" | "download";
  downloadBytes: number;
  requiredDiskBytes: number;
  totalBytes: number;
  partialBytes: number;
};

function pendingWork(paths: IrodoriPaths): PendingWork {
  const needsEngine = !engineInstalled(paths);
  const cached = huggingFaceCachedModel();
  const model: PendingWork["model"] = resolveInstalledModel(paths)
    ? "none"
    : fileSize(cached) === IRODORI_MODEL_FILE.sizeBytes
      ? "adopt"
      : "download";
  const partialArchive = (artifact: IrodoriArtifact) =>
    Math.min(fileSize(path.join(paths.downloads, `${artifact.id}.partial`)), artifact.sizeBytes);
  const partialModel = Math.min(fileSize(`${paths.modelFile}.partial`), IRODORI_MODEL_FILE.sizeBytes);
  const archives = [IRODORI_ENGINE_ARCHIVE, IRODORI_ASSETS_ARCHIVE];
  const engineDownload = needsEngine
    ? archives.reduce((sum, artifact) => sum + artifact.sizeBytes - partialArchive(artifact), 0)
    : 0;
  const modelDownload = model === "download" ? IRODORI_MODEL_FILE.sizeBytes - partialModel : 0;
  const engineDisk = needsEngine
    ? archives.reduce((sum, artifact) => sum + artifact.sizeBytes - partialArchive(artifact) + artifact.installedBytes, 0)
    : 0;
  return {
    engine: needsEngine,
    model,
    downloadBytes: engineDownload + modelDownload,
    requiredDiskBytes: engineDisk + modelDownload,
    totalBytes:
      (needsEngine ? archives.reduce((sum, artifact) => sum + artifact.sizeBytes, 0) : 0) +
      (model === "none" ? 0 : IRODORI_MODEL_FILE.sizeBytes),
    partialBytes:
      fileSize(path.join(paths.downloads, `${IRODORI_ENGINE_ARCHIVE.id}.partial`)) +
      fileSize(path.join(paths.downloads, `${IRODORI_ASSETS_ARCHIVE.id}.partial`)) +
      fileSize(`${paths.modelFile}.partial`),
  };
}

type InstallRuntime = {
  flight: Promise<void> | null;
  controller: AbortController | null;
  step: IrodoriInstallStep | null;
  phase: IrodoriInstallPhase | null;
  completedBytes: number;
  totalBytes: number;
  error: string | null;
};

const runtimeKey = Symbol.for("kana.irodoriInstall");
type RuntimeGlobal = typeof globalThis & { [runtimeKey]?: InstallRuntime };

function installRuntime(): InstallRuntime {
  const shared = globalThis as RuntimeGlobal;
  shared[runtimeKey] ??= {
    flight: null,
    controller: null,
    step: null,
    phase: null,
    completedBytes: 0,
    totalBytes: 0,
    error: null,
  };
  return shared[runtimeKey];
}

export function inspectIrodoriInstall(platform: IrodoriPlatform = currentIrodoriPlatform()): IrodoriInstallStatus {
  const paths = irodoriPaths();
  const current = installRuntime();
  const engine = engineInstalled(paths);
  const model = resolveInstalledModel(paths);
  const work = pendingWork(paths);
  const base = {
    engineInstalled: engine,
    modelInstalled: Boolean(model),
    modelSource: model?.source ?? null,
    downloadBytes: work.downloadBytes,
    requiredDiskBytes: work.requiredDiskBytes,
    freeDiskBytes: freeDiskBytes(paths.root),
    partialDownloadBytes: work.partialBytes,
    int8: platform.int8,
  };
  if (!platform.supported) {
    return { ...base, state: "unsupported", step: null, phase: null, completedBytes: 0, totalBytes: 0, message: platform.reason ?? "" };
  }
  if (current.flight) {
    return {
      ...base,
      state: "installing",
      step: current.step,
      phase: current.phase,
      completedBytes: current.completedBytes,
      totalBytes: current.totalBytes,
      message: "Installing the local voice engine.",
    };
  }
  if (engine && model) {
    return { ...base, state: "ready", step: null, phase: null, completedBytes: 0, totalBytes: 0, message: "The local voice engine is installed." };
  }
  const configuredModel = irodoriConfig().modelPath;
  return {
    ...base,
    state: current.error ? "failed" : "not_installed",
    step: null,
    phase: null,
    completedBytes: 0,
    totalBytes: 0,
    message:
      current.error ??
      (configuredModel && !model
        ? `tts.irodoriLocal.modelPath does not exist: ${configuredModel}`
        : "The local voice engine has not been downloaded yet."),
  };
}

class InstallCancelled extends Error {
  constructor() {
    super("The voice download was cancelled. It resumes where it stopped next time.");
    this.name = "InstallCancelled";
  }
}

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new InstallCancelled();
}

/** Stream a URL into `<target>.partial`, resuming an interrupted download. */
export async function downloadWithResume(
  url: string,
  partial: string,
  expectedBytes: number,
  signal: AbortSignal,
  onBytes: (bytes: number) => void,
): Promise<void> {
  let offset = Math.min(fileSize(partial), expectedBytes);
  if (offset === expectedBytes) {
    onBytes(offset);
    return;
  }
  const watchdog = new AbortController();
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const armStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => watchdog.abort(new Error("The download stalled for 60 seconds.")), STALL_TIMEOUT_MS);
  };
  armStall();
  try {
    const response = await fetch(url, {
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
      signal: AbortSignal.any([signal, watchdog.signal]),
      redirect: "follow",
    });
    if (response.status === 200 && offset > 0) {
      // The server ignored the range; start over rather than corrupt the file.
      rmSync(/* turbopackIgnore: true */ partial, { force: true });
      offset = 0;
    } else if (response.status !== 200 && response.status !== 206) {
      throw new Error(`Download failed with HTTP ${response.status}: ${new URL(url).host}`);
    }
    if (!response.body) throw new Error("The download returned no data.");
    onBytes(offset);
    let received = offset;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.byteLength;
        if (received > expectedBytes) {
          callback(new Error("The download is larger than the pinned file size."));
          return;
        }
        armStall();
        onBytes(chunk.byteLength);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>),
      meter,
      createWriteStream(/* turbopackIgnore: true */ partial, { flags: offset > 0 ? "a" : "w", mode: 0o600 }),
    );
    if (received !== expectedBytes) {
      throw new Error("The download ended early; it will resume on the next attempt.");
    }
  } catch (error) {
    if (signal.aborted) throw new InstallCancelled();
    if (watchdog.signal.aborted) throw watchdog.signal.reason;
    throw error;
  } finally {
    clearTimeout(stallTimer);
  }
}

async function sha256File(filePath: string, signal: AbortSignal, onBytes: (bytes: number) => void): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(/* turbopackIgnore: true */ filePath, { highWaterMark: 4 * 1024 * 1024 });
  for await (const chunk of stream) {
    if (signal.aborted) {
      stream.destroy();
      throw new InstallCancelled();
    }
    hash.update(chunk as Buffer);
    onBytes((chunk as Buffer).byteLength);
  }
  return hash.digest("hex");
}

function runTar(args: string[], signal: AbortSignal): Promise<void> {
  const tar = findExecutableSync("tar");
  if (!tar) return Promise.reject(new Error("The tar command is required to unpack the voice engine."));
  return new Promise((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ tar, args, { stdio: ["ignore", "ignore", "pipe"], signal });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-2000);
    });
    child.once("error", (error) => reject(signal.aborted ? new InstallCancelled() : error));
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Unpacking the voice engine failed: ${stderr.trim() || `tar exited with ${code}`}`));
    });
  });
}

function archiveTopDirectory(artifact: IrodoriArtifact): string {
  return path.basename(new URL(artifact.url).pathname).replace(/\.tar\.gz$/, "");
}

async function installEngine(paths: IrodoriPaths, signal: AbortSignal): Promise<void> {
  const current = installRuntime();
  mkdirSync(/* turbopackIgnore: true */ paths.downloads, { recursive: true, mode: 0o700 });
  const staging = `${paths.engineDirectory}.staging`;
  rmSync(/* turbopackIgnore: true */ staging, { recursive: true, force: true });
  mkdirSync(/* turbopackIgnore: true */ staging, { recursive: true, mode: 0o700 });
  const archives: Array<[IrodoriArtifact, string[]]> = [
    [IRODORI_ENGINE_ARCHIVE, IRODORI_ENGINE_MEMBERS],
    [IRODORI_ASSETS_ARCHIVE, IRODORI_ASSET_MEMBERS],
  ];
  for (const [artifact, members] of archives) {
    const partial = path.join(paths.downloads, `${artifact.id}.partial`);
    current.step = artifact.id;
    current.phase = "downloading";
    await downloadWithResume(artifact.url, partial, artifact.sizeBytes, signal, (bytes) => {
      current.completedBytes += bytes;
    });
    checkAborted(signal);
    current.phase = "verifying";
    const digest = await sha256File(partial, signal, () => undefined);
    if (digest !== artifact.sha256) {
      rmSync(/* turbopackIgnore: true */ partial, { force: true });
      throw new Error(`The downloaded ${artifact.id} archive failed its checksum; it was deleted and will download again.`);
    }
    current.phase = "extracting";
    const top = archiveTopDirectory(artifact);
    await runTar(
      ["-xzf", partial, "-C", staging, "--strip-components=1", ...members.map((member) => `${top}/${member}`)],
      signal,
    );
  }
  writeFileSync(/* turbopackIgnore: true */ 
    path.join(staging, IRODORI_ENGINE_MARKER),
    `${JSON.stringify({
      version: IRODORI_ENGINE_VERSION,
      engineSha256: IRODORI_ENGINE_ARCHIVE.sha256,
      assetsSha256: IRODORI_ASSETS_ARCHIVE.sha256,
      installedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  rmSync(/* turbopackIgnore: true */ paths.engineDirectory, { recursive: true, force: true });
  renameSync(/* turbopackIgnore: true */ staging, paths.engineDirectory);
  for (const [artifact] of archives) rmSync(/* turbopackIgnore: true */ path.join(paths.downloads, `${artifact.id}.partial`), { force: true });
}

function writeModelMarker(paths: IrodoriPaths, modelPath: string): void {
  mkdirSync(/* turbopackIgnore: true */ paths.modelDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(/* turbopackIgnore: true */ 
    path.join(paths.modelDirectory, IRODORI_MODEL_MARKER),
    `${JSON.stringify({
      repository: IRODORI_MODEL_REPOSITORY,
      revision: IRODORI_MODEL_REVISION,
      sha256: IRODORI_MODEL_FILE.sha256,
      path: modelPath,
      mtimeMs: statSync(/* turbopackIgnore: true */ modelPath).mtimeMs,
      verifiedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function installModel(paths: IrodoriPaths, mode: "adopt" | "download", signal: AbortSignal): Promise<void> {
  const current = installRuntime();
  current.step = "model";
  if (mode === "adopt") {
    const cached = huggingFaceCachedModel();
    current.phase = "verifying";
    const digest = await sha256File(cached, signal, (bytes) => {
      current.completedBytes += bytes;
    });
    if (digest === IRODORI_MODEL_FILE.sha256) {
      writeModelMarker(paths, cached);
      return;
    }
    // Not the pinned file after all: fall through to a real download, which
    // the pre-flight disk check did not budget for.
    current.completedBytes -= IRODORI_MODEL_FILE.sizeBytes;
    const diskError = notEnoughDisk(paths, IRODORI_MODEL_FILE.sizeBytes - fileSize(`${paths.modelFile}.partial`));
    if (diskError) throw diskError;
  }
  mkdirSync(/* turbopackIgnore: true */ paths.modelDirectory, { recursive: true, mode: 0o700 });
  const partial = `${paths.modelFile}.partial`;
  current.phase = "downloading";
  await downloadWithResume(IRODORI_MODEL_FILE.url, partial, IRODORI_MODEL_FILE.sizeBytes, signal, (bytes) => {
    current.completedBytes += bytes;
  });
  current.phase = "verifying";
  const digest = await sha256File(partial, signal, () => undefined);
  if (digest !== IRODORI_MODEL_FILE.sha256) {
    rmSync(/* turbopackIgnore: true */ partial, { force: true });
    throw new Error("The downloaded model failed its checksum; it was deleted and will download again.");
  }
  renameSync(/* turbopackIgnore: true */ partial, paths.modelFile);
  writeModelMarker(paths, paths.modelFile);
}

/**
 * Start (or join) the single install flight. Resolves when the voice is ready;
 * progress is observable through inspectIrodoriInstall() meanwhile.
 */
export function installIrodori(): Promise<void> {
  const current = installRuntime();
  if (current.flight) return current.flight;
  const platform = currentIrodoriPlatform();
  if (!platform.supported) return Promise.reject(new Error(platform.reason ?? "This machine cannot run the local voice."));

  const paths = irodoriPaths();
  const work = pendingWork(paths);
  const configuredModel = irodoriConfig().modelPath;
  if (configuredModel && !existsSync(/* turbopackIgnore: true */ configuredModel)) {
    return Promise.reject(new Error(`tts.irodoriLocal.modelPath does not exist: ${configuredModel}`));
  }
  const diskError = notEnoughDisk(paths, work.requiredDiskBytes);
  if (diskError) return Promise.reject(diskError);

  const controller = new AbortController();
  current.controller = controller;
  current.error = null;
  current.completedBytes = 0;
  current.totalBytes = work.totalBytes;
  current.step = null;
  current.phase = null;
  current.flight = (async () => {
    try {
      mkdirSync(/* turbopackIgnore: true */ paths.root, { recursive: true, mode: 0o700 });
      if (work.engine) await installEngine(paths, controller.signal);
      if (!configuredModel && work.model !== "none") await installModel(paths, work.model, controller.signal);
    } catch (error) {
      // A cancelled install is not a failure; partial downloads resume later.
      current.error = error instanceof InstallCancelled ? null : error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      current.flight = null;
      current.controller = null;
      current.step = null;
      current.phase = null;
      rmSync(/* turbopackIgnore: true */ `${paths.engineDirectory}.staging`, { recursive: true, force: true });
    }
  })();
  return current.flight;
}

export function cancelIrodoriInstall(): boolean {
  const current = installRuntime();
  if (!current.controller) return false;
  current.controller.abort();
  return true;
}

/**
 * Delete everything Kana downloaded for the local voice. A model adopted from
 * the Hugging Face cache or set in config.json belongs to the user and stays.
 */
export async function removeIrodoriInstall(): Promise<void> {
  const current = installRuntime();
  if (current.flight) {
    current.controller?.abort();
    await current.flight.catch(() => undefined);
  }
  const paths = irodoriPaths();
  for (const target of [paths.engineDirectory, `${paths.engineDirectory}.staging`, path.join(paths.root, "models"), paths.downloads, paths.temporary]) {
    rmSync(/* turbopackIgnore: true */ target, { recursive: true, force: true });
  }
  current.error = null;
}
