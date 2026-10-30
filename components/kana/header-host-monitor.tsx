"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { formatBytes, formatDuration, percentUsed } from "@/lib/host/host-metrics";
import type {
  HostWidgetId,
  HostWidgetLayout,
  HostWidgetZone,
} from "@/lib/preferences/types";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { useHostSnapshot } from "./use-host-snapshot";

const TICKS = 20;
const GAP = 10;
const DRAG_THRESHOLD = 5;
const NEAR_MARGIN = 40;
const SNAP_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const WIDGET_IDS: HostWidgetId[] = ["monitor", "time", "date"];
const ZONES: HostWidgetZone[] = ["left", "center", "right"];
const PRIORITY: Record<HostWidgetId, number> = { date: 1, time: 2, monitor: 3 };

type Placement = { x: number; width: number; zone: HostWidgetZone };

type Drag = {
  id: HostWidgetId;
  pointerId: number;
  startX: number;
  base: number;
  width: number;
  bandWidth: number;
  grabOffsetX: number;
  grabOffsetY: number;
};

type Preview = {
  layout: HostWidgetLayout;
};

function cloneLayout(layout: HostWidgetLayout): HostWidgetLayout {
  return {
    left: [...layout.left],
    center: [...layout.center],
    right: [...layout.right],
  };
}

function sameLayout(a: HostWidgetLayout, b: HostWidgetLayout): boolean {
  return ZONES.every(
    (zone) =>
      a[zone].length === b[zone].length
      && a[zone].every((id, index) => id === b[zone][index]),
  );
}

function blockWidth(ids: HostWidgetId[], widths: Map<HostWidgetId, number>): number {
  return ids.reduce((sum, id) => sum + (widths.get(id) ?? 0), 0)
    + Math.max(0, ids.length - 1) * GAP;
}

function positionsFor(
  layout: HostWidgetLayout,
  widths: Map<HostWidgetId, number>,
  bandWidth: number,
): Map<HostWidgetId, Placement> {
  const positions = new Map<HostWidgetId, Placement>();
  let x = 0;
  for (const id of layout.left) {
    const width = widths.get(id) ?? 0;
    positions.set(id, { x, width, zone: "left" });
    x += width + GAP;
  }
  x = bandWidth;
  for (const id of layout.right) {
    const width = widths.get(id) ?? 0;
    x -= width;
    positions.set(id, { x, width, zone: "right" });
    x -= GAP;
  }
  let centerX = (bandWidth - blockWidth(layout.center, widths)) / 2;
  for (const id of layout.center) {
    const width = widths.get(id) ?? 0;
    positions.set(id, { x: centerX, width, zone: "center" });
    centerX += width + GAP;
  }
  return positions;
}

function zoneBlock(
  layout: HostWidgetLayout,
  positions: Map<HostWidgetId, Placement>,
  zone: HostWidgetZone,
) {
  const placements = layout[zone]
    .map((id) => positions.get(id))
    .filter((placement): placement is Placement => Boolean(placement));
  if (!placements.length) return null;
  return {
    start: Math.min(...placements.map((placement) => placement.x)),
    end: Math.max(...placements.map((placement) => placement.x + placement.width)),
  };
}

function lowestPriority(ids: HostWidgetId[], protect?: HostWidgetId): HostWidgetId | null {
  return ids
    .filter((id) => id !== protect)
    .sort((a, b) => PRIORITY[a] - PRIORITY[b])[0] ?? null;
}

function overflowWidget(
  layout: HostWidgetLayout,
  positions: Map<HostWidgetId, Placement>,
  bandWidth: number,
  protect?: HostWidgetId,
): HostWidgetId | null {
  const left = zoneBlock(layout, positions, "left");
  const center = zoneBlock(layout, positions, "center");
  const right = zoneBlock(layout, positions, "right");
  if (center && (center.start < -0.5 || center.end > bandWidth + 0.5)) {
    return lowestPriority(layout.center, protect);
  }
  if (left && (left.start < -0.5 || left.end > bandWidth + 0.5)) {
    return lowestPriority(layout.left, protect);
  }
  if (right && (right.start < -0.5 || right.end > bandWidth + 0.5)) {
    return lowestPriority(layout.right, protect);
  }
  if (left && center && left.end + GAP > center.start + 0.5) {
    return lowestPriority(layout.center, protect) ?? lowestPriority(layout.left, protect);
  }
  if (center && right && center.end + GAP > right.start + 0.5) {
    return lowestPriority(layout.center, protect) ?? lowestPriority(layout.right, protect);
  }
  if (left && right && !center && left.end + GAP > right.start + 0.5) {
    return lowestPriority(layout.right, protect) ?? lowestPriority(layout.left, protect);
  }
  return null;
}

