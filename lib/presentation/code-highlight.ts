// A small, safe syntax tokenizer for chat code cards. It never parses or
// rejects: every character of the source lands in exactly one token, so
// joining the tokens returns the original text and Copy still copies the raw
// code. Anything it does not recognise stays "plain". Like the JSON reader it
// is a tokenizer, not a highlighting library.

import { tokenizeJson } from "./json-highlight";

export type CodeTokenKind =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "literal"
  | "keyword"
  | "tag"
  | "attribute"
  | "property"
  | "variable"
  | "punctuation";

export type CodeToken = { kind: CodeTokenKind; text: string };

type Rule = { kind: CodeTokenKind; pattern: RegExp };
type Profile = { rules: Rule[]; flags?: string };

const rule = (kind: CodeTokenKind, pattern: RegExp): Rule => ({ kind, pattern });

const HTML: Rule[] = [
  rule("comment", /<!--[\s\S]*?-->/),
  rule("tag", /<!DOCTYPE[^>]*>/),
  rule("tag", /<!\[CDATA\[[\s\S]*?\]\]>/),
  rule("tag", /<\/?[A-Za-z][\w:-]*/),
  rule("string", /"[^"\n]*"|'[^'\n]*'/),
  rule("attribute", /[A-Za-z_:][\w:.-]*(?=\s*=)/),
  rule("literal", /&[A-Za-z#][\w#]*;/),
  rule("punctuation", /\/?>|=/),
];

const CSS: Rule[] = [
  rule("comment", /\/\*[\s\S]*?\*\//),
  rule("string", /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/),
  rule("keyword", /@[a-zA-Z-]+/),
  rule("variable", /--[\w-]+/),
  rule("literal", /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/),
  rule("property", /[a-zA-Z-]+(?=\s*:)/),
  rule("number", /\b\d+(?:\.\d+)?(?:%|[a-zA-Z]+)?\b/),
  rule("variable", /[\w-]+(?=\s*\()/),
  rule("tag", /[.#][\w-]+/),
  rule("attribute", /:{1,2}[\w-]+/),
  rule("punctuation", /[{}();:,>+~*=|^$]/),
];

const JAVASCRIPT: Rule[] = [
  rule("comment", /\/\/[^\n]*|\/\*[\s\S]*?\*\//),
  rule("string", /`(?:\\[\s\S]|[^\\`])*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/),
  rule("literal", /\b(?:true|false|null|undefined)\b/),
  rule(
    "keyword",
    /\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|default|break|continue|new|class|extends|super|import|from|export|try|catch|finally|throw|await|async|yield|typeof|instanceof|in|of|this|void|delete|interface|type|enum|implements|public|private|protected|readonly|as|satisfies|declare|namespace|abstract|static|get|set|keyof|infer|asserts|string|number|boolean|any|unknown|never|object|symbol|bigint)\b/,
  ),
  rule("number", /\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)n?\b/),
  rule("variable", /\b[A-Za-z_$][\w$]*(?=\s*\()/),
  rule("punctuation", /[{}[\]();,.:?=+\-*/%<>!&|^~]+/),
];

const PYTHON: Rule[] = [
  rule("comment", /#[^\n]*/),
  rule("string", /(?:[rRbBuUfF]{0,2})(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/),
  rule("attribute", /@[A-Za-z_][\w.]*/),
  rule("literal", /\b(?:True|False|None)\b/),
  rule(
    "keyword",
    /\b(?:def|class|return|if|elif|else|for|while|in|not|and|or|is|import|from|as|try|except|finally|raise|with|yield|lambda|pass|break|continue|global|nonlocal|assert|del|async|await|match|case|self)\b/,
  ),
  rule("number", /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/),
  rule("variable", /\b[A-Za-z_]\w*(?=\s*\()/),
  rule("punctuation", /[{}[\]();,.:?=+\-*/%<>!&|^~]+/),
];

const SHELL: Rule[] = [
  rule("comment", /(?:^|[ \t])#[^\n]*/),
  rule("string", /"(?:[^"\\]|\\.)*"|'[^']*'/),
  rule("variable", /\$\{[^}\n]*\}|\$[A-Za-z_]\w*|\$[@*#?$!0-9-]/),
  rule("literal", /\b(?:true|false)\b/),
  rule(
    "keyword",
    /\b(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|function|in|return|export|local|readonly|declare|source|alias|unset|shift|trap|set)\b/,
  ),
  rule("number", /\b\d+\b/),
  rule("punctuation", /[{}[\]();,.:?=+\-*/%<>!&|^~]+/),
];

const SQL: Rule[] = [
  rule("comment", /--[^\n]*|\/\*[\s\S]*?\*\//),
  rule("string", /'(?:[^']|'')*'/),
  rule(
    "keyword",
    /\b(?:select|from|where|insert|into|values|update|set|delete|create|table|alter|drop|join|left|right|inner|outer|full|on|as|and|or|not|null|is|in|like|between|group|by|order|having|limit|offset|union|all|distinct|case|when|then|else|end|primary|key|foreign|references|index|view|with|returning|asc|desc|exists|truncate|begin|commit|rollback)\b/,
  ),
  rule("literal", /\b(?:true|false)\b/),
  rule("number", /\b\d+(?:\.\d+)?\b/),
  rule("punctuation", /[{}[\]();,.:?=+\-*/%<>!|]+/),
];

const YAML: Rule[] = [
  rule("comment", /#[^\n]*/),
  rule("string", /"(?:[^"\\\n]|\\.)*"|'[^']*'/),
  rule("literal", /\b(?:true|false|null|yes|no|on|off)\b/),
  rule("property", /^[ \t-]*[A-Za-z0-9_.-]+(?=\s*:)/),
  rule("number", /-?\b\d+(?:\.\d+)?\b/),
  rule("punctuation", /[{}[\],:&*!|>'"%@`-]/),
];

// Languages without a profile still get strings, comments, numbers, literals,
// and a broad keyword set; no language at all stays plain text.
const GENERIC: Rule[] = [
  rule("comment", /\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*/),
  rule("string", /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/),
  rule("literal", /\b(?:true|false|null|nil|None|True|False)\b/),
  rule(
    "keyword",
    /\b(?:if|else|elif|for|while|do|switch|case|default|break|continue|return|function|fun|fn|def|class|struct|enum|interface|type|const|let|var|static|public|private|protected|final|abstract|extends|implements|import|from|export|package|namespace|using|new|delete|try|catch|finally|throw|throws|async|await|yield|void|int|long|short|float|double|char|string|bool|boolean|byte|this|self|super|in|of|is|not|and|or|match|when|where|lambda|with|as|get|set|readonly|override|virtual|template|typename|typedef|sizeof)\b/,
  ),
  rule("number", /\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/),
  rule("variable", /\b[A-Za-z_]\w*(?=\s*\()/),
  rule("punctuation", /[{}[\]();,.:?=+\-*/%<>!&|^~]+/),
];

type NamedProfile = "html" | "css" | "javascript" | "python" | "shell" | "sql" | "yaml" | "generic";

const PROFILES: Record<NamedProfile, Profile> = {
  html: { rules: HTML, flags: "i" },
  css: { rules: CSS },
  javascript: { rules: JAVASCRIPT },
  python: { rules: PYTHON },
  shell: { rules: SHELL, flags: "m" },
  sql: { rules: SQL, flags: "i" },
  yaml: { rules: YAML, flags: "mi" },
  generic: { rules: GENERIC },
};

const ALIASES: Record<string, NamedProfile | "json" | "plain"> = {
  html: "html",
  htm: "html",
  xml: "html",
  svg: "html",
  vue: "html",
  svelte: "html",
  css: "css",
  scss: "css",
  sass: "css",
  less: "css",
  js: "javascript",
  javascript: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  ts: "javascript",
  typescript: "javascript",
  tsx: "javascript",
  json: "json",
  jsonc: "json",
  py: "python",
  python: "python",
  sh: "shell",
  bash: "shell",
  shell: "shell",
  zsh: "shell",
  console: "shell",
  terminal: "shell",
  sql: "sql",
  postgres: "sql",
  postgresql: "sql",
  mysql: "sql",
  sqlite: "sql",
  yaml: "yaml",
  yml: "yaml",
  text: "plain",
  txt: "plain",
  plain: "plain",
  output: "plain",
  log: "plain",
  markdown: "plain",
  md: "plain",
  diff: "plain",
  patch: "plain",
};

/** A plain token list for the whole source; no language means no colour. */
function plain(source: string): CodeToken[] {
  return source ? [{ kind: "plain", text: source }] : [];
}

function scan(source: string, profile: Profile): CodeToken[] {
  const pattern = new RegExp(
    profile.rules.map((entry) => `(${entry.pattern.source})`).join("|"),
    `g${profile.flags ?? ""}`,
  );
  const tokens: CodeToken[] = [];
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) tokens.push({ kind: "plain", text: source.slice(last, start) });
    let kind: CodeTokenKind = "plain";
    for (let index = 0; index < profile.rules.length; index += 1) {
      if (match[index + 1] !== undefined) {
        kind = profile.rules[index].kind;
        break;
      }
    }
    tokens.push({ kind, text: match[0] });
    last = start + match[0].length;
  }
  if (last < source.length) tokens.push({ kind: "plain", text: source.slice(last) });
  return tokens;
}

function fromJson(source: string): CodeToken[] {
  return tokenizeJson(source).map((token) => ({
    kind:
      token.kind === "key"
        ? "property"
        : token.kind === "string"
          ? "string"
          : token.kind === "number"
            ? "number"
            : token.kind === "literal"
              ? "literal"
              : token.kind === "punctuation"
                ? "punctuation"
                : "plain",
    text: token.text,
  }));
}

export function tokenizeCode(source: string, language: string): CodeToken[] {
  const key = language.trim().toLowerCase().replace(/^\./, "");
  if (!key) return plain(source);
  const profile = ALIASES[key];
  if (profile === "plain") return plain(source);
  if (profile === "json") return fromJson(source);
  return scan(source, PROFILES[profile ?? "generic"]);
}
