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

/** Visible model geometry plus the head hit area when the package defines one. */
export type Live2DModelGeometry = {
  bounds: Live2DModelBounds;
  head?: Live2DModelBounds | null;
  /**
   * Visible geometry in the top band of the model. Used to center an estimated
   * head when there is no head hit area, so held props or a leaning pose do
   * not pull the framing sideways.
   */
  crown?: Live2DModelBounds | null;
};

/** Stage edges covered by UI (header, phone chat drawer), in CSS pixels. */
export type Live2DStageInsets = {
  top: number;
  bottom: number;
  /**
   * Largest head width as a share of the usable stage width. Small avatar
   * tiles raise it so the face, not the outfit, fills the frame.
   */
  headWidthShare?: number;
};

export type Live2DFraming = "portrait" | "compact";

export type Live2DFitParams = {
  scale: number;
  x: number;
  y: number;
  framing: Live2DFraming;
};

/**
 * Portrait framing applies to standing humanoids: taller than wide, with a
 * head that is a modest share of the figure. Chibi, mascot, and other compact
 * models are shown whole instead of being cropped at the shoulders.
 */
const PORTRAIT_MIN_ASPECT = 2;
const PORTRAIT_MAX_HEAD_RATIO = 0.28;
/** Head height as a share of a tall figure when no head hit area exists. */
const ESTIMATED_HEAD_RATIO = 0.2;
/** Portrait crop: from just above the head to a little below the shoulders. */
const HAIR_ABOVE_HEAD = 0.6;
const SHOULDER_DEPTH = 2;
const TOP_MARGIN_RATIO = 0.08;
/** The head never grows wider than this share of the usable stage width. */
const HEAD_WIDTH_LIMIT = 0.6;
/** Compact models: fairly large, centered, and resting slightly low. */
const COMPACT_HEIGHT_RATIO = 0.62;
const COMPACT_WIDTH_RATIO = 0.72;
const COMPACT_BOTTOM_RATIO = 0.92;
/** Wide desktop stages frame against a portrait-like width. */
const WIDTH_BASIS_RATIO = 1.3;

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function validBounds(value: Live2DModelBounds | null | undefined): value is Live2DModelBounds {
  return Boolean(
    value
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0,
  );
}

/** Choose portrait or compact framing and resolve the head box to frame on. */
export function classifyLive2DFraming(geometry: Live2DModelGeometry): {
  framing: Live2DFraming;
  head: Live2DModelBounds;
} {
  const bounds = {
    x: finiteOr(geometry.bounds.x, 0),
    y: finiteOr(geometry.bounds.y, 0),
    width: positiveOr(geometry.bounds.width, 1),
    height: positiveOr(geometry.bounds.height, 1),
  };
  const hitHead = geometry.head;
  // A usable head hit area sits inside the figure and is not the whole model.
  const head = validBounds(hitHead)
    && hitHead.height < bounds.height * 0.9
    && hitHead.y >= bounds.y - bounds.height * 0.1
    && hitHead.y + hitHead.height <= bounds.y + bounds.height
    ? hitHead
    : null;

  if (head) {
    return {
      framing: head.height / bounds.height <= PORTRAIT_MAX_HEAD_RATIO ? "portrait" : "compact",
      head,
    };
  }
  const estimatedHeight = bounds.height * ESTIMATED_HEAD_RATIO;
  const crown = validBounds(geometry.crown) ? geometry.crown : null;
  const centerX = crown ? crown.x + crown.width / 2 : bounds.x + bounds.width / 2;
  return {
    framing: bounds.height / bounds.width >= PORTRAIT_MIN_ASPECT ? "portrait" : "compact",
    head: {
      x: centerX - estimatedHeight * 0.45,
      y: bounds.y,
      width: estimatedHeight * 0.9,
      height: estimatedHeight,
    },
  };
}

/**
 * Frame the model for the stage, then apply the user's model-specific
 * adjustment. Standing humanoids are framed from the head to just below the
 * shoulders; compact models are shown whole, centered and slightly low. The
 * user's scale grows from the framing anchor (head top or model center), and
 * offsets are fractions of the stage size.
 */
export function fitLive2DModel(
  canvasWidth: number,
  canvasHeight: number,
  geometry: Live2DModelGeometry,
  adjustment: Live2DModelLayout,
  insets: Live2DStageInsets = { top: 0, bottom: 0 },
): Live2DFitParams {
  const stageWidth = positiveOr(canvasWidth, 1);
  const stageHeight = positiveOr(canvasHeight, 1);
  const layout = normalizeLive2DModelLayout(adjustment);
  const bounds = {
    x: finiteOr(geometry.bounds.x, 0),
    y: finiteOr(geometry.bounds.y, 0),
    width: positiveOr(geometry.bounds.width, 1),
    height: positiveOr(geometry.bounds.height, 1),
  };
  const bottomInset = Math.min(Math.max(0, finiteOr(insets.bottom, 0)), stageHeight * 0.6);
  const visibleHeight = stageHeight - bottomInset;
  const topInset = Math.min(Math.max(0, finiteOr(insets.top, 0)), visibleHeight * 0.3);
  const widthBasis = Math.min(stageWidth, visibleHeight * WIDTH_BASIS_RATIO);
  const headWidthShare = Math.min(1, positiveOr(finiteOr(insets.headWidthShare ?? HEAD_WIDTH_LIMIT, HEAD_WIDTH_LIMIT), HEAD_WIDTH_LIMIT));
  const { framing, head } = classifyLive2DFraming({ ...geometry, bounds });

  let automaticScale: number;
  let anchorX: number;
  let anchorY: number;
  let screenY: number;

  if (framing === "portrait") {
    const cropTop = Math.max(bounds.y, head.y - head.height * HAIR_ABOVE_HEAD);
    const cropBottom = Math.min(
      bounds.y + bounds.height,
      head.y + head.height * SHOULDER_DEPTH,
    );
    screenY = Math.max(topInset, visibleHeight * TOP_MARGIN_RATIO);
    automaticScale = Math.min(
      (visibleHeight - screenY) / Math.max(1, cropBottom - cropTop),
      (widthBasis * headWidthShare) / head.width,
    );
    anchorX = head.x + head.width / 2;
    anchorY = cropTop;
  } else {
    automaticScale = Math.min(
      (visibleHeight * COMPACT_HEIGHT_RATIO) / bounds.height,
      (widthBasis * COMPACT_WIDTH_RATIO) / bounds.width,
    );
    anchorX = bounds.x + bounds.width / 2;
    anchorY = bounds.y + bounds.height / 2;
    const renderedHeight = bounds.height * automaticScale;
    screenY = Math.max(
      topInset + renderedHeight / 2,
      visibleHeight * COMPACT_BOTTOM_RATIO - renderedHeight / 2,
    );
  }

  if (!Number.isFinite(automaticScale) || automaticScale <= 0) automaticScale = 1;
  const scale = automaticScale * layout.scale;
  return {
    scale,
    x: stageWidth / 2 + layout.x * stageWidth - anchorX * scale,
    y: screenY + layout.y * stageHeight - anchorY * scale,
    framing,
  };
}
