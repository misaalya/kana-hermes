import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildKanaUserPrompt, unwrapKanaUserPrompt } from "@/lib/presentation/persona";

describe("Kana response contract", () => {
  it("puts the full contract after the user's words on the first prompt of a session", () => {
    const prompt = buildKanaUserPrompt("Halo Kana", true);
    assert.ok(prompt.startsWith("Halo Kana\n\n<kana>\n"), "the user's words come first");
    assert.ok(prompt.endsWith("\n</kana>"));
    assert.match(prompt, /Kana response protocol 3/);
    assert.match(prompt, /ja is always natural conversational Japanese/);
    assert.match(prompt, /language of the user's latest message/);
    assert.match(prompt, /keep the language of the user's earlier\s+messages/);
    assert.match(prompt, /Reasoning, tool names, tool\s+arguments, and internal metadata stay in English/);
  });

  it("asks for the header and a Markdown answer, never a JSON envelope or a subtitle setting", () => {
    for (const prompt of [buildKanaUserPrompt("Hi", true), buildKanaUserPrompt("Hi")]) {
      assert.match(prompt, /\n---\nja: .+\nemotion: <neutral \| happy \| sad \| angry \| surprised \| thinking \| confused \| excited>\nlang: .+\n---\n/);
      assert.doesNotMatch(prompt, /speech_ja|subtitle|kana_request|[{}]/);
    }
  });

  it("keeps later prompts short but still self-sufficient", () => {
    const full = buildKanaUserPrompt("Hi", true);
    const compact = buildKanaUserPrompt("Hi");
    assert.ok(compact.length * 2 < full.length, `${compact.length} vs ${full.length}`);
    assert.match(compact, /ja is always Japanese/);
    assert.match(compact, /language of the user's message/);
  });

  it("gives back exactly what the user typed from a stored prompt", () => {
    const typed = 'Baris satu\n\nBaris "dua" <kana>';
    assert.equal(unwrapKanaUserPrompt(buildKanaUserPrompt(typed, true)), typed);
    assert.equal(unwrapKanaUserPrompt(buildKanaUserPrompt(typed)), typed);
    const withAttachment = `${buildKanaUserPrompt("Read this")}\n\n@file:"attachments/a.txt"`;
    assert.equal(unwrapKanaUserPrompt(withAttachment), "Read this");
    assert.equal(unwrapKanaUserPrompt(buildKanaUserPrompt("")), "");
  });

  it("still unwraps the protocol 2 JSON wrapper and leaves other text alone", () => {
    const legacy = `Use the following presentation metadata for this turn.\n\n${JSON.stringify({
      kana_request: { response_protocol_version: 2 },
      user_message: 'Halo "Kana"',
    })}`;
    assert.equal(unwrapKanaUserPrompt(legacy), 'Halo "Kana"');
    assert.equal(unwrapKanaUserPrompt("Thanks"), "Thanks");
  });
});
