import type {
  KanaPollinationsAudioFormat,
  KanaPollinationsTtsConfig,
} from "@/lib/server/user-config";
import type { VoiceProviderStatus } from "@/lib/voice/types";
import {
  normalizedAudioContentType,
  TtsProviderError,
  upstreamErrorMessage,
  type ServerTtsProvider,
  type TtsAudioResult,
  type TtsProviderDescriptor,
  type TtsSynthesisInput,
} from "./types";

/**
 * Pollinations' own speech endpoint and limits, from its OpenAPI schema
 * (https://gen.pollinations.ai/openapi.json): a Bearer key, `input` of at
 * most 10,000 characters, and `instructions` for delivery direction.
 */
export const POLLINATIONS_SPEECH_ENDPOINT = "https://gen.pollinations.ai/v1/audio/speech";
export const POLLINATIONS_MAX_INPUT_CHARACTERS = 10_000;
/** Pollinations' default; small enough to reach the browser quickly. */
const DEFAULT_FORMAT: KanaPollinationsAudioFormat = "mp3";
const NAME = "Pollinations";

export class PollinationsTtsProvider implements ServerTtsProvider {
  readonly descriptor: TtsProviderDescriptor;
  private readonly apiKey?: string;
  private readonly model?: string;
  private readonly voice?: string;
  private readonly instructions?: string;
  private readonly format: KanaPollinationsAudioFormat;
  private readonly configurationError?: string;

  constructor(config: KanaPollinationsTtsConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.voice = config.voice;
    this.instructions = config.instructions;
    this.format = config.format ?? DEFAULT_FORMAT;
    // Every Pollinations speech model is paid, so a key is always needed.
    this.configurationError = this.apiKey
      ? undefined
      : "Set your Pollinations API key in tts.pollinations.apiKey.";
    this.descriptor = {
      id: "pollinations",
      type: "pollinations",
      name: NAME,
      configured: !this.configurationError,
      model: this.model,
      voice: this.voice,
      capabilities: {
        instruction: true,
        localInstall: false,
        upstreamCancellation: false,
        voiceLibrary: false,
      },
    };
  }

  async inspect(): Promise<VoiceProviderStatus> {
    const base = {
      service: NAME,
      model: this.model,
      defaultVoiceId: this.voice,
      supportsInstruction: true,
      supportsVoiceClone: false,
    };
    if (this.configurationError) {
      return { ...base, state: "unavailable", voices: [], message: this.configurationError };
    }
    // Pollinations has no free, side-effect-free speech check; the first
    // reply is the honest connectivity test.
    return {
      ...base,
      state: "ready",
      device: "remote",
      modelType: "pollinations",
      voices: this.voice
        ? [{ id: this.voice, name: this.voice, language: "multi", kind: "preset" }]
        : [],
      message: `${NAME} is configured. Connectivity is verified when speech is generated.`,
    };
  }

  async synthesize(
    input: TtsSynthesisInput,
    signal: AbortSignal,
  ): Promise<TtsAudioResult> {
    if (this.configurationError || !this.apiKey) {
      throw new TtsProviderError(this.configurationError ?? "Pollinations is not configured.", 503);
    }
    if (input.text.length > POLLINATIONS_MAX_INPUT_CHARACTERS) {
      throw new TtsProviderError(
        `${NAME} accepts at most ${POLLINATIONS_MAX_INPUT_CHARACTERS} input characters.`,
        400,
      );
    }

    // Unset model and voice fall back to Pollinations' own defaults.
    const body: Record<string, unknown> = { input: input.text, response_format: this.format };
    if (this.model) body.model = this.model;
    if (this.voice) body.voice = this.voice;
    const instructions = input.instruction ?? this.instructions;
    if (instructions) body.instructions = instructions;

    const response = await fetch(POLLINATIONS_SPEECH_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "audio/*, application/octet-stream",
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      const message = await upstreamErrorMessage(response, NAME);
      throw new TtsProviderError(message.replaceAll(this.apiKey, "[REDACTED]"), response.status);
    }
    const contentType = normalizedAudioContentType(
      response.headers.get("content-type") ?? "",
      this.format,
    );
    if (!contentType || !response.body) {
      throw new TtsProviderError(`${NAME} returned a non-audio response.`);
    }
    return {
      body: response.body,
      contentType,
      contentLength: response.headers.get("content-length") ?? undefined,
    };
  }
}
