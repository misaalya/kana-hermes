import type { Emotion } from "@/lib/presentation/types";
import type { AvatarProvider } from "./types";
import type { Live2DModelLayout } from "./model-layout";

const EMOTION_INTENSITY: Record<Emotion, number> = {
  neutral: 0.2,
  happy: 0.75,
  sad: 0.65,
  angry: 0.8,
  surprised: 0.85,
  thinking: 0.55,
  confused: 0.6,
  excited: 0.95,
};

const EMOTION_MOTION: Partial<Record<Emotion, string>> = {
  happy: "affirm",
  surprised: "surprise",
  thinking: "think",
  confused: "tilt",
  excited: "celebrate",
};

export class AvatarController {
  constructor(readonly provider: AvatarProvider) {}

  presentEmotion(emotion: Emotion = "neutral"): void {
    this.provider.setEmotion(emotion, EMOTION_INTENSITY[emotion]);
    const motion = EMOTION_MOTION[emotion];
    if (motion) this.provider.playMotion(motion);
  }

  setMouthOpen(value: number): void {
    this.provider.setMouthOpen(Math.max(0, Math.min(1, value)));
  }

  setTalking(value: boolean): void {
    this.provider.setTalking(value);
    if (!value) this.provider.setMouthOpen(0);
  }

  setLayout(layout: Live2DModelLayout): void {
    this.provider.setLayout?.(layout);
  }
}
