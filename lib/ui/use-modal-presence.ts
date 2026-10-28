"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Matches the modal exit in globals.css: content out 140 ms, panel out from
 * 120 ms for 180 ms, dim layer over 300 ms. Hosts keep the modal mounted this
 * long after `open` turns false, then release it.
 */
export const MODAL_EXIT_MS = 320;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Keep a conditionally rendered modal mounted while its exit plays. The
 * caller renders while `mounted` and marks the backdrop/panel `is-closing`
 * during `closing`; reduced motion releases at once.
 *
 * State settles in a microtask rather than synchronously in the effect: the
 * open path renders on the prop itself, so no frame is lost, and the close
 * path starts before paint.
 */
export function useModalPresence(open: boolean): {
  mounted: boolean;
  closing: boolean;
} {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (open) {
      queueMicrotask(() => {
        setMounted(true);
        setClosing(false);
      });
      return;
    }
    if (!mounted) return;
    if (prefersReducedMotion()) {
      queueMicrotask(() => {
        setMounted(false);
        setClosing(false);
      });
      return;
    }
    queueMicrotask(() => setClosing(true));
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setMounted(false);
      setClosing(false);
    }, MODAL_EXIT_MS);
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [open, mounted]);

  // Opening wins immediately: no blank frame, and a re-open during the exit
  // never renders as closing.
  return { mounted: open || mounted, closing: closing && !open };
}
