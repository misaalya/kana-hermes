import type { VoiceDescriptor, VoiceProviderStatus } from "./types";

export const QWEN3_TTS_API_VERSION = "2";
export const QWEN3_TTS_SERVICE_NAME = "kana-qwen3-tts";
export const DEFAULT_QWEN3_TTS_BASE_URL = "http://127.0.0.1:7860";
export const DEFAULT_QWEN3_TTS_VOICE_ID = "";

export type Qwen3TTSHealthResponse = {
  service: string;
  api_version: string;
  status: "loading" | "ready" | "error";
  model: string;
  revision?: string | null;
  device: string;
  dtype: string;
  speakers: string[];
  languages: string[];
  default_voice_id: string;
  supports_instruction: boolean;
  supports_voice_clone: boolean;
  model_type: string;
  loaded_seconds?: number | null;
  error?: string | null;
};

type Qwen3TTSVoicesResponse = {
  service: string;
  api_version: string;
  status: "loading" | "ready" | "error";
  default_voice_id: string;
  supports_voice_clone: boolean;
  voices: VoiceDescriptor[];
};

type Qwen3TTSCloneVoiceResponse = {
  service: string;
  api_version: string;
  voice: VoiceDescriptor;
};

export type CreateVoiceCloneInput = {
  name: string;
  audio: File;
  referenceText?: string;
  xVectorOnly: boolean;
  consent: boolean;
};

type Qwen3TTSSetupResponse = {
  service: string;
  api_version: string;
  cache_dir?: string | null;
  cache_exists: boolean;
  model_cache_detected: boolean;
  free_disk_bytes: number;
  total_disk_bytes: number;
  recommended_free_disk_bytes: number;
  disk_sufficient: boolean;
};

export function normalizeQwen3TTSBaseUrl(value: string): string {
  const fallback = DEFAULT_QWEN3_TTS_BASE_URL;
  const input = value.trim() || fallback;
  const parsed = new URL(input);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Qwen3-TTS service URL must use HTTP or HTTPS.");
  }
  const localHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  if (parsed.username || parsed.password || (parsed.protocol === "http:" && !localHttp)) {
    throw new Error(
      "Qwen3-TTS must use HTTPS or localhost HTTP without embedded credentials.",
    );
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname
    .replace(/\/(?:v1\/speech|tts)\/?$/i, "")
    .replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export function qwen3TTSUrl(baseUrl: string, path: string): string {
  return `${normalizeQwen3TTSBaseUrl(baseUrl)}${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHealthResponse(value: unknown): value is Qwen3TTSHealthResponse {
  if (!isRecord(value)) return false;
  return (
    typeof value.service === "string" &&
    typeof value.api_version === "string" &&
    ["loading", "ready", "error"].includes(String(value.status)) &&
    typeof value.model === "string" &&
    typeof value.device === "string" &&
    typeof value.default_voice_id === "string" &&
    typeof value.supports_instruction === "boolean" &&
    typeof value.supports_voice_clone === "boolean" &&
    typeof value.model_type === "string" &&
    Array.isArray(value.speakers) &&
    Array.isArray(value.languages)
  );
}

function isVoicesResponse(value: unknown): value is Qwen3TTSVoicesResponse {
  if (!isRecord(value) || !Array.isArray(value.voices)) return false;
  return value.voices.every(
    (voice) =>
      isRecord(voice) &&
      typeof voice.id === "string" &&
      typeof voice.language === "string" &&
      (voice.kind === undefined || ["preset", "cloned"].includes(String(voice.kind))),
  );
}

function normalizeVoiceDescriptor(voice: VoiceDescriptor): VoiceDescriptor {
  const wire = voice as unknown as Record<string, unknown>;
  return {
    id: voice.id,
    language: voice.language,
    ...(typeof voice.name === "string" ? { name: voice.name } : {}),
    ...(voice.kind === "preset" || voice.kind === "cloned"
      ? { kind: voice.kind }
      : {}),
    ...(typeof wire.duration_seconds === "number"
      ? { durationSeconds: wire.duration_seconds }
      : {}),
    ...(typeof wire.created_at === "string"
      ? { createdAt: wire.created_at }
      : {}),
    ...(typeof wire.x_vector_only === "boolean"
      ? { xVectorOnly: wire.x_vector_only }
      : {}),
  };
}

function isSetupResponse(value: unknown): value is Qwen3TTSSetupResponse {
  if (!isRecord(value)) return false;
  return (
    typeof value.service === "string" &&
    typeof value.api_version === "string" &&
    typeof value.cache_exists === "boolean" &&
    typeof value.model_cache_detected === "boolean" &&
    typeof value.free_disk_bytes === "number" &&
    typeof value.total_disk_bytes === "number" &&
    typeof value.recommended_free_disk_bytes === "number" &&
    typeof value.disk_sufficient === "boolean"
  );
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Qwen3-TTS service returned HTTP ${response.status}.`);
  }
  return response.json();
}

