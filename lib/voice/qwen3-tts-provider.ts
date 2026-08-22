import type { AvatarController } from "@/lib/avatar/avatar-controller";
import { AudioLipSyncController } from "./audio-lip-sync";
import {
  inspectQwen3TTSService,
  qwen3TTSUrl,
} from "./qwen3-tts-contract";
import {
  splitJapaneseSpeech,
  type VoiceDeliveryMode,
} from "./speech-chunks";
import type {
  VoiceProvider,
  VoiceRuntimeSnapshot,
  VoiceProviderStatus,
  VoiceSpeakOptions,
} from "./types";

export type Qwen3TTSProviderOptions = {
  baseUrl: string;
  voiceId?: string;
  deliveryMode?: VoiceDeliveryMode;
  maximumChunkCharacters?: number;
};

type AudioPlayback = Pick<AudioLipSyncController, "play" | "stop">;

function aborted(): DOMException {
  return new DOMException("Voice playback was cancelled.", "AbortError");
}

export class Qwen3TTSProvider implements VoiceProvider {
  readonly id = "qwen3-tts";
  private readonly lipSync: AudioPlayback;
  private readonly listeners = new Set<(snapshot: VoiceRuntimeSnapshot) => void>();
  private request: { controller: AbortController; id: string } | null = null;
  private operation = 0;
  private lastAudio: ArrayBuffer[] = [];
  private snapshot: VoiceRuntimeSnapshot = { state: "idle", canReplay: false };

  constructor(
    private readonly options: Qwen3TTSProviderOptions,
    avatar: AvatarController,
    playback?: AudioPlayback,
  ) {
    this.lipSync = playback ?? new AudioLipSyncController(avatar);
  }

  async inspect(): Promise<VoiceProviderStatus> {
    this.update({ state: "checking", message: "Checking Qwen3-TTS…" });
    const status = await inspectQwen3TTSService(this.options.baseUrl);
    this.update({
      state:
        status.state === "ready"
          ? "ready"
          : status.state === "loading"
            ? "loading_model"
            : status.state === "error"
              ? "failed"
              : "offline",
      message: status.message,
    });
    return status;
  }

  async speak(options: VoiceSpeakOptions): Promise<void> {
    this.stop();
    const operation = ++this.operation;
    const startedAt = performance.now();
    const deliveryMode = this.options.deliveryMode ?? "complete";
    const chunks =
      deliveryMode === "sentence_chunks"
        ? splitJapaneseSpeech(
            options.text,
            this.options.maximumChunkCharacters,
          )
        : [options.text];
    const generatedAudio: ArrayBuffer[] = [];
    let synthesisDuration = 0;
    let playbackDuration = 0;

    this.update({
      state: "synthesizing",
      deliveryMode,
      currentChunk: 1,
      chunkCount: chunks.length,
      message:
        chunks.length > 1
          ? `Generating Japanese speech (part 1 of ${chunks.length})…`
          : "Generating Japanese speech…",
    });

    try {
      let current = await this.synthesizeChunk(
        chunks[0],
        options,
        operation,
        1,
        chunks.length,
      );
      synthesisDuration += current.durationMs;
      const timeToFirstAudio = Math.round(performance.now() - startedAt);

      for (let index = 0; index < chunks.length; index += 1) {
        if (operation !== this.operation) throw aborted();
        generatedAudio.push(current.audio.slice(0));
        const nextSynthesis =
          index + 1 < chunks.length
            ? this.synthesizeChunk(
                chunks[index + 1],
                options,
                operation,
                index + 2,
                chunks.length,
              )
            : null;
        const playbackStartedAt = performance.now();
        this.update({
          state: "playing",
          canReplay: this.lastAudio.length > 0,
          requestId: this.request?.id,
          deliveryMode,
          currentChunk: index + 1,
          chunkCount: chunks.length,
          timeToFirstAudioMs: timeToFirstAudio,
          lastSynthesisDurationMs: Math.round(synthesisDuration),
          message:
            chunks.length > 1
              ? `Playing Japanese speech (part ${index + 1} of ${chunks.length})…`
              : "Playing Japanese speech…",
        });
        const [, next] = await Promise.all([
          this.lipSync.play(current.audio),
          nextSynthesis,
        ]);
        playbackDuration += performance.now() - playbackStartedAt;
        if (operation !== this.operation) throw aborted();
        if (next) {
          synthesisDuration += next.durationMs;
          current = next;
        }
      }

      this.lastAudio = generatedAudio;
      this.update({
        state: "ready",
        canReplay: true,
        requestId: undefined,
        deliveryMode,
        currentChunk: chunks.length,
        chunkCount: chunks.length,
        timeToFirstAudioMs: timeToFirstAudio,
        lastSynthesisDurationMs: Math.round(synthesisDuration),
        lastPlaybackDurationMs: Math.round(playbackDuration),
        message:
          chunks.length > 1
            ? `Voice ready. ${chunks.length} ordered speech parts were played.`
            : "Voice ready.",
      });
    } catch (error) {
      this.lipSync.stop();
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (operation === this.operation) {
        this.update({
          state: "failed",
          canReplay: this.lastAudio.length > 0,
          requestId: undefined,
          message:
            error instanceof Error ? error.message : "Voice playback failed.",
        });
      }
      throw error;
    }
  }

