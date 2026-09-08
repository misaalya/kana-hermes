import assert from "node:assert/strict";
import { it } from "node:test";
import { SpokenReplyQueue } from "@/lib/presentation/spoken-reply-queue";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

it("holds each queued reply until its own audio starts without losing earlier text", async () => {
  const queue = new SpokenReplyQueue();
  const shown: string[] = [];
  const starts: Array<() => void> = [];
  const audio = [deferred(), deferred()];
  for (const [index, id] of ["first", "second"].entries()) {
    queue.enqueue({ id, reveal: async () => { shown.push(id); },
      speak: async (reveal) => { starts.push(reveal); await audio[index].promise; },
      onError: (error) => { throw error; }, onFinished: () => {} });
  }
  await tick();
  assert.deepEqual(shown, []);
  assert.equal(starts.length, 1);
  starts[0](); starts[0]();
  assert.deepEqual(shown, ["first"]);
  audio[0].resolve(); await tick();
  assert.equal(starts.length, 2);
  assert.deepEqual(shown, ["first"]);
  starts[1](); audio[1].resolve(); await tick();
  assert.deepEqual(shown, ["first", "second"]);
  assert.equal(queue.active, false);
});

it("reveals a failed response and allows the next reply even if provider construction throws", async () => {
  const queue = new SpokenReplyQueue();
  const shown: string[] = [];
  const errors: unknown[] = [];
  queue.enqueue({ id: "failed", reveal: async () => { shown.push("fallback"); },
    speak: () => { throw new Error("AudioContext unavailable"); },
    onError: (error) => { errors.push(error); }, onFinished: () => {} });
  queue.enqueue({ id: "next", reveal: async () => { shown.push("next"); },
    speak: async (reveal) => { reveal(); }, onError: (error) => { errors.push(error); }, onFinished: () => {} });
  await tick();
  assert.deepEqual(shown, ["fallback", "next"]);
  assert.equal(errors.length, 1);
  assert.equal(queue.active, false);
});

it("stop reveals pending text, skips queued audio and ignores late audio callbacks", async () => {
  const queue = new SpokenReplyQueue();
  const audio = deferred();
  let lateStart = () => {};
  const shown: string[] = [];
  let calls = 0;
  for (const id of ["first", "second"]) queue.enqueue({ id,
    reveal: async () => { shown.push(id); },
    speak: async (reveal) => { calls++; lateStart = reveal; await audio.promise; },
    onError: (error) => { throw error; }, onFinished: () => {} });
  await tick(); queue.cancel(); lateStart(); audio.resolve(); await tick();
  assert.deepEqual(shown, ["first", "second"]);
  assert.equal(calls, 1);
  queue.enqueue({ id: "new", reveal: async () => { shown.push("new"); },
    speak: async (reveal) => { reveal(); }, onError: (error) => { throw error; }, onFinished: () => {} });
  await tick(); assert.deepEqual(shown, ["first", "second", "new"]);
});
