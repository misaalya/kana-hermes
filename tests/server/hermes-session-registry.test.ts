import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  __bumpHermesGatewayEpochForTests,
  __setHermesGatewayConnectedForTests,
} from "@/lib/server/hermes-bridge";
import {
  __applyHermesEventForTests,
  __resetHermesSessionRegistryForTests,
  attachCachedHermesSession,
  noteHermesRpcResult,
} from "@/lib/server/hermes-session-registry";

const KEY = "20260824_052417_fe475b";
const OTHER_KEY = "20260824_052417_aaaaaa";
const RUNTIME = "runtime-1";

function open(messages: Array<Record<string, unknown>> = [], running = false): void {
  noteHermesRpcResult(
    "session.resume",
    { persistentSessionId: KEY },
    {
      session_id: RUNTIME,
      stored_session_id: KEY,
      messages,
      running,
    },
  );
}

beforeEach(() => {
  __resetHermesSessionRegistryForTests();
  __setHermesGatewayConnectedForTests(true);
});

afterEach(() => {
  __resetHermesSessionRegistryForTests();
  __setHermesGatewayConnectedForTests(null);
});

describe("Hermes session registry", () => {
  it("serves the mirrored transcript without another Hermes call", () => {
    open([
      { role: "user", text: "Hello" },
      { role: "assistant", text: "Hi." },
    ]);
    const snapshot = attachCachedHermesSession(KEY);
    assert.ok(snapshot);
    assert.equal(snapshot.session_id, RUNTIME);
    assert.equal(snapshot.stored_session_id, KEY);
    assert.equal(snapshot.running, false);
    assert.deepEqual(snapshot.messages, [
      { role: "user", text: "Hello" },
      { role: "assistant", text: "Hi." },
    ]);
  });

  it("never serves a durable session the server never opened", () => {
    open();
    assert.equal(attachCachedHermesSession(OTHER_KEY), null);
  });

  it("keeps a running turn and its prompt current", () => {
    open();
    noteHermesRpcResult(
      "prompt.submit",
      { session_id: RUNTIME, text: "Next" },
      { accepted: true },
    );
    let snapshot = attachCachedHermesSession(KEY);
    assert.equal(snapshot?.running, true);
    assert.deepEqual(snapshot?.messages, [{ role: "user", text: "Next" }]);

    __applyHermesEventForTests({
      type: "message.complete",
      session_id: RUNTIME,
      payload: { status: "complete", text: "Answer" },
    });
    snapshot = attachCachedHermesSession(KEY);
    assert.equal(snapshot?.running, false);
    assert.deepEqual(snapshot?.messages, [
      { role: "user", text: "Next" },
      { role: "assistant", text: "Answer" },
    ]);
  });

  it("resumes after compression rewrites the stored transcript", () => {
    open();
    noteHermesRpcResult("session.compress", { session_id: RUNTIME }, {});
    assert.equal(attachCachedHermesSession(KEY), null);
  });

  it("resumes when the bounded mirror had to drop history", () => {
    open(
      Array.from({ length: 501 }, (_, index) => ({
        role: "user",
        text: `message-${index}`,
      })),
    );
    assert.equal(attachCachedHermesSession(KEY), null);
  });

  it("never serves a session from an older gateway generation", () => {
    open();
    assert.ok(attachCachedHermesSession(KEY));
    __bumpHermesGatewayEpochForTests();
    assert.equal(attachCachedHermesSession(KEY), null);
  });

  it("ignores events for a runtime session it does not mirror", () => {
    open();
    __applyHermesEventForTests({
      type: "message.complete",
      session_id: "runtime-other",
      payload: { status: "complete", text: "Nope" },
    });
    assert.deepEqual(attachCachedHermesSession(KEY)?.messages, []);
  });
});
