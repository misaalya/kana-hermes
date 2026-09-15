import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AttachmentUploadError } from "@/lib/agent/attachments";
import { readActiveConversationPointer } from "@/lib/conversation/active-conversation";
import { getCopy } from "@/lib/ui/copy";
import { createHarness, envelope, MemoryStorage, tick } from "./workspace-harness";

const copy = (harness: ReturnType<typeof createHarness>) => getCopy(harness.preferences.current().uiLocale).status;

describe("HermesSessionManager", () => {
  it("reconstructs a new browser with an editable conversation and a pointer", () => {
    const harness = createHarness();
    harness.conversations.initialize();
    const pointer = readActiveConversationPointer(harness.storage);
    assert.equal(pointer?.conversationId, harness.active().id);
    assert.equal(pointer?.persistentSessionId, undefined);
  });

  it("subscribes once and links the opened session without making it resumable", async () => {
    const harness = createHarness();
    harness.conversations.initialize();
    await harness.sessions.ensure(harness.active());
    await harness.sessions.ensure(harness.active());
    assert.equal(harness.agent.listenerCount, 1);
    assert.equal(harness.agent.opened.length, 1, "an open session is not reopened");
    assert.equal(harness.active().agent?.durable, false);
    assert.equal(readActiveConversationPointer(harness.storage)?.persistentSessionId, undefined);
  });

  it("keeps the session link when the first message is a command", async () => {
    for (const commandResult of [
      { type: "output" as const, output: "ok" },
      { type: "prefill" as const, message: "draft", notice: "Draft ready" },
      { type: "submitted" as const, notice: "Submitted" },
    ]) {
      const harness = createHarness({ setupAgent: (agent) => (agent.commandResult = commandResult) });
      harness.conversations.initialize();
      await harness.send("/status");
      assert.equal(harness.active().agent?.persistentSessionId, "hermes-session-1", commandResult.type);
      assert.equal(harness.active().messages.at(-1)?.role, "system", commandResult.type);
    }
  });

  it("restores a linked conversation from the session.resume transcript", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "kana.active-conversation.v1",
      JSON.stringify({ version: 1, conversationId: "c1", title: "Kept", createdAt: 1, persistentSessionId: "durable-1" }),
    );
    const harness = createHarness({ storage });
    harness.conversations.initialize();
    await harness.sessions.ensure(harness.active());
    assert.equal(harness.agent.opened[0].persistentSessionId, "durable-1");
    harness.agent.emit({
      type: "history.restored",
      sessionId: "runtime-1",
      persistentSessionId: "durable-1",
      messages: [
        { role: "user", text: "hi" },
        { role: "tool", name: "terminal", context: "ls" },
        { role: "assistant", text: JSON.stringify(envelope("Hello")) },
      ],
    });
    await tick();
    assert.deepEqual(harness.active().messages.map((message) => message.role), ["user", "assistant"]);
    const put = harness.fetchCalls.find((call) => call.init?.method === "PUT");
    assert.equal(JSON.parse(String(put?.init?.body)).turnIndex, 0);
  });

  it("ignores a restored transcript for another session", async () => {
    const harness = createHarness();
    harness.conversations.initialize();
    await harness.sessions.ensure(harness.active());
    harness.agent.emit({
      type: "history.restored",
      sessionId: "runtime-x",
      persistentSessionId: "someone-else",
      messages: [{ role: "user", text: "not mine" }],
    });
    await tick();
    assert.equal(harness.active().messages.length, 0);
  });

  it("shows a reply immediately with voice off and drops an adjacent duplicate", async () => {
    const harness = createHarness();
    harness.conversations.initialize();
    await harness.send("Halo");
    const reply = { type: "assistant.message" as const, response: envelope("Hello"), rawResponse: "" };
    harness.agent.emit({ type: "agent.started" });
    harness.agent.emit({ type: "tool.started", id: "t1", tool: "terminal", kind: "command" });
    harness.agent.emit({ type: "tool.finished", id: "t1", tool: "terminal", kind: "command", summary: "listed" });
    harness.agent.emit(reply);
    harness.agent.emit(reply);
    harness.agent.emit({ type: "agent.finished" });
    const messages = harness.active().messages;
    assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
    assert.equal(messages[1].activities?.[0].state, "complete");
    assert.equal(harness.active().agent?.durable, true, "a completed reply means Hermes stored the session");
    assert.equal(harness.stores.agentSession.getState().busy, false);
  });

  it("holds a spoken reply until audio starts and keeps the voice status after the turn ends", async () => {
    const harness = createHarness({ preferences: { voiceEnabled: true } });
    harness.conversations.initialize();
    await harness.send("Halo");
    harness.agent.emit({ type: "assistant.message", response: envelope("Hello"), rawResponse: "" });
    harness.agent.emit({ type: "agent.finished" });
    await tick();
    assert.equal(harness.active().messages.length, 1, "hidden while synthesizing");
    assert.equal(harness.voiceProvider.spoken.length, 1);
    assert.equal(harness.status(), copy(harness).preparingVoice);
    harness.voiceProvider.spoken[0].onAudioStart?.();
    assert.equal(harness.active().messages.length, 2, "revealed when audio starts");
    harness.voiceProvider.finish();
    await tick();
    await tick();
    assert.equal(harness.status(), copy(harness).ready);
  });

  it("reveals a held reply when the connection drops", async () => {
    const harness = createHarness({ preferences: { voiceEnabled: true } });
    harness.conversations.initialize();
    await harness.send("Halo");
    harness.agent.emit({ type: "assistant.message", response: envelope("Hello"), rawResponse: "" });
    await tick();
    harness.agent.emit({ type: "connection.changed", state: "reconnecting", retryAttempt: 1 });
    assert.equal(harness.active().messages.length, 2);
    assert.equal(harness.stores.errors.getState().metrics.reconnectCount, 1);
    assert.equal(harness.sessions.tracking.openedId, null);
  });

  it("unlinks a never-stored session quietly when Hermes lost it", async () => {
    const harness = createHarness();
    harness.conversations.initialize();
    await harness.sessions.ensure(harness.active());
    harness.agent.emit({ type: "agent.error", message: "session not found" });
    assert.equal(harness.active().agent, undefined);
    assert.equal(harness.stores.errors.getState().error, null);
    assert.equal(harness.status(), getCopy(harness.preferences.current().uiLocale).status.newReady);
  });

  it("marks a stored session missing and reports it", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "kana.active-conversation.v1",
      JSON.stringify({ version: 1, conversationId: "c1", title: "Kept", createdAt: 1, persistentSessionId: "durable-1" }),
    );
    const harness = createHarness({ storage });
    harness.conversations.initialize();
    await harness.sessions.ensure(harness.active());
    harness.agent.emit({ type: "agent.error", message: "session no longer exists" });
    assert.equal(harness.active().agent?.status, "missing");
    assert.match(harness.stores.errors.getState().error ?? "", /no longer exists/);
    assert.equal(harness.emotions.at(-1), "confused");
  });

  it("queues a plain message typed during a turn", async () => {
    const harness = createHarness();
    harness.conversations.initialize();
    await harness.send("first");
    harness.agent.emit({ type: "agent.started" });
    await harness.send("second");
    assert.deepEqual(harness.agent.queued, ["second"]);
    assert.deepEqual(harness.agent.sent, ["first"]);
    assert.equal(harness.active().messages.at(-1)?.text, "second");
  });

  it("reuses a blank conversation for /new", async () => {
    const harness = createHarness();
    harness.conversations.initialize();
    const blank = harness.active().id;
    await harness.send("/new Plans");
    assert.equal(harness.active().id, blank);
    assert.equal(harness.active().title, "Plans");
    assert.equal(harness.conversations.all().length, 1);
  });

  it("returns a prefilled draft and releases the turn", async () => {
    const harness = createHarness();
    harness.conversations.initialize();
    await harness.sessions.ensure(harness.active());
    harness.agent.commandResult = { type: "prefill", message: "draft text", notice: "Edit before sending" };
    const prefill = await harness.send("/retry");
    assert.equal(prefill, "draft text");
    assert.equal(harness.stores.agentSession.getState().busy, false);
    assert.equal(harness.sessions.tracking.turnId, null);
    assert.equal(harness.active().messages.at(-1)?.role, "system");
  });

  it("removes the pending message when an attachment upload fails", async () => {
    const harness = createHarness();
    harness.conversations.initialize();
    await harness.sessions.ensure(harness.active());
    harness.agent.sendError = new AttachmentUploadError(new Error("too large"));
    await assert.rejects(harness.send("with file"), AttachmentUploadError);
    assert.equal(harness.active().messages.length, 0);
    assert.equal(harness.stores.agentSession.getState().busy, false);
  });

  it("closes an input request even when the response cannot be delivered", async () => {
    const harness = createHarness();
    harness.conversations.initialize();
    await harness.sessions.ensure(harness.active());
    harness.agent.emit({ type: "input.requested", request: { kind: "sudo", requestId: "r1" } });
    harness.agent.emit({ type: "input.expired", kind: "sudo", requestId: "other" });
    assert.equal(harness.stores.agentSession.getState().pendingInput?.kind, "sudo", "another request id does not close it");
    harness.agent.respondError = new Error("gateway closed");
    await harness.sessions.respondToInput({ kind: "sudo", requestId: "r1", password: "x" } as never);
    assert.equal(harness.stores.agentSession.getState().pendingInput, null);
    assert.equal(harness.stores.activity.getState().activities[0].title, "Hermes input could not be delivered");
  });

  it("lands on the most recent non-empty Hermes session when nothing is selected", async () => {
    const harness = createHarness();
    harness.fetchResponses.set("/api/kana/sessions", {
      sessions: [
        { hermesSessionKey: "empty", title: "Empty", messageCount: 0, startedAt: 1, lastActive: 9 },
        { hermesSessionKey: "busy", title: "Busy", messageCount: 4, startedAt: 1, lastActive: 5 },
      ],
    });
    await harness.sessions.connect();
    assert.equal(harness.active().agent?.persistentSessionId, "busy");
    assert.equal(harness.conversations.all().length, 2, "the other Hermes session joins the list");
    assert.equal(harness.status(), copy(harness).connected);
  });

  it("switches conversations and reopens the linked session", async () => {
    const harness = createHarness();
    harness.conversations.initialize();
    const linked = harness.conversations.persist(
      { id: "linked", title: "Linked", messages: [], createdAt: 1, updatedAt: 1, agent: { provider: "hermes", persistentSessionId: "durable-9" } },
      false,
    );
    harness.stores.activity.getState().add({ id: "a", kind: "tool", title: "old", state: "running", timestamp: 1 });
    harness.sessions.selectConversation(linked.id);
    await tick();
    assert.equal(harness.active().id, "linked");
    assert.deepEqual(harness.stores.activity.getState().activities, []);
    assert.equal(harness.agent.opened.at(-1)?.persistentSessionId, "durable-9");
  });

  it("deletes the active conversation and selects the next one", () => {
    const harness = createHarness();
    harness.conversations.initialize();
    const only = harness.active().id;
    harness.sessions.deleteConversation(only);
    assert.equal(harness.conversations.all().length, 1);
    assert.notEqual(harness.active().id, only);
  });
});

