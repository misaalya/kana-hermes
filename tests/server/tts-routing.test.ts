import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, it } from "node:test";
import { GET as engineStatus, POST as engineAction } from "@/app/api/voice/tts/engine/route";
import { POST as speech } from "@/app/api/voice/tts/speech/route";
import { createSessionToken } from "@/lib/server/auth/session";
import { changeAccessPassword } from "@/lib/server/auth/password-store";
import { __setIrodoriPlatformForTests } from "@/lib/server/irodori/platform";
import { installFakeEngine, useSupportedPlatform } from "./irodori-fixtures";

const root = mkdtempSync(path.join(tmpdir(), "kana-tts-routing-"));
const previous = { data: process.env.KANA_DATA_DIR, hub: process.env.HF_HUB_CACHE };
const originalFetch = globalThis.fetch;
let token = "";

before(async () => {
  process.env.KANA_DATA_DIR = root;
  // Keep the host's real Hugging Face cache out of the download estimate.
  process.env.HF_HUB_CACHE = path.join(root, "hub");
  useSupportedPlatform();
  await changeAccessPassword("tts-routing-secret");
  token = await createSessionToken();
});

after(() => {
  globalThis.fetch = originalFetch;
  __setIrodoriPlatformForTests(null);
  for (const [key, value] of [["KANA_DATA_DIR", previous.data], ["HF_HUB_CACHE", previous.hub]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

const authorized = (url: string, init: RequestInit = {}) =>
  new Request(url, { ...init, headers: { Cookie: `kana_session=${token}`, "Content-Type": "application/json", ...init.headers } });

const speak = (id: string, voice?: string) =>
  speech(authorized("http://kana.test/api/voice/tts/speech", {
    method: "POST",
    headers: { "X-Kana-Request-Id": id },
    body: JSON.stringify({ text: "こんにちは。", voice_id: voice, language: "ja", emotion: "happy" }),
  }));

it("answers honestly and quickly before the local engine is downloaded, without downloading it", async () => {
  const fetches: string[] = [];
  globalThis.fetch = async (input) => {
    fetches.push(String(input));
    throw new Error("no network in this test");
  };
  const response = await speak("not-installed");
  assert.equal(response.status, 503);
  assert.match((await response.json() as { error: string }).error, /not installed yet/);
  const status = await engineStatus(authorized("http://kana.test/api/voice/tts/engine"));
  const body = await status.json() as { install: { state: string; downloadBytes: number } };
  assert.equal(body.install.state, "not_installed");
  assert.ok(body.install.downloadBytes > 3_000_000_000);
  assert.deepEqual(fetches, [], "checking status must not start a download");
});

it("routes each provider choice from server config despite a stale browser voice", async () => {
  const model = path.join(root, "anime.safetensors");
  writeFileSync(model, "model");
  const { log } = installFakeEngine(root);
  const calls: string[] = [];
  const remoteAudio = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    const body = JSON.parse(String(init?.body));
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer server-key");
    assert.equal(body.voice, "remote-voice");
    assert.equal(body.input, "こんにちは。");
    return new Response(remoteAudio, { headers: { "content-type": "audio/wav" } });
  };

  writeFileSync(path.join(root, "config.json"), JSON.stringify({ tts: {
    provider: "openai-compatible", irodoriLocal: { modelPath: "not/absolute" },
    openAiCompatible: { baseUrl: "https://voice.example/v1", apiKey: "server-key", model: "tts-model", voice: "remote-voice", responseFormat: "wav" },
  } }));
  const external = await speak("external", "stale-local-voice");
  assert.equal(external.status, 200, await external.clone().text());
  assert.deepEqual(new Uint8Array(await external.arrayBuffer()), remoteAudio);
  assert.deepEqual(calls, ["https://voice.example/v1/audio/speech"]);
  const conflict = await engineAction(authorized("http://kana.test/api/voice/tts/engine", { method: "POST", body: JSON.stringify({ action: "install" }) }));
  assert.equal(conflict.status, 409, "an external provider has nothing to install");

  calls.length = 0;
  writeFileSync(path.join(root, "config.json"), JSON.stringify({ tts: {
    provider: "irodori-local", irodoriLocal: { modelPath: model }, openAiCompatible: { instructionField: "model" },
  } }));
  const local = await speak("local", "stale-local-voice");
  assert.equal(local.status, 200, await local.clone().text());
  assert.equal(local.headers.get("content-type"), "audio/wav");
  const bytes = new Uint8Array(await local.arrayBuffer());
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), "RIFF");
  assert.deepEqual(calls, [], "local speech makes no network requests");
  const [run] = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[] });
  // An unknown voice id falls back to the bundled Kana reference.
  assert.match(run.args[run.args.indexOf("--ref") + 1], /kana-default\.wav$/);
});
