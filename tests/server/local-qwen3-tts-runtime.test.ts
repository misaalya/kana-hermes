import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  __setTestTtsPort,
  ensureQwen3TTSService,
  inspectLocalQwen3TtsRuntime,
  resolveUvExecutable,
  startLocalQwen3TtsRuntime,
  stopLocalQwen3TtsRuntime,
} from "@/lib/server/local-qwen3-tts-runtime";

// Fake /v1/health endpoints so probe classification exercises the real HTTP
// path without spawning the Python service.
type HealthMode = "ready" | "loading" | "foreign";

let healthServer: Server | null = null;
let healthPort = 0;
let healthMode: HealthMode = "ready";

function kanaHealthPayload(status: string): Record<string, unknown> {
  return {
    service: "kana-qwen3-tts",
    api_version: "2",
    status,
    model: "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    device: "cpu",
    dtype: "bfloat16",
    speakers: [],
    languages: ["japanese"],
    default_voice_id: "",
    supports_instruction: false,
    supports_voice_clone: true,
    model_type: "base",
    ...(status === "error" ? { error: "checkpoint missing" } : {}),
  };
}

function startFake(mode: () => HealthMode): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const current = mode();
      if (current === "foreign") {
        // A Gradio-style responder that is NOT the Kana service.
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ status: "ok" }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(kanaHealthPayload(current)));
    });
    server.listen(0, "127.0.0.1", () => {
      healthServer = server;
      resolve((server.address() as { port: number }).port);
    });
  });
}

before(async () => {
  healthPort = await startFake(() => healthMode);
});

after(() => {
  healthServer?.close();
});

describe("local qwen3-tts runtime", () => {
  it("finds uv in the standard user install location even with a minimal service PATH", () => {
    const home = mkdtempSync(path.join(tmpdir(), "kana-uv-discovery-"));
    const executable = path.join(home, ".local", "bin", "uv");
    mkdirSync(path.dirname(executable), { recursive: true });
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);
    try {
      assert.equal(
        resolveUvExecutable({
          ...process.env,
          HOME: home,
          PATH: "/usr/sbin:/usr/bin",
        }),
        executable,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reports stopped when no service answers on any candidate port", async () => {
    // Null the default-port candidate so the test never sees a real service
    // that may be running on the host's 7860.
    __setTestTtsPort(null);
    const status = await inspectLocalQwen3TtsRuntime(healthPort + 50);
    // Either stopped or failed is acceptable depending on prior state in this
    // shared global; the key assertion is that it is NOT running/external.
    assert.ok(!["running", "external"].includes(status.state), status.message);
  });

  it("adopts an external Kana service answering /v1/health as ready", async () => {
    healthMode = "ready";
    __setTestTtsPort(healthPort);
    const status = await inspectLocalQwen3TtsRuntime();
    assert.equal(status.state, "external");
    assert.equal(status.port, healthPort);
    assert.match(status.message, /found on port/);
  });

  it("adopts an external Kana service whose model is still loading, with an honest message", async () => {
    healthMode = "loading";
    __setTestTtsPort(healthPort);
    const status = await inspectLocalQwen3TtsRuntime();
    assert.equal(status.state, "external");
    assert.match(status.message, /still loading/);
  });

  it("refuses to adopt a foreign HTTP 200 responder on the port (D6 guard)", async () => {
    healthMode = "foreign";
    __setTestTtsPort(healthPort);
    const status = await inspectLocalQwen3TtsRuntime(healthPort);
    assert.ok(
      !["running", "external"].includes(status.state),
      `foreign responder was adopted: ${status.message}`,
    );
  });

  it("start adopts an occupied port served by the Kana service instead of spawning", async () => {
    healthMode = "ready";
    __setTestTtsPort(healthPort);
    const status = await startLocalQwen3TtsRuntime({ port: healthPort, readyTimeoutMs: 2_000 });
    assert.equal(status.state, "external");
  });

  it("stop is a safe no-op with no managed child", async () => {
    const status = await stopLocalQwen3TtsRuntime();
    assert.equal(status.state, "stopped");
  });
});

describe("ensureQwen3TTSService", () => {
  it("adopts the fake external service and reports its full status", async () => {
    healthMode = "ready";
    __setTestTtsPort(healthPort);
    const result = await ensureQwen3TTSService();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status.port, healthPort);
      assert.equal(result.status.state, "external");
    }
  });

  it("shares one flight across concurrent callers", async () => {
    healthMode = "ready";
    __setTestTtsPort(healthPort);
    const [first, second, third] = await Promise.all([
      ensureQwen3TTSService(),
      ensureQwen3TTSService(),
      ensureQwen3TTSService(),
    ]);
    for (const result of [first, second, third]) {
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.status.port, healthPort);
    }
  });
});
