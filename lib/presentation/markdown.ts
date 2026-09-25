/**
 * A small Markdown reader for Hermes replies: the subset chat models write
 * (paragraphs, headings, lists, quotes, code, tables, emphasis, links). It
 * returns a plain tree that the chat renders as React elements, so no reply
 * text is ever treated as HTML. Links are kept only for http(s) and mailto;
 * any other target renders as its label. Anything it does not recognize
 * stays literal text.
 */

export type MarkdownInline =
  | { type: "text"; text: string }
  | { type: "strong" | "em" | "del"; children: MarkdownInline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: MarkdownInline[] }
  | { type: "break" };

export type MarkdownAlign = "left" | "center" | "right" | null;

export type MarkdownBlock =
  | { type: "paragraph"; children: MarkdownInline[] }
  | { type: "heading"; level: number; children: MarkdownInline[] }
  | { type: "code"; language: string; text: string }
  | { type: "list"; ordered: boolean; start: number; items: MarkdownBlock[][] }
  | { type: "quote"; children: MarkdownBlock[] }
  | { type: "rule" }
  | { type: "table"; align: MarkdownAlign[]; head: MarkdownInline[][]; rows: MarkdownInline[][][] };

export function parseMarkdown(source: string): MarkdownBlock[] {
  return parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
}

// ------------------------------------------------------------------ blocks

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

type ListItem = { indent: number; ordered: boolean; number: number; contentIndent: number; text: string };

function listItem(line: string): ListItem | null {
  const match = LIST_ITEM.exec(line);
  if (!match) return null;
  const [, lead, marker, gap, text] = match;
  const indent = lead.replace(/\t/g, "    ").length;
  const ordered = /\d/.test(marker);
  return {
    indent,
    ordered,
    number: ordered ? Number.parseInt(marker, 10) : 1,
    contentIndent: indent + marker.length + Math.min(gap.length, 4),
    text,
  };
}

function leadingSpaces(line: string): number {
  return /^\s*/.exec(line.replace(/\t/g, "    "))?.[0].length ?? 0;
}

function isTableStart(lines: string[], index: number): boolean {
  const divider = lines[index + 1];
  return lines[index].includes("|") && divider !== undefined && divider.includes("|") && divider.includes("-") && TABLE_DIVIDER.test(divider);
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || listItem(line) !== null || isTableStart(lines, index);
}

function parseBlocks(lines: string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) body.push(lines[index++]);
      index += 1;
      blocks.push({ type: "code", language: fence[2], text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, children: parseInline(heading[2]) });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) body.push(lines[index++].replace(/^ {0,3}> ?/, ""));
      blocks.push({ type: "quote", children: parseBlocks(body) });
      continue;
    }

    if (isTableStart(lines, index)) {
      const align = splitRow(lines[index + 1]).map((cell): MarkdownAlign =>
        cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : null,
      );
      const head = splitRow(line).map((cell) => parseInline(cell));
      const rows: MarkdownInline[][][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitRow(lines[index++]).map((cell) => parseInline(cell)));
      }
      blocks.push({ type: "table", align, head, rows });
      continue;
    }

    if (listItem(line)) {
      const [list, next] = parseList(lines, index);
      blocks.push(list);
      index = next;
      continue;
    }

    // A paragraph runs until a blank line or the start of another block.
    const body = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) body.push(lines[index++].trim());
    blocks.push({ type: "paragraph", children: parseInline(body.join("\n")) });
  }
  return blocks;
}

function parseList(lines: string[], start: number): [MarkdownBlock, number] {
  const first = listItem(lines[start])!;
  const items: MarkdownBlock[][] = [];
  let index = start;
  while (index < lines.length) {
    // Blank lines between items of the same list keep the list going.
    let next = index;
    while (next < lines.length && !lines[next].trim()) next += 1;
    const item = next < lines.length ? listItem(lines[next]) : null;
    if (!item || item.indent !== first.indent || item.ordered !== first.ordered) break;
    index = next + 1;
    const body = [item.text];
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        let after = index + 1;
        while (after < lines.length && !lines[after].trim()) after += 1;
        if (after < lines.length && leadingSpaces(lines[after]) > first.indent && !listItemAtOrBelow(lines[after], first.indent)) {
          body.push("");
          index += 1;
          continue;
        }
        break;
      }
      if (listItemAtOrBelow(line, first.indent)) break;
      if (leadingSpaces(line) > first.indent) {
        body.push(line.replace(/\t/g, "    ").slice(Math.min(leadingSpaces(line), item.contentIndent)));
        index += 1;
        continue;
      }
      if (startsBlock(lines, index)) break;
      // A lazy continuation line of the item's paragraph.
      body.push(line.trim());
      index += 1;
    }
    items.push(parseBlocks(body));
  }
  return [{ type: "list", ordered: first.ordered, start: first.number, items }, index];
}

function listItemAtOrBelow(line: string, indent: number): boolean {
  const item = listItem(line);
  return item !== null && item.indent <= indent;
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  const trimmed = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

// ------------------------------------------------------------------ inline

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~<>]/;
const WORD = /[\p{L}\p{N}]/u;
const BARE_URL = /^https?:\/\/[^\s<>]+/i;

/** Only web and mail links survive; the rest render as their label. */
export function safeHref(raw: string): string | null {
  const href = raw.trim().replace(/^<|>$/g, "");
  if (!/^(?:https?:\/\/|mailto:)/i.test(href)) return null;
  try {
    return new URL(href).href;
  } catch {
    return null;
  }
}

