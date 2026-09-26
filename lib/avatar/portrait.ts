import type { Live2DModelBounds } from "./live2d/fit-model";

// Avatar portraits for the Settings avatar cards. There is no artwork to ship
// for the Live2D samples or an imported package, so Kana takes one from the
// stage itself: once a model has loaded, the canvas is rendered and its head
// and shoulders are cut out as a small transparent image. Portraits stay in
// this browser (localStorage) and never leave it.

/** Edge of a stored portrait, in pixels; cards show it at up to 96 CSS px. */
export const PORTRAIT_SIZE = 192;

/** A square of the stage canvas, in canvas pixels. */
export type PortraitCrop = { x: number; y: number; side: number };

/** Where the model sits on the canvas: its anchor point and scale. */
export type PortraitPlacement = {
  /** Model anchor on the stage, in CSS pixels. */
  x: number;
  y: number;
  /** CSS pixels per model unit. */
  scale: number;
  /** Canvas pixels per CSS pixel. */
  resolution: number;
};

/** The crop spans this many head heights: hair above, shoulders below. */
const PORTRAIT_SPAN = 1.45;
/** Space above the head, as a share of the crop. */
const PORTRAIT_HEADROOM = 0.12;

/**
 * The square around a model's head and shoulders, in canvas pixels. `head`
 * is in the model's anchored units, as framing measures it. Null when the
 * head is too small to make a portrait from.
 */
export function portraitCrop(head: Live2DModelBounds, placement: PortraitPlacement): PortraitCrop | null {
  const unit = placement.scale * placement.resolution;
  const headSize = Math.max(head.width, head.height) * unit;
  if (!Number.isFinite(headSize) || headSize < 8) return null;
  const side = headSize * PORTRAIT_SPAN;
  const centerX = (placement.x + (head.x + head.width / 2) * placement.scale) * placement.resolution;
  const top = (placement.y + head.y * placement.scale) * placement.resolution;
  return { x: centerX - side / 2, y: top - side * PORTRAIT_HEADROOM, side };
}

/** Draw `crop` of the stage canvas into a portrait data URL. */
export function drawPortrait(source: HTMLCanvasElement, crop: PortraitCrop, size = PORTRAIT_SIZE): string | null {
  const portrait = document.createElement("canvas");
  portrait.width = size;
  portrait.height = size;
  const context = portrait.getContext("2d");
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size);
  // WebP keeps a portrait near 10 KB; browsers without a WebP encoder give PNG.
  const url = portrait.toDataURL("image/webp", 0.9);
  return url.startsWith("data:image/") ? url : null;
}

const PORTRAITS_KEY = "kana.avatar.portraits.v1";
/** Portraits kept; the least recently taken go first. */
const PORTRAIT_LIMIT = 16;

/** Keys are an imported model's id or a hosted model's URL. */
export type AvatarPortraits = Readonly<Record<string, string>>;

/** Portraits in localStorage. Every read and write tolerates blocked storage. */
export class AvatarPortraitArchive {
  constructor(private readonly storage: () => Storage | undefined = () => globalThis.localStorage) {}

  load(): AvatarPortraits {
    try {
      const value = JSON.parse(this.storage()?.getItem(PORTRAITS_KEY) ?? "{}") as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      return Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].startsWith("data:image/"),
        ),
      );
    } catch {
      return {};
    }
  }

  /** Stores `portraits` (newest last), trimmed to the limit; returns what was kept. */
  save(portraits: AvatarPortraits): AvatarPortraits {
    const kept = Object.fromEntries(Object.entries(portraits).slice(-PORTRAIT_LIMIT));
    try {
      this.storage()?.setItem(PORTRAITS_KEY, JSON.stringify(kept));
    } catch {
      // Full or blocked storage: the portrait still shows until the page reloads.
    }
    return kept;
  }
}

/** `portraits` with `key` set to `url` (moved to newest) or removed. */
export function withPortrait(portraits: AvatarPortraits, key: string, url: string | null): AvatarPortraits {
  const next: Record<string, string> = { ...portraits };
  delete next[key];
  if (url) next[key] = url;
  return next;
}
