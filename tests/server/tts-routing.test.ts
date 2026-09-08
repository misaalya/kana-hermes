import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { POST as speech } from "@/app/api/voice/tts/speech/route";
import { createSessionToken } from "@/lib/server/auth/session";
import { __setTestTtsPort } from "@/lib/server/local-qwen3-tts-runtime";

const root = mkdtempSync(path.join(tmpdir(), "kana-tts-routing-"));
const previous = process.env.KANA_DATA_DIR;
process.env.KANA_DATA_DIR = root;
const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
  if (previous === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

it("routes both provider choices from server config despite stale browser voice and inactive config", async () => {
  const token = await createSessionToken();
  const calls: string[] = [];
  const audio = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(url);
    if (url.endsWith("/health")) return Response.json({ service: "kana-qwen3-tts", api_version: "2", status: "ready" });
    if (url.endsWith("/voices")) return Response.json({ default_voice_id: "local-default", supports_voice_clone: true, voices: [{ id: "local-default" }] });
    const body = JSON.parse(String(init?.body));
    if (url.startsWith("https://voice.example")) {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer server-key");
      assert.equal(body.voice, "remote-voice");
      assert.equal(body.input, "こんにちは。");
      assert.equal(body.voice_id, undefined);
    } else {
      assert.equal(body.voice_id, "local-default");
      assert.equal(body.text, "こんにちは。");
    }
    return new Response(audio, { headers: { "content-type": "audio/wav" } });
  };
  const run = async (id: string, voice?: string) => {
    const result = await speech(new Request("http://kana.test/api/voice/tts/speech", {
      method: "POST", headers: { Cookie: `kana_session=${token}`, "Content-Type": "application/json", "X-Kana-Request-Id": id },
      body: JSON.stringify({ text: "こんにちは。", voice_id: voice, language: "ja" }),
    }));
    assert.equal(result.status, 200, await result.clone().text());
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), audio);
  };
  writeFileSync(path.join(root, "config.json"), JSON.stringify({ tts: {
    provider: "openai-compatible", qwen3Local: { port: 80 },
    openAiCompatible: { baseUrl: "https://voice.example/v1", apiKey: "server-key", model: "tts-model", voice: "remote-voice", responseFormat: "wav" },
  } }));
  await run("external", "stale-local-clone");
  assert.deepEqual(calls, ["https://voice.example/v1/audio/speech"]);
  calls.length = 0;
  writeFileSync(path.join(root, "config.json"), JSON.stringify({ tts: {
    provider: "qwen3-local", qwen3Local: { port: 17862 }, openAiCompatible: { instructionField: "model" },
  } }));
  __setTestTtsPort(17862);
  await run("local");
  assert.ok(calls.some((url) => url === "http://127.0.0.1:17862/v1/speech"));
  assert.ok(calls.every((url) => url.startsWith("http://127.0.0.1:17862/")));
});
