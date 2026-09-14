"use client";

import { useEffect, useRef, useState } from "react";
import {
  normalizeLive2DModelLayout,
  type Live2DModelLayout,
} from "@/lib/avatar/model-layout";

type AvatarLayoutSurfaceProps = {
  layout: Live2DModelLayout;
  label: string;
  chatOpen: boolean;
  onChange(layout: Live2DModelLayout): void;
};

type Point = { x: number; y: number };

// Snap to the automatic center/size when a gesture lands close to it.
const SNAP_OFFSET = 0.015;
const SNAP_SCALE = 0.04;
const KEY_STEP = 0.01;

function snap(layout: Live2DModelLayout): Live2DModelLayout {
  return normalizeLive2DModelLayout({
    x: Math.abs(layout.x) < SNAP_OFFSET ? 0 : layout.x,
    y: Math.abs(layout.y) < SNAP_OFFSET ? 0 : layout.y,
    scale: Math.abs(layout.scale - 1) < SNAP_SCALE ? 1 : layout.scale,
  });
}

function distance(points: Point[]): number {
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function midpoint(points: Point[]): Point {
  return points.length > 1
    ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
    : points[0];
}

/**
 * Direct manipulation over the avatar stage while the layout panel is open.
 * Offsets are fractions of the stage size, matching how the Live2D fit applies
 * them, so the model follows the pointer exactly.
 */
export function AvatarLayoutSurface({ layout, label, chatOpen, onChange }: AvatarLayoutSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(normalizeLive2DModelLayout(layout));
  const onChangeRef = useRef(onChange);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ layout: Live2DModelLayout; center: Point; spread: number } | null>(null);
  const frame = useRef(0);
  const pending = useRef<Live2DModelLayout | null>(null);
  const [dragging, setDragging] = useState(false);
  const [centered, setCentered] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
    if (!pending.current) layoutRef.current = normalizeLive2DModelLayout(layout);
  });

  const commit = (next: Live2DModelLayout) => {
    const snapped = snap(next);
    layoutRef.current = snapped;
    pending.current = snapped;
    setCentered(snapped.x === 0);
    if (frame.current) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = 0;
      const value = pending.current;
      pending.current = null;
      if (value) onChangeRef.current(value);
    });
  };

  const startGesture = () => {
    const points = [...pointers.current.values()];
    gesture.current = points.length
      ? {
          layout: layoutRef.current,
          center: midpoint(points),
          spread: points.length > 1 ? distance(points) : 0,
        }
      : null;
  };

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = layoutRef.current;
      commit({ ...current, scale: current.scale * Math.exp(-event.deltaY * 0.0015) });
    };
    surface.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      surface.removeEventListener("wheel", onWheel);
      if (frame.current) window.cancelAnimationFrame(frame.current);
    };
    // commit only touches refs and stable state setters.
  }, []);

  const bounds = () => surfaceRef.current?.getBoundingClientRect();

  return (
    <div
      ref={surfaceRef}
      data-avatar-layout-surface=""
      data-chat-open={chatOpen}
      role="application"
      aria-label={label}
      tabIndex={0}
      className={`kana-layout-surface kana-focus absolute inset-0 z-[5] touch-none select-none ${dragging ? "is-dragging" : ""}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        startGesture();
        setDragging(true);
        setCentered(layoutRef.current.x === 0);
      }}
      onPointerMove={(event) => {
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const start = gesture.current;
        const rect = bounds();
        if (!start || !rect) return;
        const points = [...pointers.current.values()];
        const center = midpoint(points);
        const scale = points.length > 1 && start.spread > 0
          ? start.layout.scale * (distance(points) / start.spread)
          : start.layout.scale;
        commit({
          x: start.layout.x + (center.x - start.center.x) / rect.width,
          y: start.layout.y + (center.y - start.center.y) / rect.height,
          scale,
        });
      }}
      onPointerUp={(event) => {
        pointers.current.delete(event.pointerId);
        startGesture();
        if (!pointers.current.size) setDragging(false);
      }}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId);
        startGesture();
        if (!pointers.current.size) setDragging(false);
      }}
      onKeyDown={(event) => {
        const current = layoutRef.current;
        const step = event.shiftKey ? KEY_STEP * 5 : KEY_STEP;
        const moves: Record<string, Partial<Live2DModelLayout>> = {
          ArrowLeft: { x: current.x - step },
          ArrowRight: { x: current.x + step },
          ArrowUp: { y: current.y - step },
          ArrowDown: { y: current.y + step },
          "+": { scale: current.scale + 0.05 },
          "=": { scale: current.scale + 0.05 },
          "-": { scale: current.scale - 0.05 },
        };
        const patch = moves[event.key];
        if (!patch) return;
        event.preventDefault();
        // Keyboard nudges are exact; skip snapping so small steps are possible.
        const next = normalizeLive2DModelLayout({ ...current, ...patch });
        layoutRef.current = next;
        onChangeRef.current(next);
      }}
    >
      {dragging && centered ? <span className="kana-layout-guide" aria-hidden="true" /> : null}
    </div>
  );
}