describe("CommandService", () => {
  it("lists Kana commands first and ignores an older completion", async () => {
    const harness = createHarness();
    harness.conversations.initialize();
    await harness.sessions.ensure(harness.active());
    harness.agent.completions = [{ text: "/new", display: "/new", kind: "command" }, { text: "/model", display: "/model", kind: "command" }];
    await harness.commands.complete("/");
    const texts = harness.stores.commands.getState().suggestions.map((item) => item.text);
    assert.equal(texts[0], "/new");
    assert.equal(texts.filter((text) => text === "/new").length, 1);
    assert.ok(texts.includes("/model"));

    const slow = harness.commands.complete("/mo");
    harness.commands.clear();
    await slow;
    assert.deepEqual(harness.stores.commands.getState().suggestions, []);
    assert.equal(harness.stores.commands.getState().loading, false);
  });

  it("marks the session missing instead of retrying completions", async () => {
    const harness = createHarness();
    harness.conversations.initialize();
    harness.conversations.persist({ ...harness.active(), agent: { provider: "hermes", persistentSessionId: "gone" } }, false);
    await harness.sessions.ensure(harness.active());
    harness.agent.completionError = new Error("session no longer exists");
    await harness.commands.complete("/st");
    assert.equal(harness.active().agent?.status, "missing");
    const opened = harness.agent.opened.length;
    await harness.commands.complete("/sta");
    assert.equal(harness.agent.opened.length, opened);
  });
});

describe("ConversationService", () => {
  it("applies stored activity only for the session still open", async () => {
    const harness = createHarness();
    harness.fetchResponses.set("/api/kana/activities?session=first", {
      turns: [
        { turnAnchorMs: 1, turnIndex: 0, activities: [] },
        { turnAnchorMs: 2, turnIndex: 0, activities: [] },
      ],
    });
    const first = harness.conversations.loadServerActivities("first");
    harness.stores.activity.setState({ sessionKey: "second" });
    await first;
    assert.deepEqual(harness.stores.activity.getState().serverActivityTurns, []);
    await harness.conversations.loadServerActivities("first");
    assert.equal(harness.stores.activity.getState().serverActivityTurns.length, 1, "one row per turn index");
  });
});
