import { isJsonRecord } from "./protocol";
import { buildGuardrailRequest, GUARDRAIL_QUESTION_ID } from "./prompt";
import type { GuardrailPolicy } from "./policy";

/**
 * The TypeSafe System One adapter, shaped after that service's own documented
 * API (https://docs.typesafe.ai/api): one POST evaluates one `state` against a
 * `questions` map and returns one typed answer per question.
 *
 * Jev is not a language model: it returns a typed judgment, so Kana asks one
 * `noul` question about the owner's rules and compares the probability against
 * its own threshold in code. Kana never asks Jev to produce text.
 */

export const TYPESAFE_SYSTEMONE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const PROVIDER_NAME = "TypeSafe";
/** A provider error body is untrusted input; never read more than this. */
const MAX_ERROR_BYTES = 8 * 1024;
const MAX_ERROR_DETAIL_CHARACTERS = 300;

export type JevScreening =
  | { status: "checked"; probability: number }
  | { status: "unavailable"; reason: string };

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function statusReason(status: number): string {
  if (status === 401) return `${PROVIDER_NAME} rejected Kana's API key.`;
  if (status === 429) return `${PROVIDER_NAME} rate-limited Kana.`;
  if (status === 529) return `${PROVIDER_NAME} is overloaded.`;
  return `${PROVIDER_NAME} returned HTTP ${status}.`;
}

/** Read a bounded detail line from an error body, with the key redacted. */
async function errorDetail(response: Response, apiKey: string): Promise<string> {
  try {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_ERROR_BYTES) return "";
    const body = (await response.text()).slice(0, MAX_ERROR_BYTES);
    const parsed: unknown = JSON.parse(body);
    let detail = "";
    if (isJsonRecord(parsed)) {
      if (typeof parsed.detail === "string") detail = parsed.detail;
      else if (typeof parsed.error === "string") detail = parsed.error;
      else if (isJsonRecord(parsed.error) && typeof parsed.error.message === "string") {
        detail = parsed.error.message;
      }
    }
    if (!detail) return "";
    const clean = detail
      .replaceAll(/\s+/g, " ")
      .replaceAll(apiKey, "[REDACTED]")
      .slice(0, MAX_ERROR_DETAIL_CHARACTERS);
    return clean ? ` ${clean}` : "";
  } catch {
    // Plain text, HTML, or malformed JSON: never reflect an untrusted body.
    return "";
  }
}

/**
 * Screen one piece of text against the policy's rules. Every failure is a
 * returned "unavailable", never a thrown error: the caller decides what an
 * unchecked prompt means.
 */
export async function screenWithJev(
  policy: GuardrailPolicy,
  state: string,
  detached?: AbortSignal,
): Promise<JevScreening> {
  const timeout = AbortSignal.timeout(policy.timeoutMs);
  const signal = detached ? AbortSignal.any([detached, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(TYPESAFE_SYSTEMONE_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${policy.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: policy.model,
        ...buildGuardrailRequest(policy.rules, state),
      }),
      signal,
      cache: "no-store",
      redirect: "error",
    });
  } catch (error) {
    if (timeout.aborted) {
      return {
        status: "unavailable",
        reason: `${PROVIDER_NAME} did not answer within ${Math.round(policy.timeoutMs / 1_000)} seconds.`,
      };
    }
    return { status: "unavailable", reason: `Kana could not reach ${PROVIDER_NAME}: ${describeError(error)}` };
  }

  if (!response.ok) {
    return {
      status: "unavailable",
      reason: `${statusReason(response.status)}${await errorDetail(response, policy.apiKey)}`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "unavailable", reason: `${PROVIDER_NAME} returned a response Kana could not read.` };
  }
  const answers = isJsonRecord(body) ? body.answers : undefined;
  if (!isJsonRecord(answers)) {
    return { status: "unavailable", reason: `${PROVIDER_NAME} returned no answer.` };
  }

  // A missing or malformed answer is never a pass: Kana cannot claim the rule
  // was checked, so the whole screening is unavailable.
  const answer = answers[GUARDRAIL_QUESTION_ID];
  const value = isJsonRecord(answer) && answer.type === "noul" ? answer.noul : undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    return {
      status: "unavailable",
      reason: `${PROVIDER_NAME} did not answer the guardrail question.`,
    };
  }
  return { status: "checked", probability: value };
}