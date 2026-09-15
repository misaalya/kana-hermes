import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { Emotion } from "@/lib/presentation/types";
import { readKanaUserConfig, defaultIrodoriLocalConfig } from "@/lib/server/user-config";
import { splitJapaneseSpeech } from "@/lib/voice/speech-chunks";
import { engineInstalled, irodoriPaths, resolveInstalledModel } from "./install";
import { currentIrodoriPlatform, type IrodoriPlatform } from "./platform";
import { concatenatePcmWavs } from "./wav";

// One irodori-c process per sentence group, strictly one at a time.
//
// The engine is a command-line program: it maps the model, synthesizes one
// utterance, writes a WAV, and exits. With the page cache warm its startup is
// about a second, so a long-lived worker is unnecessary. Each run needs
// 1.4–2 GB of RAM, so requests queue instead of running in parallel.

/**
 * Engine limits: 256 text tokens and 30 seconds of audio per utterance. The
 * audio cap binds first: Japanese speech runs about 5.5–6.5 characters per
 * second (324 characters were only 124 tokens), and a longer text is not
 * rejected but squeezed into 30 seconds at roughly double speed. Measured on
 * an i3-1005G1 (int8, 16 steps), 60/100/150-character parts cost the same
 * total time for the same audio; 200 was slightly slower and nears the cap.
 */
const MAX_PART_CHARACTERS = 100;
const OUTPUT_TAIL_CHARACTERS = 1_200;

/**
 * Speaking-style captions per Kana emotion (the model's VoiceDesign input).
 * Neutral speech has no caption: that is the fastest path and the model's
 * natural delivery.
 */
export const EMOTION_CAPTIONS: Partial<Record<Emotion, string>> = {
  happy: "明るく楽しそうに、にこやかに話す。",
  excited: "わくわくした弾む声で、元気いっぱいに話す。",
  sad: "少し寂しそうに、静かに沈んだ声で話す。",
  angry: "むっとした不満げな声で、強めに話す。",
  surprised: "驚いた様子で、思わず声が上がるように話す。",
  thinking: "考えながら、ゆっくり落ち着いた声で話す。",
  confused: "戸惑った様子で、少し自信なさげに話す。",
};

export type IrodoriSynthesisRequest = {
  text: string;
  emotion?: Emotion;
  /** Reference WAV for a cloned voice; omitted for the model's own voice. */
  referencePath?: string;
};

export class IrodoriSynthesisError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: "unsupported" | "not_installed" | "engine_failed",
  ) {
    super(message);
    this.name = "IrodoriSynthesisError";
  }
}

type EngineCommand = { binary: string; args: string[]; env: Record<string, string>; cwd: string };

export function buildEngineCommand(input: {
  engineDirectory: string;
  modelPath: string;
  outputPath: string;
  text: string;
  caption?: string;
  referencePath?: string;
  platform: Pick<IrodoriPlatform, "int8" | "physicalCores">;
  config: { threads?: number; steps: number; precision: "auto" | "int8" | "fp32" };
}): EngineCommand {
  const int8 = input.config.precision === "int8" || (input.config.precision === "auto" && input.platform.int8);
  if (int8 && !input.platform.int8) {
    throw new IrodoriSynthesisError(
      "tts.irodoriLocal.precision is int8, but this CPU has no AVX-512 VNNI. Use auto or fp32.",
      503,
      "unsupported",
    );
  }
  const weights = path.join(input.engineDirectory, "weights");
  const args = [
    "--text", input.text,
    "--model", input.modelPath,
    "--tokenizer", path.join(weights, "tokenizer.bin"),
    "--decoder", path.join(weights, "dacvae_decoder.safetensors"),
    "--steps", String(input.config.steps),
    "--dit-precision", int8 ? "int8" : "fp32",
    "--codec-precision", int8 ? "int8" : "fp32",
    "--out", input.outputPath,
  ];
  if (input.caption) args.push("--caption", input.caption);
  if (input.referencePath) {
    args.push("--encoder", path.join(weights, "dacvae_encoder.safetensors"), "--ref", input.referencePath);
  }
  return {
    // The oneMKL build carries the int8 kernels; OpenBLAS is the portable FP32 build.
    binary: path.join(input.engineDirectory, "bin", int8 ? "irodori-onemkl" : "irodori-blas"),
    args,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "",
      LANG: "C.UTF-8",
      IRO_NUM_THREADS: String(input.config.threads ?? input.platform.physicalCores),
    },
    cwd: input.engineDirectory,
  };
}

