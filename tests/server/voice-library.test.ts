import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  DEFAULT_VOICE_ID,
  isWavReference,
  listLibraryVoices,
  MODEL_VOICE_ID,
  referenceForVoice,
} from "@/lib/server/voice-library";
import { createVoiceClone, deleteVoiceClone, saveVoiceReferenceFile } from "@/lib/server/voice-store";

const root = mkdtempSync(path.join(tmpdir(), "kana-voice-library-test-"));
const previousDataDir = process.env.KANA_DATA_DIR;

before(() => {
  process.env.KANA_DATA_DIR = root;
});

after(() => {
  if (previousDataDir === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previousDataDir;
  rmSync(root, { recursive: true, force: true });
});

const wavHeader = () => {
  const bytes = new Uint8Array(64);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return bytes;
};

describe("Kana voice library", () => {
  it("always offers the bundled Kana voice and the model's own voice", () => {
    const voices = listLibraryVoices();
    assert.deepEqual(voices.map((voice) => [voice.id, voice.kind]), [
      [DEFAULT_VOICE_ID, "bundled"],
      [MODEL_VOICE_ID, "model"],
    ]);
    assert.match(referenceForVoice() ?? "", /assets\/voices\/kana-default\.wav$/);
    assert.equal(referenceForVoice(MODEL_VOICE_ID), undefined, "the model voice uses no reference");
  });

  it("passes a user voice's reference straight to the engine and falls back when it is gone", () => {
    const filePath = saveVoiceReferenceFile("kc-mine", "wav", wavHeader());
    createVoiceClone({ id: "kc-mine", name: "Mine", filePath });
    assert.equal(referenceForVoice("kc-mine"), filePath);
    assert.equal(listLibraryVoices().find((voice) => voice.id === "kc-mine")?.kind, "reference");

    deleteVoiceClone("kc-mine");
    assert.match(referenceForVoice("kc-mine") ?? "", /kana-default\.wav$/);
    // A Qwen-era service voice id is unknown here and speaks with Kana too.
    assert.match(referenceForVoice("clone-11111111111111111111111111111111") ?? "", /kana-default\.wav$/);
  });

  it("uses the current bundled reference after the install path changes", () => {
    const moved = path.join(root, "moved-kana.wav");
    writeFileSync(moved, wavHeader());
    process.env.KANA_DEFAULT_VOICE_PATH = moved;
    try {
      assert.equal(referenceForVoice(DEFAULT_VOICE_ID), moved);
    } finally {
      delete process.env.KANA_DEFAULT_VOICE_PATH;
    }
  });

  it("accepts only RIFF/WAVE references", () => {
    assert.equal(isWavReference(wavHeader()), true);
    assert.equal(isWavReference(new TextEncoder().encode("ID3 mp3 data that is long enough to pass the size check")), false);
    assert.equal(isWavReference(new Uint8Array(8)), false);
  });
});
