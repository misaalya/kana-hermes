import fs from "node:fs";
import path from "node:path";
import { getQwen3TtsServiceReadiness } from "@/lib/server/local-qwen3-tts-runtime";
import {
  createVoiceClone,
  getDefaultVoiceClone,
  getVoiceCloneByServiceId,
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
  const value = (await response.json()) as {
    id?: unknown;
    voice?: { id?: unknown };
  };
  // API v2 returns the descriptor under `voice`. Retain the top-level form
  // for compatibility with an older local service during a rolling update.
  const serviceVoiceId = value.voice?.id ?? value.id;
  if (typeof serviceVoiceId !== "string" || !serviceVoiceId) {
    throw new Error("Voice registration returned no id.");
  }
  return serviceVoiceId;
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

type ServiceVoiceSnapshot = {
  default_voice_id?: unknown;
  supports_voice_clone?: unknown;
  voices?: Array<{ id?: unknown }>;
};

async function serviceVoiceSnapshot(port: number): Promise<{
  defaultVoiceId: string;
  supportsVoiceClone: boolean;
  voiceIds: Set<string>;
}> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/voices`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Voice discovery failed (HTTP ${response.status}).`);
  }
  const value = (await response.json()) as ServiceVoiceSnapshot;
  return {
    defaultVoiceId:
      typeof value.default_voice_id === "string" ? value.default_voice_id : "",
    supportsVoiceClone: value.supports_voice_clone === true,
    voiceIds: new Set(
      Array.isArray(value.voices)
        ? value.voices.flatMap((voice) =>
            typeof voice.id === "string" && voice.id ? [voice.id] : [],
          )
        : [],
    ),
  };
}

function ensureDefaultVoiceRow(): VoiceCloneRow | null {
  const existing = getDefaultVoiceClone();
  if (existing) return existing;
  const assetPath = defaultVoiceAssetPath();
  if (!assetPath) return null;
  try {
    return createVoiceClone({
      id: "kc-default",
      name: DEFAULT_VOICE_NAME,
      filePath: assetPath,
      isDefault: true,
    });
  } catch {
    // Another request may have won the first-run insert race.
    return getDefaultVoiceClone();
  }
}

/**
 * Resolve the service-side voice immediately before local synthesis.
 *
 * The Python profile directory may be wiped independently from Kana's data
 * root. Verify the stored service id against the live service and re-register
 * the original reference when necessary. This also guarantees that a fresh
 * installation can speak on its first turn without opening Settings first.
 */
export async function resolveVoiceForSynthesis(
  port: number,
  requestedServiceVoiceId?: string,
): Promise<string | undefined> {
  const snapshot = await serviceVoiceSnapshot(port);
  const requested = requestedServiceVoiceId?.trim() ?? "";
  if (!snapshot.supportsVoiceClone) {
    return requested || snapshot.defaultVoiceId || undefined;
  }
  if (requested && snapshot.voiceIds.has(requested)) return requested;

  const requestedRow = requested ? getVoiceCloneByServiceId(requested) : null;
  const row = requestedRow ?? ensureDefaultVoiceRow();
  if (!row) {
    throw new Error("Kana's bundled default voice reference is missing.");
  }
  if (row.service_voice_id && snapshot.voiceIds.has(row.service_voice_id)) {
    return row.service_voice_id;
  }

  // A stale id proves that the service-side profile disappeared. Clear it so
  // registerVoiceClone cannot mistake stale SQLite metadata for availability.
  if (row.service_voice_id) setVoiceCloneServiceId(row.id, null);
  const refreshed = { ...row, service_voice_id: null };
  const serviceVoiceId = await registerWithService(
    port,
    refreshed.name,
    new Uint8Array(fs.readFileSync(refreshed.file_path)),
  );
  setVoiceCloneServiceId(refreshed.id, serviceVoiceId);
  return serviceVoiceId;
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

  const row = existing ?? ensureDefaultVoiceRow();
  if (!row) return;

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
