import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OFFICIAL_CUBISM_CORE_URL,
  normalizeCubismCoreUrl,
  normalizeLive2DModelUrl,
} from "@/lib/avatar/defaults";

describe("Live2D URL security", () => {
  it("accepts only executable Cubism Core scripts from Live2D's SDK path", () => {
    assert.equal(normalizeCubismCoreUrl(OFFICIAL_CUBISM_CORE_URL), OFFICIAL_CUBISM_CORE_URL);
    assert.throws(() => normalizeCubismCoreUrl("https://example.com/core.js"));
    assert.throws(() =>
      normalizeCubismCoreUrl("https://cubism.live2d.com/not-the-sdk/core.js"),
    );
  });

  it("accepts hosted or local model data but rejects credentials and script URLs", () => {
    assert.equal(
      normalizeLive2DModelUrl("https://models.example/avatar.model3.json"),
      "https://models.example/avatar.model3.json",
    );
    assert.equal(
      normalizeLive2DModelUrl("http://127.0.0.1:8080/A.model3.json"),
      "http://127.0.0.1:8080/A.model3.json",
    );
    assert.throws(() => normalizeLive2DModelUrl("javascript:alert(1)"));
    assert.throws(() =>
      normalizeLive2DModelUrl("https://token@example.com/avatar.model3.json"),
    );
  });
});