function runEngine(command: EngineCommand, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    let output = "";
    const append = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-OUTPUT_TAIL_CHARACTERS);
    };
    const child = spawn(/* turbopackIgnore: true */ command.binary, command.args, {
      cwd: command.cwd,
      env: command.env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const abort = () => child.kill("SIGKILL");
    signal.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(new IrodoriSynthesisError(`The voice engine could not start: ${error.message}`, 502, "engine_failed"));
    });
    child.once("exit", (code, exitSignal) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        reject(signal.reason);
      } else if (code === 0) {
        resolve();
      } else {
        const detail = output.trim().split("\n").slice(-4).join(" ").slice(-500);
        reject(new IrodoriSynthesisError(
          `The voice engine failed (${exitSignal ?? `exit ${code}`})${detail ? `: ${detail}` : "."}`,
          502,
          "engine_failed",
        ));
      }
    });
  });
}

// Serialize engine runs across every request in this server process.
const queueKey = Symbol.for("kana.irodoriQueue");
type QueueGlobal = typeof globalThis & { [queueKey]?: Promise<void> };

function enqueue<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const shared = globalThis as QueueGlobal;
  const previous = shared[queueKey] ?? Promise.resolve();
  const run = previous.then(() => {
    signal.throwIfAborted();
    return work();
  });
  shared[queueKey] = run.then(() => undefined, () => undefined);
  return run;
}

export type IrodoriEngineRunner = (command: EngineCommand, signal: AbortSignal) => Promise<void>;

/** Synthesize Japanese speech to a single 48 kHz mono PCM16 WAV. */
export async function synthesizeWithIrodori(
  request: IrodoriSynthesisRequest,
  signal: AbortSignal,
  runner: IrodoriEngineRunner = runEngine,
): Promise<ArrayBuffer> {
  const platform = currentIrodoriPlatform();
  if (!platform.supported) {
    throw new IrodoriSynthesisError(platform.reason ?? "This machine cannot run the local voice.", 503, "unsupported");
  }
  const paths = irodoriPaths();
  const model = resolveInstalledModel(paths);
  if (!engineInstalled(paths) || !model) {
    throw new IrodoriSynthesisError(
      "The local voice engine is not installed yet. Download it in Settings → Voice.",
      503,
      "not_installed",
    );
  }
  const configured = readKanaUserConfig().tts?.irodoriLocal ?? {};
  const defaults = defaultIrodoriLocalConfig();
  const config = {
    threads: configured.threads,
    steps: configured.steps ?? defaults.steps,
    precision: configured.precision ?? defaults.precision,
  };
  const caption = request.emotion ? EMOTION_CAPTIONS[request.emotion] : undefined;
  const parts = splitJapaneseSpeech(request.text.trim(), MAX_PART_CHARACTERS).filter((part) => part.trim());
  if (parts.length === 0) throw new IrodoriSynthesisError("Speech text is empty.", 400, "engine_failed");

  mkdirSync(/* turbopackIgnore: true */ paths.temporary, { recursive: true, mode: 0o700 });
  const outputs: Uint8Array[] = [];
  for (const part of parts) {
    const outputPath = path.join(paths.temporary, `${randomUUID()}.wav`);
    try {
      await enqueue(async () => {
        await runner(
          buildEngineCommand({
            engineDirectory: paths.engineDirectory,
            modelPath: model.path,
            outputPath,
            text: part.trim(),
            caption,
            referencePath: request.referencePath,
            platform,
            config,
          }),
          signal,
        );
      }, signal);
      let bytes: Buffer;
      try {
        bytes = readFileSync(/* turbopackIgnore: true */ outputPath);
      } catch {
        throw new IrodoriSynthesisError("The voice engine finished without writing audio.", 502, "engine_failed");
      }
      outputs.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    } finally {
      rmSync(/* turbopackIgnore: true */ outputPath, { force: true });
    }
  }
  return concatenatePcmWavs(outputs);
}
