import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { readJsonObject } from "@/lib/server/request-body";
import { hermesRpc } from "@/lib/server/hermes-bridge";
import { LONG_HERMES_RPC_TIMEOUT_MS } from "@/lib/limits";
import { rewriteMediaInResult } from "@/lib/server/media-links";
import {
  PROMPT_GUARDRAIL_BLOCKED,
  PROMPT_GUARDRAIL_UNAVAILABLE,
} from "@/lib/guardrails/protocol";
import { screenPrompt, type GuardrailOutcome } from "@/lib/guardrails/screen";
import { loadGuardrailRules } from "@/lib/guardrails/policy";
import { unwrapKanaUserPrompt, withKanaRules } from "@/lib/presentation/persona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relay a single JSON-RPC request from the browser to the managed Hermes
// gateway. The browser authenticates with its Kana session cookie; the Hermes
// session token stays server-side inside the bridge.
//
// Only the JSON-RPC surface Kana needs is forwarded. Allow-listing methods
// keeps the relay a presentation-layer bridge, not an open pipe to Hermes's
// full control plane.

const ALLOWED_METHODS = new Set([
  "session.create",
  "session.resume",
  "session.close",
  "session.interrupt",
  "session.title",
  "session.branch",
  "session.save",
  "session.history",
  "session.status",
  "session.compress",
  "session.steer",
  "prompt.submit",
  "commands.catalog",
  "complete.slash",
  "model.options",
  "config.set",
  "slash.exec",
  "command.dispatch",
  "approval.respond",
  "clarify.respond",
  "sudo.respond",
  "secret.respond",
  "handoff.request",
  // /reload, /reload-mcp, /reload-skills: they act on the gateway process,
  // as in Hermes's TUI; slash.exec would reload only its command worker.
  "reload.env",
  "reload.mcp",
  "skills.reload",
]);

const LONG_RUNNING_METHODS = new Set(["session.compress", "model.options", "reload.mcp"]);

const MAX_BODY_BYTES = 2 * 1024 * 1024;

type Refusal = Extract<GuardrailOutcome, { verdict: "refuse" }>;

/**
 * The user's own text in a relayed method, without any of Kana's own framing,
 * or null when the method carries no user-written text. A slash command counts:
 * its arguments reach the same Hermes turn as a chat message.
 */
function userText(method: string, params: Record<string, unknown>): string | null {
  if (method === "prompt.submit" || method === "session.steer") {
    // The Kana response note rides in the user turn; the rule judges what the
    // user typed, not Kana's own boilerplate.
    return typeof params.text === "string" ? unwrapKanaUserPrompt(params.text) : null;
  }
  if (method === "slash.exec") {
    return typeof params.command === "string" ? params.command : null;
  }
  if (method === "command.dispatch") {
    if (typeof params.name !== "string") return null;
    const arg = typeof params.arg === "string" ? params.arg.trim() : "";
    return arg ? `/${params.name} ${arg}` : `/${params.name}`;
  }
  return null;
}

/**
 * Refuse a turn without forwarding it. The browser turns these codes back into
 * Kana's own fixed wording; the message here is for an operator reading the
 * network panel or the log.
 */
function guardrailRefusal(outcome: Refusal): Response {
  const blocked = outcome.kind === "blocked";
  return Response.json(
    {
      error: blocked
        ? "Kana's prompt guardrail refused this turn."
        : `Kana's prompt guardrail could not check this turn: ${outcome.reason}`,
      code: blocked ? PROMPT_GUARDRAIL_BLOCKED : PROMPT_GUARDRAIL_UNAVAILABLE,
    },
    { status: blocked ? 403 : 503, headers: NO_STORE },
  );
}

export const POST = withSession(async (request) => {
  let body: { method?: unknown; params?: unknown };
  try {
    body = await readJsonObject(request, MAX_BODY_BYTES);
  } catch (error) {
    return jsonError(error);
  }
  const method = body.method;
  if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
    return Response.json({ error: "Unsupported Hermes method." }, { status: 400, headers: NO_STORE });
  }
  let params =
    body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? (body.params as Record<string, unknown>)
      : {};
  if (method === "config.set") {
    if (
      params.key !== "model" ||
      typeof params.session_id !== "string" ||
      typeof params.value !== "string" ||
      !params.value.trim() ||
      params.value.length > 2_000 ||
      !/(^|\s)--provider(\s|$)/.test(params.value) ||
      !/(^|\s)--session(\s|$)/.test(params.value) ||
      /(^|\s)--(?:global|once)(\s|$)/.test(params.value)
    ) {
      return Response.json(
        { error: "Only a session-scoped Hermes model selection is supported." },
        { status: 400, headers: NO_STORE },
      );
    }
    params = {
      session_id: params.session_id,
      key: "model",
      value: params.value,
      confirm_expensive_model: params.confirm_expensive_model === true,
    };
  }
  const timeoutMs = LONG_RUNNING_METHODS.has(method) ? LONG_HERMES_RPC_TIMEOUT_MS : undefined;
  // Kana screens what the user wrote before it reaches Hermes. The guardrail
  // only reads the text and answers allow or refuse; Hermes still owns the turn.
  const screenable = userText(method, params);
  if (screenable !== null) {
    const outcome = await screenPrompt(screenable);
    if (outcome.verdict === "refuse") return guardrailRefusal(outcome);
  }
  if (method === "prompt.submit" && typeof params.text === "string") {
    // The owner's rules ride in Kana's note on every prompt turn, read here so
    // a new rule applies to the next message. Screening above is the
    // enforcement; this is the same policy stated to the model.
    const rules = loadGuardrailRules();
    if (rules.length) params = { ...params, text: withKanaRules(params.text, rules) };
  }
  try {
    // Restored transcripts carry the same signed media links as live events.
    const result = rewriteMediaInResult(await hermesRpc(method, params, timeoutMs));
    return Response.json({ result }, { headers: NO_STORE });
  } catch (error) {
    return jsonError(error, 502);
  }
});
