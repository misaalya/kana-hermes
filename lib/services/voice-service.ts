import type { AvatarController } from "@/lib/avatar/avatar-controller";
import { SpokenReplyQueue } from "@/lib/presentation/spoken-reply-queue";
import type { ErrorStore } from "@/lib/store/error-store";
import type { VoiceStore } from "@/lib/store/voice-store";
import type { VoiceProvider, VoiceProviderStatus } from "@/lib/voice/types";

export type VoiceServiceDependencies = {
  voice: VoiceStore;
  errors: ErrorStore;
  avatarController: AvatarController;
  createProvider(avatarController: AvatarController): VoiceProvider;
  inspectProvider(): Promise<{ status: VoiceProviderStatus }>;
};

/**
 * Browser playback of Kana's speech. Owns the TTS relay provider and the queue
 * that holds each reply until its audio starts.
 */
export class VoiceService {
  readonly spokenReplies = new SpokenReplyQueue();
  private provider: VoiceProvider | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: VoiceServiceDependencies) {}

  /** The provider is created on first use and keeps its gesture-unlocked AudioContext. */
  getProvider(): VoiceProvider {
    if (this.provider) return this.provider;
    // Voice and delivery choices are passed per utterance; the server owns provider selection.
    const provider = this.deps.createProvider(this.deps.avatarController);
    this.provider = provider;
    const applySnapshot = (snapshot: ReturnType<VoiceProvider["getSnapshot"]>) => {
      this.deps.voice.setState({ runtimeState: snapshot.state });
      const totalDuration =
        (snapshot.lastSynthesisDurationMs ?? 0) + (snapshot.lastPlaybackDurationMs ?? 0);
      if (totalDuration > 0) {
        this.deps.errors.getState().accumulateMetrics({
          lastVoiceDurationMs: totalDuration,
          lastVoiceSynthesisDurationMs: snapshot.lastSynthesisDurationMs,
          lastVoicePlaybackDurationMs: snapshot.lastPlaybackDurationMs,
          lastVoiceTimeToFirstAudioMs: snapshot.timeToFirstAudioMs,
        });
      }
    };
    applySnapshot(provider.getSnapshot());
    this.unsubscribe = provider.subscribe(applySnapshot);
    return provider;
  }

  async inspect(): Promise<VoiceProviderStatus> {
    this.deps.voice.setState({ runtimeState: "checking" });
    const { status } = await this.deps.inspectProvider();
    this.deps.voice.setState({ status, runtimeState: status.state });
    // "unavailable" is an engine that has not been downloaded: a setup step
    // shown in Settings and first-run setup, not an error.
    if (status.state === "error") {
      this.deps.errors
        .getState()
        .report("voice", status.message || "The configured voice provider is unavailable.", "voice");
    }
    return status;
  }

  /** Prime Web Audio while a user gesture is still active. */
  unlock(): void {
    try {
      this.getProvider().unlock?.();
    } catch (error) {
      this.deps.errors.getState().report("voice", error, "voice");
    }
  }

  stop(): void {
    this.provider?.stop();
  }

  /** Stop speech and show every reply that was waiting for its audio. */
  flushHeld(): void {
    this.stop();
    this.spokenReplies.cancel();
  }

  /** Stop speech and drop held replies without showing them. */
  discardHeld(): void {
    this.stop();
    this.spokenReplies.cancel(false);
  }

  /** Release the provider; the next use creates a fresh one. */
  release(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.provider?.dispose?.();
    this.provider = null;
    this.deps.voice.setState({ runtimeState: "idle" });
  }

  dispose(): void {
    this.spokenReplies.cancel(false);
    this.release();
  }
}
