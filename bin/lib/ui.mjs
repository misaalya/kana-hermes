// Terminal presentation for the `kana` launcher: colour, symbols, boxes,
// spinners, and prompts. Dependency-free and degrades cleanly for pipes,
// NO_COLOR, TERM=dumb, and systemd journals.

import readline from "node:readline/promises";

const env = process.env;
const stdout = process.stdout;
const stderr = process.stderr;

const interactive = Boolean(stdout.isTTY) && env.TERM !== "dumb";
const colorEnabled = "NO_COLOR" in env
  ? false
  : env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0"
    ? true
    : interactive;
const unicode = env.TERM !== "dumb" && (process.platform !== "win32" || Boolean(env.WT_SESSION));

const paint = (open, close) => (text) =>
  colorEnabled ? `\x1b[${open}m${text}\x1b[${close}m` : String(text);

export const style = {
  bold: paint("1", "22"),
  dim: paint("2", "22"),
  italic: paint("3", "23"),
  red: paint("31", "39"),
  green: paint("32", "39"),
  yellow: paint("33", "39"),
  cyan: paint("36", "39"),
  // Kana's accent: a soft pink that stays readable on dark and light themes.
  accent: paint("38;5;211", "39"),
};

export const symbols = unicode
  ? { success: "✓", error: "✗", warning: "!", info: "●", pointer: "›", mark: "✻", bullet: "•" }
  : { success: "+", error: "x", warning: "!", info: "*", pointer: ">", mark: "*", bullet: "*" };

const border = unicode
  ? { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" }
  : { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" };

const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function visibleLength(text) {
  return [...String(text).replace(ANSI_PATTERN, "")].length;
}

function padEnd(text, width) {
  return `${text}${" ".repeat(Math.max(0, width - visibleLength(text)))}`;
}

export function print(line = "") {
  stdout.write(`${line}\n`);
}

export function printError(line = "") {
  stderr.write(`${line}\n`);
}

// A pipe closed early (`kana doctor | head`) is not an error worth a stack trace.
for (const stream of [stdout, stderr]) {
  stream.on("error", (error) => {
    if (error?.code === "EPIPE") process.exit(process.exitCode ?? 0);
    throw error;
  });
}

const STATUS_LABEL_WIDTH = 16;

function statusLine(symbol, label, detail) {
  if (!detail) return `  ${symbol} ${label}`;
  return `  ${symbol} ${padEnd(label, STATUS_LABEL_WIDTH)} ${style.dim(detail)}`;
}

export const status = {
  success: (label, detail = "") => print(statusLine(style.green(symbols.success), label, detail)),
  warning: (label, detail = "") => print(statusLine(style.yellow(symbols.warning), label, detail)),
  error: (label, detail = "") => printError(statusLine(style.red(symbols.error), label, detail)),
  info: (label, detail = "") => print(statusLine(style.dim(symbols.pointer), label, detail)),
};

/** Aligned `label  value` rows. */
export function keyValues(rows, indent = "  ") {
  const width = Math.max(...rows.map(([label]) => visibleLength(label)));
  return rows.map(([label, value]) => `${indent}${style.dim(padEnd(label, width))}  ${value}`);
}

/** A rounded box around lines, sized to content and the terminal width. */
export function box(lines, { title } = {}) {
  const columns = stdout.columns || 80;
  const inner = Math.min(
    Math.max(...lines.map(visibleLength), title ? visibleLength(title) + 2 : 0) + 2,
    Math.max(20, columns - 2),
  );
  const top = title
    ? `${border.tl}${border.h} ${title} ${border.h.repeat(Math.max(0, inner - visibleLength(title) - 3))}${border.tr}`
    : `${border.tl}${border.h.repeat(inner)}${border.tr}`;
  const body = lines.map(
    (line) => `${style.dim(border.v)} ${padEnd(line, inner - 2)} ${style.dim(border.v)}`,
  );
  return [style.dim(top), ...body, style.dim(`${border.bl}${border.h.repeat(inner)}${border.br}`)];
}

export function heading(text) {
  print();
  print(`${style.accent(symbols.mark)} ${style.bold(text)}`);
  print();
}

/** Shorten plain text in the middle so it fits `max` columns. */
export function truncateMiddle(text, max) {
  const characters = [...String(text)];
  if (characters.length <= max || max < 8) return String(text);
  const keep = max - 1;
  const head = Math.ceil(keep / 3);
  return `${characters.slice(0, head).join("")}…${characters.slice(characters.length - (keep - head)).join("")}`;
}

/** Room for a value inside a box row that starts with a label column. */
export function boxValueWidth(labelWidth) {
  return Math.max(20, (stdout.columns || 80) - labelWidth - 8);
}

/** Tildify a path under the user's home for compact display. */
export function displayPath(target, home = env.HOME) {
  if (!target) return target;
  return home && (target === home || target.startsWith(`${home}/`))
    ? `~${target.slice(home.length)}`
    : target;
}

/** A single-line spinner; prints plain progress lines when not interactive. */
export function spinner(text) {
  if (!interactive) {
    print(`  ${symbols.pointer} ${text}`);
    return {
      update() {},
      succeed: (message) => status.success(message ?? text),
      fail: (message) => status.error(message ?? text),
      stop() {},
    };
  }
  const frames = unicode ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] : ["-", "\\", "|", "/"];
  let index = 0;
  let current = text;
  const render = () => {
    stdout.write(`\r\x1b[2K  ${style.accent(frames[index])} ${current}`);
    index = (index + 1) % frames.length;
  };
  stdout.write("\x1b[?25l");
  render();
  const timer = setInterval(render, 80);
  const finish = (line) => {
    clearInterval(timer);
    stdout.write("\r\x1b[2K\x1b[?25h");
    line?.();
  };
  return {
    update(message) {
      current = message;
    },
    succeed: (message) => finish(() => status.success(message ?? current)),
    fail: (message) => finish(() => status.error(message ?? current)),
    stop: () => finish(),
  };
}

export class PromptCancelledError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "PromptCancelledError";
  }
}

