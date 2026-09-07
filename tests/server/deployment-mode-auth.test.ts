import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { requireSession } from "@/lib/server/tts-relay";

const root = mkdtempSync(path.join(tmpdir(), "kana-deployment-auth-test-"));
const previous = {
  dataDir: process.env.KANA_DATA_DIR,
  deploymentMode: process.env.KANA_DEPLOYMENT_MODE,
  nodeEnv: process.env.NODE_ENV,
};
const mutableEnvironment = process.env as Record<string, string | undefined>;

process.env.KANA_DATA_DIR = root;

after(() => {
  if (previous.dataDir === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previous.dataDir;
  if (previous.deploymentMode === undefined) delete process.env.KANA_DEPLOYMENT_MODE;
  else process.env.KANA_DEPLOYMENT_MODE = previous.deploymentMode;
  if (previous.nodeEnv === undefined) delete mutableEnvironment.NODE_ENV;
  else mutableEnvironment.NODE_ENV = previous.nodeEnv;
  rmSync(root, { recursive: true, force: true });
});

describe("explicit deployment security posture", () => {
  it("requires a login session in both deployment and local mode", async () => {
    mutableEnvironment.NODE_ENV = "development";
    process.env.KANA_DEPLOYMENT_MODE = "deployment";
    const deploymentResponse = await requireSession(
      new Request("https://kana.example/api/voice/tts/status"),
    );
    assert.equal(deploymentResponse?.status, 401);

    process.env.KANA_DEPLOYMENT_MODE = "local";
    const localResponse = await requireSession(
      new Request("http://localhost/api/voice/tts/status"),
    );
    assert.equal(localResponse?.status, 401);
  });

  it("applies deployment security when the mode comes from editable JSON", async () => {
    mutableEnvironment.NODE_ENV = "development";
    delete process.env.KANA_DEPLOYMENT_MODE;
    writeFileSync(
      path.join(root, "config.json"),
      JSON.stringify({ deployment: { mode: "deployment" } }),
    );

    const response = await requireSession(
      new Request("https://kana.example/api/voice/tts/status"),
    );
    assert.equal(response?.status, 401);
  });
});