async function fetchOptionalSetup(
  baseUrl: string,
  signal: AbortSignal,
): Promise<Qwen3TTSSetupResponse | null> {
  const response = await fetch(qwen3TTSUrl(baseUrl, "/v1/setup"), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Qwen3-TTS setup check returned HTTP ${response.status}.`);
  }
  const value: unknown = await response.json();
  if (!isSetupResponse(value)) {
    throw new Error("The service returned an incompatible setup response.");
  }
  return value;
}

export async function inspectQwen3TTSService(
  baseUrl: string,
  timeoutMs = 5000,
): Promise<VoiceProviderStatus> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const healthValue = await fetchJson(
      qwen3TTSUrl(baseUrl, "/v1/health"),
      controller.signal,
    );
    if (!isHealthResponse(healthValue)) {
      throw new Error("The service returned an incompatible health response.");
    }
    if (
      healthValue.service !== QWEN3_TTS_SERVICE_NAME ||
      healthValue.api_version !== QWEN3_TTS_API_VERSION
    ) {
      throw new Error(
        `Kana requires ${QWEN3_TTS_SERVICE_NAME} API v${QWEN3_TTS_API_VERSION}.`,
      );
    }
    const setupValue = await fetchOptionalSetup(baseUrl, controller.signal);
    const setup = setupValue
      ? {
          cacheDir: setupValue.cache_dir ?? undefined,
          cacheExists: setupValue.cache_exists,
          modelCacheDetected: setupValue.model_cache_detected,
          freeDiskBytes: setupValue.free_disk_bytes,
          totalDiskBytes: setupValue.total_disk_bytes,
          recommendedFreeDiskBytes: setupValue.recommended_free_disk_bytes,
          diskSufficient: setupValue.disk_sufficient,
        }
      : undefined;
    if (healthValue.status !== "ready") {
      return {
        state: healthValue.status,
        service: healthValue.service,
        apiVersion: healthValue.api_version,
        model: healthValue.model,
        device: healthValue.device,
        supportsInstruction: healthValue.supports_instruction,
        supportsVoiceClone: healthValue.supports_voice_clone,
        modelType: healthValue.model_type,
        defaultVoiceId: healthValue.default_voice_id,
        voices: healthValue.speakers.map((id) => ({
          id,
          name: id.replaceAll("_", " "),
          language: "multi",
          kind: "preset" as const,
        })),
        message:
          healthValue.status === "loading"
            ? "The Qwen3-TTS model is still loading."
            : healthValue.error || "The Qwen3-TTS model failed to load.",
        ...(setup ? { setup } : {}),
      };
    }

    const voicesValue = await fetchJson(
      qwen3TTSUrl(baseUrl, "/v1/voices"),
      controller.signal,
    );
    if (!isVoicesResponse(voicesValue)) {
      throw new Error("The service returned an incompatible voice catalog.");
    }
    return {
      state: "ready",
      service: healthValue.service,
      apiVersion: healthValue.api_version,
      model: healthValue.model,
      device: healthValue.device,
      supportsInstruction: healthValue.supports_instruction,
      supportsVoiceClone: healthValue.supports_voice_clone,
      modelType: healthValue.model_type,
      defaultVoiceId: voicesValue.default_voice_id,
      voices: voicesValue.voices.map(normalizeVoiceDescriptor),
      message: setupValue
        ? `Ready on ${healthValue.device}. ${setupValue.disk_sufficient ? "Model storage has enough free space." : "Model storage is low on free space."}`
        : `Ready on ${healthValue.device}.`,
      ...(setup ? { setup } : {}),
    };
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "Qwen3-TTS did not respond before the health-check timeout."
        : error instanceof Error
          ? error.message
          : "Could not reach Qwen3-TTS.";
    return { state: "unavailable", voices: [], message };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function serviceError(response: Response, fallback: string): Promise<Error> {
  try {
    const value = (await response.json()) as { detail?: unknown };
    if (typeof value.detail === "string") return new Error(value.detail);
  } catch {
    // Use the stable fallback when a proxy returned a non-JSON body.
  }
  return new Error(`${fallback} (HTTP ${response.status}).`);
}

export async function createQwen3VoiceClone(
  baseUrl: string,
  input: CreateVoiceCloneInput,
): Promise<VoiceDescriptor> {
  if (input.audio.size > 20 * 1024 * 1024) {
    throw new Error("Reference audio must be 20 MB or smaller.");
  }
  const response = await fetch(qwen3TTSUrl(baseUrl, "/v1/voices/clone"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      name: input.name,
      audio_base64: bytesToBase64(new Uint8Array(await input.audio.arrayBuffer())),
      reference_text: input.referenceText?.trim() || undefined,
      x_vector_only: input.xVectorOnly,
      consent: input.consent,
    }),
  });
  if (!response.ok) throw await serviceError(response, "Could not clone the voice");
  const value = (await response.json()) as Qwen3TTSCloneVoiceResponse;
  if (
    value.service !== QWEN3_TTS_SERVICE_NAME ||
    value.api_version !== QWEN3_TTS_API_VERSION ||
    !isRecord(value.voice) ||
    typeof value.voice.id !== "string" ||
    typeof value.voice.language !== "string"
  ) {
    throw new Error("The Qwen3-TTS service returned an incompatible voice profile.");
  }
  return normalizeVoiceDescriptor(value.voice);
}

export async function deleteQwen3VoiceClone(
  baseUrl: string,
  voiceId: string,
): Promise<void> {
  if (!voiceId.startsWith("clone-")) {
    throw new Error("Only user-created cloned voices can be deleted.");
  }
  const response = await fetch(
    qwen3TTSUrl(baseUrl, `/v1/voices/${encodeURIComponent(voiceId)}`),
    { method: "DELETE", headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw await serviceError(response, "Could not delete the voice");
}
