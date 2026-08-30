import type { AvatarController } from "@/lib/avatar/avatar-controller";

const RESUME_TIMEOUT_MS = 3_000;

export class AudioLipSyncController {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private animationFrame: number | null = null;
  private epoch = 0;

  constructor(private readonly avatar: AvatarController) {}

  /**
   * Browser autoplay permission is tied to the user gesture, not to the TTS
   * request that may finish many seconds later. Prime one reusable context
   * while Send/Enter is still handling that gesture.
   */
  unlock(): void {
    const context = this.ensureContext();
    if (context.state !== "running" && context.state !== "closed") {
      void context.resume().catch(() => undefined);
    }
    // Some browsers do not retain a resume-only autoplay unlock when the
    // audible source is created much later (after Hermes + remote TTS). Start
    // one silent frame while this method still owns the Send/Enter gesture so
    // the same reusable context is authorized for the eventual WAV.
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, context.sampleRate);
    source.connect(context.destination);
    source.addEventListener("ended", () => source.disconnect(), { once: true });
    source.start();
  }

  async play(audioData: ArrayBuffer, onStarted?: () => void): Promise<void> {
    this.stop();
    const epoch = this.epoch;
    const context = this.ensureContext();
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
          this.finishPlayback(source, analyser);
          resolve();
        },
        { once: true },
      );
      source.start();
      onStarted?.();
      updateMouth();
    });
  }

  stop(): void {
    this.epoch += 1;
    const source = this.source;
    const analyser = this.analyser;
    try {
      source?.stop();
    } catch {
      // A source that already ended cannot be stopped again.
    }
    this.finishPlayback(source, analyser);
  }

  dispose(): void {
    this.stop();
    const context = this.context;
    this.context = null;
    void context?.close().catch(() => undefined);
  }

  private ensureContext(): AudioContext {
    if (this.context && this.context.state !== "closed") return this.context;
    const AudioContextConstructor =
      globalThis.AudioContext ??
      (globalThis as typeof globalThis & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("This browser does not support Web Audio playback.");
    }
    this.context = new AudioContextConstructor();
    return this.context;
  }

  private assertCurrent(epoch: number, context: AudioContext): void {
    if (epoch !== this.epoch || context.state === "closed") {
      throw new DOMException("Voice playback was cancelled.", "AbortError");
    }
  }

  // Autoplay policies leave resume() pending forever until a user gesture
  // happens; fail loudly with an actionable message instead of hanging.
  private async resumeContext(context: AudioContext): Promise<void> {
    if (context.state === "running") return;
    if (context.state === "closed") {
      throw new Error("The browser audio output is closed.");
    }
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
      // `resume()` changes state asynchronously; String() prevents TypeScript
      // from incorrectly retaining the pre-await suspended/interrupted narrow.
      if (String(context.state) !== "running") {
        throw new Error(
          "Audio is still blocked. Interact with the page and allow sound for this site.",
        );
      }
    } finally {
      if (timer !== null) clearTimeout(timer);
      resuming.catch(() => undefined);
    }
  }

  private finishPlayback(
    source: AudioBufferSourceNode | null,
    analyser: AnalyserNode | null,
  ): void {
    // A stopped source may dispatch `ended` after the next source has already
    // started. Only the source that still owns the controller may clear the
    // live mouth state and animation frame.
    const ownsPlayback = this.source === source;
    source?.disconnect();
    analyser?.disconnect();
    if (!ownsPlayback) return;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.source = null;
    this.analyser = null;
    this.avatar.setTalking(false);
  }
}
