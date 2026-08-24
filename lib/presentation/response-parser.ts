import { EMOTIONS, type Emotion, type KanaResponse } from "./types";

const JAPANESE_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff]/u;

export class KanaProtocolError extends Error {
  constructor(
    message: string,
    readonly rawResponse: string,
  ) {
    super(message);
    this.name = "KanaProtocolError";
  }
}

function unwrapJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function isEmotion(value: unknown): value is Emotion {
  return typeof value === "string" && EMOTIONS.includes(value as Emotion);
}

export function parseKanaResponse(
  rawResponse: string,
  expectedSubtitleLanguage?: string,
): KanaResponse {
  const trimmed = rawResponse.trim();

  // Graceful degradation: when Hermes answers in plain text instead of the
  // Kana JSON envelope (the persona contract is advisory to the model), wrap
  // it so the user still sees the answer instead of a silent failure.
  if (!trimmed.startsWith("{") && !trimmed.startsWith("```")) {
    return {
      speech_ja: trimmed,
      subtitle: { text: trimmed, language: expectedSubtitleLanguage ?? "en" },
      emotion: "neutral",
    };
  }

  let candidate: unknown;

  try {
    candidate = JSON.parse(unwrapJson(rawResponse));
  } catch {
    // Unparseable even though it looked envelope-ish — degrade rather than
    // drop the turn.
    return {
      speech_ja: trimmed,
      subtitle: { text: trimmed, language: expectedSubtitleLanguage ?? "en" },
      emotion: "neutral",
    };
  }

  if (!candidate || typeof candidate !== "object") {
    throw new KanaProtocolError(
      "Hermes returned an invalid Kana response object.",
      rawResponse,
    );
  }

  const value = candidate as Record<string, unknown>;
  const subtitle = value.subtitle as Record<string, unknown> | undefined;

  if (
    typeof value.speech_ja !== "string" ||
    !value.speech_ja.trim() ||
    !JAPANESE_SCRIPT.test(value.speech_ja)
  ) {
    throw new KanaProtocolError(
      "Kana speech must be non-empty conversational Japanese.",
      rawResponse,
    );
  }

  if (
    !subtitle ||
    typeof subtitle.text !== "string" ||
    !subtitle.text.trim() ||
    typeof subtitle.language !== "string" ||
    !subtitle.language.trim()
  ) {
    throw new KanaProtocolError(
      "Kana subtitles must include both text and language.",
      rawResponse,
    );
  }

  if (
    expectedSubtitleLanguage &&
    subtitle.language.toLowerCase() !== expectedSubtitleLanguage.toLowerCase()
  ) {
    throw new KanaProtocolError(
      `Hermes used subtitle language ${subtitle.language}; ${expectedSubtitleLanguage} was requested.`,
      rawResponse,
    );
  }

  if (value.emotion !== undefined && !isEmotion(value.emotion)) {
    throw new KanaProtocolError(
      "Hermes returned an unsupported Kana emotion.",
      rawResponse,
    );
  }

  return {
    speech_ja: value.speech_ja.trim(),
    subtitle: {
      text: subtitle.text.trim(),
      language: subtitle.language.trim().toLowerCase(),
    },
    emotion: (value.emotion as Emotion | undefined) ?? "neutral",
  };
}

