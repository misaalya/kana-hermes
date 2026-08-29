import type {
  KanaOpenAiTtsPreset,
  KanaTtsResponseFormat,
  KanaUserConfig,
} from "@/lib/server/user-config";
import type { VoiceProviderStatus } from "@/lib/voice/types";
import {
  isAudioContentType,
  TtsProviderError,
  upstreamErrorMessage,
  type ServerTtsProvider,
  type TtsAudioResult,
  type TtsProviderDescriptor,
  type TtsSynthesisInput,
} from "./types";

type OpenAiCompatibleTtsConfig = {
  preset?: KanaOpenAiTtsPreset;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  voice?: string;
  defaultInstruction?: string;
  instructionField?: string;
  responseFormat?: KanaTtsResponseFormat;
};

type TtsPreset = {
  name: string;
  baseUrl: string;
  model: string;
  voice: string;
  responseFormat: KanaTtsResponseFormat;
  instructionField?: string;
  requiresApiKey: boolean;
  maximumInputCharacters?: number;
};

const OPENAI_TTS_PRESETS: Record<KanaOpenAiTtsPreset, TtsPreset> = {
  pollinations: {
    name: "Pollinations",
    baseUrl: "https://gen.pollinations.ai/v1",
    model: "qwen-tts-instruct",
    voice: "Serena",
    responseFormat: "wav",
    instructionField: "instruct",
    requiresApiKey: true,
    maximumInputCharacters: 4_096,
  },
};

export function normalizeOpenAiSpeechEndpoint(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OpenAI-compatible TTS baseUrl must use HTTP or HTTPS.");
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.username || parsed.password || (parsed.protocol === "http:" && !loopback)) {
    throw new Error(
      "OpenAI-compatible TTS must use HTTPS, or loopback HTTP without embedded credentials.",
    );
  }
  if (parsed.search || parsed.hash) {
    throw new Error("OpenAI-compatible TTS baseUrl cannot contain a query or fragment.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  if (!/\/audio\/speech$/i.test(parsed.pathname)) {
    parsed.pathname = `${parsed.pathname}/audio/speech`.replace(/\/{2,}/g, "/");
  }
  return parsed.toString();
}

