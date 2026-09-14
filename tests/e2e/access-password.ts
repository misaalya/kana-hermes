// Acceptance servers start from an empty data root, which has no password.
// Each Playwright config seeds this one through the real launcher command
// before the server starts, exactly as an operator would.
export const E2E_ACCESS_PASSWORD = "kana-e2e-access-password";

/** Shell prefix that stores the acceptance password, then runs `command`. */
export function withSeededPassword(command: string): string {
  return `printf '%s\\n' '${E2E_ACCESS_PASSWORD}' | node bin/kana.mjs password --stdin && ${command}`;
}
