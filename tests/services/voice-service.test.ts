import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AvatarController } from "@/lib/avatar/avatar-controller";
import { VoiceService } from "@/lib/services/voice-service";
import { createErrorStore } from "@/lib/store/error-store";
import { createVoiceStore } from "@/lib/store/voice-store";
import type { VoiceProviderStatus } from "@/lib/voice/types";

const ready: VoiceProviderStatus = { state: "ready", voices: [] };

function createService() {
  const voice = createVoiceStore();
  let finish!: (status: VoiceProviderStatus) => void;
  const service = new VoiceService({
    voice,
    errors: createErrorStore(),
    avatarController: {} as AvatarController,
    createProvider: () => { throw new Error("not used"); },
    inspectProvider: () => new Promise((resolve) => { finish = (status) => resolve({ status }); }),
  });
  return { voice, service, finish: (status = ready) => finish(status) };
}

describe("VoiceService.inspect", () => {
  it("reports the provider state when nothing is speaking", async () => {
    const { voice, service, finish } = createService();
    const inspected = service.inspect();
    assert.equal(voice.getState().runtimeState, "checking");
    finish();
    await inspected;
    assert.equal(voice.getState().runtimeState, "ready");
    assert.deepEqual(voice.getState().status, ready);
  });

  it("keeps a reply that is still synthesizing active, so Stop stays available", async () => {
    const { voice, service, finish } = createService();
    const inspected = service.inspect();
    // A slow machine is still generating the reply's audio when the check lands.
    voice.setState({ runtimeState: "synthesizing" });
    finish();
    await inspected;
    assert.equal(voice.getState().runtimeState, "synthesizing");
    assert.deepEqual(voice.getState().status, ready, "the new status is still recorded");
  });

  it("does not show a check over playback that already started", async () => {
    const { voice, service, finish } = createService();
    voice.setState({ runtimeState: "playing" });
    const inspected = service.inspect();
    assert.equal(voice.getState().runtimeState, "playing");
    finish();
    await inspected;
    assert.equal(voice.getState().runtimeState, "playing");
  });
});
