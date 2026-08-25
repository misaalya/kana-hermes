import type { AvatarController } from "@/lib/avatar/avatar-controller";

const RESUME_TIMEOUT_MS = 3_000;

export class AudioLipSyncController {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private animationFrame: number | null = null;
  private epoch = 0;

  constructor(private readonly avatar: AvatarController) {}

  async play(audioData: ArrayBuffer): Promise<void> {
    this.stop();
    const epoch = this.epoch;
    const context = (this.context ??= new AudioContext());
    await this.resumeContext(context);
    this.assertCurrent(epoch, context);
    const audioBuffer = await context.decodeAudioData(audioData.slice(0));
    this.assertCurrent(epoch, context);
    const source = context.createBufferSource();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    source.buffer = audioBuffer;
    source.connect(analyser);
    analyser.connect(context.destination);
    this.source = source;
    this.analyser = analyser;
    this.avatar.setTalking(true);

    const samples = new Uint8Array(analyser.fftSize);
    const updateMouth = () => {
      if (this.analyser !== analyser) return;
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        energy += normalized * normalized;
      }
      const rms = Math.sqrt(energy / samples.length);
      this.avatar.setMouthOpen(Math.min(1, rms * 4.8));
      this.animationFrame = requestAnimationFrame(updateMouth);
    };

    return new Promise((resolve) => {
      source.addEventListener(
        "ended",
        () => {
          this.finishPlayback();
          resolve();
        },
        { once: true },
      );
      source.start();
      updateMouth();
    });
  }

  stop(): void {
    this.epoch += 1;
    try {
      this.source?.stop();
    } catch {
      // A source that already ended cannot be stopped again.
    }
    this.finishPlayback();
  }

  private assertCurrent(epoch: number, context: AudioContext): void {
    if (epoch !== this.epoch || context.state === "closed") {
      throw new DOMException("Voice playback was cancelled.", "AbortError");
    }
  }

  // Autoplay policies leave resume() pending forever until a user gesture
  // happens; fail loudly with an actionable message instead of hanging.
  private async resumeContext(context: AudioContext): Promise<void> {
    if (context.state !== "suspended") return;
    const resuming = context.resume();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const blocked = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timer = null;
        reject(
          new Error(
            "Audio is blocked until you interact with the page (browser autoplay policy).",
          ),
        );
      }, RESUME_TIMEOUT_MS);
    });
    try {
      await Promise.race([resuming, blocked]);
    } finally {
      if (timer !== null) clearTimeout(timer);
      resuming.catch(() => undefined);
    }
  }

  private finishPlayback(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.source = null;
    this.analyser = null;
    this.avatar.setTalking(false);
    // Release the hardware audio device between utterances; browsers cap the
    // number of live AudioContexts per page. The next play() recreates it.
    const context = this.context;
    this.context = null;
    void context?.close().catch(() => undefined);
  }
}
