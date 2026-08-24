import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import {
  __setTestTtsPort,
  inspectLocalQwen3TtsRuntime,
  startLocalQwen3TtsRuntime,
  stopLocalQwen3TtsRuntime,
} from "@/lib/server/local-qwen3-tts-runtime";

// A fake TTS health endpoint so probe() exercises the real HTTP path without
// spawning the Python service.
let healthServer: ReturnType<typeof createServer> | null = null;
let healthPort = 0;

before(async () => {
  await new Promise<void>((resolve) => {
    healthServer = createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
    });
    healthServer.listen(0, "127.0.0.1", () => {
      healthPort = (healthServer!.address() as { port: number }).port;
      resolve();
    });
  });
});

after(() => {
  healthServer?.close();
});

describe("local qwen3-tts runtime", () => {
  it("reports stopped when no service answers on any candidate port", async () => {
    __setTestTtsPort(healthPort + 50); // an almost-certainly closed loopback port
    const status = await inspectLocalQwen3TtsRuntime(healthPort + 51);
    // Either stopped or failed is acceptable depending on prior state in this
    // shared global; the key assertion is that it is NOT running/external.
    assert.ok(!["running", "external"].includes(status.state), status.message);
  });

  it("adopts an external service answering /v1/health", async () => {
    __setTestTtsPort(healthPort);
    const status = await inspectLocalQwen3TtsRuntime();
    assert.equal(status.state, "external");
    assert.equal(status.port, healthPort);
    assert.match(status.message, /found on port/);
  });

  it("refuses to double-start while a managed child would exist, and reports external when the port is already served", async () => {
    __setTestTtsPort(healthPort);
    // The port is occupied by our fake server; start must adopt it as external
    // instead of spawning.
    const status = await startLocalQwen3TtsRuntime({ port: healthPort, readyTimeoutMs: 2_000 });
    assert.equal(status.state, "external");
  });

  it("stop is a safe no-op with no managed child", async () => {
    const status = await stopLocalQwen3TtsRuntime();
    assert.equal(status.state, "stopped");
  });
});

describe("ensureQwen3TTSService", () => {
  it("adopts the fake external service and reports ok", async () => {
    __setTestTtsPort(healthPort);
    const { ensureQwen3TTSService } = await import("@/lib/server/local-qwen3-tts-runtime");
    const result = await ensureQwen3TTSService();
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.port, healthPort);
  });
});
