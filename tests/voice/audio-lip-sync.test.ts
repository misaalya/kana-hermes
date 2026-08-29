import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AvatarController } from "@/lib/avatar/avatar-controller";
import type { AvatarProvider } from "@/lib/avatar/types";
import { AudioLipSyncController } from "@/lib/voice/audio-lip-sync";

const originalAudioContext = globalThis.AudioContext;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

afterEach(() => {
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: originalAudioContext,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: originalRequestAnimationFrame,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: originalCancelAnimationFrame,
  });
});

describe("AudioLipSyncController", () => {
  it("turns decoded audio amplitude into Live2D mouth movement", async () => {
    const mouthValues: number[] = [];
    const talkingValues: boolean[] = [];
    const provider: AvatarProvider = {
      id: "lip-sync-test",
      load: async () => undefined,
      unload: () => undefined,
      setEmotion: () => undefined,
      playMotion: () => undefined,
      setMouthOpen: (value) => mouthValues.push(value),
      setTalking: (value) => talkingValues.push(value),
    };

    let ended: (() => void) | null = null;
    const source = {
      buffer: null,
      connect: () => undefined,
      disconnect: () => undefined,
      addEventListener: (_event: string, listener: () => void) => {
        ended = listener;
      },
      start: () => queueMicrotask(() => ended?.()),
      stop: () => undefined,
    };
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      connect: () => undefined,
      disconnect: () => undefined,
      getByteTimeDomainData: (samples: Uint8Array) => {
        samples.fill(176);
      },
    };
    class FakeAudioContext {
      state = "running";
      destination = {};
      decodeAudioData = async () => ({ duration: 1 });
      createBufferSource = () => source;
      createAnalyser = () => analyser;
      resume = async () => undefined;
      close = async () => undefined;
    }

    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: () => 1,
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: () => undefined,
    });

    const controller = new AudioLipSyncController(
      new AvatarController(provider),
    );
    await controller.play(new ArrayBuffer(16));

    assert.ok(talkingValues.includes(true));
    assert.ok(mouthValues.some((value) => value > 0.5));
    assert.equal(talkingValues.at(-1), false);
    assert.equal(mouthValues.at(-1), 0);
  });
});
