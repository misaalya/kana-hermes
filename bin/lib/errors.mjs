/** An expected launcher failure: printed as a message and hint, without a stack trace. */
export class LauncherError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = "LauncherError";
    this.hint = hint;
  }
}