  async replay(): Promise<void> {
    if (this.lastAudio.length === 0) {
      throw new Error("There is no generated speech to replay yet.");
    }
    this.stop();
    const operation = ++this.operation;
    const startedAt = performance.now();
    const audio = this.lastAudio.map((part) => part.slice(0));
    this.update({
      state: "playing",
      canReplay: true,
      currentChunk: 1,
      chunkCount: audio.length,
      message: "Replaying the last Japanese speech…",
    });
    try {
      for (let index = 0; index < audio.length; index += 1) {
        if (operation !== this.operation) throw aborted();
        this.update({
          state: "playing",
          canReplay: true,
          currentChunk: index + 1,
          chunkCount: audio.length,
          message:
            audio.length > 1
              ? `Replaying Japanese speech (part ${index + 1} of ${audio.length})…`
              : "Replaying the last Japanese speech…",
        });
        await this.lipSync.play(audio[index]);
      }
      if (operation !== this.operation) throw aborted();
      this.update({
        state: "ready",
        canReplay: true,
        currentChunk: audio.length,
        chunkCount: audio.length,
        lastPlaybackDurationMs: Math.round(performance.now() - startedAt),
        message: "Voice ready.",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (operation === this.operation) {
        this.update({
          state: "failed",
          canReplay: true,
          message: error instanceof Error ? error.message : "Replay failed.",
        });
      }
      throw error;
    }
  }

  stop(): void {
    const wasActive =
      this.request !== null ||
      this.snapshot.state === "synthesizing" ||
      this.snapshot.state === "playing";
    this.operation += 1;
    if (wasActive) {
      this.update({
        state: "stopping",
        canReplay: this.lastAudio.length > 0,
        message: "Stopping voice…",
      });
    }
    const request = this.request;
    this.request = null;
    if (request) {
      request.controller.abort();
      void fetch(
        qwen3TTSUrl(
          this.options.baseUrl,
          `/v1/requests/${encodeURIComponent(request.id)}/cancel`,
        ),
        { method: "POST", keepalive: true },
      ).catch(() => undefined);
    }
    this.lipSync.stop();
    if (wasActive) {
      this.update({
        state: this.lastAudio.length > 0 ? "ready" : "idle",
        canReplay: this.lastAudio.length > 0,
        requestId: undefined,
        currentChunk: undefined,
        chunkCount: undefined,
        message:
          this.lastAudio.length > 0
            ? "Voice stopped. Replay is available."
            : undefined,
      });
    }
  }

  getSnapshot(): VoiceRuntimeSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: VoiceRuntimeSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async synthesizeChunk(
    text: string,
    options: VoiceSpeakOptions,
    operation: number,
    chunk: number,
    chunkCount: number,
  ): Promise<{ audio: ArrayBuffer; durationMs: number }> {
    if (operation !== this.operation) throw aborted();
    const controller = new AbortController();
    const requestId = crypto.randomUUID();
    this.request = { controller, id: requestId };
    const synthesisStartedAt = performance.now();
    if (chunk === 1 || this.snapshot.state !== "playing") {
      this.update({
        state: "synthesizing",
        requestId,
        currentChunk: chunk,
        chunkCount,
        message:
          chunkCount > 1
            ? `Generating Japanese speech (part ${chunk} of ${chunkCount})…`
            : "Generating Japanese speech…",
      });
    }

    try {
      const response = await fetch(
        qwen3TTSUrl(this.options.baseUrl, "/v1/speech"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Kana-Request-Id": requestId,
          },
          signal: controller.signal,
          body: JSON.stringify({
            text,
            language: "ja",
            voice_id: options.voiceId || this.options.voiceId || undefined,
            emotion: options.emotion,
          }),
        },
      );

      if (!response.ok) {
        let detail = "";
        try {
          const body = (await response.json()) as { detail?: unknown };
          if (typeof body.detail === "string") detail = ` ${body.detail}`;
        } catch {
          // The status code remains enough when an intermediary returned HTML.
        }
        throw new Error(
          `Qwen3-TTS request failed with HTTP ${response.status}.${detail}`,
        );
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.startsWith("audio/")) {
        throw new Error("Qwen3-TTS must return an audio response body.");
      }

      const audio = await response.arrayBuffer();
      if (operation !== this.operation || controller.signal.aborted) {
        throw aborted();
      }
      return {
        audio,
        durationMs: performance.now() - synthesisStartedAt,
      };
    } finally {
      if (this.request?.controller === controller) this.request = null;
    }
  }

  private update(next: Partial<VoiceRuntimeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
