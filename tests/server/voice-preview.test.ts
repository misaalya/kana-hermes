import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  DEFAULT_VOICE_ID,
  MODEL_VOICE_ID,
  referenceForVoice,
} from "@/lib/server/voice-library";
import {
  createVoiceClone,
  deleteVoiceClone,
  saveVoiceReferenceFile,
} from "@/lib/server/voice-store";
import {
  loadVoicePreview,
  VoicePreviewNotFoundError,
} from "@/lib/server/voice-preview";

const root = mkdtempSync(path.join(tmpdir(), "kana-voice-preview-test-"));
const previousDataDir = process.env.KANA_DATA_DIR;

before(() => {
  process.env.KANA_DATA_DIR = root;
});

after(() => {
  if (previousDataDir === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previousDataDir;
  rmSync(root, { recursive: true, force: true });
});

function wavBytes(): Buffer {
  const bytes = Buffer.alloc(64);
  bytes.write("RIFF", 0);
  bytes.write("WAVE", 8);
  return bytes;
}

describe("Kana voice previews", () => {
  it("plays the bundled reference itself and the prepared model sample", () => {
    const reference = referenceForVoice(DEFAULT_VOICE_ID);
    assert.ok(reference);
    assert.deepEqual(loadVoicePreview(DEFAULT_VOICE_ID), readFileSync(reference));

    const model = loadVoicePreview(MODEL_VOICE_ID);
    assert.ok(model.byteLength > 44, "the model sample has audio");
    assert.equal(model.subarray(0, 4).toString(), "RIFF");
    assert.equal(model.subarray(8, 12).toString(), "WAVE");
  });

  it("previews a reference voice with its own uploaded sample", () => {
    const bytes = wavBytes();
    const filePath = saveVoiceReferenceFile("kc-preview-mine", "wav", bytes);
    createVoiceClone({ id: "kc-preview-mine", name: "Mine", filePath });
    try {
      assert.deepEqual(loadVoicePreview("kc-preview-mine"), bytes);
    } finally {
      deleteVoiceClone("kc-preview-mine");
    }
    assert.throws(() => loadVoicePreview("kc-preview-mine"), VoicePreviewNotFoundError);
  });

  it("rejects unknown and unsafe voice ids", () => {
    assert.throws(() => loadVoicePreview("missing"), VoicePreviewNotFoundError);
    assert.throws(() => loadVoicePreview("../../etc/passwd"), VoicePreviewNotFoundError);
  });
});
