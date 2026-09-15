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
    const conversation = createConversation({});
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
        stageBackground: "custom",
        customBackgroundId: "local-background-asset",
        voice: {
          voiceId: "kc-mine",
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
    assert.equal(serialized.includes("local-background-asset"), false);
    assert.deepEqual(restored.conversations[0].messages[0].subtitle, {
      text: "Halo",
      language: "id",
    });
    assert.equal(restored.preferences.voice.deliveryMode, "sentence_chunks");
    assert.equal(restored.preferences.voice.voiceId, "kc-mine");
    assert.equal(restored.preferences.stageBackground, "plain");
  });

  it("restores the delivery mode from a backup made with the Qwen3-TTS voice service", () => {
    const backup = JSON.parse(serializeKanaBackup(createKanaBackup(DEFAULT_PREFERENCES, [])));
    const { voice: _current, ...legacyPreferences } = backup.preferences;
    void _current;
    backup.preferences = {
      ...legacyPreferences,
      qwen3Tts: { baseUrl: "http://127.0.0.1:7860", voiceId: "clone-0123", deliveryMode: "sentence_chunks" },
    };
    const restored = parseKanaBackup(JSON.stringify(backup));
    assert.deepEqual(restored.preferences.voice, { voiceId: "", deliveryMode: "sentence_chunks" });
    assert.equal("qwen3Tts" in restored.preferences, false);
  });

  it("rejects malformed or unsupported backup envelopes", () => {
    assert.throws(() => parseKanaBackup("not-json"), /valid JSON/i);
    assert.throws(
      () => parseKanaBackup(JSON.stringify({ kind: "kana.local-backup", version: 99 })),
      /supported Kana backup/i,
    );
  });
});
