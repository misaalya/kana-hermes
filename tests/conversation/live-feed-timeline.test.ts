import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLiveFeedTimeline } from "@/lib/conversation/live-feed-timeline";
import type { ActivityItem } from "@/lib/agent/types";
import type { KanaMessage } from "@/lib/conversation/types";

const activity: ActivityItem = {
  id: "tool-1",
  kind: "tool",
  tool: "terminal",
  title: "Read files",
  state: "complete",
  timestamp: 120,
};

describe("live feed activity anchoring", () => {
  it("keeps a completed turn's activity before its assistant when a new user message arrives", () => {
    const messages: KanaMessage[] = [
      { id: "user-1", role: "user", text: "Find env files", timestamp: 100 },
      {
        id: "assistant-1",
        role: "assistant",
        subtitle: { text: "Found them", language: "en" },
        timestamp: 200,
        activities: [activity],
      },
      { id: "user-2", role: "user", text: "Open one", timestamp: 300 },
    ];

    const timeline = buildLiveFeedTimeline(messages, [activity], []);
    assert.deepEqual(
      timeline.map((entry) =>
        entry.kind === "message" ? entry.message.id : `activity:${entry.activities[0]?.id}`,
      ),
      ["user-1", "activity:tool-1", "assistant-1", "user-2"],
    );
  });

  it("uses server activity only when the local assistant has no embedded turn log", () => {
    const messages: KanaMessage[] = [
      { id: "user-1", role: "user", text: "Find env files", timestamp: 100 },
      {
        id: "assistant-1",
        role: "assistant",
        subtitle: { text: "Found them", language: "en" },
        timestamp: 200,
      },
    ];
    const timeline = buildLiveFeedTimeline(messages, [], [
      { turnAnchorMs: 150, turnIndex: 0, activities: [activity] },
    ]);
    assert.deepEqual(timeline.map((entry) => entry.kind), ["message", "activity", "message"]);
  });
});
