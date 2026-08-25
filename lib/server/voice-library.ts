import fs from "node:fs";
import path from "node:path";
import { ensureQwen3TTSService } from "@/lib/server/local-qwen3-tts-runtime";
import {
  createVoiceClone,
  getDefaultVoiceClone,
  listVoiceClones,
  setVoiceCloneServiceId,
  type VoiceCloneRow,
} from "@/lib/server/voice-store";

/**
 * Registration bridge between Kana's persistent voice library (files +
 * SQLite) and the Qwen service's runtime voice profiles.
 *
 * The shipped default voice ("Kana", assets/voices/kana-default.mp3) is
 * registered lazily: the attempt never blocks callers and retries whenever
 * the service becomes available, because a fresh install may not have the
 * model downloaded yet.
 */

const DEFAULT_VOICE_ASSET = "assets/voices/kana-default.mp3";
export const DEFAULT_VOICE_NAME = "Kana";

function defaultVoiceAssetPath(): string | null {
  const explicit = process.env.KANA_DEFAULT_VOICE_PATH?.trim();
  if (explicit) return path.resolve(explicit);
  // Repo checkout and standalone/package layouts both keep this next to the
  // server bundle's project root; resolve module-relative first, then cwd.
  const candidates: string[] = [];
  try {
    if (typeof __dirname === "string" && __dirname) {
      candidates.push(path.resolve(__dirname, "../../assets/voices/kana-default.mp3"));
    }
  } catch {
    // ESM context without __dirname.
  }
  candidates.push(path.resolve(process.cwd(), DEFAULT_VOICE_ASSET));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function registerWithService(
  port: number,
  name: string,
  audioBytes: Uint8Array,
): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/voices/clone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      audio_base64: Buffer.from(audioBytes).toString("base64"),
      x_vector_only: true,
      consent: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Voice registration failed (HTTP ${response.status}).`);
  }
  const value = (await response.json()) as { id?: unknown };
  if (typeof value.id !== "string" || !value.id) {
    throw new Error("Voice registration returned no id.");
  }
  return value.id;
}

/** Register one library row with the service; returns the service voice id. */
export async function registerVoiceClone(row: VoiceCloneRow): Promise<string | null> {
  if (row.service_voice_id) return row.service_voice_id;
  const ensured = await ensureQwen3TTSService();
  if (!ensured.ok) return null;
  try {
    const audioBytes = new Uint8Array(fs.readFileSync(row.file_path));
    const serviceId = await registerWithService(ensured.status.port, row.name, audioBytes);
    setVoiceCloneServiceId(row.id, serviceId);
    return serviceId;
  } catch {
    // Left pending; retried on a later attempt once the service is healthy.
    return null;
  }
}

/**
 * Make sure the shipped default voice exists in the library and is
 * registered with the service. Fire-and-forget by design.
 */
export async function ensureDefaultVoice(): Promise<void> {
  const existing = getDefaultVoiceClone();
  if (existing?.service_voice_id) return;

  let row = existing;
  if (!row) {
    const assetPath = defaultVoiceAssetPath();
    if (!assetPath) return;
    try {
      row = createVoiceClone({
        id: `kc-default-${Date.now().toString(36)}`,
        name: DEFAULT_VOICE_NAME,
        filePath: assetPath,
        isDefault: true,
      });
    } catch {
      return;
    }
  }

  try {
    await registerVoiceClone(row);
  } catch {
    // Never propagate into request paths.
  }
}

export type LibraryVoice = {
  id: string;
  name: string;
  registered: boolean;
  serviceVoiceId: string | null;
  isDefault: boolean;
};

export function listLibraryVoices(): LibraryVoice[] {
  return listVoiceClones().map((row) => ({
    id: row.id,
    name: row.name,
    registered: Boolean(row.service_voice_id),
    serviceVoiceId: row.service_voice_id,
    isDefault: row.is_default === 1,
  }));
}
