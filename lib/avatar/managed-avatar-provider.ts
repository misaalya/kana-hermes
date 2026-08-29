import type { Emotion } from "@/lib/presentation/types";
import type { Live2DModelLayout } from "./model-layout";
import { MockAvatarProvider } from "./mock-avatar-provider";
import type {
  AvatarModelSource,
  AvatarProvider,
  AvatarSnapshot,
  ObservableAvatarProvider,
} from "./types";

/**
 * Keeps UI-observable avatar state separate from the active renderer. This lets
 * voice and presentation code use one stable provider while the user switches
 * between the CSS preview and a real Live2D runtime.
 */
export class ManagedAvatarProvider implements ObservableAvatarProvider {
  readonly id = "managed-avatar";
  private readonly state = new MockAvatarProvider();
  private active: AvatarProvider = this.state;

  async use(provider: AvatarProvider, source: AvatarModelSource): Promise<void> {
    if (this.active !== this.state) this.active.unload();
    this.active = provider;
    try {
      await provider.load(source);
      await this.state.load(source);
      this.state.setRenderMode(provider.id === "live2d" ? "live2d" : "mock");
    } catch (error) {
      provider.unload();
      this.active = this.state;
      await this.state.load({ id: "kana-mock", name: "Kana preview" });
      this.state.setRenderMode("mock");
      throw error;
    }
  }

  async load(source: AvatarModelSource): Promise<void> {
    await this.active.load(source);
  }

  unload(): void {
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
