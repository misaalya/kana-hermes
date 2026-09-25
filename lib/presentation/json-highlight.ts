// A tiny JSON tokenizer for colouring the /docs examples. It never parses or
// rejects: every character of the source lands in exactly one token, so
// joining the tokens gives back the original text (and what Copy puts on the
// clipboard is unchanged). Anything it does not recognise stays "plain".

export type JsonTokenKind = "key" | "string" | "number" | "literal" | "punctuation" | "plain";

export type JsonToken = { kind: JsonTokenKind; text: string };

// A string (a key when a colon follows), a number, true/false/null, or one
// structural character. Strings come first, so digits inside them stay text.
const TOKEN = /("(?:[^"\\\n]|\\.)*")(?=\s*:)|("(?:[^"\\\n]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

export function tokenizeJson(source: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    const start = match.index;
    if (start > last) tokens.push({ kind: "plain", text: source.slice(last, start) });
    const kind: JsonTokenKind = match[1]
      ? "key"
      : match[2]
        ? "string"
        : match[3]
          ? "number"
          : match[4]
            ? "literal"
            : "punctuation";
    tokens.push({ kind, text: match[0] });
    last = start + match[0].length;
  }
  if (last < source.length) tokens.push({ kind: "plain", text: source.slice(last) });
  return tokens;
}
