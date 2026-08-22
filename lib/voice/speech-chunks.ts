export type VoiceDeliveryMode = "complete" | "sentence_chunks";

const DEFAULT_MAX_CHUNK_CHARACTERS = 160;
const SOFT_BREAKS = new Set(["、", "，", ",", "；", ";", "：", ":", "\n", " ", "　"]);

function codePoints(value: string): string[] {
  return Array.from(value);
}

function splitOversizedSegment(segment: string, maximum: number): string[] {
  const remaining = codePoints(segment);
  const chunks: string[] = [];
  while (remaining.length > maximum) {
    const minimumSoftBreak = Math.floor(maximum * 0.55);
    let cut = maximum;
    for (let index = maximum - 1; index >= minimumSoftBreak; index -= 1) {
      if (SOFT_BREAKS.has(remaining[index])) {
        cut = index + 1;
        break;
      }
    }
    chunks.push(remaining.splice(0, cut).join(""));
  }
  if (remaining.length > 0) chunks.push(remaining.join(""));
  return chunks;
}

function fallbackSentences(text: string): string[] {
  return text.match(/[^。！？!?\n]+[。！？!?]+[\s　]*|[^\n]+\n+|.+$/gu) ?? [text];
}

function sentenceSegments(text: string): string[] {
  if (typeof Intl.Segmenter !== "function") return fallbackSentences(text);
  return Array.from(
    new Intl.Segmenter("ja", { granularity: "sentence" }).segment(text),
    (part) => part.segment,
  );
}

export function splitJapaneseSpeech(
  text: string,
  maximumCharacters = DEFAULT_MAX_CHUNK_CHARACTERS,
): string[] {
  if (!Number.isInteger(maximumCharacters) || maximumCharacters < 20) {
    throw new Error("Voice chunk size must be an integer of at least 20 characters.");
  }
  if (codePoints(text).length <= maximumCharacters) return [text];

  const chunks: string[] = [];
  let pending = "";
  const flush = () => {
    if (pending) chunks.push(pending);
    pending = "";
  };

  for (const sentence of sentenceSegments(text)) {
    for (const segment of splitOversizedSegment(sentence, maximumCharacters)) {
      const combined = `${pending}${segment}`;
      if (pending && codePoints(combined).length > maximumCharacters) flush();
      if (codePoints(segment).length >= maximumCharacters) {
        flush();
        chunks.push(segment);
      } else {
        pending += segment;
      }
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [text];
}
