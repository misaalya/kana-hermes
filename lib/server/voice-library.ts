import fs from "node:fs";
import path from "node:path";
import {
  createVoiceClone,
  getDefaultVoiceClone,
  getVoiceClone,
  listVoiceClones,
} from "@/lib/server/voice-store";

/**
 * Kana's voice library for the local Irodori engine.
 *
 * A voice is a reference WAV that the engine conditions on per utterance, so
 * there is no registration step and nothing to fall out of sync: the files in
 * `<data root>/voices` plus their SQLite rows are the whole library. The
 * bundled "Kana" reference is always present and cannot be removed.
 */

const DEFAULT_VOICE_ASSET = "assets/voices/kana-default.wav";
export const DEFAULT_VOICE_ID = "kc-default";
export const DEFAULT_VOICE_NAME = "Kana";
/** The model's own voice: no reference, so it is the fastest option. */
export const MODEL_VOICE_ID = "irodori-model";

export type LibraryVoice = {
  id: string;
  name: string;
  kind: "model" | "bundled" | "reference";
  isDefault: boolean;
};

function defaultVoiceAssetPath(): string | null {
  const explicit = process.env.KANA_DEFAULT_VOICE_PATH?.trim();
  if (explicit) return path.resolve(explicit);
  // Repo checkout and standalone/package layouts both keep this next to the
  // server bundle's project root; resolve module-relative first, then cwd.
  const candidates: string[] = [];
  try {
    if (typeof __dirname === "string" && __dirname) {
      candidates.push(path.resolve(__dirname, "../../assets/voices/kana-default.wav"));
    }
  } catch {
    // ESM context without __dirname.
  }
  candidates.push(path.resolve(process.cwd(), DEFAULT_VOICE_ASSET));
  for (const candidate of candidates) {
    if (fs.existsSync(/* turbopackIgnore: true */ candidate)) return candidate;
  }
  return null;
}

function ensureDefaultVoiceRow(): void {
  if (getDefaultVoiceClone()) return;
  const assetPath = defaultVoiceAssetPath();
  if (!assetPath) return;
  try {
    createVoiceClone({ id: DEFAULT_VOICE_ID, name: DEFAULT_VOICE_NAME, filePath: assetPath, isDefault: true });
  } catch {
    // Another request may have won the first-run insert race.
  }
}

export function listLibraryVoices(): LibraryVoice[] {
  ensureDefaultVoiceRow();
  return [
    ...listVoiceClones().map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.is_default === 1 ? "bundled" as const : "reference" as const,
      isDefault: row.is_default === 1,
    })),
    { id: MODEL_VOICE_ID, name: "Irodori", kind: "model" as const, isDefault: false },
  ];
}

/**
 * The reference WAV for a selected voice. An unknown or deleted id falls back
 * to the bundled Kana voice so a stale browser selection still speaks.
 */
export function referenceForVoice(voiceId?: string): string | undefined {
  if (voiceId === MODEL_VOICE_ID) return undefined;
  ensureDefaultVoiceRow();
  const row = (voiceId ? getVoiceClone(voiceId) : null) ?? getDefaultVoiceClone();
  if (!row) return undefined;
  // A package upgrade or a move to a VPS changes the bundled asset's path.
  const file = row.is_default === 1 ? (defaultVoiceAssetPath() ?? row.file_path) : row.file_path;
  return fs.existsSync(/* turbopackIgnore: true */ file) ? file : undefined;
}

/** Reference audio must be RIFF/WAVE; the browser converts other formats first. */
export function isWavReference(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > 44 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WAVE"
  );
}