/** Hide the lower-priority widget in each collision until the blocks clear. */
function resolveLayout(
  layout: HostWidgetLayout,
  widths: Map<HostWidgetId, number>,
  bandWidth: number,
  protect?: HostWidgetId,
): { layout: HostWidgetLayout; visible: Set<HostWidgetId>; positions: Map<HostWidgetId, Placement> } {
  const visible = new Set<HostWidgetId>(WIDGET_IDS);
  while (true) {
    const visibleLayout: HostWidgetLayout = {
      left: layout.left.filter((id) => visible.has(id)),
      center: layout.center.filter((id) => visible.has(id)),
      right: layout.right.filter((id) => visible.has(id)),
    };
    const positions = positionsFor(visibleLayout, widths, bandWidth);
    const hide = overflowWidget(visibleLayout, positions, bandWidth, protect);
    if (!hide) {
      return { layout: visibleLayout, visible, positions };
    }
    visible.delete(hide);
    if (visible.size === 0) {
      return { layout: visibleLayout, visible, positions };
    }
  }
}

function formatClock(locale: string, date: Date, timeZone?: string): { time: string; zone: string } {
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);
  const zone = new Intl.DateTimeFormat(locale, {
    timeZoneName: "short",
    timeZone,
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value ?? timeZone ?? "";
  return { time, zone };
}

function formatDate(locale: string, date: Date): { dayMonth: string; detail: string } {
  return {
    dayMonth: new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
    }).format(date),
    detail: `${new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date)} ${
      new Intl.DateTimeFormat(locale, { year: "numeric" }).format(date)
    }`,
  };
}

/**
 * The desktop header's three host widgets laid out in fixed LEFT, CENTER, and
 * RIGHT zones. Each zone packs its widgets with one gap: LEFT from the band's
 * left edge, RIGHT from its right edge (first widget rightmost), CENTER as a
 * re-centred block. Drag a widget to another zone or position; a line previews
 * the insert, and the drop slides every tile into the new layout. When a zone
 * would collide, the date steps out first, then the clock, then the monitor,
 * so the centre never touches a side block.
 */
