import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitLive2DModel } from "@/lib/avatar/live2d/fit-model";
import { DEFAULT_LIVE2D_MODEL_LAYOUT } from "@/lib/avatar/model-layout";

describe("Live2D automatic fit", () => {
  it("contains an unknown square model instead of applying an upper-body crop", () => {
    const fit = fitLive2DModel(
      1_000,
      800,
      { x: -500, y: -500, width: 1_000, height: 1_000 },
      DEFAULT_LIVE2D_MODEL_LAYOUT,
    );

    assert.equal(fit.scale, 0.736);
    assert.equal(fit.x, 500);
    assert.equal(fit.y, 432);
  });

  it("centers horizontally and grounds geometry with a non-standard Cubism origin", () => {
    const fit = fitLive2DModel(
      1_200,
      900,
      { x: 100, y: -250, width: 400, height: 1_200 },
      DEFAULT_LIVE2D_MODEL_LAYOUT,
    );
    const renderedCenterX = fit.x + (100 + 400 / 2) * fit.scale;
    const renderedBottomY = fit.y + (-250 + 1_200) * fit.scale;

    assert.equal(renderedCenterX, 600);
    assert.equal(renderedBottomY, 900);
  });

  it("applies responsive x/y offsets and scale after the automatic fit", () => {
    const automatic = fitLive2DModel(
      1_000,
      800,
      { x: -250, y: -500, width: 500, height: 1_000 },
      DEFAULT_LIVE2D_MODEL_LAYOUT,
    );
    const adjusted = fitLive2DModel(
      1_000,
      800,
      { x: -250, y: -500, width: 500, height: 1_000 },
      { x: 0.1, y: -0.2, scale: 1.5 },
    );

    assert.equal(adjusted.scale, automatic.scale * 1.5);
    assert.equal(adjusted.x, automatic.x + 100);
    const automaticBottom = automatic.y + 500 * automatic.scale;
    const adjustedBottom = adjusted.y + 500 * adjusted.scale;
    assert.equal(automaticBottom, 800);
    assert.equal(adjustedBottom, 640);
  });
});
