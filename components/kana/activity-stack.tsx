import { memo } from "react";
import type { ActivityItem } from "@/lib/state/use-kana-controller";
import { toolVariant } from "@/lib/agent/tool-presets";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

type ActivityStackProps = {
  activities: ActivityItem[];
  locale: UiLocale;
};

function formatDuration(durationMs?: number): string | null {
  if (!durationMs) return null;
  return durationMs < 1_000
    ? `${durationMs}ms`
    : `${(durationMs / 1_000).toFixed(1)}s`;
}

export const ActivityRow = memo(function ActivityRow({
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
      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 py-1.5 text-[11px]"
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
          <p className="truncate leading-relaxed text-faint">{activity.detail}</p>
        ) : null}
      </div>
      <span className="pt-0.5 text-[9px] tabular-nums text-faint">
        {running ? copy.activity.working : duration ?? copy.activity.done}
      </span>
    </div>
  );
});

export function ActivityStack({ activities, locale }: ActivityStackProps) {
  if (!activities?.length) return null;
  const ordered = [...activities].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <details
      className="group w-full border border-line bg-surface-strong px-3 py-2"
      open={activities.some((activity) => activity.state === "running")}
    >
      <summary className="kana-focus flex cursor-pointer list-none items-center justify-between gap-3 text-[10px] font-bold text-muted [&::-webkit-details-marker]:hidden">
        <span>{getCopy(locale).activity.title}</span>
        <span className="font-medium text-faint">{getCopy(locale).activity.steps(activities.length)}</span>
      </summary>
      <div className="mt-2 border-t border-line pt-1">
        {ordered.map((activity) => (
          <ActivityRow key={activity.id} activity={activity} locale={locale} />
        ))}
      </div>
    </details>
  );
}
