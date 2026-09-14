import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeRestoredMessages,
  parseHermesTranscript,
  withoutLastUserTurn,
} from "@/lib/conversation/hermes-transcript";

const envelope = (text: string, language = "en") =>
  JSON.stringify({ speech_ja: "はい。", subtitle: { text, language }, emotion: "happy" });

describe("Hermes transcript projection", () => {
  it("unwraps Kana requests, numbers assistant turns, and anchors tool activity", () => {
    const { messages, turns } = parseHermesTranscript([
      { role: "system", text: "persona" },
      { role: "user", text: '{"kana_request":{"user_message":"Halo \\"Kana\\""}}' },
      { role: "tool", name: "terminal", context: "ls" },
      { role: "assistant", text: envelope("Hello.") },
      { role: "user", text: "Thanks" },
      { role: "assistant", text: envelope("You're welcome.") },
    ]);
    assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "user", "assistant"]);
    assert.equal(messages[0].text, 'Halo "Kana"');
    assert.equal(messages[1].subtitle?.text, "Hello.");
    assert.equal(messages[1].activities?.length, 1);
    assert.deepEqual(turns.map((turn) => turn.turnIndex), [0]);
    const timestamps = messages.map((message) => message.timestamp);
    assert.deepEqual([...timestamps].sort((a, b) => a - b), timestamps, "order is preserved");
  });

  it("keeps a plain reply without inventing a subtitle language, and hides broken envelopes", () => {
    const { messages } = parseHermesTranscript([
      { role: "assistant", text: "plain text reply" },
      { role: "assistant", text: "{not a Kana envelope}" },
      { role: "assistant", text: '{"speech_ja": "壊れ' },
    ]);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].subtitle?.text, "plain text reply");
    assert.deepEqual(messages.map((message) => message.subtitle?.language), ["und", "und"]);
  });

  it("merges local-only rows after the authoritative restored rows", () => {
    const restored = parseHermesTranscript([{ role: "user", text: "hi" }]).messages;
    const local = [
      { ...restored[0], id: "local-copy" },
      { id: "notice", role: "system" as const, text: "Queued", timestamp: 1 },
    ];
    const merged = mergeRestoredMessages(restored, local);
    assert.deepEqual(merged.map((message) => message.id), [restored[0].id, "notice"]);
    assert.deepEqual(withoutLastUserTurn(merged).map((message) => message.id), []);
  });
});
