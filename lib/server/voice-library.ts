import fs from "node:fs";
import path from "node:path";
import { getQwen3TtsServiceReadiness } from "@/lib/server/local-qwen3-tts-runtime";
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
 * Registration only runs while the service reports itself READY — never
 * spawning, never blocking callers. A fresh install without the model yet
 * keeps rows "pending" and retries are throttled so an unhealthy engine
 * cannot be hammered into a respawn loop.
 */

const DEFAULT_VOICE_ASSET = "assets/voices/kana-default.wav";
export const DEFAULT_VOICE_NAME = "Kana";
const REGISTRATION_THROTTLE_MS = 30_000;

let lastRegistrationAttempt = 0;

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
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Voice registration failed (HTTP ${response.status}).${detail ? ` ${detail.slice(0, 300)}` : ""}`,
    );
  }
  const value = (await response.json()) as { id?: unknown };
  if (typeof value.id !== "string" || !value.id) {
    throw new Error("Voice registration returned no id.");
  }
  return value.id;
}

/** Register one library row; returns the service voice id or null (pending). */
export async function registerVoiceClone(row: VoiceCloneRow): Promise<string | null> {
  if (row.service_voice_id) return row.service_voice_id;
  if (!fs.existsSync(row.file_path)) return null;
  const readiness = await getQwen3TtsServiceReadiness();
  if (!readiness.ready) return null;
  try {
    const audioBytes = new Uint8Array(fs.readFileSync(row.file_path));
    const serviceId = await registerWithService(readiness.port, row.name, audioBytes);
    setVoiceCloneServiceId(row.id, serviceId);
    return serviceId;
  } catch {
    // Left pending; retried on a later throttled attempt.
    return null;
  }
}

/**
 * Make sure the shipped default voice exists in the library and is
 * registered with the service. Fire-and-forget and throttled: safe to call
 * on every library read.
 */
export async function ensureDefaultVoice(): Promise<void> {
  const existing = getDefaultVoiceClone();
  if (existing?.service_voice_id) return;
  if (Date.now() - lastRegistrationAttempt < REGISTRATION_THROTTLE_MS) return;
  lastRegistrationAttempt = Date.now();

  let row = existing;
  if (!row) {
    const assetPath = defaultVoiceAssetPath();
    if (!assetPath) return;
    try {
      row = createVoiceClone({
        id: "kc-default",
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
