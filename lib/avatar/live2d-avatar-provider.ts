import type { Emotion } from "@/lib/presentation/types";
import type { AvatarModelSource, AvatarProvider } from "./types";

export type Live2DModelBindings = {
  mouthOpenParameter: string;
  emotionExpressions?: Partial<Record<Emotion, string>>;
  motions?: Record<string, { group: string; index?: number }>;
};

export interface Live2DModelInstance {
  destroy(): void;
  setExpression(name: string): void;
  startMotion(group: string, index?: number): void;
  setParameter(id: string, value: number): void;
  /** Optional speech boundary so runtimes can own the mouth via a plugin. */
  setTalking?(value: boolean): void;
}

export interface Live2DRuntimeAdapter {
  load(options: {
    canvas: HTMLCanvasElement;
    modelUrl?: string;
    modelFiles?: File[];
    mouthOpenParameterId: string;
  }): Promise<Live2DModelInstance>;
}

/**
 * Framework-neutral Live2D provider. A Cubism runtime adapter owns SDK-specific
 * loading/rendering, while per-model parameter IDs stay in bindings instead of
 * leaking into chat components.
 */
export class Live2DAvatarProvider implements AvatarProvider {
  readonly id = "live2d";
  private model: Live2DModelInstance | null = null;
  private loadGeneration = 0;

  constructor(
    private readonly runtime: Live2DRuntimeAdapter,
    private readonly bindings: Live2DModelBindings,
  ) {}

  async load(source: AvatarModelSource): Promise<void> {
    if (!source.canvas || (!source.modelUrl && !source.modelFiles?.length)) {
      throw new Error(
        "Live2D requires a canvas and either a model URL or imported model folder.",
      );
    }
    const generation = ++this.loadGeneration;
    const previous = this.model;
    this.model = null;
    previous?.destroy();
    const loaded = await this.runtime.load({
      canvas: source.canvas,
      modelUrl: source.modelUrl,
      modelFiles: source.modelFiles,
      mouthOpenParameterId: this.bindings.mouthOpenParameter,
    });
    if (generation !== this.loadGeneration) {
      loaded.destroy();
      return;
    }
    this.model = loaded;
  }

  unload(): void {
    this.loadGeneration += 1;
    this.model?.destroy();
    this.model = null;
  }

  setEmotion(emotion: Emotion): void {
    const expression = this.bindings.emotionExpressions?.[emotion];
    if (expression) this.model?.setExpression(expression);
  }

  playMotion(name: string): void {
    const motion = this.bindings.motions?.[name];
    if (motion) this.model?.startMotion(motion.group, motion.index);
  }

  setMouthOpen(value: number): void {
    this.model?.setParameter(
      this.bindings.mouthOpenParameter,
      Math.max(0, Math.min(1, value)),
    );
  }

  setTalking(value: boolean): void {
    // The runtime owns the mouth during speech; the voice layer supplies the
    // boundary and amplitude samples.
    this.model?.setTalking?.(value);
  }
}
