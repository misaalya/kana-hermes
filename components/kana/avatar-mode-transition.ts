// Kana's mode change is a full-screen candy wave: an opaque sheet with wavy
// accent edges enters from above, the new layout is written while the screen is
// covered, and the sheet leaves through the bottom. It is Kana's own DOM
// transition, so it does not depend on View Transitions.

import { flushSync } from "react-dom";

const COVER_MS = 500;
const REVEAL_MS = 600;
const COVER_EASING = "cubic-bezier(0.45, 0, 0.55, 1)";
const REVEAL_EASING = "cubic-bezier(0.22, 0.8, 0.28, 1)";
const WAVE_CLASS = "kana-wave-wipe";

/**
 * Kana's four-point sparkles ride the wave bands: deeper Kana blue on the
 * white sheet, white on the pale-blue one. Positions are outside the main
 * sheet (above its top, below its bottom), so each star sits on the layered
 * edge that is visible during that phase.
 */
const SPARKLES: ReadonlyArray<{
  left: string;
  top: string;
  size: number;
  delay: number;
  tone: "ink" | "white";
}> = [
  { left: "6%", top: "calc(100% + 4.5vh)", size: 12, delay: 0, tone: "ink" },
  { left: "16%", top: "calc(100% + 15vh)", size: 18, delay: 180, tone: "white" },
  { left: "28%", top: "calc(100% + 6vh)", size: 10, delay: 340, tone: "ink" },
  { left: "40%", top: "calc(100% + 17vh)", size: 15, delay: 60, tone: "white" },
  { left: "52%", top: "calc(100% + 4vh)", size: 20, delay: 260, tone: "ink" },
  { left: "64%", top: "calc(100% + 14.5vh)", size: 12, delay: 420, tone: "white" },
  { left: "76%", top: "calc(100% + 6.5vh)", size: 14, delay: 120, tone: "ink" },
  { left: "88%", top: "calc(100% + 16vh)", size: 16, delay: 300, tone: "white" },
  { left: "95%", top: "calc(100% + 5vh)", size: 12, delay: 480, tone: "ink" },
  { left: "11%", top: "calc(-5vh)", size: 15, delay: 150, tone: "ink" },
  { left: "34%", top: "calc(-16vh)", size: 12, delay: 330, tone: "white" },
  { left: "58%", top: "calc(-5.5vh)", size: 10, delay: 90, tone: "ink" },
  { left: "82%", top: "calc(-15vh)", size: 18, delay: 240, tone: "white" },
  { left: "22%", top: "calc(100% - 4vh)", size: 12, delay: 240, tone: "white" },
  { left: "49%", top: "calc(100% - 6vh)", size: 8, delay: 60, tone: "white" },
  { left: "79%", top: "calc(100% - 3.5vh)", size: 14, delay: 380, tone: "white" },
  { left: "31%", top: "4vh", size: 9, delay: 180, tone: "white" },
  { left: "68%", top: "3vh", size: 12, delay: 320, tone: "white" },
];

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
  // Two back layers extend past the main sheet's leading and trailing edges,
  // so the sweep reads as stacked waves: light blue, white, then Kana blue.
  const far = document.createElement("div");
  far.className = `${WAVE_CLASS}__layer ${WAVE_CLASS}__layer--blue`;
  const near = document.createElement("div");
  near.className = `${WAVE_CLASS}__layer ${WAVE_CLASS}__layer--white`;
  const sheet = document.createElement("div");
  sheet.className = `${WAVE_CLASS}__sheet`;
  wave.append(far, near, sheet);
  for (const sparkle of SPARKLES) {
    const node = document.createElement("span");
    node.className = `${WAVE_CLASS}__sparkle ${WAVE_CLASS}__sparkle--${sparkle.tone}`;
    node.style.left = sparkle.left;
    node.style.top = sparkle.top;
    node.style.setProperty("--kana-sparkle-size", `${sparkle.size}px`);
    node.style.animationDelay = `${sparkle.delay}ms`;
    wave.append(node);
  }
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
