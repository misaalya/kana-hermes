import assert from "node:assert/strict";
import { test } from "node:test";

// The adapter is a single-file HTTP server; this pins the contract surface
// that lib/voice/qwen3-tts-contract.ts and the relay routes depend on.

test("health payload keeps the v2 contract shape", async () => {
  const { spawn } = await import("node:child_process");
  const port = 7899;
  const proc = spawn(
    process.execPath,
    [new URL("../server.mjs", import.meta.url).pathname],
    {
      env: {
        ...process.env,
        KANA_TTS_PORT: String(port),
        KANA_TTS_ENGINE_DIR: "/nonexistent",
      },
      stdio: "ignore",
    },
  );
  try {
    let lastError = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/v1/health`);
        const body = await response.json();
        assert.equal(body.service, "kana-qwen3-tts");
        assert.equal(body.api_version, "2");
        assert.equal(body.status, "loading");
        assert.ok(Array.isArray(body.languages));
        assert.equal(body.supports_voice_clone, true);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    assert.ok(lastError === null, `health probe failed: ${lastError}`);
  } finally {
    proc.kill("SIGTERM");
  }
});
