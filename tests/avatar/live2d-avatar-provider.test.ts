import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Live2DAvatarProvider,
  type Live2DModelInstance,
  type Live2DRuntimeAdapter,
} from "@/lib/avatar/live2d-avatar-provider";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function model(name: string, calls: string[]): Live2DModelInstance {
  return {
    destroy: () => calls.push(`${name}:destroy`),
    setExpression: (value) => calls.push(`${name}:expression:${value}`),
    startMotion: (group) => calls.push(`${name}:motion:${group}`),
    setParameter: (id, value) => calls.push(`${name}:parameter:${id}:${value}`),
  };
}

describe("Live2DAvatarProvider model replacement", () => {
  it("destroys a stale asynchronous load instead of stacking it over the new model", async () => {
    const calls: string[] = [];
    const first = deferred<Live2DModelInstance>();
    const second = deferred<Live2DModelInstance>();
    let loadCount = 0;
    const runtime: Live2DRuntimeAdapter = {
      load: () => (++loadCount === 1 ? first.promise : second.promise),
    };
    const provider = new Live2DAvatarProvider(runtime, {
      mouthOpenParameter: "ParamMouth",
      emotionExpressions: { happy: "Smile" },
    });
    const canvas = {} as HTMLCanvasElement;

    const loadingFirst = provider.load({
      id: "a",
      name: "A",
      canvas,
      modelUrl: "https://example.test/a.model3.json",
    });
    const loadingSecond = provider.load({
      id: "b",
      name: "B",
      canvas,
      modelUrl: "https://example.test/b.model3.json",
    });
    second.resolve(model("new", calls));
    await loadingSecond;
    first.resolve(model("stale", calls));
    await loadingFirst;

    provider.setEmotion("happy");
    provider.setMouthOpen(0.5);
    assert.deepEqual(calls, [
      "stale:destroy",
      "new:expression:Smile",
      "new:parameter:ParamMouth:0.5",
    ]);
  });
});
