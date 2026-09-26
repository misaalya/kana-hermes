import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildKanaUserPrompt, unwrapKanaUserPrompt } from "@/lib/presentation/persona";

describe("Kana response contract", () => {
  it("puts the full contract after the user's words on the first prompt of a session", () => {
    const prompt = buildKanaUserPrompt("Halo Kana", { full: true });
    assert.ok(prompt.startsWith("Halo Kana\n\n<kana>\n"), "the user's words come first");
    assert.ok(prompt.endsWith("\n</kana>"));
    assert.match(prompt, /Kana response protocol 3/);
    assert.match(prompt, /ja is always natural conversational Japanese/);
    assert.match(prompt, /language of the user's latest message/);
    assert.match(prompt, /keep the language of the user's earlier\s+messages/);
    assert.match(prompt, /Reasoning, tool names, tool\s+arguments, and\s+internal metadata stay in English/);
  });

  it("asks for the header and a Markdown answer, never a JSON envelope or a subtitle setting", () => {
    for (const prompt of [buildKanaUserPrompt("Hi", { full: true }), buildKanaUserPrompt("Hi")]) {
      assert.match(prompt, /\n---\nja: .+\nemotion: <neutral \| happy \| sad \| angry \| surprised \| thinking \| confused \| excited>\nlang: .+\n---\n/);
      assert.doesNotMatch(prompt, /speech_ja|subtitle|kana_request|[{}]/);
    }
  });

  it("keeps later prompts short but still self-sufficient", () => {
    const full = buildKanaUserPrompt("Hi", { full: true });
    const compact = buildKanaUserPrompt("Hi");
    assert.ok(compact.length * 2 < full.length, `${compact.length} vs ${full.length}`);
    assert.match(compact, /ja is always Japanese/);
    assert.match(compact, /language of the user's message/);
  });

  it("tells Hermes what Kana is, so voice and avatar talk is about Kana, not Hermes", () => {
    for (const voice of [true, false]) {
      const prompt = buildKanaUserPrompt("Ngomong dong", { full: true, voice });
      assert.match(prompt, /Kana's voice \(its own text-to-speech: the local Irodori\s+engine or Pollinations\) belong to Kana, not to Hermes/);
      assert.match(prompt, /a local voice model, the avatar, or the\s+app, they mean Kana's/);
    }
  });

  it("tells Hermes how its config changes reach Kana, and never to restart its own server", () => {
    const prompt = buildKanaUserPrompt("Tambahkan model baru", { full: true });
    assert.match(prompt, /Models and providers added to\s+config\.yaml show up in Kana's model picker at once, without a restart/);
    assert.match(prompt, /type \/reload in Kana/);
    assert.match(prompt, /Never stop or\s+restart hermes serve yourself/);
    assert.doesNotMatch(buildKanaUserPrompt("Next", { full: false }), /hermes serve/);
  });

  it("asks for Japanese speech only while Kana's voice is on", () => {
    const on = buildKanaUserPrompt("Hi", { full: true, voice: true });
    assert.match(on, /Kana's voice is on: Kana reads the ja line of every reply aloud/);
    assert.match(on, /never call text_to_speech or another\s+tool for it/);

    const off = buildKanaUserPrompt("Hi", { full: true, voice: false });
    assert.match(off, /Kana's voice is off: nothing is read aloud, so the header has no ja\s+line/);
    assert.match(off, /turn on the voice in\s+Kana's settings/);
    assert.match(off, /\n---\nemotion: .+\nlang: .+\n---\n/);
    assert.doesNotMatch(off, /^ja:|natural conversational Japanese|never put the path in ja/m);
    assert.ok(off.length < on.length, "a silent turn costs fewer tokens");

    const compactOff = buildKanaUserPrompt("Hi", { voice: false });
    assert.match(compactOff, /Kana's voice is off, so there is no ja line/);
    assert.doesNotMatch(compactOff, /^ja:/m);
    assert.match(buildKanaUserPrompt("Hi"), /Kana reads it aloud, so never use a TTS tool to speak/);
  });

  it("gives back exactly what the user typed from a stored prompt", () => {
    const typed = 'Baris satu\n\nBaris "dua" <kana>';
    assert.equal(unwrapKanaUserPrompt(buildKanaUserPrompt(typed, { full: true })), typed);
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
