import type { Emotion } from "@/lib/presentation/types";
import type {
  AvatarModelSource,
  AvatarSnapshot,
  ObservableAvatarProvider,
} from "./types";

const INITIAL_SNAPSHOT: AvatarSnapshot = {
  loaded: false,
  renderMode: "mock",
  emotion: "neutral",
  emotionIntensity: 0.2,
  mouthOpen: 0,
  talking: false,
};

export class MockAvatarProvider implements ObservableAvatarProvider {
  readonly id = "mock-avatar";
  private snapshot: AvatarSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<(snapshot: AvatarSnapshot) => void>();

  async load(source: AvatarModelSource): Promise<void> {
    void source;
    this.update({ loaded: true });
  }

  unload(): void {
    this.snapshot = INITIAL_SNAPSHOT;
    this.notify();
  }

  setEmotion(emotion: Emotion, intensity = 1): void {
    this.update({ emotion, emotionIntensity: Math.max(0, Math.min(1, intensity)) });
  }

  playMotion(motion: string): void {
    this.update({ motion });
  }

  setMouthOpen(mouthOpen: number): void {
    this.update({ mouthOpen: Math.max(0, Math.min(1, mouthOpen)) });
  }

  setTalking(talking: boolean): void {
    this.update({ talking, ...(talking ? {} : { mouthOpen: 0 }) });
  }

  setRenderMode(renderMode: AvatarSnapshot["renderMode"]): void {
    this.update({ renderMode });
  }

  getSnapshot(): AvatarSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: AvatarSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private update(update: Partial<AvatarSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
