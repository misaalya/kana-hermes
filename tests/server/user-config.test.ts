import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  DEFAULT_KANA_USER_CONFIG,
  ensureKanaUserConfigFile,
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
          provider: "qwen3-local",
          qwen3Local: {
            projectDirectory: "/opt/kana/qwen",
            uvExecutable: "/opt/uv/bin/uv",
            runtimeDirectory: "/srv/kana/qwen-runtime",
            cacheDirectory: "/srv/kana/qwen-cache",
            dataDirectory: "/srv/kana/qwen-data",
            port: 7861,
            model: "custom/model",
            modelRevision: null,
            device: "cpu",
            dtype: "float32",
            attention: "eager",
            defaultVoice: "kana",
            maxCharacters: 1500,
            maxNewTokens: 2500,
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
        provider: "qwen3-local",
        qwen3Local: {
          projectDirectory: "/opt/kana/qwen",
          uvExecutable: "/opt/uv/bin/uv",
          runtimeDirectory: "/srv/kana/qwen-runtime",
          cacheDirectory: "/srv/kana/qwen-cache",
          dataDirectory: "/srv/kana/qwen-data",
          port: 7861,
          model: "custom/model",
          modelRevision: null,
          device: "cpu",
          dtype: "float32",
          attention: "eager",
          defaultVoice: "kana",
          maxCharacters: 1500,
          maxNewTokens: 2500,
        },
      },
    });
  });

  it("reads an owner-supplied Pollinations provider configuration", () => {
    writeFileSync(
      kanaUserConfigPath(),
      JSON.stringify({
        tts: {
          provider: "openai-compatible",
          openAiCompatible: {
            preset: "pollinations",
            baseUrl: "https://gen.pollinations.ai/v1",
            apiKey: "user-owned-secret",
            model: "qwen-tts-instruct",
            voice: "Serena",
            defaultInstruction: "Speak calmly in Japanese.",
            instructionField: "instruct",
            responseFormat: "wav",
          },
        },
      }),
    );
    const tts = readKanaUserConfig().tts;
    assert.equal(tts?.provider, "openai-compatible");
    assert.equal(tts?.openAiCompatible?.preset, "pollinations");
    assert.equal(tts?.openAiCompatible?.apiKey, "user-owned-secret");
    assert.equal(tts?.openAiCompatible?.instructionField, "instruct");
  });

  it("resolves Pollinations without exposing its API key in browser-safe metadata", async () => {
    writeFileSync(
      kanaUserConfigPath(),
      JSON.stringify({
        tts: {
          provider: "openai-compatible",
          openAiCompatible: {
            preset: "pollinations",
            apiKey: "never-send-this-key",
          },
        },
      }),
    );
    const { getConfiguredTtsProvider } = await import("@/lib/server/tts-provider");
    const provider = getConfiguredTtsProvider();
    assert.equal(provider.descriptor.name, "Pollinations");
    assert.equal(provider.descriptor.capabilities.instruction, true);
    assert.doesNotMatch(JSON.stringify(provider.descriptor), /never-send-this-key/);
  });

  it("rejects relative paths and unsafe ports", () => {
    writeFileSync(kanaUserConfigPath(), JSON.stringify({ hermes: { executable: "bin/hermes" } }));
    assert.throws(() => readKanaUserConfig(), /absolute path/);

    writeFileSync(
      kanaUserConfigPath(),
      JSON.stringify({ tts: { qwen3Local: { port: 80 } } }),
    );
    assert.throws(() => readKanaUserConfig(), /between 1024 and 65535/);

    writeFileSync(kanaUserConfigPath(), JSON.stringify({ deployment: { mode: "remote-ish" } }));
    assert.throws(() => readKanaUserConfig(), /local.*deployment/);

    writeFileSync(kanaUserConfigPath(), JSON.stringify({ tts: { provider: "cloud-magic" } }));
    assert.throws(() => readKanaUserConfig(), /qwen3-local.*openai-compatible/);

    writeFileSync(
      kanaUserConfigPath(),
      JSON.stringify({
        tts: {
          provider: "openai-compatible",
          openAiCompatible: { instructionField: "model" },
        },
      }),
    );
    assert.throws(() => readKanaUserConfig(), /cannot replace/);
  });

  it("reads the previous flat TTS shape without exposing it as the new API", () => {
    writeFileSync(
      kanaUserConfigPath(),
      JSON.stringify({
        tts: {
          provider: "qwen3-local",
          port: 7862,
          model: "legacy/model",
          device: "cpu",
        },
      }),
    );
    const tts = readKanaUserConfig().tts;
    assert.equal(tts?.qwen3Local?.port, 7862);
    assert.equal(tts?.qwen3Local?.model, "legacy/model");
    assert.equal("model" in (tts ?? {}), false);
  });

  it("migrates a flat Pollinations preset without treating its model as local Qwen", () => {
    writeFileSync(
      kanaUserConfigPath(),
      JSON.stringify({
        tts: {
          preset: "pollinations",
          apiKey: "legacy-user-key",
          model: "qwen-tts-instruct",
          voice: "Serena",
        },
      }),
    );
    const tts = readKanaUserConfig().tts;
    assert.equal(tts?.provider, "openai-compatible");
    assert.equal(tts?.qwen3Local, undefined);
    assert.equal(tts?.openAiCompatible?.model, "qwen-tts-instruct");
  });

  it("lets the environment override deployment mode", () => {
    writeFileSync(kanaUserConfigPath(), JSON.stringify({ deployment: { mode: "local" } }));
    process.env.KANA_DEPLOYMENT_MODE = "deployment";
    assert.deepEqual(resolveKanaDeploymentMode(), {
      mode: "deployment",
      source: "environment",
    });
    delete process.env.KANA_DEPLOYMENT_MODE;
    assert.deepEqual(resolveKanaDeploymentMode(), {
      mode: "local",
      source: "config",
    });
  });
});
