/**
 * Strip the response envelope from a partial assistant stream.
 *
 * Focus mode with the voice off does not display speech, emotion, or a
 * subtitle language, so the answer body can appear while Hermes is still
 * streaming it. The complete payload remains authoritative: the final
 * message is parsed and committed from `message.complete` as before.
 */
export function streamReplyPreview(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n");
  const start = text.replace(/^\s+/, "");
  if (!start) return "";
  // Hold the preview while the stream may still be the opening delimiter.
  if (start.length < 4 && "---\n".startsWith(start)) return "";
  // A protocol 2 JSON envelope has no readable body until it is complete.
  if (start.startsWith("{")) return "";
  // A plain reply without an envelope can stream from its first character.
  if (!start.startsWith("---\n")) return start;
  const close = start.indexOf("\n---\n", 4);
  if (close === -1) return "";
  return start.slice(close + 5);
}
