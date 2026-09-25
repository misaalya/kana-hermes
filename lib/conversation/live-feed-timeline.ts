import type { ActivityItem } from "@/lib/agent/types";
import type { KanaMessage } from "@/lib/conversation/types";

export type ServerActivityTurn = {
  turnAnchorMs: number;
  turnIndex: number | null;
  activities: ActivityItem[];
};

export type LiveFeedEntry =
  | { kind: "message"; at: number; message: KanaMessage }
  | {
      kind: "activity";
      at: number;
      /** Stable per block. The live block gets a new key once its reply lands. */
      key: string;
      /** The running turn's tools, not yet closed by a reply. */
      live: boolean;
      activities: ActivityItem[];
    };

export function buildLiveFeedTimeline(
  messages: KanaMessage[],
  liveActivities: ActivityItem[],
  serverActivityTurns: ServerActivityTurn[],
): LiveFeedEntry[] {
  const timeline: LiveFeedEntry[] = messages.map((message) => ({
    kind: "message",
    at: message.timestamp,
    message,
  }));
  const assistants = messages.filter((message) => message.role === "assistant");
  const embeddedActivityIds = new Set<string>();

  assistants.forEach((message) => {
    if (!message.activities?.length) return;
    message.activities.forEach((activity) => embeddedActivityIds.add(activity.id));
    timeline.push({
      kind: "activity",
      at: message.timestamp - 0.5,
      key: `turn-${message.id}`,
      live: false,
      activities: message.activities,
    });
  });

  for (const turn of serverActivityTurns) {
    if (!turn.activities.length) continue;
    const assistant = assistants[turn.turnIndex ?? -1];
    // The locally committed assistant message already owns this exact turn.
    // Server activity is the cross-browser/history fallback, not a duplicate.
    if (assistant?.activities?.length) continue;
    timeline.push({
      kind: "activity",
      at: assistant ? assistant.timestamp - 0.5 : turn.turnAnchorMs,
      key: `stored-${turn.turnIndex ?? turn.turnAnchorMs}`,
      live: false,
      activities: turn.activities,
    });
  }

  const uncommittedActivities = liveActivities.filter(
    (activity) => !embeddedActivityIds.has(activity.id),
  );
  if (uncommittedActivities.length) {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    const first = uncommittedActivities.reduce((earliest, activity) =>
      activity.timestamp < earliest.timestamp ? activity : earliest,
    );
    timeline.push({
      kind: "activity",
      at: (lastUser?.timestamp ?? Date.now()) + 0.5,
      key: `live-${first.id}`,
      live: true,
      activities: uncommittedActivities,
    });
  }

  return timeline.sort((left, right) => left.at - right.at);
}