function isLoopbackEndpoint(endpoint: string): boolean {
  const hostname = new URL(endpoint).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export class OpenAiCompatibleTtsProvider implements ServerTtsProvider {
  readonly descriptor: TtsProviderDescriptor;
  private readonly endpoint?: string;
  private readonly name: string;
  private readonly model?: string;
  private readonly voice?: string;
  private readonly responseFormat?: KanaTtsResponseFormat;
  private readonly instructionField?: string;
  private readonly defaultInstruction?: string;
  private readonly maximumInputCharacters?: number;
  private readonly requiresApiKey: boolean;
  private readonly apiKey?: string;
  private readonly configurationError?: string;

  constructor(config: OpenAiCompatibleTtsConfig) {
    const preset = config.preset ? OPENAI_TTS_PRESETS[config.preset] : undefined;
    this.name = preset?.name ?? "OpenAI-compatible TTS";
    this.model = config.model ?? preset?.model;
    this.voice = config.voice ?? preset?.voice;
    this.responseFormat = config.responseFormat ?? preset?.responseFormat;
    this.instructionField = config.instructionField ?? preset?.instructionField;
    this.defaultInstruction = config.defaultInstruction;
    this.maximumInputCharacters = preset?.maximumInputCharacters;
    this.requiresApiKey = preset?.requiresApiKey ?? false;
    this.apiKey = config.apiKey;

    let endpoint: string | undefined;
    let configurationError: string | undefined;
    try {
      const baseUrl = config.baseUrl ?? preset?.baseUrl;
      if (!baseUrl) {
        throw new Error("Set tts.openAiCompatible.baseUrl in Kana config.json.");
      }
      endpoint = normalizeOpenAiSpeechEndpoint(baseUrl);
      if (!this.model) {
        throw new Error("Set tts.openAiCompatible.model in Kana config.json.");
      }
      if (!this.voice) {
        throw new Error("Set tts.openAiCompatible.voice in Kana config.json.");
      }
      if (this.requiresApiKey && !this.apiKey) {
        throw new Error(
          "Set your Pollinations API key in tts.openAiCompatible.apiKey.",
        );
      }
      if (!this.apiKey && !isLoopbackEndpoint(endpoint)) {
        throw new Error(
          "Set tts.openAiCompatible.apiKey for a remote OpenAI-compatible provider.",
        );
      }
    } catch (error) {
      configurationError = error instanceof Error ? error.message : "TTS configuration is invalid.";
    }
    this.endpoint = endpoint;
    this.configurationError = configurationError;
    this.descriptor = {
      id: config.preset ? `openai-compatible:${config.preset}` : "openai-compatible:custom",
      type: "openai-compatible",
      name: this.name,
      preset: config.preset,
      configured: !configurationError,
      model: this.model,
      voice: this.voice,
      capabilities: {
        instruction: Boolean(this.instructionField),
        runtimeControl: false,
        upstreamCancellation: false,
        voiceLibrary: false,
      },
    };
  }

  async inspect(): Promise<VoiceProviderStatus> {
    if (this.configurationError) {
      return {
        state: "unavailable",
        service: this.name,
        model: this.model,
        defaultVoiceId: this.voice,
        supportsInstruction: Boolean(this.instructionField),
        supportsVoiceClone: false,
        voices: [],
        message: this.configurationError,
      };
    }
    // There is no standard, side-effect-free health endpoint in the OpenAI
    // audio contract. The first synthesis is the honest live connectivity test.
    return {
      state: "ready",
      service: this.name,
      model: this.model,
      device: "remote",
      defaultVoiceId: this.voice,
      supportsInstruction: Boolean(this.instructionField),
      supportsVoiceClone: false,
      modelType: "openai-compatible",
      voices: this.voice
        ? [{ id: this.voice, name: this.voice, language: "multi", kind: "preset" }]
        : [],
      message: `${this.name} is configured. Connectivity is verified when speech is generated.`,
    };
  }

  async synthesize(
    input: TtsSynthesisInput,
    signal: AbortSignal,
  ): Promise<TtsAudioResult> {
    if (this.configurationError || !this.endpoint || !this.model || !this.voice) {
      throw new TtsProviderError(
        this.configurationError ?? "The OpenAI-compatible TTS provider is incomplete.",
        503,
      );
    }
    if (
      this.maximumInputCharacters !== undefined &&
      input.text.length > this.maximumInputCharacters
    ) {
      throw new TtsProviderError(
        `${this.name} accepts at most ${this.maximumInputCharacters} input characters.`,
        400,
      );
    }

    const body: Record<string, unknown> = {
      model: this.model,
      input: input.text,
      voice: this.voice,
    };
    if (this.responseFormat) body.response_format = this.responseFormat;
    const instruction = input.instruction ?? this.defaultInstruction;
    if (instruction && this.instructionField) {
      body[this.instructionField] = instruction;
    }

    const headers: Record<string, string> = {
      Accept: "audio/*, application/octet-stream",
      "Content-Type": "application/json",
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      const message = await upstreamErrorMessage(response, this.name);
      throw new TtsProviderError(
        this.apiKey ? message.replaceAll(this.apiKey, "[REDACTED]") : message,
        response.status,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!isAudioContentType(contentType) || !response.body) {
      throw new TtsProviderError(`${this.name} returned a non-audio response.`);
    }
    return {
      body: response.body,
      contentType,
      contentLength: response.headers.get("content-length") ?? undefined,
    };
  }
}

export function openAiCompatibleConfigFromUserConfig(
  config: KanaUserConfig["tts"],
): OpenAiCompatibleTtsConfig {
  const provider = config?.openAiCompatible;
  return {
    preset: provider?.preset,
    baseUrl: provider?.baseUrl,
    apiKey: provider?.apiKey,
    model: provider?.model,
    voice: provider?.voice,
    defaultInstruction: provider?.defaultInstruction,
    instructionField: provider?.instructionField,
    responseFormat: provider?.responseFormat,
  };
}
