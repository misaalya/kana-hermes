import { memo, useId, useState } from "react";
import type { ActivityItem } from "@/lib/agent/types";
import { toolVariant } from "@/lib/agent/tool-presets";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

type ActivityStackProps = {
  activities: ActivityItem[];
  locale: UiLocale;
  /** The running turn's block: open until its reply lands, unless closed. */
  live?: boolean;
};

function formatDuration(durationMs?: number): string | null {
  if (!durationMs) return null;
  return durationMs < 1_000
    ? `${durationMs}ms`
    : `${(durationMs / 1_000).toFixed(1)}s`;
}

const ActivityRow = memo(function ActivityRow({
  activity,
  locale,
}: {
  activity: ActivityItem;
  locale: UiLocale;
}) {
  const copy = getCopy(locale);
  const variant = toolVariant(activity.tool ?? "", activity.kind, locale);
  const running = activity.state === "running";
  const duration = formatDuration(activity.durationMs);

  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-2 text-[11px]"
      aria-label={`${activity.title} ${activity.state}`}
    >
      <div className="min-w-0">
        <p className="leading-relaxed text-ink-dim">
          {running ? variant.runningLabel : variant.label}
          {activity.tool ? (
            <span className="ml-1 font-semibold text-accent-strong">{activity.tool}</span>
          ) : null}
        </p>
        {activity.detail ? (
          <p className="truncate text-[10.5px] leading-relaxed text-faint">
            {activity.detail}
          </p>
        ) : null}
      </div>
      <span className="pt-0.5 text-[9px] tabular-nums text-faint">
        {running ? copy.activity.working : duration ?? copy.activity.done}
      </span>
    </div>
  );
});

/**
 * One turn's Hermes activity. A running turn's block starts open and stays
 * open, even between tools, until the reader closes it; the feed remounts it
 * under a new key when the reply lands, so every finished turn is collapsed.
 */
export function ActivityStack({ activities, locale, live = false }: ActivityStackProps) {
  const [open, setOpen] = useState(live);
  const bodyId = useId();
  if (!activities?.length) return null;
  const copy = getCopy(locale);
  const ordered = [...activities].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <section
      className="kana-activity group w-full px-4"
      role="group"
      aria-label={copy.activity.title}
      data-expanded={open}
    >
      <button
        type="button"
        className="kana-focus flex min-h-12 w-full items-center gap-2 text-left text-[11px] font-extrabold"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="kana-activity-title min-w-0 truncate text-ink-dim">
          {copy.activity.title}
        </span>
        <span className="shrink-0 text-[10px] font-semibold text-faint">
          {copy.activity.steps(activities.length)}
        </span>
      </button>
      <div id={bodyId} className="kana-activity-reveal" data-open={open}>
        <div className="min-h-0 overflow-hidden">
          <div className="divide-y divide-line/70 border-t border-line/70 pb-1">
            {ordered.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} locale={locale} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
