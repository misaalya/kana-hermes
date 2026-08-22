import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitJapaneseSpeech } from "@/lib/voice/speech-chunks";

describe("Japanese speech chunking", () => {
  it("preserves the exact response text and sentence order", () => {
    const text =
      "こんにちは。今日は長い作業について説明します。最初の手順を確認してから、安全に次へ進みます。最後まで順番は変わりません。";
    const chunks = splitJapaneseSpeech(text, 32);

    assert.ok(chunks.length > 1);
    assert.equal(chunks.join(""), text);
    assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 32));
  });

  it("splits an oversized sentence at Japanese soft breaks", () => {
    const text =
      "これはとても長い文章で、句読点を使いながら、安全な位置で、音声を分けるためのテスト文章です";
    const chunks = splitJapaneseSpeech(text, 24);

    assert.equal(chunks.join(""), text);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 24));
  });
});
