/**
 * Hermes writes these texts when an API error, retry, or cancellation ends a
 * turn. They are control notices, not assistant prose, and must never become
 * a chat bubble in the live feed or a restored transcript.
 */
export function isInterruptionNotice(text: string): boolean {
  const value = text.trimStart();
  return value.startsWith("Operation interrupted:")
    || value.startsWith("Operation interrupted during retry");
}
