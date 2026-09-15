import { createStore, type StoreApi } from "zustand/vanilla";
import type { ActivityItem } from "@/lib/agent/types";
import type { ServerActivityTurn } from "@/lib/conversation/live-feed-timeline";

export type { ServerActivityTurn };

/** Live activity rows kept on screen; older rows are still in the turn log. */
export const LIVE_ACTIVITY_LIMIT = 40;

export type ActivityState = {
  /** Newest first, for the running turn. */
  activities: ActivityItem[];
  /**
   * Every activity of the current turn in arrival order. It is copied onto the
   * assistant message when the reply lands so tool history survives a refresh.
   */
  turnLog: ActivityItem[];
  /** Stored turns for the open Hermes session (SQLite, shared across browsers). */
  serverActivityTurns: ServerActivityTurn[];
  /** The Hermes session whose stored turns may still be applied. */
  sessionKey: string | null;
  add(activity: ActivityItem): void;
  finish(finished: Pick<ActivityItem, "id" | "tool" | "kind" | "durationMs"> & { title: string }): void;
  startTurn(): void;
  reset(): void;
};

export type ActivityStore = StoreApi<ActivityState>;

export function createActivityStore(): ActivityStore {
  return createStore<ActivityState>()((set) => ({
    activities: [],
    turnLog: [],
    serverActivityTurns: [],
    sessionKey: null,
    add(activity) {
      set((state) => {
        const logIndex = state.turnLog.findIndex((item) => item.id === activity.id);
        const turnLog =
          logIndex === -1
            ? [...state.turnLog, activity]
            : state.turnLog.map((item, index) => (index === logIndex ? activity : item));
        const existing = state.activities.find((item) => item.id === activity.id);
        let activities: ActivityItem[];
        if (!existing) {
          activities = [activity, ...state.activities].slice(0, LIVE_ACTIVITY_LIMIT);
        } else if (existing.state === "complete" && activity.state === "running") {
          // A late start event never reopens a finished tool.
          activities = state.activities;
        } else {
          activities = state.activities.map((item) => (item.id === activity.id ? activity : item));
        }
        return { turnLog, activities };
      });
    },
    finish({ id, tool, kind, title, durationMs }) {
      set((state) => {
        const complete = (activity: ActivityItem): ActivityItem =>
          activity.id === id ? { ...activity, state: "complete", title, durationMs } : activity;
        // The turn log only completes rows it already has; it is what lands on
        // the assistant message, so it must carry final states.
        const turnLog = state.turnLog.map(complete);
        const activities = state.activities.some((activity) => activity.id === id)
          ? state.activities.map(complete)
          : [
              { id, tool, kind, title, state: "complete" as const, timestamp: Date.now(), durationMs },
              ...state.activities,
            ].slice(0, LIVE_ACTIVITY_LIMIT);
        return { turnLog, activities };
      });
    },
    startTurn() {
      set({ turnLog: [], activities: [] });
    },
    reset() {
      set({ sessionKey: null, turnLog: [], activities: [], serverActivityTurns: [] });
    },
  }));
}
