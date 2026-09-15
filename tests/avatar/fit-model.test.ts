import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyLive2DFraming,
  fitLive2DModel,
} from "@/lib/avatar/live2d/fit-model";
import { DEFAULT_LIVE2D_MODEL_LAYOUT } from "@/lib/avatar/model-layout";

const close = (actual: number, expected: number, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);

// Proportions measured from the official Haru sample after warm-up.
const HARU = {
  bounds: { x: -462, y: -2060, width: 953, height: 4040 },
  head: { x: -391, y: -2060, width: 830, height: 746 },
};
// Official Wanko: a chibi dog in a bowl, about as wide as tall.
const WANKO = { bounds: { x: -291, y: -161, width: 600, height: 612 }, head: null };

describe("Live2D automatic framing", () => {
  it("frames a standing humanoid from the head to below the shoulders", () => {
    const fit = fitLive2DModel(1_440, 900, HARU, DEFAULT_LIVE2D_MODEL_LAYOUT, { top: 76, bottom: 0 });
    assert.equal(fit.framing, "portrait");

    const cropTop = Math.max(HARU.bounds.y, HARU.head.y - HARU.head.height * 0.6);
    const shoulders = HARU.head.y + HARU.head.height * 2;
    close(fit.y + cropTop * fit.scale, 76);
    close(fit.y + shoulders * fit.scale, 900);
    close(fit.x + (HARU.head.x + HARU.head.width / 2) * fit.scale, 720);
  });

  it("keeps the head within 60% of a narrow phone stage", () => {
    const fit = fitLive2DModel(390, 844, HARU, DEFAULT_LIVE2D_MODEL_LAYOUT, { top: 64, bottom: 388 });
    assert.equal(fit.framing, "portrait");
    assert.ok(HARU.head.width * fit.scale <= 390 * 0.6 + 1e-6);
    const headTop = fit.y + HARU.bounds.y * fit.scale;
    assert.ok(headTop >= 64 - 1e-6, "head clears the header");
    assert.ok(fit.y + HARU.head.y * fit.scale < 844 - 388, "head sits above the chat");
  });

  it("lets a small avatar tile frame the face larger", () => {
    const normal = fitLive2DModel(96, 128, HARU, DEFAULT_LIVE2D_MODEL_LAYOUT);
    const tile = fitLive2DModel(96, 128, HARU, DEFAULT_LIVE2D_MODEL_LAYOUT, { top: 0, bottom: 0, headWidthShare: 0.9 });
    assert.ok(HARU.head.width * normal.scale <= 96 * 0.6 + 1e-6);
    assert.ok(tile.scale > normal.scale, "the tile zooms in");
    assert.ok(HARU.head.width * tile.scale <= 96 * 0.9 + 1e-6, "the head still fits the tile");
    close(tile.x + (HARU.head.x + HARU.head.width / 2) * tile.scale, 48);
    const invalid = fitLive2DModel(96, 128, HARU, DEFAULT_LIVE2D_MODEL_LAYOUT, { top: 0, bottom: 0, headWidthShare: Number.NaN });
    close(invalid.scale, normal.scale);
  });

  it("estimates the head of a tall figure without a head hit area", () => {
    const tall = { bounds: { x: -500, y: -1_800, width: 1_000, height: 3_600 }, head: null };
    const { framing, head } = classifyLive2DFraming(tall);
    assert.equal(framing, "portrait");
    close(head.y, -1_800);
    close(head.height, 3_600 * 0.2);
    close(head.x + head.width / 2, 0);
  });

  it("centers an estimated head on the model's top band, not on held props", () => {
    const leaning = {
      bounds: { x: -300, y: -1_200, width: 900, height: 2_400 },
      head: null,
      crown: { x: -250, y: -1_200, width: 300, height: 430 },
    };
    const { head } = classifyLive2DFraming(leaning);
    close(head.x + head.width / 2, -100);
    const fit = fitLive2DModel(1_440, 900, leaning, DEFAULT_LIVE2D_MODEL_LAYOUT);
    close(fit.x + -100 * fit.scale, 720);
  });

  it("shows a chibi or mascot whole, large, centered, and slightly low", () => {
    const fit = fitLive2DModel(1_440, 900, WANKO, DEFAULT_LIVE2D_MODEL_LAYOUT, { top: 76, bottom: 0 });
    assert.equal(fit.framing, "compact");
    close(WANKO.bounds.height * fit.scale, 900 * 0.62);
    const centerX = fit.x + (WANKO.bounds.x + WANKO.bounds.width / 2) * fit.scale;
    const bottom = fit.y + (WANKO.bounds.y + WANKO.bounds.height) * fit.scale;
    close(centerX, 720);
    close(bottom, 900 * 0.92);
  });

  it("treats a big-headed figure with a head hit area as compact", () => {
    const chibi = {
      bounds: { x: -400, y: -900, width: 800, height: 1_800 },
      head: { x: -350, y: -900, width: 700, height: 800 },
    };
    assert.equal(classifyLive2DFraming(chibi).framing, "compact");
  });

  it("ignores a head hit area that covers the whole model", () => {
    const wholeBody = {
      bounds: { x: -300, y: -300, width: 600, height: 600 },
      head: { x: -300, y: -300, width: 600, height: 600 },
    };
    assert.equal(classifyLive2DFraming(wholeBody).framing, "compact");
  });

  it("keeps compact models above the phone chat drawer", () => {
    const fit = fitLive2DModel(390, 844, WANKO, DEFAULT_LIVE2D_MODEL_LAYOUT, { top: 64, bottom: 388 });
    const top = fit.y + WANKO.bounds.y * fit.scale;
    const bottom = fit.y + (WANKO.bounds.y + WANKO.bounds.height) * fit.scale;
    assert.ok(top >= 64 - 1e-6);
    assert.ok(bottom <= 844 - 388 + 1e-6);
  });

  it("applies responsive offsets and grows the user's scale from the framing anchor", () => {
    const automatic = fitLive2DModel(1_000, 800, WANKO, DEFAULT_LIVE2D_MODEL_LAYOUT);
    const adjusted = fitLive2DModel(1_000, 800, WANKO, { x: 0.1, y: -0.2, scale: 1.5 });
    const centerY = WANKO.bounds.y + WANKO.bounds.height / 2;
    const centerX = WANKO.bounds.x + WANKO.bounds.width / 2;

    close(adjusted.scale, automatic.scale * 1.5);
    close(adjusted.x + centerX * adjusted.scale, automatic.x + centerX * automatic.scale + 100);
    close(adjusted.y + centerY * adjusted.scale, automatic.y + centerY * automatic.scale - 160);
  });

  it("falls back safely for degenerate geometry", () => {
    const fit = fitLive2DModel(0, Number.NaN, { bounds: { x: Number.NaN, y: 0, width: 0, height: -1 } }, DEFAULT_LIVE2D_MODEL_LAYOUT);
    assert.ok(Number.isFinite(fit.scale) && fit.scale > 0);
    assert.ok(Number.isFinite(fit.x) && Number.isFinite(fit.y));
  });
});
