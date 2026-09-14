import type { Emotion } from "@/lib/presentation/types";
import type { Live2DModelLayout } from "./model-layout";
import { MockAvatarProvider } from "./mock-avatar-provider";
import type {
  AvatarModelSource,
  AvatarProvider,
  AvatarSnapshot,
  ObservableAvatarProvider,
} from "./types";

/** A load finished after a newer `use()` call started; its result was discarded. */
export class AvatarLoadSupersededError extends Error {
  constructor() {
    super("A newer avatar load replaced this one.");
    this.name = "AvatarLoadSupersededError";
  }
}

/**
 * Keeps UI-observable avatar state separate from the active renderer. This lets
 * voice and presentation code use one stable provider while the user switches
 * between the CSS preview and a real Live2D runtime.
 */
export class ManagedAvatarProvider implements ObservableAvatarProvider {
  readonly id = "managed-avatar";
  private readonly state = new MockAvatarProvider();
  private active: AvatarProvider = this.state;
  private useGeneration = 0;

  /**
   * Switch to `provider`. Loads are not serialized by callers, so only the
   * latest call may change shared state: an older load that settles later is
   * unloaded and rejects with AvatarLoadSupersededError.
   */
  async use(provider: AvatarProvider, source: AvatarModelSource): Promise<void> {
    const generation = ++this.useGeneration;
    if (this.active !== this.state) this.active.unload();
    this.active = provider;
    // A new attempt is in progress; do not keep showing the previous failure.
    this.state.setLoadError(undefined);
    try {
      await provider.load(source);
    } catch (error) {
      provider.unload();
      if (generation !== this.useGeneration) throw new AvatarLoadSupersededError();
      this.active = this.state;
      await this.state.load({ id: "kana-mock", name: "Kana preview" });
      if (generation !== this.useGeneration) throw new AvatarLoadSupersededError();
      this.state.setRenderMode("mock");
      this.state.setLoadError(
        error instanceof Error && error.message ? error.message : "Unknown Live2D runtime error.",
      );
      throw error;
    }
    if (generation === this.useGeneration) await this.state.load(source);
    if (generation !== this.useGeneration) {
      provider.unload();
      throw new AvatarLoadSupersededError();
    }
    this.state.setRenderMode(provider.id === "live2d" ? "live2d" : "mock");
  }

  async load(source: AvatarModelSource): Promise<void> {
    await this.active.load(source);
  }

  unload(): void {
    // An in-flight use() must not revive a model after an explicit unload.
    this.useGeneration += 1;
    if (this.active !== this.state) this.active.unload();
    this.active = this.state;
    this.state.unload();
  }

  setEmotion(emotion: Emotion, intensity = 1): void {
    if (this.active !== this.state) this.active.setEmotion(emotion, intensity);
    this.state.setEmotion(emotion, intensity);
  }

  playMotion(name: string): void {
    if (this.active !== this.state) this.active.playMotion(name);
    this.state.playMotion(name);
  }

  setMouthOpen(value: number): void {
    if (this.active !== this.state) this.active.setMouthOpen(value);
    this.state.setMouthOpen(value);
  }

  setTalking(value: boolean): void {
    if (this.active !== this.state) this.active.setTalking(value);
    this.state.setTalking(value);
  }

  setLayout(layout: Live2DModelLayout): void {
    if (this.active !== this.state) this.active.setLayout?.(layout);
  }

  getSnapshot(): AvatarSnapshot {
    return this.state.getSnapshot();
  }

  subscribe(listener: (snapshot: AvatarSnapshot) => void): () => void {
    return this.state.subscribe(listener);
  }
}
