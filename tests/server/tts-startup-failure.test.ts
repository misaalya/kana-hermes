import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { startLocalQwen3TtsRuntime } from "@/lib/server/local-qwen3-tts-runtime";

const root = mkdtempSync(path.join(tmpdir(), "kana-tts-spawn-test-"));
const previous = process.env.KANA_DATA_DIR;
process.env.KANA_DATA_DIR = root;
after(() => {
  if (previous === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

it("reports the dependency install error instead of leaving the UI at Starting", async () => {
  const uv = path.join(root, "uv");
  writeFileSync(uv, "#!/bin/sh\necho 'dependency installation failed in fixture' >&2\nexit 1\n");
  chmodSync(uv, 0o755);
  writeFileSync(path.join(root, "config.json"), JSON.stringify({ tts: { qwen3Local: { uvExecutable: uv } } }));
  const port = await new Promise<number>((resolve) => {
    const socket = createServer();
    socket.listen(0, "127.0.0.1", () => {
      const port = (socket.address() as { port: number }).port;
      socket.close(() => resolve(port));
    });
  });
  await assert.rejects(startLocalQwen3TtsRuntime({ port, readyTimeoutMs: 2000 }), /dependency installation failed in fixture/);
});
