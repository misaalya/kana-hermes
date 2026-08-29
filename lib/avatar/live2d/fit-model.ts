import {
  normalizeLive2DModelLayout,
  type Live2DModelLayout,
} from "../model-layout";

/** Cubism canvas geometry measured from the loaded Live2D display object. */
export type Live2DModelBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Live2DFitParams = {
  scale: number;
  x: number;
  y: number;
};

/** Leave headroom while keeping the avatar's lower edge grounded. */
const AUTO_WIDTH_RATIO = 0.84;
const AUTO_HEIGHT_RATIO = 0.92;

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Fit the model's visible Cubism bounds inside the stage, then apply the
 * model-specific user adjustment. The lower drawable edge rests at the stage
 * edge: full-body avatars stand naturally, while intentionally half-body
 * models do not expose their flat asset boundary above the bottom of the UI.
 */
export function fitLive2DModel(
  canvasWidth: number,
  canvasHeight: number,
  modelBounds: Live2DModelBounds,
  adjustment: Live2DModelLayout,
): Live2DFitParams {
  const stageWidth = positiveOr(canvasWidth, 1);
  const stageHeight = positiveOr(canvasHeight, 1);
  const modelWidth = positiveOr(modelBounds.width, 1);
  const modelHeight = positiveOr(modelBounds.height, 1);
  const layout = normalizeLive2DModelLayout(adjustment);

  let automaticScale = Math.min(
    (stageWidth * AUTO_WIDTH_RATIO) / modelWidth,
    (stageHeight * AUTO_HEIGHT_RATIO) / modelHeight,
  );
  if (!Number.isFinite(automaticScale) || automaticScale <= 0) {
    automaticScale = 1;
  }
  const scale = automaticScale * layout.scale;
  const modelCenterX = finiteOr(modelBounds.x, 0) + modelWidth / 2;
  const modelBottomY = finiteOr(modelBounds.y, 0) + modelHeight;

  return {
    scale,
    x: stageWidth / 2 + layout.x * stageWidth - modelCenterX * scale,
    y: stageHeight + layout.y * stageHeight - modelBottomY * scale,
  };
}
