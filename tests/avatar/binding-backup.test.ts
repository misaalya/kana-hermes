import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLive2DBindingBackup,
  parseLive2DBindingBackup,
} from "@/lib/avatar/binding-backup";

describe("Live2D binding backup", () => {
  it("round-trips parameter, expression, and motion bindings without assets", () => {
    const backup = createLive2DBindingBackup("My local model", {
      mouthOpenParameter: "ParamMouthCustom",
      emotionExpressions: { happy: "Smile" },
      emotionMotions: { happy: { group: "Joy", index: 1 } },
      motions: { affirm: { group: "Yes", index: 2 } },
    });
    const serialized = JSON.stringify(backup);
    const parsed = parseLive2DBindingBackup(serialized);
    assert.equal(parsed.bindings.mouthOpenParameter, "ParamMouthCustom");
    assert.equal(parsed.bindings.emotionExpressions?.happy, "Smile");
    assert.deepEqual(parsed.bindings.emotionMotions?.happy, { group: "Joy", index: 1 });
    assert.deepEqual(parsed.bindings.motions?.affirm, { group: "Yes", index: 2 });
    assert.equal(serialized.includes("moc3"), false);
  });

  it("rejects unsupported envelopes and invalid mouth bindings", () => {
    assert.throws(() => parseLive2DBindingBackup("{}"), /not a supported/i);
    assert.throws(
      () =>
        parseLive2DBindingBackup(
          JSON.stringify({
            kind: "kana.live2d-bindings",
            version: 1,
            bindings: { mouthOpenParameter: "" },
          }),
        ),
      /mouth parameter/i,
    );
  });
});
