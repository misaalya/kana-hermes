// Shared between Kana's relay route (server) and the Hermes relay client
// (browser), so a refused prompt is recognised as a decision instead of
// surfacing as a generic relay failure. Keep this module free of Node imports:
// the browser imports it.

/** A guardrail rule fired, so Kana refused to forward the prompt. */
export const PROMPT_GUARDRAIL_BLOCKED = "prompt_guardrail_blocked";
/** The guardrail could not run and its policy is to refuse rather than forward. */
export const PROMPT_GUARDRAIL_UNAVAILABLE = "prompt_guardrail_unavailable";

export type PromptGuardrailReason = "blocked" | "unavailable";

/**
 * Raised by the relay client when Kana's prompt guardrail refuses a turn.
 * The chat service answers it with Kana's own fixed wording, because no model
 * ever saw the message: a persona reply would be invented.
 */
export class PromptGuardrailError extends Error {
  constructor(
    readonly reason: PromptGuardrailReason,
    message: string,
  ) {
    super(message);
    this.name = "PromptGuardrailError";
  }
}

/** A JSON object, as every guardrail payload is expected to be. */
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}