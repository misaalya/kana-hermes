import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { kanaUserConfigPath, readKanaUserConfig } from "@/lib/server/user-config";

const root = mkdtempSync(path.join(tmpdir(), "kana-user-config-test-"));
const previousDataDir = process.env.KANA_DATA_DIR;
process.env.KANA_DATA_DIR = root;

after(() => {
  if (previousDataDir === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previousDataDir;
  rmSync(root, { recursive: true, force: true });
});

describe("advanced user configuration", () => {
  it("uses the single Kana data root and treats a missing file as optional", () => {
    assert.equal(kanaUserConfigPath(), path.join(root, "config.json"));
    assert.deepEqual(readKanaUserConfig(), {});
  });

  it("reads supported Hermes and TTS overrides", () => {
    writeFileSync(
      kanaUserConfigPath(),
      JSON.stringify({
        hermes: {
          executable: "/opt/hermes/bin/hermes",
          port: 9120,
          workingDirectory: "/srv/hermes",
        },
        tts: {
          projectDirectory: "/opt/kana/qwen",
          uvExecutable: "/opt/uv/bin/uv",
          port: 7861,
          model: "custom/model",
          device: "cpu",
        },
      }),
    );

    assert.deepEqual(readKanaUserConfig(), {
      hermes: {
        executable: "/opt/hermes/bin/hermes",
        port: 9120,
        workingDirectory: "/srv/hermes",
      },
      tts: {
        projectDirectory: "/opt/kana/qwen",
        uvExecutable: "/opt/uv/bin/uv",
        port: 7861,
        model: "custom/model",
        device: "cpu",
      },
    });
  });

  it("rejects relative paths and unsafe ports", () => {
    writeFileSync(kanaUserConfigPath(), JSON.stringify({ hermes: { executable: "bin/hermes" } }));
    assert.throws(() => readKanaUserConfig(), /absolute path/);

    writeFileSync(kanaUserConfigPath(), JSON.stringify({ tts: { port: 80 } }));
    assert.throws(() => readKanaUserConfig(), /between 1024 and 65535/);
  });
});