export function canPrompt() {
  return Boolean(process.stdin.isTTY && stdout.isTTY);
}

// Keystrokes typed or pasted past the end of one prompt belong to the next.
let pendingKeys = "";

/** Reads a secret without echoing it (a dot per character). */
export function promptSecret(question) {
  const input = process.stdin;
  if (!canPrompt()) return Promise.reject(new Error("An interactive terminal is required."));
  stdout.write(`  ${style.accent(symbols.pointer)} ${question} `);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    let settled = false;
    const cleanup = () => {
      settled = true;
      input.off("data", onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      stdout.write("\n");
    };
    const onData = (chunk) => {
      // Ignore arrow keys and other escape sequences as a whole.
      if (chunk.startsWith("\x1b")) return;
      const characters = [...chunk];
      for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        if (character === "\r" || character === "\n") {
          const rest = characters.slice(index + 1).join("");
          pendingKeys = rest.startsWith("\n") && character === "\r" ? rest.slice(1) : rest;
          cleanup();
          resolve(value);
          return;
        }
        // Ctrl+C / Ctrl+D cancel.
        if (character === "\u0003" || character === "\u0004") {
          pendingKeys = "";
          cleanup();
          reject(new PromptCancelledError());
          return;
        }
        // Backspace / Delete.
        if (character === "\u007f" || character === "\b") {
          if (value) {
            value = [...value].slice(0, -1).join("");
            stdout.write("\b \b");
          }
          continue;
        }
        // Ctrl+U clears the line.
        if (character === "\u0015") {
          stdout.write("\b \b".repeat([...value].length));
          value = "";
          continue;
        }
        if (character < " ") continue;
        value += character;
        stdout.write(style.dim(symbols.bullet));
      }
    };
    input.on("data", onData);
    if (pendingKeys) {
      const keys = pendingKeys;
      pendingKeys = "";
      onData(keys);
    }
    if (!settled) input.resume();
  });
}

export async function promptConfirm(question, defaultValue = false) {
  if (!canPrompt()) return defaultValue;
  const prompt = readline.createInterface({ input: process.stdin, output: stdout });
  try {
    const hint = style.dim(defaultValue ? "[Y/n]" : "[y/N]");
    const answer = (await prompt.question(`  ${style.accent(symbols.pointer)} ${question} ${hint} `)).trim();
    return answer ? /^y(es)?$/i.test(answer) : defaultValue;
  } finally {
    prompt.close();
  }
}

/** The first line of piped standard input (for non-interactive automation). */
export async function readStdinLine() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/, 1)[0] ?? "";
}
