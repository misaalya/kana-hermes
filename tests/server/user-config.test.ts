import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  DEFAULT_KANA_USER_CONFIG,
  ensureKanaUserConfigFile,
  inspectKanaUserConfig,
  kanaUserConfigPath,
  readKanaUserConfig,
  resolveKanaDeploymentMode,
} from "@/lib/server/user-config";

const root = mkdtempSync(path.join(tmpdir(), "kana-user-config-test-"));
const previousDataDir = process.env.KANA_DATA_DIR;
const previousDeploymentMode = process.env.KANA_DEPLOYMENT_MODE;
process.env.KANA_DATA_DIR = root;

after(() => {
  if (previousDataDir === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previousDataDir;
  if (previousDeploymentMode === undefined) delete process.env.KANA_DEPLOYMENT_MODE;
  else process.env.KANA_DEPLOYMENT_MODE = previousDeploymentMode;
  rmSync(root, { recursive: true, force: true });
});

describe("advanced user configuration", () => {
  it("uses the single Kana data root and treats a missing file as optional", () => {
    assert.equal(kanaUserConfigPath(), path.join(root, "config.json"));
    assert.deepEqual(readKanaUserConfig(), {});
  });

  it("creates an owner-editable starter JSON without overwriting it", () => {
    const filePath = ensureKanaUserConfigFile();
    assert.equal(filePath, path.join(root, "config.json"));
    assert.deepEqual(readKanaUserConfig(), DEFAULT_KANA_USER_CONFIG);
    writeFileSync(filePath, JSON.stringify({ deployment: { mode: "deployment" } }));
    ensureKanaUserConfigFile();
    assert.equal(readKanaUserConfig().deployment?.mode, "deployment");
  });

  it("reads supported Hermes and TTS overrides", () => {
    writeFileSync(
      kanaUserConfigPath(),
      JSON.stringify({
        deployment: { mode: "deployment" },
        hermes: {
          executable: "/opt/hermes/bin/hermes",
          port: 9120,
          workingDirectory: "/srv/hermes",
        },
        tts: {
          provider: "irodori-local",
          irodoriLocal: {
            installDirectory: "/srv/kana/voice",
            modelPath: "/srv/models/anime.safetensors",
            threads: 2,
            steps: 12,
            precision: "int8",
          },
        },
      }),
    );

    assert.deepEqual(readKanaUserConfig(), {
      deployment: { mode: "deployment" },
      hermes: {
        executable: "/opt/hermes/bin/hermes",
        port: 9120,
        workingDirectory: "/srv/hermes",
      },
      tts: {
        provider: "irodori-local",
        irodoriLocal: {
          installDirectory: "/srv/kana/voice",
          modelPath: "/srv/models/anime.safetensors",
          threads: 2,
          steps: 12,
          precision: "int8",
        },
      },
    });
  });

  it("reads an owner-supplied Pollinations provider configuration", () => {
    writeFileSync(
      kanaUserConfigPath(),
      JSON.stringify({
        tts: {
          provider: "pollinations",
          pollinations: {
            apiKey: "user-owned-secret",
            model: "elevenlabs/eleven-v3",
            voice: "JTlYtJrcTzPC71hMLOxo",
            instructions: "Speak calmly in Japanese.",
            format: "wav",
          },
        },
      }),
    );
    assert.deepEqual(readKanaUserConfig().tts, {
      provider: "pollinations",
      pollinations: {
        apiKey: "user-owned-secret",
        model: "elevenlabs/eleven-v3",
        voice: "JTlYtJrcTzPC71hMLOxo",
        instructions: "Speak calmly in Japanese.",
        format: "wav",
      },
    });
  });

  it("resolves Pollinations without exposing its API key in browser-safe metadata", async () => {
    writeFileSync(
      kanaUserConfigPath(),
      JSON.stringify({ tts: { provider: "pollinations", pollinations: { apiKey: "never-send-this-key" } } }),
    );
    const { getConfiguredTtsProvider } = await import("@/lib/server/tts-provider");
    const provider = getConfiguredTtsProvider();
    assert.equal(provider.descriptor.name, "Pollinations");
    assert.equal(provider.descriptor.configured, true);
    assert.doesNotMatch(JSON.stringify(provider.descriptor), /never-send-this-key/);
  });

  it("reads a config from the generic openai-compatible days as Pollinations", () => {
    // The shape Kana wrote when Pollinations was a preset over a generic adapter.
    writeFileSync(
      kanaUserConfigPath(),
      JSON.stringify({
        tts: {
          provider: "openai-compatible",
          openAiCompatible: {
            apiKey: "legacy-key",
            preset: "pollinations",
            baseUrl: "https://gen.pollinations.ai/v1",
            model: "elevenlabs",
            voice: "JTlYtJrcTzPC71hMLOxo",
            defaultInstruction: "Speak softly.",
            instructionField: "instruct",
          },
        },
      }),
    );
    assert.deepEqual(readKanaUserConfig().tts, {
      provider: "pollinations",
      pollinations: {
        apiKey: "legacy-key",
        model: "elevenlabs",
        voice: "JTlYtJrcTzPC71hMLOxo",
        instructions: "Speak softly.",
        // The old preset's format, so an untouched file sounds the same.
        format: "wav",
      },
    });

    writeFileSync(
      kanaUserConfigPath(),
      JSON.stringify({
        tts: {
          provider: "openai-compatible",
          openAiCompatible: { baseUrl: "https://voice.example/v1", apiKey: "k", model: "tts-1", voice: "alloy" },
        },
      }),
    );
    assert.throws(() => readKanaUserConfig(), /no longer supported.*pollinations/);
  });

  it("rejects relative paths and unsafe ports", () => {
    writeFileSync(kanaUserConfigPath(), JSON.stringify({ hermes: { executable: "bin/hermes" } }));
    assert.throws(() => readKanaUserConfig(), /absolute path/);

    writeFileSync(kanaUserConfigPath(), JSON.stringify({ hermes: { port: 80 } }));
    assert.throws(() => readKanaUserConfig(), /between 1024 and 65535/);

    writeFileSync(kanaUserConfigPath(), JSON.stringify({ deployment: { mode: "remote-ish" } }));
    assert.throws(() => readKanaUserConfig(), /local.*deployment/);

    writeFileSync(kanaUserConfigPath(), JSON.stringify({ tts: { provider: "cloud-magic" } }));
    assert.throws(() => readKanaUserConfig(), /irodori-local.*pollinations/);

    const pollinations = (block: unknown) =>
      writeFileSync(kanaUserConfigPath(), JSON.stringify({ tts: { provider: "pollinations", pollinations: block } }));
    pollinations({ format: "pcm" });
    assert.throws(() => readKanaUserConfig(), /format must be one of: mp3, opus, aac, flac, wav/);
    pollinations({ model: "eleven labs" });
    assert.throws(() => readKanaUserConfig(), /Pollinations model name/);
  });

  it("maps a Qwen-era local configuration onto the local Irodori engine", () => {
    writeFileSync(
      kanaUserConfigPath(),
      JSON.stringify({
        tts: {
          provider: "qwen3-local",
          timeoutSeconds: 600,
          qwen3Local: { port: 7862, model: "Qwen/Qwen3-TTS-12Hz-0.6B-Base", uvExecutable: "relative/uv" },
        },
      }),
    );
    const tts = readKanaUserConfig().tts;
    assert.equal(tts?.provider, "irodori-local");
    assert.equal(tts?.timeoutSeconds, 600);
    assert.equal("qwen3Local" in (tts ?? {}), false);
  });

  it("validates the local Irodori settings", () => {
    const write = (irodoriLocal: unknown) =>
      writeFileSync(kanaUserConfigPath(), JSON.stringify({ tts: { provider: "irodori-local", irodoriLocal } }));
    write({ steps: 8, threads: 4, precision: "fp32", modelPath: "/models/anime.safetensors", installDirectory: "/srv/kana-voice" });
    assert.deepEqual(readKanaUserConfig().tts?.irodoriLocal, {
      steps: 8,
      threads: 4,
      precision: "fp32",
      modelPath: "/models/anime.safetensors",
      installDirectory: "/srv/kana-voice",
    });
    write({ precision: "int4" });
    assert.throws(() => readKanaUserConfig(), /precision must be auto, int8, or fp32/);
    write({ steps: 0 });
    assert.throws(() => readKanaUserConfig(), /steps/);
    write({ modelPath: "relative/model.safetensors" });
    assert.throws(() => readKanaUserConfig(), /absolute path/);
  });

  it("migrates a flat Pollinations preset with the defaults it relied on", () => {
    writeFileSync(
      kanaUserConfigPath(),
      JSON.stringify({ tts: { preset: "pollinations", apiKey: "legacy-user-key" } }),
    );
    assert.deepEqual(readKanaUserConfig().tts, {
      provider: "pollinations",
      pollinations: { apiKey: "legacy-user-key", model: "qwen-tts-instruct", voice: "Serena", format: "wav" },
    });
  });

  it("lets the environment override deployment mode", () => {
    writeFileSync(kanaUserConfigPath(), JSON.stringify({ deployment: { mode: "local" } }));
    process.env.KANA_DEPLOYMENT_MODE = "deployment";
    assert.deepEqual(resolveKanaDeploymentMode(), {
      mode: "deployment",
      source: "environment",
      error: null,
    });
    delete process.env.KANA_DEPLOYMENT_MODE;
    assert.deepEqual(resolveKanaDeploymentMode(), {
      mode: "local",
      source: "config",
      error: null,
    });
  });

  it("reports an invalid file as status instead of throwing on status surfaces", () => {
    writeFileSync(kanaUserConfigPath(), "{ not json");
    const inspection = inspectKanaUserConfig();
    assert.deepEqual(inspection.config, {});
    assert.match(inspection.error ?? "", /could not read/);
    assert.throws(() => readKanaUserConfig(), /could not read/);

    const mode = resolveKanaDeploymentMode();
    assert.equal(mode.mode, "local");
    assert.match(mode.error ?? "", /could not read/);

    process.env.KANA_DEPLOYMENT_MODE = "cloud";
    assert.match(resolveKanaDeploymentMode().error ?? "", /KANA_DEPLOYMENT_MODE/);
    delete process.env.KANA_DEPLOYMENT_MODE;
  });

  it("caches the parsed file until it changes on disk", () => {
    writeFileSync(kanaUserConfigPath(), JSON.stringify({ hermes: { port: 9200 } }));
    const first = readKanaUserConfig();
    assert.equal(readKanaUserConfig(), first, "an unchanged file is not re-parsed");
    writeFileSync(kanaUserConfigPath(), JSON.stringify({ hermes: { port: 9300 } }));
    assert.equal(readKanaUserConfig().hermes?.port, 9300);
  });
});

it("only validates the selected provider and requires an explicit choice with both blocks", () => {
  const write = (tts: unknown) => writeFileSync(kanaUserConfigPath(), JSON.stringify({ tts }));
  write({ provider: "pollinations", irodoriLocal: { steps: -1, modelPath: "old/path" }, pollinations: { apiKey: "test" } });
  assert.equal(readKanaUserConfig().tts?.irodoriLocal, undefined);
  write({ provider: "irodori-local", irodoriLocal: { steps: 16 }, pollinations: { format: "pcm" } });
  assert.equal(readKanaUserConfig().tts?.pollinations, undefined);
  write({ irodoriLocal: {}, pollinations: {} });
  assert.throws(() => readKanaUserConfig(), /Set tts.provider/);
  write({ pollinations: { apiKey: "test" } });
  assert.equal(readKanaUserConfig().tts?.provider, "pollinations");
  // A new block wins over one left from the openai-compatible days.
  write({ provider: "pollinations", pollinations: { apiKey: "new" }, openAiCompatible: { baseUrl: "https://voice.example/v1" } });
  assert.equal(readKanaUserConfig().tts?.pollinations?.apiKey, "new");
});

it("validates the readable synthesis timeout setting", () => {
  writeFileSync(kanaUserConfigPath(), JSON.stringify({ tts: { timeoutSeconds: 900 } }));
  assert.equal(readKanaUserConfig().tts?.timeoutSeconds, 900);
  for (const value of [0, -1, 3601, 1.5, "900"]) {
    writeFileSync(kanaUserConfigPath(), JSON.stringify({ tts: { timeoutSeconds: value } }));
    assert.throws(() => readKanaUserConfig(), /timeoutSeconds/);
  }
});
