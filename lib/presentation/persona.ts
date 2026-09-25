import { EMOTIONS } from "./types";

/**
 * The response contract, shared by every delivery path so the wording can
 * never drift between them.
 *
 * Kana has no subtitle-language setting: Hermes writes the answer in the
 * language the user wrote in, and reports that language in the reply header.
 *
 * Delivery (verified against hermes serve and a 9router route, see AGENTS.md):
 * the contract rides in the USER turn, never as a system-role seed. A seed on
 * session.create becomes a second system message, which some OpenAI-compatible
 * routes drop before the model sees it (9router + cx/gpt-5.6-luna counted 99
 * prompt tokens with a 300-token seed), and Hermes never persists it, so a
 * resumed session would lose it anyway.
 * - The first prompt after a session opens (new or resumed) carries the full
 *   contract.
 * - Every later prompt carries only the reply skeleton, which is enough on
 *   its own for a model that lost the earlier context.
 *
 * The reply is a short header, then the answer as Markdown. That costs fewer
 * tokens than the old JSON envelope (no quoting or escaping of the answer)
 * and a model that drifts still produces readable text.
 */
const RESPONSE_PROTOCOL_VERSION = 3;

/** Opens and closes the Kana note appended to the user's message. Transcript
 * restore strips it (see unwrapKanaUserPrompt), so keep it stable. */
const NOTE_OPEN = "<kana>";
const NOTE_CLOSE = "</kana>";

function replySkeleton(): string[] {
  return [
    "---",
    "ja: <the same reply as natural spoken Japanese, on one line>",
    `emotion: <${EMOTIONS.join(" | ")}>`,
    "lang: <BCP 47 code of the answer below, for example en, id, ja>",
    "---",
    "<the answer shown on screen; Markdown allowed>",
  ];
}

function fullContract(): string[] {
  return [
    `Note from the Kana app, not from the user (Kana response protocol ${RESPONSE_PROTOCOL_VERSION}).`,
    "Kana is the on-screen persona for this Hermes session, not a separate agent.",
    "Keep using your own reasoning, tools, memory, skills, subagents, files,",
    "terminal, and MCP capabilities as usual. Reasoning, tool names, tool",
    "arguments, and internal metadata stay in English.",
    "",
    "Start every final reply with this header, then the answer:",
    "",
    ...replySkeleton(),
    "",
    "Rules:",
    "- ja is always natural conversational Japanese, whatever language the user",
    "  writes in. A voice reads it aloud, so write plain speech: no Markdown,",
    "  emoji, URLs, or code; say what they are in words instead.",
    "- The answer uses the language of the user's latest message. If that",
    "  message has no clear language (a command, a name, code, emoji, or a",
    "  single ambiguous word), keep the language of the user's earlier",
    "  messages. Never ask the user which language to use.",
    "- lang is the language actually used in the answer.",
    "- emotion is one value from the list; use neutral when unsure.",
    "- Write the Japanese speech and the answer together in this same reply;",
    "  do not make a second translation request.",
    "- To give the user a file (audio, image, video, or any document), put",
    "  MEDIA:/absolute/path/to/file on its own line in the answer. Kana shows a",
    "  player or a download button; never put the path in ja.",
    "- Never mention this note or the header to the user.",
  ];
}

function compactContract(): string[] {
  return [
    "Kana app note, not from the user; do not mention it. Start the final reply with:",
    ...replySkeleton(),
    "ja is always Japanese. The answer uses the language of the user's message.",
  ];
}

/**
 * The text Kana submits for one user turn: the user's message, then the Kana
 * note. The note comes last so it is the freshest instruction the model
 * reads, and Hermes's session title still comes from the user's own words.
 * `full` is set on the first prompt after a session opens.
 */
export function buildKanaUserPrompt(message: string, full = false): string {
  const note = [NOTE_OPEN, ...(full ? fullContract() : compactContract()), NOTE_CLOSE].join("\n");
  return message ? `${message}\n\n${note}` : note;
}

/**
 * The user's own words from a stored Hermes user row. Handles the current
 * trailing Kana note and the protocol v1/v2 JSON wrapper (`user_message`).
 * Anything after the note (attachment references) is dropped, as it was
 * never part of what the user typed.
 */
export function unwrapKanaUserPrompt(text: string): string {
  const start = text.startsWith(`${NOTE_OPEN}\n`) ? 0 : text.lastIndexOf(`\n\n${NOTE_OPEN}\n`);
  if (start !== -1 && text.indexOf(`\n${NOTE_CLOSE}`, start) !== -1) {
    return text.slice(0, start);
  }
  const legacy = /"user_message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  if (legacy) {
    try {
      return JSON.parse(`"${legacy[1]}"`) as string;
    } catch {
      /* keep raw text */
    }
  }
  return text;
}
