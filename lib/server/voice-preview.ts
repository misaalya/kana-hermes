import fs from "node:fs";
import path from "node:path";
import { listLibraryVoices, referenceForVoice } from "@/lib/server/voice-library";

/**
 * The developer-prepared sample for the model's own voice lives beside the
 * reference WAVs. It was generated once with the pinned Irodori model from the
 * greeting "こんにちは、カナです。" so a user's play button never runs the model
 * or waits for synthesis. Every other voice previews the reference it has.
 */
const PREVIEW_ASSET_DIRECTORY = "assets/voices";

export class VoicePreviewNotFoundError extends Error {
  readonly status = 404;

  constructor(message = "Voice preview is not available.") {
    super(message);
    this.name = "VoicePreviewNotFoundError";
  }
}

function preparedPreviewPath(voiceId: string): string | null {
  if (!/^[A-Za-z0-9._-]+$/.test(voiceId)) return null;
  const relative = `${PREVIEW_ASSET_DIRECTORY}/${voiceId}.wav`;
  const candidates: string[] = [];
  try {
    if (typeof __dirname === "string" && __dirname) {
      candidates.push(path.resolve(__dirname, "../../", relative));
    }
  } catch {
    // ESM context without __dirname.
  }
  candidates.push(path.resolve(process.cwd(), relative));
  for (const candidate of candidates) {
    if (fs.existsSync(/* turbopackIgnore: true */ candidate)) return candidate;
  }
  return null;
}

/**
 * The sample behind a library voice. Kana and every user-added voice play
 * their own reference WAV directly; only the model voice has no reference, so
 * it plays the prepared generation. Nothing here invokes the engine.
 */
export function loadVoicePreview(voiceId: string): Buffer {
  const voice = listLibraryVoices().find((entry) => entry.id === voiceId);
  if (!voice) throw new VoicePreviewNotFoundError("Voice not found.");
  const file =
    voice.kind === "model"
      ? preparedPreviewPath(voice.id)
      : referenceForVoice(voice.id);
  if (!file) throw new VoicePreviewNotFoundError();
  return fs.readFileSync(/* turbopackIgnore: true */ file);
}
