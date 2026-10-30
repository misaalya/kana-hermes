"use client";

import { flushSync } from "react-dom";

/**
 * Morph the workspace between chat-with-avatar and focus mode. The chat panel
 * is the same surface in both layouts and carries its own view-transition
 * name, so the browser animates its geometry from the dock to the focus
 * workspace while the rail and avatar cross-fade around it. Browsers without
 * View Transitions apply the change immediately, as before.
 */
export type AvatarModeDirection = "to-focus" | "to-avatar";

export function morphAvatarModeChange(update: () => void, direction: AvatarModeDirection): void {
  if (typeof document === "undefined" || typeof document.startViewTransition !== "function") {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.kanaModeTransition = direction;
  const clear = () => {
    delete root.dataset.kanaModeTransition;
  };
  try {
    // Flush the preference write into the new snapshot; the transition then
    // morphs the layouts it captured before and after.
    document
      .startViewTransition(() => flushSync(update))
      .finished.finally(clear)
      .catch(() => undefined);
  } catch {
    update();
    clear();
  }
}
