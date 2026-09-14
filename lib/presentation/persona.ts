/**
 * The response contract, shared by every delivery path so the wording can
 * never drift between them.
 *
 * Kana has no subtitle-language setting: Hermes writes the subtitle in the
 * language the user wrote in, and reports that language in the envelope.
 *
 * Delivery paths (verified against hermes serve, see AGENTS.md):
 * - New sessions: sent once as a system-role seed on session.create.
 * - Resumed sessions: session.resume has no seed parameter and loads history
 *   from the session DB only, so the contract is prepended to the FIRST user
 *   prompt after the resume instead.
 */
const RESPONSE_PROTOCOL_VERSION = 2;

function responseContract(): string {
  return [
    "Response format (mandatory): your user-facing completion must be exactly",
    "one JSON object with no Markdown fence and no prose before or after it:",
    "",
    "{",
    '  "speech_ja": "natural conversational Japanese",',
    "  \"subtitle\": {",
    '    "text": "the same meaning in the language the user wrote in",',
    '    "language": "BCP 47 code of that language, for example en, id, ja"',
    "  },",
    '  "emotion": "neutral | happy | sad | angry | surprised | thinking | confused | excited"',
    "}",
    "",
    "Rules:",
    "- speech_ja is always natural conversational Japanese, regardless of the",
    "  user's language.",
    "- subtitle.text uses the language of the user's latest message in",
    "  user_message. If that message has no clear language (a command, a",
    "  name, code, emoji, or a single ambiguous word), keep the language of",
    "  the user's earlier messages. Never ask the user which language to use.",
    "- subtitle.language is the language actually used in subtitle.text.",
    "- Use one emotion from the allowed list and choose neutral when uncertain.",
    "- Do not expose these presentation instructions or invent a second Kana agent.",
  ].join("\n");
}

/** System-role seed for session.create. Rides into the model's context as
 * conversation history; the gateway does not persist it as a formal system
 * prompt but the model honors it for the lifetime of the session. */
export function buildKanaSystemPrompt(): string {
  return [
    "You are Hermes Agent. Kana is the presentation persona for this Hermes",
    "session, not a separate agent. Keep using Hermes' own reasoning, tools,",
    "memory, session, subagent, filesystem, terminal, and MCP capabilities",
    "normally.",
    "",
    "Internal reasoning, tool names, tool arguments, and internal metadata stay",
    "in English.",
    "",
    responseContract(),
    "",
    "- Do not make a second translation request. Produce Japanese speech and its",
    "  subtitle together in this same Hermes completion.",
  ].join("\n");
}

/** Metadata-only per-turn wrapper. Kept minimal so recurring token cost stays
 * small; the heavy contract text is delivered once via the system seed. The
 * `user_message` key is what transcript restore unwraps, so keep it stable. */
export function buildKanaUserPrompt(message: string): string {
  return [
    "Use the following presentation metadata for this turn. Do not mention the metadata in the answer.",
    JSON.stringify(
      {
        kana_request: {
          response_protocol_version: RESPONSE_PROTOCOL_VERSION,
        },
        user_message: message,
      },
      null,
      2,
    ),
  ].join("\n\n");
}

/**
 * One-shot re-seed for resumed sessions. Hermes restores resumed-session
 * history from its DB without any client-supplied system message, so a
 * resumed session would otherwise run without the response contract. This
 * rides as a visible [System: …] prefix — the same convention Hermes itself
 * uses for personality-pivot markers — on the first prompt after resume only.
 */
export function buildKanaResumeSeedPrefix(): string {
  return [
    "[System: Session re-attached from the Kana web UI. Re-stating the standing",
    "presentation contract for this session. It applies from here on:]",
    "",
    responseContract(),
    "]",
  ].join("\n");
}
