import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_HARU_BINDINGS,
  DEFAULT_MAO_BINDINGS,
  OFFICIAL_HARU_MODEL_URL,
  OFFICIAL_LIVE2D_SAMPLES,
  OFFICIAL_MAO_MODEL_URL,
  normalizeLive2DModelUrl,
} from "@/lib/avatar/defaults";
import { live2DModelBindings } from "@/lib/avatar/model-bindings";
import { DEFAULT_PREFERENCES } from "@/lib/preferences/local-preferences-store";

describe("Official Live2D samples", () => {
  it("keeps two pinned official models with deliberately different mouth bindings", () => {
    assert.equal(OFFICIAL_LIVE2D_SAMPLES.length, 2);
    assert.equal(normalizeLive2DModelUrl(OFFICIAL_HARU_MODEL_URL), OFFICIAL_HARU_MODEL_URL);
    assert.equal(normalizeLive2DModelUrl(OFFICIAL_MAO_MODEL_URL), OFFICIAL_MAO_MODEL_URL);
    assert.equal(DEFAULT_HARU_BINDINGS.mouthOpenParameter, "ParamMouthOpenY");
    assert.equal(DEFAULT_MAO_BINDINGS.mouthOpenParameter, "ParamA");
    assert.notEqual(
      DEFAULT_HARU_BINDINGS.mouthOpenParameter,
      DEFAULT_MAO_BINDINGS.mouthOpenParameter,
    );
  });

  it("resolves Mao bindings from its source instead of inheriting Haru defaults", () => {
    const bindings = live2DModelBindings({
      ...DEFAULT_PREFERENCES.live2d,
      modelUrl: OFFICIAL_MAO_MODEL_URL,
      modelName: "Mao",
      modelId: undefined,
      mouthOpenParameter: "ParamMouthOpenY",
      bindingProfiles: {},
    });

    assert.equal(bindings.mouthOpenParameter, "ParamA");
    assert.equal(bindings.emotionExpressions?.happy, "exp_02");
    assert.deepEqual(bindings.motions?.celebrate, {
      group: "TapBody",
      index: 3,
    });
  });
});
