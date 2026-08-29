import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  normalizeOpenAiSpeechEndpoint,
  OpenAiCompatibleTtsProvider,
} from "@/lib/server/tts-provider/openai-compatible-provider";

const originalFetch = globalThis.fetch;

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: originalFetch,
  });
});

describe("OpenAI-compatible TTS provider", () => {
  it("normalizes API roots and full speech endpoints without accepting insecure remotes", () => {
    assert.equal(
      normalizeOpenAiSpeechEndpoint("https://gen.pollinations.ai/v1"),
      "https://gen.pollinations.ai/v1/audio/speech",
    );
    assert.equal(
      normalizeOpenAiSpeechEndpoint("https://voice.example/v1/audio/speech"),
      "https://voice.example/v1/audio/speech",
    );
    assert.equal(
      normalizeOpenAiSpeechEndpoint("http://127.0.0.1:8080/v1"),
      "http://127.0.0.1:8080/v1/audio/speech",
    );
    assert.throws(
      () => normalizeOpenAiSpeechEndpoint("http://voice.example/v1"),
      /HTTPS.*loopback/i,
    );
    assert.throws(
      () => normalizeOpenAiSpeechEndpoint("https://secret@voice.example/v1"),
      /embedded credentials/i,
    );
  });

  it("uses Pollinations as a preset over the generic request adapter", async () => {
    let requestedUrl = "";
    let requestedHeaders = new Headers();
    let requestedBody: Record<string, unknown> = {};
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async (input: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedHeaders = new Headers(init?.headers);
        requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(new Uint8Array([82, 73, 70, 70]), {
          headers: { "Content-Type": "audio/wav" },
        });
      },
    });

    const provider = new OpenAiCompatibleTtsProvider({
      preset: "pollinations",
      apiKey: "user-key",
      defaultInstruction: "A calm and gentle voice.",
    });
    const result = await provider.synthesize(
      { text: "こんにちは。", language: "ja", voiceId: "ignored-local-voice" },
      new AbortController().signal,
    );

    assert.equal(requestedUrl, "https://gen.pollinations.ai/v1/audio/speech");
    assert.equal(requestedHeaders.get("authorization"), "Bearer user-key");
    assert.deepEqual(requestedBody, {
      model: "qwen-tts-instruct",
      input: "こんにちは。",
      voice: "Serena",
      response_format: "wav",
      instruct: "A calm and gentle voice.",
    });
    assert.equal(result.contentType, "audio/wav");
    assert.equal(JSON.stringify(provider.descriptor).includes("user-key"), false);
  });

  it("does not send an instruction unless the provider opts into a field", async () => {
    let requestedBody: Record<string, unknown> = {};
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async (_input: string | URL | Request, init?: RequestInit) => {
        requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(new Uint8Array([1]), {
          headers: { "Content-Type": "audio/mpeg" },
        });
      },
    });
    const provider = new OpenAiCompatibleTtsProvider({
      baseUrl: "http://127.0.0.1:8080/v1",
      model: "tts-1",
      voice: "alloy",
      defaultInstruction: "This provider does not support it.",
    });
    await provider.synthesize({ text: "hello" }, new AbortController().signal);
    assert.deepEqual(requestedBody, {
      model: "tts-1",
      input: "hello",
      voice: "alloy",
    });
  });

  it("fails safely when a remote provider has no user API key", async () => {
    const provider = new OpenAiCompatibleTtsProvider({
      baseUrl: "https://voice.example/v1",
      model: "tts-1",
      voice: "alloy",
    });
    const inspection = await provider.inspect();
    assert.equal(inspection.state, "unavailable");
    assert.match(inspection.message ?? "", /apiKey/);
    await assert.rejects(
      provider.synthesize({ text: "hello" }, new AbortController().signal),
      /apiKey/,
    );
  });

  it("redacts a key even when an upstream error carelessly echoes it", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async () => new Response(
        JSON.stringify({ error: { message: "Invalid token secret-user-key" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    });
    const provider = new OpenAiCompatibleTtsProvider({
      baseUrl: "https://voice.example/v1",
      apiKey: "secret-user-key",
      model: "tts-1",
      voice: "alloy",
    });
    await assert.rejects(
      provider.synthesize({ text: "hello" }, new AbortController().signal),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /secret-user-key/);
        assert.match(error.message, /\[REDACTED\]/);
        return true;
      },
    );
  });
});
