import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

// A stand-in `hermes serve`: it answers /api/health on the --port it is given.
const FAKE_HERMES = `#!/usr/bin/env node
const http = require("node:http");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
http
  .createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, version: "test" }));
  })
  .listen(port, "127.0.0.1");
process.on("SIGTERM", () => process.exit(0));
`;

const root = mkdtempSync(path.join(tmpdir(), "kana-hermes-runtime-test-"));
const previous = { bin: process.env.KANA_HERMES_BIN, data: process.env.KANA_DATA_DIR };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Fake Hermes did not start.");
}

describe("Kana-managed hermes serve restart", () => {
  before(() => {
    const executable = path.join(root, "hermes");
    writeFileSync(executable, FAKE_HERMES);
    chmodSync(executable, 0o755);
    process.env.KANA_HERMES_BIN = executable;
    process.env.KANA_DATA_DIR = path.join(root, "data");
  });

  after(async () => {
    const { stopLocalHermesRuntime } = await import("@/lib/server/local-hermes-runtime");
    await stopLocalHermesRuntime();
    process.env.KANA_HERMES_BIN = previous.bin;
    process.env.KANA_DATA_DIR = previous.data;
    if (previous.bin === undefined) delete process.env.KANA_HERMES_BIN;
    if (previous.data === undefined) delete process.env.KANA_DATA_DIR;
    rmSync(root, { recursive: true, force: true });
  });

  it("restarts only a Hermes it started, on the same port with a new token", async () => {
    const runtime = await import("@/lib/server/local-hermes-runtime");
    await assert.rejects(runtime.restartLocalHermesRuntime(), /not started by Kana/);

    const port = await freePort();
    const first = await runtime.startLocalHermesRuntime({ port });
    assert.equal(first.state, "running");
    assert.equal(first.managed, true);
    assert.equal(first.tokenAvailable, true);
    const firstToken = runtime.managedRuntimeToken();

    // A second request while one runs joins it instead of stopping the new process.
    const [restarted, joined] = await Promise.all([
      runtime.restartLocalHermesRuntime(),
      runtime.restartLocalHermesRuntime(),
    ]);
    assert.equal(joined, restarted);
    assert.equal(restarted.state, "running");
    assert.equal(restarted.managed, true);
    assert.equal(restarted.tokenAvailable, true);
    assert.equal(restarted.port, port);
    assert.notEqual(restarted.pid, first.pid);
    assert.ok(runtime.managedRuntimeToken());
    assert.notEqual(runtime.managedRuntimeToken(), firstToken);

    await runtime.stopLocalHermesRuntime();
    await assert.rejects(runtime.restartLocalHermesRuntime(), /not started by Kana/);
  });

  it("adopts a gateway Kana did not start only when its session token is readable", async () => {
    const runtime = await import("@/lib/server/local-hermes-runtime");
    const executable = path.join(root, "hermes");

    const startExternal = async (token: string | null) => {
      const port = await freePort();
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.HERMES_DASHBOARD_SESSION_TOKEN;
      if (token) env.HERMES_DASHBOARD_SESSION_TOKEN = token;
      const child = spawn(executable, ["serve", "--host", "127.0.0.1", "--port", String(port)], { env });
      await waitForHealth(port);
      return {
        port,
        stop: async () => {
          child.kill("SIGTERM");
          await new Promise<void>((resolve) => child.once("exit", () => resolve()));
        },
      };
    };

    // Hermes started without the variable generates a token only its own
    // process knows, so the gateway is visible but not adoptable.
    const unreadable = await startExternal(null);
    try {
      const started = await runtime.startLocalHermesRuntime({ port: unreadable.port });
      assert.equal(started.state, "running");
      assert.equal(started.managed, false);
      assert.equal(started.tokenAvailable, false);
      assert.match(started.message, /session token could not be read/);

      const inspected = await runtime.inspectLocalHermesRuntime();
      assert.equal(inspected.tokenAvailable, false);
      assert.match(inspected.message, /session token could not be read/);
    } finally {
      await unreadable.stop();
    }

    // A starter that supplies the variable gives Kana the token to adopt.
    const token = "external-session-token";
    const readable = await startExternal(token);
    try {
      const started = await runtime.startLocalHermesRuntime({ port: readable.port });
      assert.equal(started.state, "running");
      assert.equal(started.managed, false);
      assert.equal(started.tokenAvailable, true);
      assert.equal(runtime.managedRuntimeToken(), token);

      const inspected = await runtime.inspectLocalHermesRuntime();
      assert.equal(inspected.tokenAvailable, true);
    } finally {
      await readable.stop();
    }
  });
});

describe("hermes serve environment", () => {
  it("keeps Kana's own settings, and its session secret, out of Hermes", async () => {
    const { hermesServeEnvironment } = await import("@/lib/server/local-hermes-runtime");
    const env = hermesServeEnvironment(
      {
        PATH: "/usr/bin",
        HOME: "/home/you",
        OPENROUTER_API_KEY: "kept-for-hermes",
        KANA_JWT_SECRET: "x".repeat(40),
        KANA_DATA_DIR: "/var/lib/kana",
        __NEXT_PRIVATE_STANDALONE_CONFIG: "{}",
      },
      "minted-token",
    );
    assert.deepEqual(env, {
      PATH: "/usr/bin",
      HOME: "/home/you",
      OPENROUTER_API_KEY: "kept-for-hermes",
      HERMES_DASHBOARD_SESSION_TOKEN: "minted-token",
    });
  });
});
