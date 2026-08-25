import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  deleteQwen3VoiceClone,
  deleteQwen3VoiceCloneUrl,
  inspectQwen3TTSService,
  qwen3TTSUrl,
} from "@/lib/voice/qwen3-tts-contract";

const originalFetch = globalThis.fetch;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: originalFetch,
  });
});

describe("qwen3-tts relay URL mapping", () => {
  it("maps speech, health, and cancel paths onto the relay route tree", () => {
    const base = "http://127.0.0.1:7860";
    assert.equal(qwen3TTSUrl(base, "/v1/speech"), "/api/voice/tts/speech");
    assert.equal(qwen3TTSUrl(base, "/v1/health"), "/api/voice/tts/health");
    assert.equal(
      qwen3TTSUrl(base, `/v1/requests/${encodeURIComponent("req-1")}/cancel`),
      "/api/voice/tts/requests/req-1/cancel",
    );
  });
});

describe("voice clone deletion contract", () => {
  it("pairs the query-param URL builder with the relay route parser", () => {
    // The DELETE handler on /api/voice/tts/voices reads `id` from the query
    // string; this is exactly that parsing logic.
    const parseDeleteVoiceId = (url: string): string | null =>
      new URL(url, "http://kana.invalid").searchParams.get("id");

    for (const voiceId of ["clone-abc123", "clone/a?b&c", "clone-日本語"]) {
      const url = deleteQwen3VoiceCloneUrl("http://127.0.0.1:7860", voiceId);
      const parsed = new URL(url, "http://kana.invalid");
      assert.equal(parsed.pathname, "/api/voice/tts/voices");
      assert.equal(parsed.searchParams.get("id"), voiceId);
      assert.equal(parseDeleteVoiceId(url), voiceId);
    }
  });

  it("keeps preset voices undeletable at the contract layer", async () => {
    await assert.rejects(
      () => deleteQwen3VoiceClone("http://127.0.0.1:7860", "ono_anna"),
      /Only user-created cloned voices/,
    );
  });
});

describe("relay health envelope classification", () => {
  function mockFetchWith(payload: unknown): void {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async () => json(payload),
    });
  }

  it("reports an honest loading state from the relay notice", async () => {
    mockFetchWith({
      service: "kana-qwen3-tts",
      api_version: "2",
      relay_status: "loading",
      message: "Starting the Qwen3-TTS service…",
    });
    const status = await inspectQwen3TTSService("http://127.0.0.1:7860");
    assert.equal(status.state, "loading");
    assert.match(status.message ?? "", /Starting the Qwen3-TTS service/);
  });

  it("reports stopped as unavailable instead of a spawn attempt", async () => {
    mockFetchWith({
      service: "kana-qwen3-tts",
      api_version: "2",
      relay_status: "stopped",
      message: "No running Qwen3-TTS service was detected on this machine.",
    });
    const status = await inspectQwen3TTSService("http://127.0.0.1:7860");
    assert.equal(status.state, "unavailable");
    assert.match(status.message ?? "", /not running|No running/);
  });

  it("still rejects a non-Kana health payload", async () => {
    mockFetchWith({ status: "ok", service: "gradio-app" });
    const status = await inspectQwen3TTSService("http://127.0.0.1:7860");
    assert.equal(status.state, "unavailable");
    assert.match(status.message ?? "", /incompatible health response/);
  });
});
