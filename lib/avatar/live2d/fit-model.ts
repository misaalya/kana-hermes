/**
 * Model normalization ported from AIRI's `useFitModel`: a fitted model is two
 * canvas heights tall, centered horizontally, and anchored so the upper half
 * of the body fills the stage. All values operate in CSS-pixel stage space;
 * the renderer applies its own resolution scaling on top.
 */

export type Live2DFitParams = {
  scale: number;
  x: number;
  y: number;
};

/** 1 shows the upper half of the body, matching AIRI's landscape default. */
export const LIVE2D_FIT_OFFSET_Y = 1;

export function fitLive2DModel(
  canvasWidth: number,
  canvasHeight: number,
  modelWidth: number,
  modelHeight: number,
  offsetY: number = LIVE2D_FIT_OFFSET_Y,
): Live2DFitParams {
  const heightScale = (canvasHeight / modelHeight) * 2;
  const widthScale = (canvasWidth / modelWidth) * 2;
  let scale = Math.min(heightScale, widthScale);
  if (!Number.isFinite(scale) || scale <= 0) scale = 1e-6;

  return {
    scale,
    x: canvasWidth / 2,
    y: canvasHeight * offsetY,
  };
}
