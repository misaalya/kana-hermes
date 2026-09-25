import { EMOTIONS, type Emotion, type KanaResponse } from "./types";

const JAPANESE_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff]/u;
const JAPANESE_CHARACTERS = /[\u3040-\u30ff\u3400-\u9fff]/gu;
const LETTERS = /\p{L}/gu;

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
): KanaResponse {
  if (!isRecord(candidate)) {
    throw new KanaProtocolError(
      "Hermes returned an invalid Kana response object.",
      rawResponse,
    );
  }

  const value = candidate;
  const subtitle = isRecord(value.subtitle) ? value.subtitle : undefined;

  if (value.speech_ja !== undefined && typeof value.speech_ja !== "string") {
    throw new KanaProtocolError(
      "Kana speech must be text.",
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

  if (value.emotion !== undefined && !isEmotion(value.emotion)) {
    throw new KanaProtocolError(
      "Hermes returned an unsupported Kana emotion.",
      rawResponse,
    );
  }

  return {
    speech_ja: japaneseSpeech(value.speech_ja ?? ""),
    subtitle: {
      text: subtitle.text.trim(),
      language: subtitle.language.trim().toLowerCase(),
    },
    emotion: (value.emotion as Emotion | undefined) ?? "neutral",
  };
}

/**
 * Speech the voice may read: Japanese only. Anything else becomes "", which
 * shows the reply without a voice instead of reading another language in a
 * Japanese voice.
 */
function japaneseSpeech(text: string): string {
  // A file tag is never read aloud (see lib/presentation/media.ts).
  const speech = text.replace(/MEDIA:\s*\S+/g, "").replace(/\[\[(?:audio_as_voice|as_document)\]\]/g, "").trim();
  return JAPANESE_SCRIPT.test(speech) ? speech : "";
}

/** A plain reply is spoken only when most of its letters are Japanese. */
function isMostlyJapanese(text: string): boolean {
  const japanese = text.match(JAPANESE_CHARACTERS)?.length ?? 0;
  const letters = text.match(LETTERS)?.length ?? 0;
  return japanese > 0 && japanese * 2 >= letters;
}

type HeaderField = "speech" | "emotion" | "language";

const HEADER_FIELDS: Record<string, HeaderField> = {
  ja: "speech",
  speech: "speech",
  speech_ja: "speech",
  emotion: "emotion",
  lang: "language",
  language: "language",
};

const HEADER_LINE = /^\s*([a-z_]+)\s*:\s?(.*)$/i;
const FENCE_LINE = /^\s*(?:```|~~~)/;

function headerField(line: string): HeaderField | undefined {
  const match = HEADER_LINE.exec(line);
  return match ? HEADER_FIELDS[match[1].toLowerCase()] : undefined;
}

function isRule(line: string | undefined): boolean {
  return line?.trim() === "---";
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(trimmed);
  return (quoted ? quoted[2] : trimmed).trim();
}

/**
 * The protocol 3 reply: a header of `ja`, `emotion` and `lang` lines between
 * `---` rules, then the answer as Markdown. Tolerates what models commonly
 * do: wrap the whole reply in a code fence, drop the opening rule, quote a
 * value, or wrap `ja` onto a second line. Prose before the header is kept
 * as part of the answer.
 */
function parseHeaderReply(rawResponse: string): KanaResponse | undefined {
  let lines = rawResponse.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.findIndex((line) => line.trim());
  if (first === -1) return undefined;

  // A whole reply wrapped in a fence: drop the opening fence and its closing
  // twin, but never a fence that belongs to a code block in the answer.
  let wrapped = false;
  if (FENCE_LINE.test(lines[first])) {
    const next = lines.slice(first + 1).find((line) => line.trim());
    if (isRule(next) || (next !== undefined && headerField(next) === "speech")) {
      lines = lines.slice(first + 1);
      wrapped = true;
    }
  }

  // `start` is the first header line; `proseEnd` is where text before the
  // header (and its opening rule, when there is one) ends.
  let start = -1;
  let proseEnd = 0;
  let bodyFrom = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isRule(line)) {
      const next = lines.slice(index + 1).find((candidate) => candidate.trim());
      if (next !== undefined && headerField(next)) {
        start = index + 1;
        proseEnd = index;
        break;
      }
    } else if (line.trim()) {
      // Without an opening rule, only a reply that starts with `ja:` counts,
      // so a "Speech:" line inside an ordinary answer is left alone.
      if (index === lines.findIndex((candidate) => candidate.trim()) && headerField(line) === "speech") {
        start = index;
        proseEnd = index;
        break;
      }
    }
  }
  if (start === -1) return undefined;

  const fields: Partial<Record<HeaderField, string>> = {};
  let current: HeaderField | undefined;
  let index = start;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (isRule(line)) {
      bodyFrom = index + 1;
      break;
    }
    const field = headerField(line);
    if (field) {
      current = field;
      fields[field] = HEADER_LINE.exec(line)?.[2] ?? "";
    } else if (!line.trim()) {
      // A blank line ends a header that has no closing rule.
      if (fields.speech !== undefined) {
        bodyFrom = index + 1;
        break;
      }
    } else if (current === "speech") {
      fields.speech = `${fields.speech ?? ""} ${line.trim()}`;
    } else if (HEADER_LINE.test(line)) {
      current = undefined; // an unknown key, such as a model's own note
    } else {
      bodyFrom = index;
      break;
    }
  }
  if (fields.speech === undefined) return undefined;
  if (bodyFrom === -1) bodyFrom = index;

  const prose = lines.slice(0, proseEnd).join("\n").trim();
  const bodyLines = lines.slice(bodyFrom);
  if (wrapped) {
    // An odd number of fences means the last one closes the outer wrapper.
    const fences = bodyLines.filter((line) => FENCE_LINE.test(line)).length;
    const last = bodyLines.findLastIndex((line) => line.trim());
    if (fences % 2 === 1 && last !== -1 && FENCE_LINE.test(bodyLines[last])) {
      bodyLines.splice(last, 1);
    }
  }
  const body = [prose, bodyLines.join("\n").trim()].filter(Boolean).join("\n\n");
  const speech = japaneseSpeech(unquote(fields.speech));
  const emotion = unquote(fields.emotion ?? "").replace(/^<|>$/g, "").toLowerCase();
  const language = unquote(fields.language ?? "").replace(/^<|>$/g, "").toLowerCase();

  if (!body && !speech) {
    throw new KanaProtocolError("Hermes returned an empty Kana reply.", rawResponse);
  }
  return {
    speech_ja: speech,
    subtitle: body
      ? { text: body, language: /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(language) ? language : "und" }
      : { text: speech, language: "ja" },
    emotion: isEmotion(emotion) ? emotion : "neutral",
  };
}

export function parseKanaResponse(rawResponse: string): KanaResponse {
  const trimmed = rawResponse.trim();

  const header = parseHeaderReply(rawResponse);
  if (header !== undefined) return header;

  // Protocol 1 and 2 replies (a JSON envelope) still arrive from restored
  // history and from models that keep the older habit.
  const embedded = parseEmbeddedEnvelope(rawResponse);
  if (embedded !== undefined) {
    return validateKanaEnvelope(embedded, rawResponse);
  }

  const loose = recoverLooseKanaEnvelope(rawResponse);
  if (loose !== undefined) {
    return validateKanaEnvelope(loose, rawResponse);
  }

  // JSON-looking output that cannot be recovered must fail explicitly. Never
  // display the protocol envelope itself as a chat bubble.
  if (/^(?:\{|```)/.test(trimmed) && /\b(?:speech_ja|subtitle)\b/.test(trimmed)) {
    throw new KanaProtocolError(
      "Hermes returned a malformed Kana response envelope.",
      rawResponse,
    );
  }

  // Graceful degradation: a model that ignored the contract still gets its
  // answer shown. It is spoken only when it is already Japanese; the voice
  // never reads another language. The language is unknown, so BCP 47 "und".
  return {
    speech_ja: isMostlyJapanese(trimmed) ? trimmed : "",
    subtitle: { text: trimmed, language: "und" },
    emotion: "neutral",
  };
}
