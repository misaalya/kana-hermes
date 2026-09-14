import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildKanaResumeSeedPrefix,
  buildKanaSystemPrompt,
  buildKanaUserPrompt,
} from "@/lib/presentation/persona";

describe("Kana response contract", () => {
  it("asks Hermes to subtitle in the language the user wrote in", () => {
    for (const prompt of [buildKanaSystemPrompt(), buildKanaResumeSeedPrefix()]) {
      assert.match(prompt, /language of the user's latest message/);
      assert.match(prompt, /keep the language of\s+the user's earlier messages/);
      assert.match(prompt, /speech_ja is always natural conversational Japanese/);
      assert.doesNotMatch(prompt, /requested subtitle language/);
    }
  });

  it("sends no subtitle language setting with each turn", () => {
    const prompt = buildKanaUserPrompt("Halo Kana");
    const envelope = JSON.parse(prompt.slice(prompt.indexOf("{"))) as {
      kana_request: Record<string, unknown>;
      user_message: string;
    };

    assert.equal(envelope.user_message, "Halo Kana");
    assert.deepEqual(envelope.kana_request, { response_protocol_version: 2 });
  });
});