/** Trailing punctuation belongs to the sentence, not the URL. */
function trimUrl(url: string): string {
  let end = url.length;
  while (end > 0) {
    const char = url[end - 1];
    if (/[.,;:!?'"*_]/.test(char)) {
      end -= 1;
    } else if (char === ")" || char === "]") {
      const open = char === ")" ? "(" : "[";
      const body = url.slice(0, end);
      if (body.split(open).length - 1 < body.split(char).length - 1) end -= 1;
      else break;
    } else {
      break;
    }
  }
  return url.slice(0, end);
}

/** `[label](target)` starting at `start`, with nested brackets and parens. */
function readLink(text: string, start: number): { label: string; target: string; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") index += 1;
    else if (char === "[") depth += 1;
    else if (char === "]" && --depth === 0) {
      close = index;
      break;
    }
  }
  if (close === -1 || text[close + 1] !== "(") return null;
  let parens = 0;
  for (let index = close + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\n") return null;
    if (char === "(") parens += 1;
    else if (char === ")" && --parens === 0) {
      // Drop an optional "title" after the target.
      const target = text.slice(close + 2, index).trim().replace(/\s+(?:"[^"]*"|'[^']*')$/, "");
      return { label: text.slice(start + 1, close), target, end: index + 1 };
    }
  }
  return null;
}

const DELIMITERS = ["***", "___", "**", "__", "~~", "*", "_"] as const;

/** Emphasis opening at `start`: the closing run must match and hug the text. */
function readEmphasis(text: string, start: number): { delimiter: string; inner: string; end: number } | null {
  for (const delimiter of DELIMITERS) {
    if (!text.startsWith(delimiter, start)) continue;
    const char = delimiter[0];
    const after = text[start + delimiter.length];
    if (!after || /\s/.test(after) || after === char) continue;
    // Underscores inside words (snake_case) are never emphasis.
    if (char === "_" && start > 0 && WORD.test(text[start - 1])) continue;
    for (let index = start + delimiter.length + 1; index <= text.length - delimiter.length; index += 1) {
      if (text[index] === "`") {
        const run = /^`+/.exec(text.slice(index))![0];
        const skip = text.indexOf(run, index + run.length);
        if (skip !== -1) index = skip + run.length - 1;
        continue;
      }
      if (!text.startsWith(delimiter, index)) continue;
      // A single * or _ must not close on part of a longer run.
      let run = 0;
      while (text[index + run] === char) run += 1;
      if (run > delimiter.length && delimiter.length === 1) {
        index += run - 1;
        continue;
      }
      if (/\s/.test(text[index - 1])) continue;
      if (char === "_" && WORD.test(text[index + delimiter.length] ?? "")) continue;
      return { delimiter, inner: text.slice(start + delimiter.length, index), end: index + delimiter.length };
    }
  }
  return null;
}

/** `links` is false inside a link's label: links never nest. */
export function parseInline(text: string, links = true): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) nodes.push({ type: "text", text: buffer });
    buffer = "";
  };
  const push = (node: MarkdownInline) => {
    flush();
    nodes.push(node);
  };

  let index = 0;
  while (index < text.length) {
    const char = text[index];

    if (char === "\\" && ESCAPABLE.test(text[index + 1] ?? "")) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }

    if (char === "\n") {
      push({ type: "break" });
      index += 1;
      continue;
    }

    if (char === "`") {
      const run = /^`+/.exec(text.slice(index))![0];
      const close = text.indexOf(run, index + run.length);
      if (close !== -1) {
        const code = text.slice(index + run.length, close);
        push({ type: "code", text: /^ .* $/.test(code) ? code.slice(1, -1) : code });
        index = close + run.length;
        continue;
      }
      buffer += run;
      index += run.length;
      continue;
    }

    const image = char === "!" && text[index + 1] === "[";
    if (char === "[" || image) {
      // Images become links too: Kana never loads remote pictures into chat.
      const link = readLink(text, image ? index + 1 : index);
      if (link) {
        const href = links ? safeHref(link.target) : null;
        const children = parseInline(link.label, false);
        if (href) push({ type: "link", href, children });
        else {
          flush();
          nodes.push(...children);
        }
        index = link.end;
        continue;
      }
    }

    if (char === "<" && links) {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(text.slice(index));
      const href = auto ? safeHref(auto[1]) : null;
      if (auto && href) {
        push({ type: "link", href, children: [{ type: "text", text: auto[1] }] });
        index += auto[0].length;
        continue;
      }
    }

    if (links && (char === "h" || char === "H") && (index === 0 || !WORD.test(text[index - 1]))) {
      const bare = BARE_URL.exec(text.slice(index));
      if (bare) {
        const url = trimUrl(bare[0]);
        const href = safeHref(url);
        if (href) {
          push({ type: "link", href, children: [{ type: "text", text: url }] });
          index += url.length;
          continue;
        }
      }
    }

    if (char === "*" || char === "_" || char === "~") {
      const emphasis = readEmphasis(text, index);
      if (emphasis) {
        const inner = parseInline(emphasis.inner, links);
        const { delimiter } = emphasis;
        push(
          delimiter.length === 3
            ? { type: "strong", children: [{ type: "em", children: inner }] }
            : { type: delimiter === "~~" ? "del" : delimiter.length === 2 ? "strong" : "em", children: inner },
        );
        index = emphasis.end;
        continue;
      }
      // Keep an unmatched run together so its parts are not retried.
      const run = /^([*_~])\1*/.exec(text.slice(index))![0];
      buffer += run;
      index += run.length;
      continue;
    }

    buffer += char;
    index += 1;
  }
  flush();
  return nodes;
}
