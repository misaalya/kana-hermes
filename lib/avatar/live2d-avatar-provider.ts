import type { Emotion } from "@/lib/presentation/types";
import type { AvatarModelSource, AvatarProvider } from "./types";
import type { Live2DModelLayout } from "./model-layout";

export type Live2DModelBindings = {
  mouthOpenParameter: string;
  emotionExpressions?: Partial<Record<Emotion, string>>;
  emotionMotions?: Partial<
    Record<Emotion, { group: string; index?: number }>
  >;
  motions?: Record<string, { group: string; index?: number }>;
};

export interface Live2DModelInstance {
  destroy(): void;
  setExpression(name: string): void;
  clearExpression(): void;
  startMotion(group: string, index?: number): void;
  setMouthOpen(value: number): void;
  /** Optional speech boundary so runtimes can own the mouth via a plugin. */
  setTalking?(value: boolean): void;
  setLayout?(layout: Live2DModelLayout): void;
}

export interface Live2DRuntimeAdapter {
  load(options: {
    canvas: HTMLCanvasElement;
    modelUrl?: string;
    modelFiles?: File[];
    mouthOpenParameterId: string;
    layout: Live2DModelLayout;
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
    private layout: Live2DModelLayout,
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
      layout: this.layout,
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
    else this.model?.clearExpression();
    const motion = this.bindings.emotionMotions?.[emotion];
    if (motion) this.model?.startMotion(motion.group, motion.index);
  }

  playMotion(name: string): void {
    const motion = this.bindings.motions?.[name];
    if (motion) this.model?.startMotion(motion.group, motion.index);
  }

  setMouthOpen(value: number): void {
    this.model?.setMouthOpen(Math.max(0, Math.min(1, value)));
  }

  setTalking(value: boolean): void {
    // The runtime owns the mouth during speech; the voice layer supplies the
    // boundary and amplitude samples.
    this.model?.setTalking?.(value);
  }

  setLayout(layout: Live2DModelLayout): void {
    this.layout = layout;
    this.model?.setLayout?.(layout);
  }
}
