import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  POLLINATIONS_MAX_INPUT_CHARACTERS,
  POLLINATIONS_SPEECH_ENDPOINT,
  PollinationsTtsProvider,
} from "@/lib/server/tts-provider/pollinations-provider";

const originalFetch = globalThis.fetch;

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: originalFetch,
  });
});

type Captured = { url: string; headers: Headers; body: Record<string, unknown> };

function captureFetch(response: () => Response): Captured[] {
  const calls: Captured[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return response();
    },
  });
  return calls;
}

describe("Pollinations TTS provider", () => {
  it("sends Pollinations' own fields to its speech endpoint", async () => {
    const calls = captureFetch(() => new Response(new Uint8Array([73, 68, 51]), {
      headers: { "Content-Type": "audio/mpeg" },
    }));
    const provider = new PollinationsTtsProvider({
      apiKey: "sk_user-key",
      model: "elevenlabs",
      voice: "JTlYtJrcTzPC71hMLOxo",
      instructions: "Speak softly and warmly.",
    });
    const result = await provider.synthesize(
      { text: "こんにちは。", language: "ja", voiceId: "ignored-local-voice" },
      new AbortController().signal,
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, POLLINATIONS_SPEECH_ENDPOINT);
    assert.equal(calls[0]?.headers.get("authorization"), "Bearer sk_user-key");
    assert.deepEqual(calls[0]?.body, {
      input: "こんにちは。",
      response_format: "mp3",
      model: "elevenlabs",
      voice: "JTlYtJrcTzPC71hMLOxo",
      // Pollinations' field, not the "instruct" the old generic preset sent.
      instructions: "Speak softly and warmly.",
    });
    assert.equal(result.contentType, "audio/mpeg");
    assert.equal(provider.descriptor.type, "pollinations");
    assert.equal(JSON.stringify(provider.descriptor).includes("sk_user-key"), false);
  });

  it("leaves an unset model and voice to Pollinations' defaults", async () => {
    const calls = captureFetch(() => new Response(new Uint8Array([1]), {
      headers: { "Content-Type": "audio/mpeg" },
    }));
    await new PollinationsTtsProvider({ apiKey: "sk_key" }).synthesize(
      { text: "hello" },
      new AbortController().signal,
    );
    assert.deepEqual(calls[0]?.body, { input: "hello", response_format: "mp3" });
  });

  it("reads an octet-stream body as the requested format", async () => {
    captureFetch(() => new Response(new Uint8Array([82, 73, 70, 70]), {
      headers: { "Content-Type": "application/octet-stream" },
    }));
    const provider = new PollinationsTtsProvider({ apiKey: "sk_key", format: "wav" });
    const result = await provider.synthesize({ text: "hello" }, new AbortController().signal);
    assert.equal(result.contentType, "audio/wav");
  });

  it("refuses input past Pollinations' limit before calling it", async () => {
    const calls = captureFetch(() => new Response(new Uint8Array([1])));
    const provider = new PollinationsTtsProvider({ apiKey: "sk_key" });
    await assert.rejects(
      provider.synthesize(
        { text: "a".repeat(POLLINATIONS_MAX_INPUT_CHARACTERS + 1) },
        new AbortController().signal,
      ),
      /at most 10000 input characters/,
    );
    assert.equal(calls.length, 0);
  });

  it("reports a missing API key instead of calling Pollinations", async () => {
    const calls = captureFetch(() => new Response(new Uint8Array([1])));
    const provider = new PollinationsTtsProvider({ model: "elevenlabs" });
    const inspection = await provider.inspect();
    assert.equal(inspection.state, "unavailable");
    assert.match(inspection.message ?? "", /tts\.pollinations\.apiKey/);
    assert.equal(provider.descriptor.configured, false);
    await assert.rejects(
      provider.synthesize({ text: "hello" }, new AbortController().signal),
      /apiKey/,
    );
    assert.equal(calls.length, 0);
  });

  it("surfaces Pollinations' error message with the key redacted", async () => {
    captureFetch(() => new Response(
      JSON.stringify({
        status: 402,
        success: false,
        error: { code: "INSUFFICIENT_BALANCE", message: "Insufficient pollen balance for sk_secret-user-key." },
      }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    ));
    const provider = new PollinationsTtsProvider({ apiKey: "sk_secret-user-key" });
    await assert.rejects(
      provider.synthesize({ text: "hello" }, new AbortController().signal),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Pollinations returned HTTP 402\. Insufficient pollen balance/);
        assert.doesNotMatch(error.message, /sk_secret-user-key/);
        assert.match(error.message, /\[REDACTED\]/);
        return true;
      },
    );
  });
});
