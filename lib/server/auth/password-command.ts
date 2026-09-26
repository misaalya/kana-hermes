/** The launcher's commands (`passwordCommand` in bin/lib/context.mjs). */
const COMMANDS = ["kana password", "npm run password", "node bin/kana.mjs password"] as const;

export type PasswordCommand = (typeof COMMANDS)[number];

/**
 * The command that sets the access password on this install, for the login
 * page to show until one exists. The `kana` launcher says which kind of
 * install it started (KANA_PASSWORD_COMMAND); a server started without it
 * (`npm run dev`, `npm start`) is a source checkout. Any other value is
 * ignored, so the public status route can only ever name one of the three.
 */
export function passwordCommand(env: Record<string, string | undefined> = process.env): PasswordCommand {
  const value = env.KANA_PASSWORD_COMMAND?.trim();
  return COMMANDS.find((command) => command === value) ?? "npm run password";
}
