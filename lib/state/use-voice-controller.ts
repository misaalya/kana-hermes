"use client";

import { useCallback, useRef, useState } from "react";
import { AvatarController } from "@/lib/avatar/avatar-controller";
import type {
  KanaErrorCategory,
  KanaErrorSource,
} from "@/lib/diagnostics/types";
import { TtsRelayProvider } from "@/lib/voice/tts-relay-provider";
import { inspectConfiguredTtsProvider } from "@/lib/voice/tts-relay-contract";
import type {
  VoiceProvider,
  VoiceProviderStatus,
} from "@/lib/voice/types";

type VoiceMetricsCallback = (metrics: {
  lastVoiceDurationMs: number;
  lastVoiceSynthesisDurationMs?: number;
  lastVoicePlaybackDurationMs?: number;
  lastVoiceTimeToFirstAudioMs?: number;
}) => void;

export function useVoiceController(
  avatarController: AvatarController,
  onMetrics: VoiceMetricsCallback,
  onError: (
    source: KanaErrorSource,
    value: unknown,
    category?: KanaErrorCategory,
  ) => void,
) {
  const [voiceStatus, setVoiceStatus] = useState<VoiceProviderStatus | null>(
    null,
  );
  const [voiceRuntimeState, setVoiceRuntimeState] = useState("idle");

  const voiceRef = useRef<VoiceProvider | null>(null);
  const unsubscribeVoiceRef = useRef<(() => void) | null>(null);

  const getVoice = useCallback((): VoiceProvider => {
    if (voiceRef.current) return voiceRef.current;
    // Keep the gesture-unlocked AudioContext across preference changes.
    // Voice/delivery choices are passed per utterance; the server owns provider selection.
    const provider = new TtsRelayProvider({}, avatarController);
    voiceRef.current = provider;
    const applySnapshot = (
      snapshot: ReturnType<VoiceProvider["getSnapshot"]>,
    ) => {
      setVoiceRuntimeState(snapshot.state);
      const totalDuration =
        (snapshot.lastSynthesisDurationMs ?? 0) +
        (snapshot.lastPlaybackDurationMs ?? 0);
      if (totalDuration > 0) {
        onMetrics({
          lastVoiceDurationMs: totalDuration,
          lastVoiceSynthesisDurationMs: snapshot.lastSynthesisDurationMs,
          lastVoicePlaybackDurationMs: snapshot.lastPlaybackDurationMs,
          lastVoiceTimeToFirstAudioMs: snapshot.timeToFirstAudioMs,
        });
      }
    };
    applySnapshot(provider.getSnapshot());
    unsubscribeVoiceRef.current = provider.subscribe(applySnapshot);
    return provider;
  }, [avatarController, onMetrics]);

  const inspectVoiceService = useCallback(
    async () => {
      setVoiceRuntimeState("checking");
      const { status: inspection } = await inspectConfiguredTtsProvider();
      setVoiceStatus(inspection);
      setVoiceRuntimeState(inspection.state);
      // "unavailable" is an engine that has not been downloaded: a setup step
      // shown in Settings and first-run setup, not an error.
      if (inspection.state === "error") {
        onError(
          "voice",
          inspection.message || "The configured voice provider is unavailable.",
          "voice",
        );
      }
      return inspection;
    },
    [onError],
  );

  const unlockVoice = useCallback(() => {
    try {
      getVoice().unlock?.();
    } catch (error) {
      onError("voice", error, "voice");
    }
  }, [getVoice, onError]);

  const stopVoice = useCallback(() => {
    voiceRef.current?.stop();
  }, []);

  const cleanupVoice = useCallback(() => {
    unsubscribeVoiceRef.current?.();
    unsubscribeVoiceRef.current = null;
    voiceRef.current?.dispose?.();
    voiceRef.current = null;
    setVoiceRuntimeState("idle");
  }, []);

  return {
    voiceRuntimeState,
    voiceStatus,
    getVoice,
    inspectVoiceService,
    unlockVoice,
    stopVoice,
    cleanupVoice,
  };
}
