import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeRestoredMessages,
  parseHermesTranscript,
  withoutLastUserTurn,
} from "@/lib/conversation/hermes-transcript";
import { buildKanaUserPrompt } from "@/lib/presentation/persona";

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

  it("restores protocol 3 turns: the user's words without the Kana note, and the header reply", () => {
    const { messages } = parseHermesTranscript([
      { role: "user", text: `${buildKanaUserPrompt("Halo Kana", { full: true })}\n\n@file:"attachments/a.txt"` },
      { role: "assistant", text: "---\nja: こんにちは。\nemotion: happy\nlang: id\n---\nHalo! **Aku** di sini." },
      { role: "user", text: buildKanaUserPrompt("Thanks") },
      { role: "assistant", text: "Plain English reply" },
    ]);
    assert.deepEqual(messages.map((message) => message.text ?? message.subtitle?.text), [
      "Halo Kana",
      "Halo! **Aku** di sini.",
      "Thanks",
      "Plain English reply",
    ]);
    assert.equal(messages[1].speech_ja, "こんにちは。");
    assert.deepEqual([messages[1].subtitle?.language, messages[1].emotion], ["id", "happy"]);
    assert.equal(messages[3].speech_ja, "", "a plain non-Japanese reply keeps no speech");
  });

  it("returns the tools of a turn Hermes is still working on", () => {
    const { messages, turns, unfinished } = parseHermesTranscript([
      { role: "user", text: "hi" },
      { role: "tool", name: "terminal", context: "ls" },
      { role: "assistant", text: envelope("Hello.") },
      { role: "user", text: "Find the news" },
      { role: "tool", name: "web_search", context: "news today" },
      { role: "tool", name: "web_extract", context: "bbc.com" },
    ]);
    assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "user"]);
    assert.equal(turns.length, 1);
    assert.deepEqual(unfinished.map((activity) => activity.tool), ["web_search", "web_extract"]);
    assert.ok(unfinished.every((activity) => activity.state === "complete"));
    assert.ok(unfinished[0].timestamp > messages[2].timestamp, "they sort after the pending user turn");
    assert.deepEqual(parseHermesTranscript([{ role: "user", text: "hi" }]).unfinished, []);
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

  it("keeps Kana's own commands where they were, between the restored turns", () => {
    const restored = parseHermesTranscript([
      { role: "user", text: "halo" },
      { role: "assistant", text: "---\nemotion: happy\nlang: id\n---\nHai." },
      { role: "user", text: "lagi" },
      { role: "assistant", text: "---\nemotion: happy\nlang: id\n---\nYa." },
    ]).messages;
    const old = 1_000;
    const local = [
      { ...restored[0], id: "u1", timestamp: old },
      { ...restored[1], id: "a1", timestamp: old + 1 },
      { id: "status", role: "user" as const, text: "/status", timestamp: old + 2 },
      { id: "status-note", role: "system" as const, text: "ok", timestamp: old + 3 },
      { ...restored[2], id: "u2", timestamp: old + 4 },
      { ...restored[3], id: "a2", timestamp: old + 5 },
      { id: "restart", role: "user" as const, text: "/restart", timestamp: old + 6 },
    ];
    const merged = mergeRestoredMessages(restored, local);
    assert.deepEqual(merged.map((message) => message.id), [
      restored[0].id, restored[1].id, "status", "status-note", restored[2].id, restored[3].id, "restart",
    ]);
    const timestamps = merged.map((message) => message.timestamp);
    assert.deepEqual([...timestamps].sort((a, b) => a - b), timestamps, "the time order is the chat order");
    assert.ok(new Set(timestamps).size === timestamps.length);
  });
});
