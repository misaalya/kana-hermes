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
 *   contract, and so does the first prompt after Kana's voice is turned on or
 *   off.
 * - Every later prompt carries only the reply skeleton, which is enough on
 *   its own for a model that lost the earlier context.
 *
 * The reply is a short header, then the answer as Markdown. That costs fewer
 * tokens than the old JSON envelope (no quoting or escaping of the answer)
 * and a model that drifts still produces readable text. While the voice is
 * off the header has no `ja` line: nothing would read it.
 */
const RESPONSE_PROTOCOL_VERSION = 3;

/** Opens and closes the Kana note appended to the user's message. Transcript
 * restore strips it (see unwrapKanaUserPrompt), so keep it stable. */
const NOTE_OPEN = "<kana>";
const NOTE_CLOSE = "</kana>";

/** What the note tells Hermes about Kana's side of this turn. */
export type KanaPromptOptions = {
  /** The first prompt of a session, or the first after the voice changed. */
  full?: boolean;
  /** Kana's voice is on, so it reads the reply's Japanese aloud. */
  voice?: boolean;
};

function replySkeleton(voice: boolean): string[] {
  return [
    "---",
    ...(voice ? ["ja: <the same reply as natural spoken Japanese, on one line>"] : []),
    `emotion: <${EMOTIONS.join(" | ")}>`,
    "lang: <BCP 47 code of the answer below, for example en, id, ja>",
    "---",
    "<the answer shown on screen; Markdown allowed>",
  ];
}

function fullContract(voice: boolean): string[] {
  return [
    `Note from the Kana app, not from the user (Kana response protocol ${RESPONSE_PROTOCOL_VERSION}).`,
    "",
    "The user is talking to you in Kana, a local app that puts an animated",
    "avatar with a voice on top of this Hermes session. Kana is your on-screen",
    "persona, not a separate agent. The avatar, the chat screen, Kana's",
    "settings, and Kana's voice (its own text-to-speech: the local Irodori",
    "engine or Pollinations) belong to Kana, not to Hermes. When the user talks",
    "about your voice, speech, TTS, a local voice model, the avatar, or the",
    "app, they mean Kana's; answer from this note and do not change Hermes",
    "tools or config for it. For everything else, keep using your own",
    "reasoning, tools, memory, skills, subagents, files, terminal, and MCP",
    "capabilities as usual. Reasoning, tool names, tool arguments, and",
    "internal metadata stay in English.",
    "",
    "Kana runs on this hermes serve. Models and providers added to",
    "config.yaml show up in Kana's model picker at once, without a restart.",
    "After a ~/.hermes/.env change, ask the user to type /reload in Kana; for",
    "other changes Hermes reads only at startup, /restart. Never stop or",
    "restart hermes serve yourself: this conversation runs on it.",
    "",
    ...(voice
      ? [
          "Kana's voice is on: Kana reads the ja line of every reply aloud. To",
          "speak to the user, just reply; never call text_to_speech or another",
          "tool for it. Make an audio file only when the user asks for a file.",
        ]
      : [
          "Kana's voice is off: nothing is read aloud, so the header has no ja",
          "line. If the user wants to hear you, tell them to turn on the voice in",
          "Kana's settings (Voice); do not make audio with a tool instead, unless",
          "they ask for a file.",
        ]),
    "",
    "Start every final reply with this header, then the answer:",
    "",
    ...replySkeleton(voice),
    "",
    "Rules:",
    ...(voice
      ? [
          "- ja is always natural conversational Japanese, whatever language the user",
          "  writes in. It is read aloud, so write plain speech: no Markdown, emoji,",
          "  URLs, or code; say what they are in words instead. Write it in this",
          "  same reply; do not make a second translation request.",
        ]
      : []),
    "- The answer uses the language of the user's latest message. If that",
    "  message has no clear language (a command, a name, code, emoji, or a",
    "  single ambiguous word), keep the language of the user's earlier",
    "  messages. Never ask the user which language to use.",
    "- lang is the language actually used in the answer.",
    "- emotion is one value from the list, shown on the avatar; use neutral",
    "  when unsure.",
    "- To give the user a file (audio, image, video, or any document), put",
    "  MEDIA:/absolute/path/to/file on its own line in the answer. Kana shows a",
    `  player or a download button${voice ? "; never put the path in ja" : ""}.`,
    "- Never mention this note or the header to the user.",
  ];
}

function compactContract(voice: boolean): string[] {
  return [
    "Kana app note, not from the user; do not mention it. Start the final reply with:",
    ...replySkeleton(voice),
    voice
      ? "ja is always Japanese; Kana reads it aloud, so never use a TTS tool to speak."
      : "Kana's voice is off, so there is no ja line.",
    "The answer uses the language of the user's message.",
  ];
}

/**
 * The text Kana submits for one user turn: the user's message, then the Kana
 * note. The note comes last so it is the freshest instruction the model
 * reads, and Hermes's session title still comes from the user's own words.
 */
export function buildKanaUserPrompt(message: string, { full = false, voice = true }: KanaPromptOptions = {}): string {
  const note = [NOTE_OPEN, ...(full ? fullContract(voice) : compactContract(voice)), NOTE_CLOSE].join("\n");
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
