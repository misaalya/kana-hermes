import type { AvatarController } from "@/lib/avatar/avatar-controller";
import type {
  VoiceProvider,
  VoiceRuntimeSnapshot,
  VoiceProviderStatus,
  VoiceSpeakOptions,
} from "./types";

export class MockVoiceProvider implements VoiceProvider {
  readonly id = "mock-voice";
  private timer: number | null = null;
  private finish: (() => void) | null = null;
  private lastOptions: VoiceSpeakOptions | null = null;
  private readonly listeners = new Set<(snapshot: VoiceRuntimeSnapshot) => void>();
  private snapshot: VoiceRuntimeSnapshot = { state: "idle", canReplay: false };

  constructor(private readonly avatar: AvatarController) {}

  async inspect(): Promise<VoiceProviderStatus> {
    this.update({ state: "checking", message: "Checking mock voice…" });
    this.update({ state: "ready", message: "Mock lip sync is ready." });
    return {
      state: "ready",
      service: "mock-voice",
      apiVersion: "development",
      voices: [{ id: "mock", language: "ja" }],
      defaultVoiceId: "mock",
      supportsInstruction: true,
      message: "Mock lip sync is ready.",
    };
  }

  speak(options: VoiceSpeakOptions): Promise<void> {
    this.stop();
    this.lastOptions = { ...options };
    const duration = Math.min(3600, Math.max(900, options.text.length * 65));
    const startedAt = performance.now();
    this.avatar.setTalking(true);
    this.update({
      state: "playing",
      canReplay: true,
      message: "Playing mock lip sync…",
    });

    return new Promise((resolve) => {
      this.finish = () => {
        this.update({
          state: "ready",
          canReplay: true,
          lastPlaybackDurationMs: Math.round(performance.now() - startedAt),
          message: "Mock voice ready.",
        });
        resolve();
      };
      this.timer = window.setInterval(() => {
        const elapsed = performance.now() - startedAt;
        const wave = 0.18 + Math.abs(Math.sin(elapsed / 92)) * 0.62;
        this.avatar.setMouthOpen(wave);
        if (elapsed >= duration) this.stop();
      }, 48);
    });
  }

  replay(): Promise<void> {
    if (!this.lastOptions) {
      return Promise.reject(
        new Error("There is no mock speech to replay yet."),
      );
    }
    return this.speak(this.lastOptions);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.avatar.setTalking(false);
    const finish = this.finish;
    this.finish = null;
    finish?.();
  }

  getSnapshot(): VoiceRuntimeSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: VoiceRuntimeSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(next: Partial<VoiceRuntimeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
