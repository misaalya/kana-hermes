import type { Emotion } from "@/lib/presentation/types";
import type { Live2DModelLayout } from "./model-layout";

export type AvatarModelSource = {
  id: string;
  name: string;
  modelUrl?: string;
  modelFiles?: File[];
  canvas?: HTMLCanvasElement;
};

export type AvatarSnapshot = {
  loaded: boolean;
  renderMode: "mock" | "live2d";
  emotion: Emotion;
  emotionIntensity: number;
  motion?: string;
  mouthOpen: number;
  talking: boolean;
};

export interface AvatarProvider {
  readonly id: string;
  load(source: AvatarModelSource): Promise<void>;
  unload(): void;
  setEmotion(emotion: Emotion, intensity?: number): void;
  playMotion(name: string): void;
  setMouthOpen(value: number): void;
  setTalking(value: boolean): void;
  /** Optional runtime-only layout update that must not reload model assets. */
  setLayout?(layout: Live2DModelLayout): void;
}

export interface ObservableAvatarProvider extends AvatarProvider {
  getSnapshot(): AvatarSnapshot;
  subscribe(listener: (snapshot: AvatarSnapshot) => void): () => void;
}
