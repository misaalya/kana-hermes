import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Live2DAvatarProvider,
  type Live2DModelInstance,
  type Live2DRuntimeAdapter,
} from "@/lib/avatar/live2d-avatar-provider";
import { DEFAULT_LIVE2D_MODEL_LAYOUT } from "@/lib/avatar/model-layout";

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
    clearExpression: () => calls.push(`${name}:expression:clear`),
    startMotion: (group) => calls.push(`${name}:motion:${group}`),
    setMouthOpen: (value) => calls.push(`${name}:mouth:${value}`),
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
    const provider = new Live2DAvatarProvider(
      runtime,
      {
        mouthOpenParameter: "ParamMouth",
        emotionExpressions: { happy: "Smile" },
      },
      DEFAULT_LIVE2D_MODEL_LAYOUT,
    );
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
      "new:mouth:0.5",
    ]);
  });

  it("clears stale expressions and plays a per-emotion motion when configured", async () => {
    const calls: string[] = [];
    const runtime: Live2DRuntimeAdapter = {
      load: async () => model("avatar", calls),
    };
    const provider = new Live2DAvatarProvider(
      runtime,
      {
        mouthOpenParameter: "ParamMouthOpenY",
        emotionExpressions: { happy: "Smile" },
        emotionMotions: { happy: { group: "Joy", index: 1 } },
      },
      DEFAULT_LIVE2D_MODEL_LAYOUT,
    );
    await provider.load({
      id: "avatar",
      name: "Avatar",
      canvas: {} as HTMLCanvasElement,
      modelFiles: [new File(["model"], "avatar.model3.json")],
    });

    provider.setEmotion("happy");
    provider.setEmotion("sad");

    assert.deepEqual(calls, [
      "avatar:expression:Smile",
      "avatar:motion:Joy",
      "avatar:expression:clear",
    ]);
  });
});
