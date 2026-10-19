import { screenWithJev } from "./jev";
import { loadGuardrailConfig, type KanaGuardrailUnavailableAction } from "./policy";

/**
 * Kana's prompt guardrail: the check that runs before a user's own text is
 * forwarded to Hermes.
 *
 * What it can do: read the text of one turn and decide allow or refuse. What it
 * cannot do: stop Hermes from reaching the same thing by another route, or
 * screen an answer the user gives mid-turn. It is an intent filter on Kana's
 * own forwarding path, not a sandbox around Hermes.
 *
 * The policy is the owner's, read from config.json, which Kana never writes.
 */

export type GuardrailOutcome =
  | { verdict: "allow" }
  | { verdict: "refuse"; kind: "blocked" }
  | { verdict: "refuse"; kind: "unavailable"; reason: string };

function unavailableOutcome(
  action: KanaGuardrailUnavailableAction,
  reason: string,
): GuardrailOutcome {
  return action === "allow" ? { verdict: "allow" } : { verdict: "refuse", kind: "unavailable", reason };
}

/**
 * Screen one turn's text. Never throws: a guardrail that cannot run follows the
 * owner's `whenUnavailable`, which defaults to refusing rather than forwarding
 * an unchecked prompt.
 */
export async function screenPrompt(text: string): Promise<GuardrailOutcome> {
  // Nothing was typed, so there is nothing to judge and no request to spend.
  if (!text.trim()) return { verdict: "allow" };

  const load = loadGuardrailConfig();
  if (load.kind === "disabled") return { verdict: "allow" };
  if (load.kind === "invalid") {
    return unavailableOutcome(
      load.whenUnavailable,
      `the guardrails block in config.json could not be used: ${load.error}`,
    );
  }

  const policy = load.policy;
  const screening = await screenWithJev(policy, text);
  if (screening.status === "unavailable") {
    return unavailableOutcome(policy.whenUnavailable, screening.reason);
  }
  // One question over the owner's rules, so one number to threshold. The
  // threshold is Kana's, not Jev's: Jev reports a probability and never decides.
  if (screening.probability >= policy.threshold) return { verdict: "refuse", kind: "blocked" };
  return { verdict: "allow" };
}