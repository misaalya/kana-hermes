import type { AvatarController } from "@/lib/avatar/avatar-controller";

export class AudioLipSyncController {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private animationFrame: number | null = null;

  constructor(private readonly avatar: AvatarController) {}

  async play(audioData: ArrayBuffer): Promise<void> {
    this.stop();
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();

    const audioBuffer = await this.context.decodeAudioData(audioData.slice(0));
    const source = this.context.createBufferSource();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    source.buffer = audioBuffer;
    source.connect(analyser);
    analyser.connect(this.context.destination);
    this.source = source;
    this.avatar.setTalking(true);

    const samples = new Uint8Array(analyser.fftSize);
    const updateMouth = () => {
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
    try {
      this.source?.stop();
    } catch {
      // A source that already ended cannot be stopped again.
    }
    this.finishPlayback();
  }

  private finishPlayback(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.source?.disconnect();
    this.source = null;
    this.avatar.setTalking(false);
  }
}

