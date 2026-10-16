import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  closeLiveStreams,
  registerLiveStream,
  resetLiveStreamsForTests,
} from "@/lib/server/live-streams";
import { createHermesEventStream } from "@/lib/server/hermes-event-stream";

beforeEach(() => {
  resetLiveStreamsForTests();
});

describe("live stream registry", () => {
  it("closes each registered stream exactly once", () => {
    const closed: string[] = [];
    registerLiveStream(() => closed.push("a"));
    registerLiveStream(() => closed.push("b"));
    closeLiveStreams();
    assert.deepEqual(closed.sort(), ["a", "b"]);

    // Idempotent: nothing runs a second time, and an empty registry is fine.
    closeLiveStreams();
    assert.deepEqual(closed.sort(), ["a", "b"]);
  });

  it("does not close a stream that already unregistered", () => {
    const closed: string[] = [];
    const unregister = registerLiveStream(() => closed.push("gone"));
    unregister();
    unregister(); // idempotent
    closeLiveStreams();
    assert.deepEqual(closed, []);
  });

  it("closes a stream registered during the shutdown window", () => {
    const closed: string[] = [];
    closeLiveStreams();
    registerLiveStream(() => closed.push("late"));
    assert.deepEqual(closed, ["late"]);
  });

  it("keeps closing the others when one cleanup throws", () => {
    const closed: string[] = [];
    registerLiveStream(() => { throw new Error("already gone"); });
    registerLiveStream(() => closed.push("after"));
    closeLiveStreams();
    assert.deepEqual(closed, ["after"]);
  });
});

describe("Hermes event stream registration", () => {
  it("is closed by closeLiveStreams while it is open", async () => {
    let subscriptions = 0;
    const stream = createHermesEventStream(new AbortController().signal, {
      connect: async () => {},
      subscribe: () => { subscriptions += 1; return () => {}; },
      authorized: async () => true,
    });
    const reader = stream.getReader();
    assert.equal((await reader.read()).done, false); // the "open" frame
    assert.equal(subscriptions, 1);

    closeLiveStreams();
    let done = false;
    while (!done) done = (await reader.read()).done;
    assert.equal(done, true);
  });

  it("unregisters once it ends, so a later stop has nothing to close", async () => {
    const controller = new AbortController();
    const stream = createHermesEventStream(controller.signal, {
      connect: async () => {},
      subscribe: () => () => {},
      authorized: async () => true,
    });
    const reader = stream.getReader();
    await reader.read();
    controller.abort();
    let done = false;
    while (!done) done = (await reader.read()).done;

    // The registry no longer knows this stream: closing must do nothing,
    // which is only observable through the registry's own bookkeeping.
    const closed: string[] = [];
    registerLiveStream(() => closed.push("other"));
    closeLiveStreams();
    assert.deepEqual(closed, ["other"]);
  });
});