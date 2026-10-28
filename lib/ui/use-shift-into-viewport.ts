"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keep a floating surface inside the viewport horizontally. A surface that
 * crosses the left edge shifts right; one that crosses the right edge shifts
 * left. `translate` leaves a menu's entrance transform free to compose, while
 * `left` moves a positioned dialog without becoming a containing block for
 * its fixed-position dropdowns.
 */
export function useShiftIntoViewport(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  { mode = "translate", edge = 8 }: { mode?: "translate" | "left"; edge?: number } = {},
) {
  useEffect(() => {
    if (!active) return;
    const element = ref.current;
    if (!element) return;
    const reset = () => {
      if (mode === "translate") element.style.translate = "";
      else element.style.left = "";
    };
    const shift = () => {
      reset();
      const bounds = element.getBoundingClientRect();
      let dx = 0;
      if (bounds.left < edge) dx = edge - bounds.left;
      else if (bounds.right > window.innerWidth - edge) dx = window.innerWidth - edge - bounds.right;
      if (!dx) return;
      const value = `${Math.round(dx)}px`;
      if (mode === "translate") element.style.translate = value;
      else element.style.left = value;
    };
    shift();
    const observer = new ResizeObserver(shift);
    observer.observe(element);
    window.addEventListener("resize", shift);
    document.addEventListener("scroll", shift, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", shift);
      document.removeEventListener("scroll", shift, true);
      reset();
    };
  }, [active, edge, mode, ref]);
}
