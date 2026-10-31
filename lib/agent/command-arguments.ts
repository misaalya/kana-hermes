/**
 * Hermes's command catalog carries each command's usage hint inside its
 * description, e.g. "Inject a message ... (usage: /steer <prompt>)". These
 * helpers read that live hint instead of keeping a second command list.
 */

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