export function HeaderHostMonitor({
  locale,
  layout,
  onLayout,
}: {
  locale: UiLocale;
  layout: HostWidgetLayout;
  onLayout(layout: HostWidgetLayout): void;
}) {
  const copy = getCopy(locale);
  const settings = copy.settings;
  const { snapshot, receivedAt, cpu, error } = useHostSnapshot();
  const [now, setNow] = useState(() => Date.now());
  const [current, setCurrent] = useState<HostWidgetLayout>(layout);
  const [drag, setDrag] = useState<{ id: HostWidgetId } | null>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const tiles = useRef(new Map<HostWidgetId, HTMLDivElement>());
  const widths = useRef(new Map<HostWidgetId, number>());
  const positions = useRef(new Map<HostWidgetId, Placement>());
  const layoutRef = useRef(current);
  const dragRef = useRef<Drag | null>(null);
  const activeDrag = useRef(false);
  const previewRef = useRef<HostWidgetLayout | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const place = useCallback(() => {
    const band = bandRef.current;
    if (!band) return;
    const bandWidth = band.clientWidth;
    for (const id of WIDGET_IDS) {
      const tile = tiles.current.get(id);
      if (tile) widths.current.set(id, tile.offsetWidth);
    }
    const held = activeDrag.current ? dragRef.current?.id : undefined;
    const resolved = resolveLayout(
      previewRef.current ?? layoutRef.current,
      widths.current,
      bandWidth,
      held,
    );
    positions.current = resolved.positions;
    for (const id of WIDGET_IDS) {
      const tile = tiles.current.get(id);
      if (!tile) continue;
      const isHeld = held === id;
      tile.style.transition = isHeld
        ? "outline-color 150ms ease"
        : `transform 200ms ${SNAP_EASING}, outline-color 150ms ease`;
      const placement = resolved.positions.get(id);
      if (!placement) {
        tile.style.visibility = "hidden";
        tile.style.pointerEvents = "none";
        continue;
      }
      tile.style.visibility = "";
      tile.style.pointerEvents = "";
      if (!isHeld) tile.style.transform = `translateX(${placement.x}px)`;
    }
  }, []);

  useLayoutEffect(() => {
    layoutRef.current = current;
    place();
  }, [current, place]);

  useEffect(() => {
    const band = bandRef.current;
    if (!band) return;
    const observer = new ResizeObserver(() => place());
    observer.observe(band);
    for (const tile of tiles.current.values()) observer.observe(tile);
    return () => observer.disconnect();
  }, [place]);

  const localDate = new Date(now);
  const localClock = formatClock(copy.dateLocale, localDate);
  const localDay = formatDate(copy.dateLocale, localDate);
  const serverNow = snapshot && receivedAt !== null
    ? snapshot.serverTime.now + (now - receivedAt)
    : null;
  const serverClock = snapshot && serverNow !== null
    ? formatClock(copy.dateLocale, new Date(serverNow), snapshot.serverTime.zone)
    : null;

  const buildPreview = (id: HostWidgetId, heldCenter: number): Preview | null => {
    const band = bandRef.current;
    if (!band) return null;
    const width = band.clientWidth;
    const without = cloneLayout(previewRef.current ?? layoutRef.current);
    for (const zone of ZONES) {
      without[zone] = without[zone].filter((other) => other !== id);
    }
    const base = resolveLayout(without, widths.current, width);
    const zoneDistance = (zone: HostWidgetZone) => {
      const placements = without[zone]
        .map((other) => base.positions.get(other))
        .filter((placement): placement is Placement => Boolean(placement));
      if (!placements.length) {
        const anchor = zone === "left" ? 0 : zone === "center" ? width / 2 : width;
        return Math.abs(heldCenter - anchor);
      }
      const start = Math.min(...placements.map((placement) => placement.x));
      const end = Math.max(...placements.map((placement) => placement.x + placement.width));
      if (heldCenter < start) return start - heldCenter;
      if (heldCenter > end) return heldCenter - end;
      return 0;
    };
    let zone = ZONES.reduce(
      (best, candidate) =>
        zoneDistance(candidate) < zoneDistance(best) ? candidate : best,
      ZONES[0],
    );
    const currentZone = previewRef.current
      ? ZONES.find((item) => previewRef.current?.[item].includes(id))
      : undefined;
    if (currentZone && zoneDistance(currentZone) <= zoneDistance(zone) + 12) {
      zone = currentZone;
    }
    let index = 0;
    for (const other of without[zone]) {
      const placement = base.positions.get(other);
      if (!placement) continue;
      const center = placement.x + placement.width / 2;
      if (zone === "right" ? center > heldCenter : center < heldCenter) index += 1;
    }
    const next = cloneLayout(without);
    next[zone].splice(index, 0, id);
    return { layout: next };
  };

  const startDrag = (id: HostWidgetId, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const band = bandRef.current;
    const tile = tiles.current.get(id);
    const placement = positions.current.get(id);
    if (!band || !tile || !placement) return;
    const bandBox = band.getBoundingClientRect();
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      base: placement.x,
      width: tile.offsetWidth,
      bandWidth: band.clientWidth,
      grabOffsetX: event.clientX - (bandBox.left + placement.x),
      grabOffsetY: event.clientY - bandBox.top,
    };
    activeDrag.current = false;
    previewRef.current = null;
    tile.getAnimations().forEach((animation) => animation.cancel());
    tile.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (id: HostWidgetId, event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragRef.current;
    if (!dragState || dragState.id !== id || dragState.pointerId !== event.pointerId) return;
    const raw = event.clientX - dragState.startX;
    if (!activeDrag.current && Math.abs(raw) <= DRAG_THRESHOLD) return;
    const tile = tiles.current.get(id);
    const band = bandRef.current;
    if (!tile || !band) return;
    if (!activeDrag.current) {
      activeDrag.current = true;
      previewRef.current = cloneLayout(layoutRef.current);
      setDrag({ id });
      place();
    }
    const bandBox = band.getBoundingClientRect();
    const x = event.clientX - bandBox.left - dragState.grabOffsetX;
    const y = event.clientY - bandBox.top - dragState.grabOffsetY;
    tile.style.transform = `translate(${x}px, ${y}px) scale(1.02)`;
    const near =
      event.clientX >= bandBox.left - NEAR_MARGIN
      && event.clientX <= bandBox.right + NEAR_MARGIN
      && event.clientY >= bandBox.top - NEAR_MARGIN
      && event.clientY <= bandBox.bottom + NEAR_MARGIN;
    if (!near) {
      if (previewRef.current) {
        previewRef.current = null;
        place();
      }
      return;
    }
    const heldCenter = x + dragState.width / 2;
    const preview = buildPreview(id, heldCenter);
    if (preview && (!previewRef.current || !sameLayout(preview.layout, previewRef.current))) {
      previewRef.current = preview.layout;
      place();
    }
  };

  const endDrag = (id: HostWidgetId, event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const dragState = dragRef.current;
    if (!dragState || dragState.id !== id || dragState.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const tile = tiles.current.get(id);
    if (tile?.hasPointerCapture(event.pointerId)) {
      tile.releasePointerCapture(event.pointerId);
    }
    const wasActive = activeDrag.current;
    activeDrag.current = false;
    const band = bandRef.current;
    const bandBox = band?.getBoundingClientRect();
    const near = Boolean(
      bandBox
      && event.clientX >= bandBox.left - NEAR_MARGIN
      && event.clientX <= bandBox.right + NEAR_MARGIN
      && event.clientY >= bandBox.top - NEAR_MARGIN
      && event.clientY <= bandBox.bottom + NEAR_MARGIN,
    );
    const preview = near ? previewRef.current : null;
    previewRef.current = null;
    setDrag(null);
    if (!wasActive) return;
    if (!cancelled && preview && !sameLayout(preview, layoutRef.current)) {
      layoutRef.current = preview;
      setCurrent(preview);
      onLayout(preview);
    }
    place();
  };

  return (
    <div
      ref={bandRef}
      data-host-widgets=""
      data-host-layout={JSON.stringify(current)}
      className="kana-header-widgets relative h-[60px] min-w-0 flex-1 max-lg:hidden"
    >
      <div
        ref={(node) => {
          if (node) tiles.current.set("monitor", node);
          else tiles.current.delete("monitor");
        }}
        data-widget-id="monitor"
        onPointerDown={(event) => startDrag("monitor", event)}
        onPointerMove={(event) => moveDrag("monitor", event)}
        onPointerUp={(event) => endDrag("monitor", event)}
        onPointerCancel={(event) => endDrag("monitor", event, true)}
        role="group"
        aria-label={snapshot?.hostname}
        title={snapshot?.hostname}
        className={`kana-header-host pointer-events-auto absolute left-0 top-0 grid h-full touch-none select-none grid-cols-[1fr_1fr_1fr_1.5fr] gap-3 rounded-[12px] bg-surface-strong px-3.5 py-2 outline outline-1 outline-offset-[-1px] ${
          drag?.id === "monitor"
            ? "z-10 cursor-grabbing outline-accent"
            : "cursor-grab outline-line"
        }`}
        style={{ width: "clamp(280px, 26vw, 380px)" }}
      >
        {snapshot ? (
          <>
            <Metric
              label={settings.hostCpu}
              value={cpu === null ? "—" : `${Math.round(cpu)}%`}
              percent={cpu ?? 0}
            />
            <Metric
              label={settings.hostMemory}
              value={`${Math.round(percentUsed(snapshot.memory.total, snapshot.memory.available))}%`}
              percent={percentUsed(snapshot.memory.total, snapshot.memory.available)}
            />
            <Metric
              label={settings.hostDisk}
              value={snapshot.disk ? `${Math.round(percentUsed(snapshot.disk.total, snapshot.disk.available))}%` : "—"}
              percent={snapshot.disk ? percentUsed(snapshot.disk.total, snapshot.disk.available) : undefined}
            />
            <Metric
              label={settings.hostUptime}
              value={formatDuration(snapshot.uptime)}
              detail={snapshot.source === "remote"
                ? settings.hostHermesDetail(
                    formatDuration(snapshot.kana.uptime),
                    formatBytes(snapshot.kana.rss),
                  )
                : settings.hostKanaDetail(
                    formatDuration(snapshot.kana.uptime),
                    formatBytes(snapshot.kana.rss),
                  )}
              error={error}
              errorLabel={settings.hostFailed}
            />
          </>
        ) : (
          <p
            className={`col-span-4 self-center truncate text-center text-[11px] font-bold ${
              error ? "text-danger" : "text-muted"
            }`}
          >
            {error ? settings.hostFailed : settings.hostLoading}
          </p>
        )}
      </div>

      <div
        ref={(node) => {
          if (node) tiles.current.set("time", node);
          else tiles.current.delete("time");
        }}
        data-widget-id="time"
        onPointerDown={(event) => startDrag("time", event)}
        onPointerMove={(event) => moveDrag("time", event)}
        onPointerUp={(event) => endDrag("time", event)}
        onPointerCancel={(event) => endDrag("time", event, true)}
        className={`kana-header-clock pointer-events-auto absolute left-0 top-0 flex h-full w-[180px] touch-none select-none items-stretch gap-3 rounded-[12px] bg-surface-strong px-3.5 py-2 outline outline-1 outline-offset-[-1px] ${
          drag?.id === "time"
            ? "z-10 cursor-grabbing outline-accent"
            : "cursor-grab outline-line"
        }`}
      >
        <TimeCell label={settings.hostLocalTime} time={localClock.time} zone={localClock.zone} />
        <span aria-hidden="true" className="w-0 shrink-0 border-l-2 border-dotted border-line-strong" />
        <TimeCell
          label={settings.hostServerTime}
          time={serverClock?.time ?? "—"}
          zone={serverClock?.zone ?? ""}
        />
      </div>

      <div
        ref={(node) => {
          if (node) tiles.current.set("date", node);
          else tiles.current.delete("date");
        }}
        data-widget-id="date"
        onPointerDown={(event) => startDrag("date", event)}
        onPointerMove={(event) => moveDrag("date", event)}
        onPointerUp={(event) => endDrag("date", event)}
        onPointerCancel={(event) => endDrag("date", event, true)}
        className={`kana-header-date pointer-events-auto absolute left-0 top-0 flex h-full w-[116px] touch-none select-none flex-col gap-1 rounded-[12px] bg-surface-strong px-3.5 py-2 outline outline-1 outline-offset-[-1px] ${
          drag?.id === "date"
            ? "z-10 cursor-grabbing outline-accent"
            : "cursor-grab outline-line"
        }`}
      >
        <span className="truncate text-[9px] font-extrabold leading-none text-muted">
          {settings.hostDate}
        </span>
        <span className="truncate text-[17px] font-extrabold leading-none text-ink tabular-nums">
          {localDay.dayMonth}
        </span>
        <span className="truncate text-[9px] font-bold leading-none text-faint">
          {localDay.detail}
        </span>
      </div>
    </div>
  );
}

function TimeCell({ label, time, zone }: { label: string; time: string; zone: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="truncate text-[9px] font-extrabold leading-none text-muted">{label}</span>
      <span className="truncate text-[17px] font-extrabold leading-none text-ink tabular-nums">
        {time}
      </span>
      <span className="truncate text-[9px] font-bold leading-none text-faint">
        {zone || "\u00a0"}
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  percent,
  detail,
  error = false,
  errorLabel,
}: {
  label: string;
  value: string;
  percent?: number;
  detail?: string;
  error?: boolean;
  errorLabel?: string;
}) {
  const filled = percent === undefined ? 0 : Math.round((percent / 100) * TICKS);

  return (
    <div className="flex min-w-0 flex-col gap-1 border-l-2 border-dotted border-line-strong pl-3 first:border-l-0 first:pl-0">
      <span className="flex min-w-0 items-center gap-1 text-[9px] font-extrabold leading-none text-muted">
        <span className="truncate">{label}</span>
        {error ? (
          <span role="img" aria-label={errorLabel} className="text-[9px] font-extrabold text-danger">
            !
          </span>
        ) : null}
      </span>
      <span className="truncate text-[17px] font-extrabold leading-none text-ink tabular-nums">
        {value}
      </span>
      {percent === undefined ? (
        detail ? (
          <span className="truncate text-[9px] font-bold leading-none text-faint">{detail}</span>
        ) : null
      ) : (
        <span aria-hidden="true" data-host-ticks="" className="flex h-2.5 items-end gap-[1px]">
          {Array.from({ length: TICKS }, (_, index) => (
            <span
              key={index}
              className={`h-full min-w-[1px] flex-1 rounded-[2px] transition-colors duration-500 ${
                index < filled ? "bg-accent" : "bg-line"
              }`}
            />
          ))}
        </span>
      )}
    </div>
  );
}
