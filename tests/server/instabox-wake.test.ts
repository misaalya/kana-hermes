import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { wakeRemoteHermes } from "@/lib/server/instabox-wake";
import { kanaUserConfigPath } from "@/lib/server/user-config";

const root = mkdtempSync(path.join(tmpdir(), "kana-instabox-wake-"));
const previousDataDir = process.env.KANA_DATA_DIR;
const logPath = path.join(root, "wake.log");
const readyPath = path.join(root, "ready");
const executable = path.join(root, "bin", "instabox");
let server: ReturnType<typeof createServer>;
let port = 0;

before(async () => {
  process.env.KANA_DATA_DIR = root;
  process.env.WAKE_TEST_LOG = logPath;
  process.env.WAKE_TEST_READY = readyPath;
  process.env.WAKE_TEST_TOKEN = "allowed-token";
  process.env.WAKE_TEST_SECRET = "must-not-reach-instabox";
  mkdirSync(path.dirname(executable), { recursive: true });
  writeFileSync(
    executable,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'fs.appendFileSync(process.env.WAKE_TEST_LOG, JSON.stringify({',
      "  args: process.argv.slice(2),",
      "  cwd: process.cwd(),",
      "  allowed: process.env.WAKE_TEST_TOKEN ?? null,",
      "  secret: process.env.WAKE_TEST_SECRET ?? null,",
      '}) + "\\n");',
      'if (process.argv[2] === "resume") fs.writeFileSync(process.env.WAKE_TEST_READY, "1");',
      "",
    ].join("\n"),
  );
  chmodSync(executable, 0o755);

  server = createServer((request, response) => {
    if (request.url !== "/api/health") {
      response.writeHead(404).end();
      return;
    }
    let ready = false;
    try {
      ready = readFileSync(readyPath, "utf8") === "1";
    } catch {
      ready = false;
    }
    response.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    response.end(JSON.stringify(ready ? { ok: true, version: "test" } : { ok: false }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;
  writeFileSync(
    kanaUserConfigPath(),
    JSON.stringify({
      hermes: {
        remote: {
          url: `ws://127.0.0.1:${port}`,
          auth: { mode: "password", username: "test", password: "test" },
          instabox: {
            machineId: "m_test",
            executable,
            timeoutSeconds: 10,
            env: ["WAKE_TEST_LOG", "WAKE_TEST_READY", "WAKE_TEST_TOKEN"],
          },
        },
      },
    }),
  );
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (previousDataDir === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previousDataDir;
  delete process.env.WAKE_TEST_LOG;
  delete process.env.WAKE_TEST_READY;
  delete process.env.WAKE_TEST_TOKEN;
  delete process.env.WAKE_TEST_SECRET;
  rmSync(root, { recursive: true, force: true });
});

describe("Instabox wake", () => {
  it("runs only the fixed command with a minimal environment and home cwd", async () => {
    const result = await wakeRemoteHermes();
    assert.equal(result.alreadyUp, false);
    assert.equal(result.woke, true);
    const [entry] = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as {
        args: string[];
        cwd: string;
        allowed: string | null;
        secret: string | null;
      });
    assert.deepEqual(entry.args, ["resume", "m_test"]);
    assert.equal(entry.cwd, homedir());
    assert.equal(entry.allowed, "allowed-token");
    assert.equal(entry.secret, null);

    const again = await wakeRemoteHermes();
    assert.equal(again.alreadyUp, true);
    assert.equal(readFileSync(logPath, "utf8").trim().split("\n").length, 1);
  });
});
