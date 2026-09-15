import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createActivityStore, LIVE_ACTIVITY_LIMIT } from "@/lib/store/activity-store";
import { createAvatarStore, EMPTY_AVATAR } from "@/lib/store/avatar-store";
import { createConversationStore, selectActiveConversation } from "@/lib/store/conversation-store";
import { createErrorStore } from "@/lib/store/error-store";
import { createKanaStores } from "@/lib/store/kana-stores";
import { createThemeStore, THEME_STORAGE_KEY } from "@/lib/store/theme-store";
import { createWorkspaceStore } from "@/lib/store/workspace-store";

const activity = (id: string, state: "running" | "complete" = "running") => ({
  id,
  kind: "tool" as const,
  tool: "terminal",
  title: id,
  state,
  timestamp: 1,
});

describe("Kana stores", () => {
  it("never share state between two workspaces", () => {
    const first = createKanaStores();
    const second = createKanaStores();
    first.conversations.getState().commit([{ id: "a", title: "A", messages: [], createdAt: 1, updatedAt: 1 }]);
    first.workspace.getState().setDraft("a", "hello");
    assert.equal(second.conversations.getState().conversations.length, 0);
    assert.deepEqual(second.workspace.getState().drafts, {});
  });

  it("keeps conversations most recently updated first", () => {
    const store = createConversationStore();
    store.getState().commit([
      { id: "old", title: "Old", messages: [], createdAt: 1, updatedAt: 1 },
      { id: "new", title: "New", messages: [], createdAt: 2, updatedAt: 5 },
    ]);
    store.getState().upsert({ id: "old", title: "Old", messages: [], createdAt: 1, updatedAt: 9 });
    assert.deepEqual(store.getState().conversations.map((item) => item.id), ["old", "new"]);
    store.setState({ activeConversationId: "new" });
    assert.equal(selectActiveConversation(store.getState())?.title, "New");
  });

  it("does not report the same error twice until it is cleared", () => {
    const store = createErrorStore();
    assert.ok(store.getState().report("agent", "Hermes is gone"));
    store.getState().dismiss();
    assert.equal(store.getState().report("agent", new Error("Hermes is gone")), null);
    assert.equal(store.getState().error, null);
    store.getState().clear();
    assert.ok(store.getState().report("agent", "Hermes is gone"));
    assert.equal(store.getState().error, store.getState().lastError?.message);
  });

  it("never reopens a finished tool and caps live activity", () => {
    const store = createActivityStore();
    store.getState().add(activity("tool-1"));
    store.getState().finish({ id: "tool-1", tool: "terminal", kind: "tool", title: "done", durationMs: 4 });
    store.getState().add(activity("tool-1"));
    assert.equal(store.getState().activities[0].state, "complete");
    assert.equal(store.getState().turnLog[0].state, "running", "the turn log takes the latest event as-is");
    for (let index = 0; index < LIVE_ACTIVITY_LIMIT + 5; index += 1) store.getState().add(activity(`extra-${index}`));
    assert.equal(store.getState().activities.length, LIVE_ACTIVITY_LIMIT);
    assert.equal(store.getState().turnLog.length, LIVE_ACTIVITY_LIMIT + 6);
  });

  it("completes a tool whose start event was never seen", () => {
    const store = createActivityStore();
    store.getState().finish({ id: "late", tool: "read", kind: "file", title: "read finished" });
    assert.equal(store.getState().activities[0].state, "complete");
    assert.deepEqual(store.getState().turnLog, []);
  });

  it("ignores avatar snapshots that only move the mouth", () => {
    const store = createAvatarStore();
    const before = store.getState().snapshot;
    store.getState().apply({ ...EMPTY_AVATAR, mouthOpen: 0.7 });
    assert.equal(store.getState().snapshot, before);
    store.getState().apply({ ...EMPTY_AVATAR, talking: true });
    assert.equal(store.getState().snapshot.talking, true);
  });

  it("appends dictation to the draft of one conversation", () => {
    const store = createWorkspaceStore();
    store.getState().setDraft("a", "Halo  ");
    store.getState().appendDraft("a", "Kana");
    store.getState().appendDraft("b", "only");
    assert.deepEqual(store.getState().drafts, { a: "Halo Kana", b: "only" });
  });

  it("starts dark, adopts the stored theme, and persists a toggle", () => {
    const values = new Map([[THEME_STORAGE_KEY, "light"]]);
    const root = { dataset: {} as DOMStringMap };
    const store = createThemeStore({
      root,
      storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    });
    assert.equal(store.getState().theme, "dark");
    store.getState().hydrate();
    assert.equal(store.getState().theme, "light");
    assert.equal(root.dataset.theme, "light");
    store.getState().toggle();
    assert.equal(values.get(THEME_STORAGE_KEY), "dark");
    assert.equal(root.dataset.theme, "dark");
  });
});
