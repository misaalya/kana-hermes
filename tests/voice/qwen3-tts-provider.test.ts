import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { AvatarController } from "@/lib/avatar/avatar-controller";
import { inspectQwen3TTSService } from "@/lib/voice/qwen3-tts-contract";
import { Qwen3TTSProvider } from "@/lib/voice/qwen3-tts-provider";

const originalFetch = globalThis.fetch;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function responseFor(url: string): Response {
  if (url.endsWith("/health")) {
    return json({
      service: "kana-qwen3-tts",
      api_version: "2",
      status: "ready",
      model: "Qwen/test",
      revision: "pinned",
      device: "cuda:0",
      dtype: "float16",
      speakers: ["ono_anna"],
      languages: ["japanese"],
      default_voice_id: "ono_anna",
      supports_instruction: false,
      supports_voice_clone: true,
      model_type: "custom_voice",
    });
  }
  if (url.endsWith("/setup")) {
    return json({
      service: "kana-qwen3-tts",
      api_version: "2",
      cache_dir: "/srv/qwen-cache",
      cache_exists: true,
      model_cache_detected: true,
      free_disk_bytes: 12 * 1024 ** 3,
      total_disk_bytes: 40 * 1024 ** 3,
      recommended_free_disk_bytes: 4 * 1024 ** 3,
      disk_sufficient: true,
    });
  }
  if (url.endsWith("/voices")) {
    return json({
      service: "kana-qwen3-tts",
      api_version: "2",
      status: "ready",
      default_voice_id: "ono_anna",
      voices: [{ id: "ono_anna", language: "multi", kind: "preset" }],
    });
  }
  return json({ detail: "not found" }, 404);
}

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: originalFetch,
  });
});

