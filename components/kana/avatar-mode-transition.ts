"use client";

import { flushSync } from "react-dom";

/**
 * Cross-fade the workspace between chat-with-avatar and focus mode. The
 * browser snapshots both layouts and blends them, so the rail, the dock's
 * geometry, and the avatar change under one fade instead of snapping. Browsers
 * without View Transitions apply the change immediately, as before.
 */
export function fadeAvatarModeChange(update: () => void): void {
  if (typeof document === "undefined" || typeof document.startViewTransition !== "function") {
    update();
    return;
  }
  try {
    // Flush the preference write into the new snapshot; the transition then
    // blends the layouts it captured before and after.
    document.startViewTransition(() => flushSync(update)).finished.catch(() => undefined);
  } catch {
    update();
  }
}
