import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setImmediate } from "node:timers/promises";
import { createHermesEventStream } from "@/lib/server/hermes-event-stream";

describe("Hermes event stream lifecycle", () => {
  it("does not subscribe after abort or reader cancellation during connection", async () => {
    for (const mode of ["abort", "cancel"] as const) {
      const abort = new AbortController();
      const connection = Promise.withResolvers<void>();
      let subscriptions = 0;
      const stream = createHermesEventStream(abort.signal, {
        connect: () => connection.promise,
        subscribe: () => { subscriptions++; return () => {}; },
        authorized: async () => true,
      });
      if (mode === "abort") abort.abort();
      else await stream.cancel();
      connection.resolve();
      await setImmediate();
      assert.equal(subscriptions, 0);
      const reader = stream.getReader();
      while (!(await reader.read()).done) { /* Drain the initial open frame. */ }
    }
  });

  it("never connects an already-aborted request", async () => {
    let connects = 0;
    const stream = createHermesEventStream(AbortSignal.abort(), {
      connect: async () => { connects++; },
      subscribe: () => () => {},
      authorized: async () => true,
    });
    assert.equal((await stream.getReader().read()).done, true);
    assert.equal(connects, 0);
  });

  it("cleans up once on cancellation and stops heartbeat work", async (context) => {
    context.mock.timers.enable({ apis: ["setInterval"] });
    let unsubscribed = 0;
    let checks = 0;
    const abort = new AbortController();
    const stream = createHermesEventStream(abort.signal, {
      connect: async () => {},
      subscribe: () => () => { unsubscribed++; },
      authorized: async () => { checks++; return true; },
    });
    await setImmediate();
    await stream.cancel();
    abort.abort();
    context.mock.timers.tick(50_000);
    assert.equal(unsubscribed, 1);
    assert.equal(checks, 0);
  });

  it("closes an existing stream when its session expires or is revoked", async (context) => {
    context.mock.timers.enable({ apis: ["setInterval"] });
    let unsubscribed = false;
    const stream = createHermesEventStream(new AbortController().signal, {
      connect: async () => {},
      subscribe: () => () => { unsubscribed = true; },
      authorized: async () => false,
    });
    await setImmediate();
    context.mock.timers.tick(25_000);
    await setImmediate();
    assert.equal(unsubscribed, true);
    const reader = stream.getReader();
    while (!(await reader.read()).done) { /* Drain already queued frames. */ }
  });

  it("says the gateway is unreachable and ends, so the browser retries", async () => {
    let subscriptions = 0;
    const stream = createHermesEventStream(new AbortController().signal, {
      connect: async () => { throw new Error("Hermes is restarting."); },
      subscribe: () => { subscriptions++; return () => {}; },
      authorized: async () => true,
    });
    const text = await new Response(stream).text();
    assert.match(text, /event: gateway\ndata: \{"connected":false,"message":"Hermes is restarting\."\}/);
    assert.equal(subscriptions, 0);
  });

  it("ends when the gateway connection drops, so the browser resumes on the next", async () => {
    let lost: () => void = () => {};
    let unsubscribed = 0;
    let unwatched = 0;
    const stream = createHermesEventStream(new AbortController().signal, {
      connect: async () => {},
      subscribe: () => () => { unsubscribed++; },
      onConnectionLost: (listener) => { lost = listener; return () => { unwatched++; }; },
      authorized: async () => true,
    });
    await setImmediate();
    lost();
    const text = await new Response(stream).text();
    assert.match(text, /"connected":true/);
    assert.match(text, /"connected":false,"message":"Hermes gateway disconnected\."/);
    assert.equal(unsubscribed, 1);
    assert.equal(unwatched, 1);
  });

  it("disconnects slow readers instead of buffering events indefinitely", async () => {
    let emit: (params: unknown) => void = () => {};
    let unsubscribed = false;
    const stream = createHermesEventStream(new AbortController().signal, {
      connect: async () => {},
      subscribe: (listener) => { emit = listener; return () => { unsubscribed = true; }; },
      authorized: async () => true,
    });
    await setImmediate();
    const payload = "x".repeat(1024 * 1024);
    for (let i = 0; i < 17; i++) emit(payload);
    assert.equal(unsubscribed, true);
    await assert.rejects(stream.getReader().read(), /too slow/);
  });
});
