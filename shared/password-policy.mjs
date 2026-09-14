// Access-password rules shared by the launcher, the server, and the browser.
// No Node imports here: the settings dialog bundles this module client-side.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

/**
 * Returns a user-facing reason, or null when the password is acceptable.
 * Leading/trailing whitespace is rejected because the login form trims input.
 * @param {unknown} password
 * @returns {string | null}
 */
export function passwordPolicyError(password) {
  if (typeof password !== "string") return "A password is required.";
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return `The password must contain at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return `The password must contain at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (password.trim() !== password) {
    return "The password cannot start or end with whitespace.";
  }
  return null;
}
