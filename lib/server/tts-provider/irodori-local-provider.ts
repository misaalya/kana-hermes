import { inspectIrodoriInstall } from "@/lib/server/irodori/install";
import { IRODORI_MODEL_NAME } from "@/lib/server/irodori/release";
import { IrodoriSynthesisError, synthesizeWithIrodori } from "@/lib/server/irodori/synthesis";
import { referenceForVoice } from "@/lib/server/voice-library";
import type { VoiceProviderStatus } from "@/lib/voice/types";
import {
  TtsProviderError,
  type ServerTtsProvider,
  type TtsAudioResult,
  type TtsProviderDescriptor,
  type TtsSynthesisInput,
} from "./types";

/**
 * Local Japanese speech with the irodori-c engine and the Irodori-TTS v4.1
 * Anime model. The engine and model are installed on request (see
 * lib/server/irodori/install.ts); until then speech fails fast and honestly
 * instead of starting a multi-gigabyte download behind the user's back.
 */
export class IrodoriLocalTtsProvider implements ServerTtsProvider {
  readonly descriptor: TtsProviderDescriptor = {
    id: "irodori-local",
    type: "irodori-local",
    name: "Irodori TTS",
    configured: true,
    model: IRODORI_MODEL_NAME,
    capabilities: {
      instruction: false,
      localInstall: true,
      upstreamCancellation: true,
      voiceLibrary: true,
    },
  };

  async inspect(): Promise<VoiceProviderStatus> {
    const install = inspectIrodoriInstall();
    const state: VoiceProviderStatus["state"] =
      install.state === "ready" ? "ready" : install.state === "installing" ? "loading" : install.state === "failed" ? "error" : "unavailable";
    return {
      state,
      service: this.descriptor.name,
      model: IRODORI_MODEL_NAME,
      device: install.state === "unsupported" ? undefined : install.int8 ? "CPU int8" : "CPU fp32",
      supportsVoiceClone: true,
      modelType: "local",
      voices: [],
      message: install.message,
      installRequired: install.state === "not_installed",
    };
  }

  async synthesize(input: TtsSynthesisInput, signal: AbortSignal): Promise<TtsAudioResult> {
    try {
      const audio = await synthesizeWithIrodori(
        { text: input.text, emotion: input.emotion, referencePath: referenceForVoice(input.voiceId) },
        signal,
      );
      return { body: audio, contentType: "audio/wav", contentLength: String(audio.byteLength) };
    } catch (error) {
      if (error instanceof IrodoriSynthesisError) throw new TtsProviderError(error.message, error.status);
      throw error;
    }
  }
}
