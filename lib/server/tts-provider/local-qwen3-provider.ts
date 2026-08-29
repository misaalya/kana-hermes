import {
  ensureQwen3TTSService,
  getQwen3TtsServiceReadiness,
  inspectLocalQwen3TtsRuntime,
} from "@/lib/server/local-qwen3-tts-runtime";
import { ttsServiceUrl } from "@/lib/server/tts-relay";
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

export class LocalQwen3TtsProvider implements ServerTtsProvider {
  readonly descriptor: TtsProviderDescriptor = {
    id: "qwen3-local",
    type: "qwen3-local",
    name: "Qwen3-TTS",
    configured: true,
    capabilities: {
      instruction: false,
      runtimeControl: true,
      upstreamCancellation: true,
      voiceLibrary: true,
    },
  };

  async inspect(): Promise<VoiceProviderStatus> {
    const runtime = await inspectLocalQwen3TtsRuntime();
    this.descriptor.model = runtime.model;
    if (runtime.state === "starting") {
      return { state: "loading", service: "Qwen3-TTS", model: runtime.model, device: runtime.device, voices: [], message: runtime.message };
    }
    if (runtime.state === "failed") {
      return { state: "error", service: "Qwen3-TTS", model: runtime.model, device: runtime.device, voices: [], message: runtime.message };
    }
    const readiness = await getQwen3TtsServiceReadiness();
    if (!readiness.ready) {
      return {
        state: readiness.reason === "loading" ? "loading" : readiness.reason === "error" ? "error" : "unavailable",
        service: "Qwen3-TTS",
        model: runtime.model,
        device: runtime.device,
        voices: [],
        message: runtime.message,
      };
    }
    return {
      state: "ready",
      service: "Qwen3-TTS",
      model: runtime.model,
      device: runtime.device,
      supportsInstruction: false,
      supportsVoiceClone: true,
      modelType: "local",
      voices: [],
      message: runtime.message,
    };
  }

  async synthesize(
    input: TtsSynthesisInput,
    signal: AbortSignal,
  ): Promise<TtsAudioResult> {
    const ensured = await ensureQwen3TTSService();
    if (!ensured.ok) {
      throw new TtsProviderError(
        ensured.status.message || "The Qwen3-TTS service is unavailable.",
        503,
      );
    }
    const response = await fetch(ttsServiceUrl(ensured.status.port, "/v1/speech"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(input.requestId ? { "X-Kana-Request-Id": input.requestId } : {}),
      },
      body: JSON.stringify({
        text: input.text,
        language: input.language ?? "ja",
        voice_id: input.voiceId,
        emotion: input.emotion,
      }),
      signal,
    });
    if (!response.ok) {
      throw new TtsProviderError(
        await upstreamErrorMessage(response, "Qwen3-TTS"),
        response.status,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!isAudioContentType(contentType) || !response.body) {
      throw new TtsProviderError("Qwen3-TTS returned a non-audio response.");
    }
    return {
      body: response.body,
      contentType,
      contentLength: response.headers.get("content-length") ?? undefined,
    };
  }

  async cancel(requestId: string, signal: AbortSignal): Promise<boolean> {
    const status = await inspectLocalQwen3TtsRuntime();
    if (status.state !== "running" && status.state !== "external") return false;
    const response = await fetch(
      ttsServiceUrl(status.port, `/v1/requests/${encodeURIComponent(requestId)}/cancel`),
      { method: "POST", headers: { Accept: "application/json" }, signal, cache: "no-store" },
    );
    if (!response.ok) {
      throw new TtsProviderError(
        await upstreamErrorMessage(response, "Qwen3-TTS cancellation"),
        response.status,
      );
    }
    return true;
  }
}
