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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeKanaEnvelope(value: unknown): boolean {
  return isRecord(value) && ("speech_ja" in value || "subtitle" in value);
}

/** Find balanced JSON objects embedded after accidental prose or fences. */
function jsonObjectCandidates(raw: string): string[] {
  const candidates: string[] = [];
  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const character = raw[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{") depth += 1;
      if (character !== "}") continue;
      depth -= 1;
      if (depth === 0) {
        candidates.push(raw.slice(start, index + 1));
        start = index;
        break;
      }
    }
  }
  return candidates;
}

function parseEmbeddedEnvelope(raw: string): unknown {
  const attempts = [unwrapJson(raw), ...jsonObjectCandidates(raw).reverse()];
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (looksLikeKanaEnvelope(parsed)) return parsed;
    } catch {
      // Try the next complete object; Hermes occasionally prefixes prose.
    }
  }
  return undefined;
}

function decodeLooseJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    let decoded = "";
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (character !== "\\" || index + 1 >= value.length) {
        decoded += character;
        continue;
      }
      const escaped = value[++index];
      if (escaped === "n") decoded += "\n";
      else if (escaped === "r") decoded += "\r";
      else if (escaped === "t") decoded += "\t";
      else if (escaped === "b") decoded += "\b";
      else if (escaped === "f") decoded += "\f";
      else if (escaped === "u") {
        const code = value.slice(index + 1, index + 5);
        if (/^[0-9a-f]{4}$/i.test(code)) {
          decoded += String.fromCharCode(Number.parseInt(code, 16));
          index += 4;
        } else decoded += "u";
      } else decoded += escaped;
    }
    return decoded;
  }
}

/**
 * Narrow recovery for the common model failure where quotes inside subtitle
 * text were left unescaped. Field boundaries remain explicit, so this never
 * guesses a response from unrelated prose.
 */
function recoverLooseKanaEnvelope(raw: string): unknown {
  const speech = /["']speech_ja["']\s*:\s*"([\s\S]*?)"\s*,\s*["']subtitle["']\s*:/i.exec(raw);
  const subtitleStart = /["']subtitle["']\s*:\s*\{/i.exec(raw);
  if (!speech || !subtitleStart) return undefined;
  const subtitleSource = raw.slice(subtitleStart.index + subtitleStart[0].length);
  const text = /["']text["']\s*:\s*"([\s\S]*?)"\s*,\s*["']language["']\s*:/i.exec(subtitleSource);
  const language = /["']language["']\s*:\s*"([^"\r\n]+)"/i.exec(subtitleSource);
  if (!text || !language) return undefined;
  const emotion = /["']emotion["']\s*:\s*"([^"\r\n]+)"/i.exec(raw);
  return {
    speech_ja: decodeLooseJsonString(speech[1]),
    subtitle: {
      text: decodeLooseJsonString(text[1]),
      language: decodeLooseJsonString(language[1]),
    },
    ...(emotion ? { emotion: decodeLooseJsonString(emotion[1]) } : {}),
  };
}

function validateKanaEnvelope(
  candidate: unknown,
  rawResponse: string,
  expectedSubtitleLanguage?: string,
): KanaResponse {
  if (!isRecord(candidate)) {
    throw new KanaProtocolError(
      "Hermes returned an invalid Kana response object.",
      rawResponse,
    );
  }

  const value = candidate;
  const subtitle = isRecord(value.subtitle) ? value.subtitle : undefined;

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

export function parseKanaResponse(
  rawResponse: string,
  expectedSubtitleLanguage?: string,
): KanaResponse {
  const trimmed = rawResponse.trim();

  const embedded = parseEmbeddedEnvelope(rawResponse);
  if (embedded !== undefined) {
    return validateKanaEnvelope(
      embedded,
      rawResponse,
      expectedSubtitleLanguage,
    );
  }

  const loose = recoverLooseKanaEnvelope(rawResponse);
  if (loose !== undefined) {
    return validateKanaEnvelope(loose, rawResponse, expectedSubtitleLanguage);
  }

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

  // JSON-looking output that cannot be recovered must fail explicitly. Never
  // display the protocol envelope itself as a chat bubble.
  throw new KanaProtocolError(
    "Hermes returned a malformed Kana response envelope.",
    rawResponse,
  );
}
