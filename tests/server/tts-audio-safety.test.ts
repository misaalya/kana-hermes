import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundedAudioResult,
  MAX_TTS_AUDIO_BYTES,
  TtsProviderError,
  upstreamErrorMessage,
} from "@/lib/server/tts-provider/types";

describe("TTS audio response limits", () => {
  it("rejects empty, oversized, and inconsistent declared responses", async () => {
    await assert.rejects(
      boundedAudioResult({
        body: new ArrayBuffer(0),
        contentType: "audio/wav",
      }),
      /empty audio body/,
    );
    await assert.rejects(
      boundedAudioResult({
        body: new Uint8Array([1]).buffer,
        contentType: "audio/wav",
        contentLength: String(MAX_TTS_AUDIO_BYTES + 1),
      }),
      (error: unknown) => error instanceof TtsProviderError && error.status === 413,
    );
    await assert.rejects(
      boundedAudioResult({
        body: new Uint8Array([1, 2]).buffer,
        contentType: "audio/wav",
        contentLength: "1",
      }),
      /inconsistent audio length/,
    );
  });

  it("preserves a bounded stream and its trusted length", async () => {
    const result = await boundedAudioResult({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4]));
          controller.close();
        },
      }),
      contentType: "audio/wav",
      contentLength: "4",
    });
    assert.ok(result.body instanceof ReadableStream);
    assert.deepEqual(
      [...new Uint8Array(await new Response(result.body).arrayBuffer())],
      [1, 2, 3, 4],
    );
    assert.equal(result.contentLength, "4");
  });

  it("bounds untrusted provider error bodies", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(20_000));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
    assert.equal(
      await upstreamErrorMessage(response, "External TTS"),
      "External TTS returned HTTP 502.",
    );
    assert.equal(cancelled, true);
  });
});
