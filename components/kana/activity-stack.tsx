"use client";

import type { ActivityItem } from "@/lib/state/use-kana-controller";

type ActivityStackProps = {
  activities: ActivityItem[];
};

const STATE_BORDER: Record<ActivityItem["state"], string> = {
  running: "border-accent/50 bg-accent/10",
  complete: "border-line-strong",
  attention: "border-danger/40 bg-danger/10",
};

const STATE_DOT: Record<ActivityItem["state"], string> = {
  running: "bg-accent animate-kana-pulse",
  complete: "bg-muted",
  attention: "bg-danger animate-kana-pulse",
};

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

/**
 * Thin activity stack rendered inside the shared overlay column above the
 * Kana dialogue box — max 3 visible, newest last (FILO). Items inherit the
 * column's centering; each gets up to 4 seconds before leaving the stack,
 * "running" items linger longer.
 */
export function ActivityStack({ activities }: ActivityStackProps) {
  if (!activities?.length) return null;

  const visible = activities.slice(-3);

  return (
    <div className="flex max-w-full flex-col items-center gap-0.5" aria-label="Recent Hermes activity">
      {visible.map((activity) => (
        <div
          key={activity.id}
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] leading-none transition-colors ${STATE_BORDER[activity.state]}`}
        >
          <span className={`size-1.5 rounded-full ${STATE_DOT[activity.state]}`} />
          <span className="min-w-0 max-w-[120px] truncate font-semibold text-ink-dim">{activity.title}</span>
          {activity.detail ? (
            <span className="max-w-[80px] truncate text-faint">· {activity.detail}</span>
          ) : null}
          <span className="shrink-0 text-faint">{formatTime(activity.timestamp)}</span>
        </div>
      ))}
    </div>
  );
}
