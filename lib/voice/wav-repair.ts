/**
 * The speech relay answers with a WAV head before a slow engine finishes so a
 * proxy cannot time out; that head cannot know the final sizes. Restore them
 * from the received length before decoding.
 */
export function repairOpenWavSizes(buffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 44) return buffer;
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(36) !== "data") return buffer;
  const view = new DataView(buffer);
  view.setUint32(4, buffer.byteLength - 8, true);
  view.setUint32(40, buffer.byteLength - 44, true);
  return buffer;
}
