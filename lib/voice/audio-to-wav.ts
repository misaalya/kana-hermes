// Client-side audio normalization for voice uploads. The Qwen service only
// accepts libsndfile-decodable containers (WAV/FLAC/OGG), while users naturally
// record or download MP3/M4A. The browser decodes nearly everything, so we
// convert any input to 16-bit PCM mono WAV before it leaves the page.

export const MAX_REFERENCE_SECONDS = 30;

export async function convertToWav(file: File): Promise<File> {
  if (/\.wav$/i.test(file.name) && file.type !== "audio/mpeg") {
    // Already a WAV container; pass through untouched.
    return file;
  }
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("Browser tidak mendukung konversi audio. Gunakan file WAV.");
  }
  const context = new AudioContextCtor();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const wav = encodeWavMono16(decoded);
    const baseName = file.name.replace(/\.[^.]+$/, "") || "voice";
    return new File([wav], `${baseName}.wav`, { type: "audio/wav" });
  } catch {
    throw new Error(
      "Audio tidak bisa dibaca browser. Gunakan WAV, atau format lain yang bisa diputar di sini.",
    );
  } finally {
    void context.close().catch(() => undefined);
  }
}

function encodeWavMono16(buffer: AudioBuffer): Blob {
  const sampleRate = buffer.sampleRate;
  const source = buffer.getChannelData(0);
  const maxSamples = Math.min(source.length, MAX_REFERENCE_SECONDS * sampleRate);

  const dataBytes = maxSamples * 2;
  const output = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(output);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let index = 0; index < maxSamples; index += 1) {
    const sample = Math.max(-1, Math.min(1, source[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([output], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
