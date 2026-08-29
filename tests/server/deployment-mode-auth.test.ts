import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { isInsecureNoAuthMode } from "@/lib/server/auth/password-store";
import { requireSession } from "@/lib/server/tts-relay";

const root = mkdtempSync(path.join(tmpdir(), "kana-deployment-auth-test-"));
const previous = {
  dataDir: process.env.KANA_DATA_DIR,
  deploymentMode: process.env.KANA_DEPLOYMENT_MODE,
  nodeEnv: process.env.NODE_ENV,
  password: process.env.KANA_ACCESS_PASSWORD,
};
const mutableEnvironment = process.env as Record<string, string | undefined>;

process.env.KANA_DATA_DIR = root;
delete process.env.KANA_ACCESS_PASSWORD;

after(() => {
  if (previous.dataDir === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previous.dataDir;
  if (previous.deploymentMode === undefined) delete process.env.KANA_DEPLOYMENT_MODE;
  else process.env.KANA_DEPLOYMENT_MODE = previous.deploymentMode;
  if (previous.nodeEnv === undefined) delete mutableEnvironment.NODE_ENV;
  else mutableEnvironment.NODE_ENV = previous.nodeEnv;
  if (previous.password === undefined) delete process.env.KANA_ACCESS_PASSWORD;
  else process.env.KANA_ACCESS_PASSWORD = previous.password;
  rmSync(root, { recursive: true, force: true });
});

describe("explicit deployment security posture", () => {
  it("treats a dev server declared as deployment as insecure without auth", () => {
    mutableEnvironment.NODE_ENV = "development";
    process.env.KANA_DEPLOYMENT_MODE = "deployment";
    assert.equal(isInsecureNoAuthMode(), true);

    process.env.KANA_DEPLOYMENT_MODE = "local";
    assert.equal(isInsecureNoAuthMode(), false);
  });

  it("blocks Qwen process access in deployment mode until auth exists", async () => {
    process.env.KANA_DEPLOYMENT_MODE = "deployment";
    const response = await requireSession(
      new Request("https://kana.example/api/voice/tts/status"),
    );
    assert.equal(response?.status, 403);
    assert.match(await response!.text(), /Authentication is required/);

    process.env.KANA_DEPLOYMENT_MODE = "local";
    assert.equal(
      await requireSession(new Request("http://localhost/api/voice/tts/status")),
      null,
    );
  });

  it("applies deployment security when the mode comes from editable JSON", async () => {
    mutableEnvironment.NODE_ENV = "development";
    delete process.env.KANA_DEPLOYMENT_MODE;
    writeFileSync(
      path.join(root, "config.json"),
      JSON.stringify({ deployment: { mode: "deployment" } }),
    );

    assert.equal(isInsecureNoAuthMode(), true);
    const response = await requireSession(
      new Request("https://kana.example/api/voice/tts/status"),
    );
    assert.equal(response?.status, 403);
  });
});
