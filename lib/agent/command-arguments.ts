/**
 * Hermes's command catalog carries each command's usage hint inside its
 * description, e.g. "Inject a message ... (usage: /steer <prompt>)". These
 * helpers read that live hint instead of keeping a second command list.
 */

import type { AgentCommandSuggestion } from "@/lib/agent/types";

/** Command names compare case-insensitively, with Telegram's underscores folded to hyphens. */
export function normalizeCommandName(name: string): string {
  return `/${name.trim().replace(/^\/+/, "").toLowerCase().replaceAll("_", "-")}`;
}

/** The shortest candidate sharing a prefix with the typed token; ties keep menu order. */
export function nearestCommandToken(typed: string, candidates: string[]): string | null {
  const lower = typed.toLowerCase();
  let nearest: string | null = null;
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (!normalized.startsWith(lower) && !lower.startsWith(normalized)) continue;
    if (nearest === null || candidate.length < nearest.length) nearest = candidate;
  }
  return nearest;
}

/**
 * The first offered option sharing a prefix with the typed token. The menu
 * order is Hermes's own ranking, so the same row a user would see first is the
 * one Enter picks; command names keep the shortest-name rule instead.
 */
function nearestOfferedOption(typed: string, candidates: string[]): string | null {
  const lower = typed.toLowerCase();
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (normalized.startsWith(lower) || lower.startsWith(normalized)) return candidate;
  }
  return null;
}

const TYPED_ARGUMENT = /^\/([^\s/]+)(\s+)([^\s]+)([\s\S]*)$/;
const OFFERED_ARGUMENT = /^\/([^\s/]+)\s+([^\s]+)(?:\s|$)/;

/** Whether a suggestion offers an argument matching the first token already typed. */
export function suggestionArgumentMatches(input: string, suggestion: string): boolean {
  const typed = TYPED_ARGUMENT.exec(input.trim());
  const offered = OFFERED_ARGUMENT.exec(suggestion.trim());
  if (!typed || !offered) return false;
  if (normalizeCommandName(typed[1]) !== normalizeCommandName(offered[1])) return false;
  const token = typed[3].toLowerCase();
  const option = offered[2].toLowerCase();
  return option.startsWith(token) || token.startsWith(option);
}

/** Whether the menu has reached the argument stage for this command. */
export function hasOfferedArgument(input: string, suggestions: AgentCommandSuggestion[]): boolean {
  const typed = TYPED_ARGUMENT.exec(input.trim());
  if (!typed) return false;
  const command = normalizeCommandName(typed[1]);
  return suggestions.some((suggestion) => {
    const offered = OFFERED_ARGUMENT.exec(suggestion.text.trim());
    return Boolean(offered && normalizeCommandName(offered[1]) === command);
  });
}

/**
 * A leading slash command typed after blank lines belongs on the first line:
 * the slash menu only follows a draft that starts with `/`. Whitespace before
 * the slash is dropped only when it contains a newline and nothing else, so
 * text on an earlier line keeps the draft untouched.
 */
export function lineUpCommandDraft(input: string): string {
  const first = input.search(/\S/);
  if (first <= 0 || input[first] !== "/") return input;
  return input.slice(0, first).includes("\n") ? input.slice(first) : input;
}

/**
 * The first argument token resolved to the nearest option Hermes offered for
 * this command. Free-form arguments, later tokens, and unknown commands stay
 * exactly as typed; only a token with a prefix match is substituted.
 */
export function resolveTypedArguments(
  input: string,
  suggestions: AgentCommandSuggestion[],
): string {
  const typed = input.trim();
  const match = TYPED_ARGUMENT.exec(typed);
  if (!match) return typed;
  const [, name, gap, token, rest] = match;
  const command = normalizeCommandName(name);
  const options = new Map<string, string>();
  for (const suggestion of suggestions) {
    const offered = OFFERED_ARGUMENT.exec(suggestion.text.trim());
    if (!offered) continue;
    if (normalizeCommandName(offered[1]) !== command) continue;
    const option = offered[2];
    if (!options.has(option.toLowerCase())) options.set(option.toLowerCase(), option);
  }
  if (!options.size) return typed;
  if (options.has(token.toLowerCase())) return typed;
  const nearest = nearestOfferedOption(token, [...options.values()]);
  return nearest === null ? typed : `/${name}${gap}${nearest}${rest}`;
}

/** The argument hint for one command, or null when Hermes gave none. */
export function commandArgumentHint(command: string, description: string | undefined): string | null {
  if (!description) return null;
  const name = command.trim().replace(/^\/+/, "");
  if (!name) return null;
  const text = description.trim();
  if (!text.endsWith(")")) return null;
  const close = text.length - 1;
  const open = text.lastIndexOf("(", close - 1);
  if (open < 0) return null;
  const inner = text.slice(open + 1, close);
  // The command follows the localized "usage" label (or starts the group).
  // Requiring that position keeps an ordinary "(see /steer docs)" out.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[:：])\\s*\\/${escaped}\\s+(.+)$`).exec(inner);
  if (!match) return null;
  const hint = match[1].trim();
  return hint || null;
}

/**
 * A required placeholder is written in angle brackets. Placeholders inside an
 * optional group stay optional, so /queue's `[<prompt>|list]` can be sent bare.
 */
export function commandRequiresArgument(hint: string | null): boolean {
  if (!hint) return false;
  return /<[^>]+>/.test(hint.replace(/\[[^\]]*\]/g, ""));
}

/**
 * Commands Kana itself cannot run bare. Hermes marks /reasoning's effort as
 * optional because its slash worker can print a status line; Kana's reasoning
 * change goes through config.set, so a bare command has nothing to apply.
 */
const KANA_REQUIRED_ARGUMENTS: Readonly<Record<string, string>> = {
  "/reasoning": "[level|show|hide|full|clamp] [--global]",
};

export function commandArgumentPolicy(
  command: string,
  hint: string | null,
): { hint: string | null; required: boolean } {
  const fallback = kanaRequiredArgumentHint(command);
  if (fallback !== undefined) {
    return { hint: hint ?? fallback, required: true };
  }
  return { hint, required: commandRequiresArgument(hint) };
}

/** The fallback used when the live completion map has not seen the command yet. */
export function kanaRequiredArgumentHint(command: string): string | undefined {
  const normalized = command.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(KANA_REQUIRED_ARGUMENTS, normalized)
    ? KANA_REQUIRED_ARGUMENTS[normalized]
    : undefined;
}