describe("Qwen3-TTS browser contract", () => {
  it("reports model, voice, cache, disk, and device setup", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async (input: string | URL | Request) => responseFor(String(input)),
    });

    const status = await inspectQwen3TTSService("http://127.0.0.1:7860");
    assert.equal(status.state, "ready");
    assert.equal(status.device, "cuda:0");
    assert.equal(status.voices[0]?.id, "ono_anna");
    assert.equal(status.setup?.modelCacheDetected, true);
    assert.equal(status.setup?.diskSufficient, true);
  });

  it("always submits Japanese, caches audio, and replays without another request", async () => {
    const speechBodies: Array<Record<string, unknown>> = [];
    let speechRequests = 0;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/speech")) {
          speechRequests += 1;
          speechBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return new Response(new Uint8Array([82, 73, 70, 70]), {
            headers: { "content-type": "audio/wav" },
          });
        }
        if (url.includes("/cancel")) return json({ cancelled: true });
        return responseFor(url);
      },
    });

    const played: ArrayBuffer[] = [];
    const provider = new Qwen3TTSProvider(
      { baseUrl: "http://127.0.0.1:7860", voiceId: "ono_anna" },
      null as unknown as AvatarController,
      {
        play: async (audio) => {
          played.push(audio);
        },
        stop: () => undefined,
      },
    );

    await provider.speak({
      text: "こんにちは。",
      language: "en",
      emotion: "happy",
    });
    await provider.replay();

    assert.equal(speechRequests, 1);
    assert.equal(speechBodies[0]?.language, "ja");
    assert.equal(speechBodies[0]?.text, "こんにちは。");
    assert.equal(played.length, 2);
    assert.equal(provider.getSnapshot().canReplay, true);
    assert.equal(provider.getSnapshot().state, "ready");
  });

  it("delivers sentence chunks in order, prefetches safely, and replays every cached part", async () => {
    const speechTexts: string[] = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/speech")) {
          const body = JSON.parse(String(init?.body)) as { text: string };
          speechTexts.push(body.text);
          return new Response(new TextEncoder().encode(`RIFF${speechTexts.length}`), {
            headers: { "content-type": "audio/wav" },
          });
        }
        if (url.includes("/cancel")) return json({ cancelled: true });
        return responseFor(url);
      },
    });

    const played: string[] = [];
    const provider = new Qwen3TTSProvider(
      {
        baseUrl: "http://127.0.0.1:7860",
        deliveryMode: "sentence_chunks",
        maximumChunkCharacters: 20,
      },
      null as unknown as AvatarController,
      {
        play: async (audio) => {
          played.push(new TextDecoder().decode(audio));
        },
        stop: () => undefined,
      },
    );
    const text =
      "最初の文章です。次の文章もあります。最後の文章まで順番に読みます。";

    await provider.speak({ text, language: "ja" });
    const requestCount = speechTexts.length;
    await provider.replay();

    assert.ok(requestCount > 1);
    assert.equal(speechTexts.join(""), text);
    assert.equal(speechTexts.length, requestCount);
    assert.deepEqual(
      played.slice(0, requestCount),
      Array.from({ length: requestCount }, (_, index) => `RIFF${index + 1}`),
    );
    assert.deepEqual(played.slice(requestCount), played.slice(0, requestCount));
    assert.equal(provider.getSnapshot().deliveryMode, "sentence_chunks");
    assert.equal(provider.getSnapshot().chunkCount, requestCount);
  });

  it("cancels a prefetched sentence part and never starts its playback", async () => {
    let speechRequestCount = 0;
    let resolveSecondSpeech: ((response: Response) => void) | null = null;
    let cancelRequestCount = 0;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/speech")) {
          speechRequestCount += 1;
          if (speechRequestCount === 1) {
            return Promise.resolve(
              new Response(new TextEncoder().encode("RIFF1"), {
                headers: { "content-type": "audio/wav" },
              }),
            );
          }
          return new Promise<Response>((resolve) => {
            resolveSecondSpeech = resolve;
          });
        }
        if (url.includes("/cancel")) {
          cancelRequestCount += 1;
          return Promise.resolve(json({ cancelled: true }));
        }
        return Promise.resolve(responseFor(url));
      },
    });

    let finishPlayback: (() => void) | null = null;
    let playCount = 0;
    const provider = new Qwen3TTSProvider(
      {
        baseUrl: "http://127.0.0.1:7860",
        deliveryMode: "sentence_chunks",
        maximumChunkCharacters: 20,
      },
      null as unknown as AvatarController,
      {
        play: () => {
          playCount += 1;
          return new Promise<void>((resolve) => {
            finishPlayback = resolve;
          });
        },
        stop: () => {
          const finish = finishPlayback;
          finishPlayback = null;
          finish?.();
        },
      },
    );

    const speaking = provider.speak({
      text: "最初の文章です。次の文章もあります。最後まで読みます。",
      language: "ja",
    });
    for (let index = 0; index < 10 && !resolveSecondSpeech; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.ok(resolveSecondSpeech);
    provider.stop();
    const finishSecondSpeech = resolveSecondSpeech as (response: Response) => void;
    finishSecondSpeech(
      new Response(new TextEncoder().encode("RIFF2"), {
        headers: { "content-type": "audio/wav" },
      }),
    );

    await assert.rejects(speaking, (error: unknown) => {
      return error instanceof DOMException && error.name === "AbortError";
    });
    assert.equal(playCount, 1);
    assert.equal(cancelRequestCount, 1);
    assert.equal(provider.getSnapshot().state, "idle");
    assert.equal(provider.getSnapshot().canReplay, false);
  });

  it("prevents a cancelled response from starting stale playback", async () => {
    let resolveSpeech: ((response: Response) => void) | null = null;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/speech")) {
          return new Promise<Response>((resolve) => {
            resolveSpeech = resolve;
          });
        }
        return Promise.resolve(json({ cancelled: true }));
      },
    });

    let playCount = 0;
    const provider = new Qwen3TTSProvider(
      { baseUrl: "http://127.0.0.1:7860" },
      null as unknown as AvatarController,
      {
        play: async () => {
          playCount += 1;
        },
        stop: () => undefined,
      },
    );
    const speaking = provider.speak({ text: "止めて。", language: "ja" });
    await Promise.resolve();
    provider.stop();
    assert.ok(resolveSpeech);
    const finishSpeech = resolveSpeech as (response: Response) => void;
    finishSpeech(
      new Response(new Uint8Array([82, 73, 70, 70]), {
        headers: { "content-type": "audio/wav" },
      }),
    );

    await assert.rejects(speaking, (error: unknown) => {
      return error instanceof DOMException && error.name === "AbortError";
    });
    assert.equal(playCount, 0);
    assert.equal(provider.getSnapshot().state, "idle");
  });
});
