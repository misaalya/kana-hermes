// Kana's mode change is a liquid wave: layered sheets of water pour down over
// the screen, the new layout is written while it is covered, and the water
// drains away front first. `mode-wave-painter.ts` paints it on one canvas; this
// file owns the timeline, the hand-off to React, and every fallback. It is
// Kana's own DOM transition, so it does not depend on View Transitions.

import { flushSync } from "react-dom";
import {
  MODE_WAVE_COVER_END_MS,
  MODE_WAVE_REVEAL_SPAN_MS,
  MODE_WAVE_TIMING,
  ModeWavePainter,
  type Rgb,
} from "./mode-wave-painter";

const WAVE_CLASS = "kana-wave-wipe";
/** Backing pixels are capped so a large or dense screen stays smooth. */
const MAX_BACKING_PIXELS = 5_000_000;
const FALLBACK_ACCENT: Rgb = [89, 157, 198];
/** A stalled frame loop (a hidden tab) still applies the change and clears the screen. */
const SAFETY_MS = MODE_WAVE_COVER_END_MS + MODE_WAVE_TIMING.holdMs + MODE_WAVE_REVEAL_SPAN_MS + 2_000;

/** Distinguishes a running wave from one whose mode change was superseded. */
let generation = 0;

function canAnimate(): boolean {
  return (
    typeof document !== "undefined"
    && typeof window !== "undefined"
    && typeof requestAnimationFrame === "function"
    && document.visibilityState !== "hidden"
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The theme's accent as RGB; the canvas cannot read a CSS variable itself. */
function readAccent(): Rgb {
  const probe = document.createElement("span");
  probe.style.color = "var(--accent)";
  probe.style.display = "none";
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  if (!value.startsWith("rgb")) return FALLBACK_ACCENT;
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  return channels.length === 3 && channels.every((channel) => Number.isFinite(channel))
    ? (channels as unknown as Rgb)
    : FALLBACK_ACCENT;
}

function runWave(update: () => void, token: number): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (width * height * dpr * dpr > MAX_BACKING_PIXELS) {
    dpr = Math.max(1, Math.sqrt(MAX_BACKING_PIXELS / (width * height)));
  }
  const canvas = document.createElement("canvas");
  canvas.className = WAVE_CLASS;
  canvas.setAttribute("aria-hidden", "true");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    update();
    return;
  }

  let applied = false;
  const apply = () => {
    if (applied) return;
    applied = true;
    if (token === generation) flushSync(update);
  };

  let painter: ModeWavePainter;
  try {
    painter = new ModeWavePainter(ctx, { width, height, dpr, accent: readAccent() });
  } catch {
    apply();
    return;
  }
  document.body.append(canvas);

  let frame = 0;
  let done = false;
  let revealAt: number | null = null;
  let framesSinceApplied = 0;
  const started = performance.now();

  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    window.clearTimeout(safety);
    canvas.remove();
    // An interrupted wave must not lose the mode change.
    apply();
  };
  const safety = window.setTimeout(finish, SAFETY_MS);

  const tick = (now: number) => {
    if (done) return;
    const elapsed = now - started;
    try {
      painter.draw(elapsed, revealAt);
      if (!applied && elapsed >= MODE_WAVE_COVER_END_MS) {
        // This frame covers the whole screen, so the new layout lands unseen.
        apply();
      } else if (applied && revealAt === null) {
        // Let the new layout paint under the water before it drains.
        framesSinceApplied += 1;
        if (framesSinceApplied >= 2 && elapsed >= MODE_WAVE_COVER_END_MS + MODE_WAVE_TIMING.holdMs) {
          revealAt = elapsed;
        }
      } else if (revealAt !== null && elapsed >= revealAt + MODE_WAVE_REVEAL_SPAN_MS) {
        finish();
        return;
      }
    } catch {
      finish();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

/**
 * Switch between the avatar workspace and focus mode with the liquid wave.
 * A second call during a wave applies immediately: the running wave then
 * reveals the latest layout instead of replaying its own, older update.
 */
export function wipeAvatarModeChange(update: () => void): void {
  if (!canAnimate()) {
    update();
    return;
  }
  const token = ++generation;
  if (document.querySelector(`.${WAVE_CLASS}`)) {
    update();
    return;
  }
  runWave(update, token);
}
