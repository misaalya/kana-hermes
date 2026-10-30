import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  InstaboxWakeError,
  wakeRemoteHermes,
} from "@/lib/server/instabox-wake";
import { kanaUserConfigPath } from "@/lib/server/user-config";

const root = mkdtempSync(path.join(tmpdir(), "kana-instabox-missing-"));
const previousDataDir = process.env.KANA_DATA_DIR;
let server: ReturnType<typeof createServer>;

before(async () => {
  process.env.KANA_DATA_DIR = root;
  server = createServer((_request, response) => {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false }));
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
            executable: path.join(root, "missing", "instabox"),
            timeoutSeconds: 10,
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
  rmSync(root, { recursive: true, force: true });
});

describe("Instabox wake failure", () => {
  it("fails fast when the Instabox CLI cannot start", async () => {
    await assert.rejects(
      wakeRemoteHermes(),
      (error: unknown) =>
        error instanceof InstaboxWakeError
        && error.code === "failed"
        && error.status === 502
        && !error.message.includes(root),
    );
  });
});
