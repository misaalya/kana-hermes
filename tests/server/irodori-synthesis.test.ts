import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  buildEngineCommand,
  EMOTION_CAPTIONS,
  IrodoriSynthesisError,
  synthesizeWithIrodori,
} from "@/lib/server/irodori/synthesis";
import { __setIrodoriPlatformForTests } from "@/lib/server/irodori/platform";
import { parsePcmWav } from "@/lib/server/irodori/wav";
import { installFakeEngine, useSupportedPlatform } from "./irodori-fixtures";

const root = mkdtempSync(path.join(tmpdir(), "kana-irodori-synthesis-"));
const previous = process.env.KANA_DATA_DIR;
const model = path.join(root, "anime.safetensors");
let log = "";

before(() => {
  process.env.KANA_DATA_DIR = root;
  writeFileSync(model, "fixture model");
  writeFileSync(path.join(root, "config.json"), JSON.stringify({ tts: { irodoriLocal: { modelPath: model, steps: 12 } } }));
  useSupportedPlatform();
  log = installFakeEngine(root).log;
});

after(() => {
  __setIrodoriPlatformForTests(null);
  if (previous === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

const runs = () =>
  readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as {
    args: string[];
    threads: string;
    start: number;
  });
const flag = (args: string[], name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

describe("engine command", () => {
  const base = {
    engineDirectory: "/opt/irodori",
    modelPath: "/models/anime.safetensors",
    outputPath: "/tmp/out.wav",
    text: "こんにちは。",
    platform: { int8: true, physicalCores: 4 },
    config: { steps: 16, precision: "auto" as const },
  };

  it("uses the oneMKL int8 build when the CPU supports it, and OpenBLAS fp32 otherwise", () => {
    const fast = buildEngineCommand(base);
    assert.equal(fast.binary, "/opt/irodori/bin/irodori-onemkl");
    assert.equal(flag(fast.args, "--dit-precision"), "int8");
    assert.equal(flag(fast.args, "--codec-precision"), "int8");
    assert.equal(fast.env.IRO_NUM_THREADS, "4");

    const portable = buildEngineCommand({ ...base, platform: { int8: false, physicalCores: 2 } });
    assert.equal(portable.binary, "/opt/irodori/bin/irodori-blas");
    assert.equal(flag(portable.args, "--dit-precision"), "fp32");

    const forced = buildEngineCommand({ ...base, config: { ...base.config, precision: "fp32", threads: 1 } });
    assert.equal(forced.binary, "/opt/irodori/bin/irodori-blas");
    assert.equal(forced.env.IRO_NUM_THREADS, "1");
    assert.throws(
      () => buildEngineCommand({ ...base, platform: { int8: false, physicalCores: 2 }, config: { ...base.config, precision: "int8" } }),
      /AVX-512 VNNI/,
    );
  });

  it("adds a style caption and a voice reference only when requested", () => {
    const plain = buildEngineCommand(base);
    assert.equal(plain.args.includes("--caption"), false);
    assert.equal(plain.args.includes("--ref"), false);
    const styled = buildEngineCommand({ ...base, caption: EMOTION_CAPTIONS.happy, referencePath: "/voices/kana.wav" });
    assert.equal(flag(styled.args, "--caption"), EMOTION_CAPTIONS.happy);
    assert.equal(flag(styled.args, "--ref"), "/voices/kana.wav");
    assert.equal(flag(styled.args, "--encoder"), "/opt/irodori/weights/dacvae_encoder.safetensors");
    // The engine is not handed Kana's own environment (for example MKL tuning variables).
    assert.deepEqual(Object.keys(plain.env).sort(), ["HOME", "IRO_NUM_THREADS", "LANG", "PATH"]);
  });
});

describe("synthesis through the engine process", () => {
  it("speaks with the configured model, steps, emotion caption, and reference", async () => {
    writeFileSync(log, "");
    const audio = await synthesizeWithIrodori(
      { text: "やったね！", emotion: "happy", referencePath: "/voices/kana.wav" },
      new AbortController().signal,
    );
    const wav = parsePcmWav(new Uint8Array(audio));
    assert.equal(wav.sampleRate, 48_000);
    const [run] = runs();
    assert.equal(flag(run.args, "--model"), model);
    assert.equal(flag(run.args, "--steps"), "12");
    assert.equal(flag(run.args, "--caption"), EMOTION_CAPTIONS.happy);
    assert.equal(flag(run.args, "--ref"), "/voices/kana.wav");
    assert.equal(run.threads, "2");
    // Temporary engine outputs are removed after reading.
    assert.deepEqual(readdirSync(path.join(root, "irodori", "tmp")), []);
  });

  it("splits long speech into engine-sized parts and joins them in order", async () => {
    writeFileSync(log, "");
    const sentence = "今日はとても良い天気なので、公園までゆっくり散歩しに行こうと思っています。";
    const audio = await synthesizeWithIrodori({ text: sentence.repeat(6) }, new AbortController().signal);
    const texts = runs().map((run) => flag(run.args, "--text") ?? "");
    assert.ok(texts.length >= 3, `expected several parts, got ${texts.length}`);
    assert.ok(texts.every((text) => Array.from(text).length <= 100));
    assert.equal(texts.join(""), sentence.repeat(6));
    const joined = parsePcmWav(new Uint8Array(audio));
    assert.ok(joined.data.byteLength > 960 * texts.length);
  });

  it("runs one engine at a time across concurrent requests", async () => {
    writeFileSync(log, "");
    await Promise.all([
      synthesizeWithIrodori({ text: "一つ目。" }, new AbortController().signal),
      synthesizeWithIrodori({ text: "二つ目。" }, new AbortController().signal),
    ]);
    const [first, second] = runs();
    assert.ok(second.start - first.start >= 35, "the second engine started before the first finished");
  });

  it("kills the engine when the request is cancelled", async () => {
    writeFileSync(log, "");
    const controller = new AbortController();
    const started = Date.now();
    const pending = synthesizeWithIrodori({ text: "SLOW" }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 300));
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.ok(Date.now() - started < 5_000, "cancellation waited for the engine to finish");
    // The queue is free again right away.
    await synthesizeWithIrodori({ text: "次。" }, new AbortController().signal);
  });

  it("reports engine failures with the engine's own message", async () => {
    await assert.rejects(
      synthesizeWithIrodori({ text: "FAIL" }, new AbortController().signal),
      (error: unknown) =>
        error instanceof IrodoriSynthesisError &&
        error.code === "engine_failed" &&
        /exceeds 256 tokens/.test(error.message),
    );
  });

  it("fails fast when the engine is not installed or the CPU is unsupported", async () => {
    writeFileSync(path.join(root, "config.json"), JSON.stringify({ tts: { irodoriLocal: { modelPath: path.join(root, "missing.safetensors") } } }));
    await assert.rejects(
      synthesizeWithIrodori({ text: "こんにちは。" }, new AbortController().signal),
      (error: unknown) => error instanceof IrodoriSynthesisError && error.code === "not_installed" && error.status === 503,
    );
    __setIrodoriPlatformForTests({ supported: false, reason: "Needs Linux.", int8: false, physicalCores: 1 });
    await assert.rejects(
      synthesizeWithIrodori({ text: "こんにちは。" }, new AbortController().signal),
      (error: unknown) => error instanceof IrodoriSynthesisError && error.code === "unsupported",
    );
    useSupportedPlatform();
    writeFileSync(path.join(root, "config.json"), JSON.stringify({ tts: { irodoriLocal: { modelPath: model, steps: 12 } } }));
  });
});
