import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createKanaBackup,
  parseKanaBackup,
  serializeKanaBackup,
} from "@/lib/backup/kana-backup";
import { createConversation } from "@/lib/conversation/types";
import { DEFAULT_PREFERENCES } from "@/lib/preferences/local-preferences-store";

describe("Kana local backup", () => {
  it("preserves displayed subtitles while excluding credentials and avatar assets", () => {
    const conversation = createConversation({ subtitleLanguage: "id" });
    conversation.messages.push({
      id: "assistant-1",
      role: "assistant",
      speech_ja: "こんにちは",
      subtitle: { text: "Halo", language: "id" },
      timestamp: 42,
    });
    const backup = createKanaBackup(
      {
        ...DEFAULT_PREFERENCES,
        qwen3Tts: {
          ...DEFAULT_PREFERENCES.qwen3Tts,
          deliveryMode: "sentence_chunks",
        },
        live2d: {
          ...DEFAULT_PREFERENCES.live2d,
          modelId: "licensed-local-model",
          modelName: "Local model",
        },
      },
      [conversation],
    );
    const serialized = serializeKanaBackup(backup);
    const restored = parseKanaBackup(serialized);

    // Credentials cannot leak: they are not part of preferences at all now.
    assert.equal(serialized.includes("token"), false);
    assert.equal(serialized.includes("websocketUrl"), false);
    assert.equal(serialized.includes("ws://"), false);
    assert.equal(serialized.includes("licensed-local-model"), false);
    assert.deepEqual(restored.conversations[0].messages[0].subtitle, {
      text: "Halo",
      language: "id",
    });
    assert.equal(restored.preferences.qwen3Tts.deliveryMode, "sentence_chunks");
  });

  it("rejects malformed or unsupported backup envelopes", () => {
    assert.throws(() => parseKanaBackup("not-json"), /valid JSON/i);
    assert.throws(
      () => parseKanaBackup(JSON.stringify({ kind: "kana.local-backup", version: 99 })),
      /supported Kana backup/i,
    );
  });
});
