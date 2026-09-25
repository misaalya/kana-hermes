export const EMOTIONS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "thinking",
  "confused",
  "excited",
] as const;

export type Emotion = (typeof EMOTIONS)[number];

export type SubtitleLanguage = string;

export type Subtitle = {
  text: string;
  language: SubtitleLanguage;
};

export type KanaResponse = {
  /** What the Japanese voice reads. Always Japanese; "" when the reply had
   * no Japanese speech, and then the reply is shown without a voice. */
  speech_ja: string;
  subtitle: Subtitle;
  emotion?: Emotion;
};

