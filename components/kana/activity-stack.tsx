"use client";

import { memo } from "react";
import type { ActivityItem } from "@/lib/state/use-kana-controller";
import { toolVariant } from "@/lib/agent/tool-presets";

type ActivityStackProps = {
  activities: ActivityItem[];
};

const STATE_DOT: Record<ActivityItem["state"], string> = {
  running: "bg-accent-strong animate-kana-pulse",
  complete: "bg-muted/60",
  attention: "bg-danger animate-kana-pulse",
};

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

/**
 * One chronological row in the live-chat feed for a Hermes tool activity.
 * Left-aligned vtuber-chat style: family glyph + pastel chip with a specific
 * verb per tool family, status dot, and completion duration.
 */
export const ActivityRow = memo(function ActivityRow({ activity }: { activity: ActivityItem }) {
  const variant = toolVariant(activity.tool ?? "", activity.kind);
  const running = activity.state === "running";
  const label = running ? variant.runningLabel : variant.label;

  return (
    <div className="flex max-w-full items-center gap-1.5 text-[11px] leading-snug" aria-label={`${activity.title} ${activity.state}`}>
      <span aria-hidden="true" className="shrink-0 text-[12px]">{variant.glyph}</span>
      <p className="min-w-0 flex-1 text-ink-dim">
        <span>{running ? label : `${label} `}</span>
        {activity.tool ? (
          <span className={`inline-flex items-center rounded-md border px-1.5 py-px font-mono text-[10px] font-semibold ${variant.chipClass}`}>
            {activity.tool}
          </span>
        ) : null}
        {activity.detail ? (
          <span className="ml-1 text-faint">— {activity.detail}</span>
        ) : null}
        {activity.state === "complete" && activity.durationMs ? (
          <span className="ml-1 text-faint">({(activity.durationMs / 1000).toFixed(1)}s)</span>
        ) : null}
      </p>
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${STATE_DOT[activity.state]}`} />
      <span className="shrink-0 text-[9px] tabular-nums text-faint">{formatTime(activity.timestamp)}</span>
    </div>
  );
});

/**
 * Chronological list of tool activities for one turn, rendered inline in the
 * live-chat feed between the user's message and Kana's reply — like stream
 * chat events, not a capped stack. Order: oldest first (the order they ran).
 */
export function ActivityStack({ activities }: ActivityStackProps) {
  if (!activities?.length) return null;

  const ordered = [...activities].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div
      className="flex w-[min(100%,520px)] flex-col gap-1 rounded-xl border border-line bg-surface/70 px-3 py-2"
      aria-label="Hermes activity log"
    >
      {ordered.map((activity) => (
        <ActivityRow key={activity.id} activity={activity} />
      ))}
    </div>
  );
}
