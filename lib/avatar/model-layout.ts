/**
 * A model-specific adjustment layered on top of Kana's automatic fit.
 *
 * X and Y are fractions of the current stage size, rather than pixels, so a
 * layout remains useful across desktop, mobile, and resized windows. Scale is
 * a multiplier over the model's automatically calculated scale.
 */
export type Live2DModelLayout = {
  x: number;
  y: number;
  scale: number;
};

export const DEFAULT_LIVE2D_MODEL_LAYOUT: Live2DModelLayout = Object.freeze({
  x: 0,
  y: 0,
  scale: 1,
});

export const LIVE2D_LAYOUT_LIMITS = Object.freeze({
  x: { minimum: -0.75, maximum: 0.75 },
  y: { minimum: -0.75, maximum: 0.75 },
  scale: { minimum: 0.25, maximum: 2.5 },
});

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeLive2DModelLayout(
  value: unknown,
): Live2DModelLayout {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    x: clamp(
      finiteOr(record.x, DEFAULT_LIVE2D_MODEL_LAYOUT.x),
      LIVE2D_LAYOUT_LIMITS.x.minimum,
      LIVE2D_LAYOUT_LIMITS.x.maximum,
    ),
    y: clamp(
      finiteOr(record.y, DEFAULT_LIVE2D_MODEL_LAYOUT.y),
      LIVE2D_LAYOUT_LIMITS.y.minimum,
      LIVE2D_LAYOUT_LIMITS.y.maximum,
    ),
    scale: clamp(
      finiteOr(record.scale, DEFAULT_LIVE2D_MODEL_LAYOUT.scale),
      LIVE2D_LAYOUT_LIMITS.scale.minimum,
      LIVE2D_LAYOUT_LIMITS.scale.maximum,
    ),
  };
}

export function isDefaultLive2DModelLayout(
  value: Live2DModelLayout,
): boolean {
  const normalized = normalizeLive2DModelLayout(value);
  return (
    normalized.x === DEFAULT_LIVE2D_MODEL_LAYOUT.x &&
    normalized.y === DEFAULT_LIVE2D_MODEL_LAYOUT.y &&
    normalized.scale === DEFAULT_LIVE2D_MODEL_LAYOUT.scale
  );
}

export function normalizeLive2DLayoutProfiles(
  value: unknown,
): Record<string, Live2DModelLayout> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 200)
      .flatMap(([key, layout]) => {
        const normalizedKey = key.trim().slice(0, 2_048);
        if (!normalizedKey) return [];
        return [[normalizedKey, normalizeLive2DModelLayout(layout)]];
      }),
  );
}
