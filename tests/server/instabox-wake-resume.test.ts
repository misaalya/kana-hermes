import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { wakeRemoteHermes } from "@/lib/server/instabox-wake";
import { kanaUserConfigPath } from "@/lib/server/user-config";

const root = mkdtempSync(path.join(tmpdir(), "kana-instabox-resume-"));
const previousDataDir = process.env.KANA_DATA_DIR;
const executable = path.join(root, "bin", "instabox");
const logPath = path.join(root, "wake.log");
const readyPath = path.join(root, "ready");
let server: ReturnType<typeof createServer>;

before(async () => {
  process.env.KANA_DATA_DIR = root;
  process.env.WAKE_RESUME_LOG = logPath;
  process.env.WAKE_RESUME_READY = readyPath;
  mkdirSync(path.dirname(executable), { recursive: true });
  writeFileSync(
    executable,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'fs.appendFileSync(process.env.WAKE_RESUME_LOG, process.argv.slice(2).join(" ") + "\\n");',
      'if (process.argv[2] === "resume") process.exit(1);',
      'fs.writeFileSync(process.env.WAKE_RESUME_READY, "1");',
      "",
    ].join("\n"),
  );
  chmodSync(executable, 0o755);

  server = createServer((request, response) => {
    if (request.url !== "/api/health") {
      response.writeHead(404).end();
      return;
    }
    const ready = existsSync(readyPath);
    response.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    response.end(JSON.stringify(ready ? { ok: true, version: "test" } : { ok: false }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
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
            env: ["WAKE_RESUME_LOG", "WAKE_RESUME_READY"],
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
  delete process.env.WAKE_RESUME_LOG;
  delete process.env.WAKE_RESUME_READY;
  rmSync(root, { recursive: true, force: true });
});

describe("Instabox wake fallback", () => {
  it("starts a stopped sandbox after resume fails and only reports success after health", async () => {
    const result = await wakeRemoteHermes();
    assert.equal(result.woke, true);
    assert.equal(readFileSync(logPath, "utf8"), "resume m_test\nstart m_test\n");
  });
});
