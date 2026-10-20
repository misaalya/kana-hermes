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

  it("draws a message Hermes took into a running turn under that turn's user message", () => {
    const messages: KanaMessage[] = [
      { id: "user-1", role: "user", text: "Find env files", timestamp: 100 },
      { id: "correction-1", role: "user", text: "and the folders", correction: "redirected", timestamp: 150 },
      { id: "correction-2", role: "user", text: "also the hidden ones", correction: "steered", timestamp: 160 },
      { id: "assistant-1", role: "assistant", subtitle: { text: "Found them", language: "en" }, timestamp: 200 },
    ];

    const timeline = buildLiveFeedTimeline(messages, [], []);
    assert.deepEqual(
      timeline.map((entry) => (entry.kind === "message" ? entry.message.id : "activity")),
      ["user-1", "assistant-1"],
      "corrections never become bubbles of their own",
    );
    const turn = timeline[0];
    assert.ok(turn.kind === "message");
    assert.deepEqual(turn.corrections?.map((message) => message.id), ["correction-1", "correction-2"]);

    const orphan = buildLiveFeedTimeline(
      [{ id: "correction", role: "user", text: "alone", correction: "redirected", timestamp: 1 }],
      [],
      [],
    );
    assert.equal(orphan.length, 1, "a correction with no turn still reaches the reader");
  });

  it("marks the running turn's block live and gives it a new key once its reply lands", () => {
    const user: KanaMessage = { id: "user-1", role: "user", text: "Find env files", timestamp: 100 };
    const running = buildLiveFeedTimeline([user], [activity], []);
    const live = running.find((entry) => entry.kind === "activity");
    assert.ok(live && live.kind === "activity");
    assert.equal(live.live, true);
    assert.equal(live.key, "live-tool-1");

    const replied = buildLiveFeedTimeline(
      [user, { id: "assistant-1", role: "assistant", subtitle: { text: "Found", language: "en" }, timestamp: 200, activities: [activity] }],
      [activity],
      [],
    );
    const closed = replied.filter((entry) => entry.kind === "activity");
    assert.equal(closed.length, 1, "the live copy is not shown twice");
    assert.ok(closed[0].kind === "activity" && !closed[0].live && closed[0].key === "turn-assistant-1");
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
