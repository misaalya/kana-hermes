// Minimal RIFF/WAVE handling for joining the engine's per-sentence outputs.
// irodori-c writes 48 kHz mono PCM16; any other layout is rejected rather
// than concatenated into noise.

export type PcmWav = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  data: Uint8Array;
};

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export function parsePcmWav(buffer: Uint8Array): PcmWav {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buffer.byteLength < 12 || ascii(buffer, 0, 4) !== "RIFF" || ascii(buffer, 8, 4) !== "WAVE") {
    throw new Error("The voice engine did not produce a WAV file.");
  }
  let format: Omit<PcmWav, "data"> | null = null;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id = ascii(buffer, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > buffer.byteLength && id !== "data") break;
    if (id === "fmt ") {
      if (view.getUint16(body, true) !== 1) throw new Error("The voice engine produced non-PCM audio.");
      format = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!format) break;
      const end = Math.min(buffer.byteLength, body + size);
      return { ...format, data: buffer.subarray(body, end) };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("The voice engine produced an incomplete WAV file.");
}

export function encodePcmWav(format: Omit<PcmWav, "data">, data: Uint8Array): ArrayBuffer {
  const blockAlign = (format.channels * format.bitsPerSample) / 8;
  const output = new ArrayBuffer(44 + data.byteLength);
  const view = new DataView(output);
  const bytes = new Uint8Array(output);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + data.byteLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, format.channels, true);
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, format.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, format.bitsPerSample, true);
  write(36, "data");
  view.setUint32(40, data.byteLength, true);
  bytes.set(data, 44);
  return output;
}

/** Join same-format PCM WAVs with a short silence between parts. */
export function concatenatePcmWavs(parts: Uint8Array[], gapSeconds = 0.12): ArrayBuffer {
  if (parts.length === 0) throw new Error("There is no audio to join.");
  const parsed = parts.map(parsePcmWav);
  const [first] = parsed;
  for (const part of parsed) {
    if (
      part.sampleRate !== first.sampleRate ||
      part.channels !== first.channels ||
      part.bitsPerSample !== first.bitsPerSample
    ) {
      throw new Error("The voice engine produced parts with different audio formats.");
    }
  }
  if (parsed.length === 1) return encodePcmWav(first, first.data);
  const blockAlign = (first.channels * first.bitsPerSample) / 8;
  const gapBytes = Math.round(first.sampleRate * gapSeconds) * blockAlign;
  const total = parsed.reduce((sum, part) => sum + part.data.byteLength, 0) + gapBytes * (parsed.length - 1);
  const data = new Uint8Array(total);
  let offset = 0;
  parsed.forEach((part, index) => {
    data.set(part.data, offset);
    offset += part.data.byteLength;
    if (index < parsed.length - 1) offset += gapBytes;
  });
  return encodePcmWav(first, data);
}
