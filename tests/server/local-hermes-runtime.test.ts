import assert from "node:assert/strict";
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
    const firstToken = runtime.managedRuntimeToken();

    // A second request while one runs joins it instead of stopping the new process.
    const [restarted, joined] = await Promise.all([
      runtime.restartLocalHermesRuntime(),
      runtime.restartLocalHermesRuntime(),
    ]);
    assert.equal(joined, restarted);
    assert.equal(restarted.state, "running");
    assert.equal(restarted.managed, true);
    assert.equal(restarted.port, port);
    assert.notEqual(restarted.pid, first.pid);
    assert.ok(runtime.managedRuntimeToken());
    assert.notEqual(runtime.managedRuntimeToken(), firstToken);

    await runtime.stopLocalHermesRuntime();
    await assert.rejects(runtime.restartLocalHermesRuntime(), /not started by Kana/);
  });
});
