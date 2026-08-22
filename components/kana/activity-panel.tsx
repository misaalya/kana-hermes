import type { ActivityItem } from "@/lib/state/use-kana-controller";

type ActivityPanelProps = {
  activities: ActivityItem[];
  onClose(): void;
};

function activityIcon(activity: ActivityItem): string {
  if (activity.state === "attention") return "!";
  if (activity.state === "complete") return "✓";
  if (activity.kind === "command") return ">_";
  if (activity.kind === "file") return "±";
  return "·";
}

export function ActivityPanel({ activities, onClose }: ActivityPanelProps) {
  return (
    <aside className="activity-panel" aria-label="Hermes activity">
      <div className="panel-heading">
        <div>
          <h2>Activity</h2>
          <p>Live events from Hermes</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close activity panel">
          ×
        </button>
      </div>

      <div className="activity-list">
        {!activities.length ? (
          <div className="empty-activity">
            <span>◇</span>
            <p>Tool and command activity will appear here.</p>
          </div>
        ) : null}
        {activities.map((activity) => (
          <article className={`activity-item ${activity.state}`} key={activity.id}>
            <span className="activity-icon">{activityIcon(activity)}</span>
            <div>
              <strong>{activity.title}</strong>
              {activity.detail ? <p>{activity.detail}</p> : null}
              {activity.durationMs ? (
                <small>{(activity.durationMs / 1000).toFixed(1)}s</small>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}
