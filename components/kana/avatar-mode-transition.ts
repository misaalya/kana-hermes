// Kana's mode change is a full-screen candy wave: an opaque sheet with wavy
// accent edges enters from above, the new layout is written while the screen is
// covered, and the sheet leaves through the bottom. It is Kana's own DOM
// transition, so it does not depend on View Transitions.

import { flushSync } from "react-dom";

const COVER_MS = 280;
const REVEAL_MS = 340;
const COVER_EASING = "cubic-bezier(0.55, 0, 0.75, 0.35)";
const REVEAL_EASING = "cubic-bezier(0.2, 0.8, 0.25, 1)";
const WAVE_CLASS = "kana-wave-wipe";

/** Distinguishes a running wipe from one whose mode change was superseded. */
let generation = 0;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Two frames: one commits the covered layout, the next paints it. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function runWave(update: () => void, token: number): void {
  const wave = document.createElement("div");
  wave.className = WAVE_CLASS;
  wave.setAttribute("aria-hidden", "true");
  document.body.append(wave);

  const applyIfCurrent = () => {
    if (token === generation) flushSync(update);
  };

  void (async () => {
    try {
      const cover = wave.animate(
        [
          { transform: "translateY(-106%)" },
          { transform: "translateY(-6%)" },
        ],
        { duration: COVER_MS, easing: COVER_EASING, fill: "forwards" },
      );
      await cover.finished;
      applyIfCurrent();
      // The sheet covers the viewport; let the new layout paint before the
      // trailing wave uncovers it.
      await nextFrame();
      const reveal = wave.animate(
        [
          { transform: "translateY(-6%)" },
          { transform: "translateY(100%)" },
        ],
        { duration: REVEAL_MS, easing: REVEAL_EASING, fill: "forwards" },
      );
      await reveal.finished;
    } catch {
      // An interrupted animation must not lose the mode change.
      applyIfCurrent();
    } finally {
      wave.remove();
    }
  })();
}

/**
 * Switch between the avatar workspace and focus mode with a candy wave wipe.
 * A second call during a wipe applies immediately: the running wipe then
 * reveals the latest layout instead of replaying its own, older update.
 */
export function wipeAvatarModeChange(update: () => void): void {
  if (
    typeof document === "undefined"
    || typeof window === "undefined"
    || prefersReducedMotion()
  ) {
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
