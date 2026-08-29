"use client";

import { useCallback, useRef, useState } from "react";
import { AvatarController } from "@/lib/avatar/avatar-controller";
import type {
  KanaErrorCategory,
  KanaErrorSource,
} from "@/lib/diagnostics/types";
import {
  createQwen3VoiceClone,
  deleteQwen3VoiceClone,
  inspectQwen3TTSService,
  type CreateVoiceCloneInput,
} from "@/lib/voice/qwen3-tts-contract";
import { TtsRelayProvider } from "@/lib/voice/tts-relay-provider";
import { inspectConfiguredTtsProvider } from "@/lib/voice/tts-relay-contract";
import type {
  VoiceProvider,
  VoiceProviderStatus,
} from "@/lib/voice/types";
import type { KanaPreferences } from "@/lib/preferences/types";

type VoiceMetricsCallback = (metrics: {
  lastVoiceDurationMs: number;
  lastVoiceSynthesisDurationMs?: number;
  lastVoicePlaybackDurationMs?: number;
  lastVoiceTimeToFirstAudioMs?: number;
}) => void;

export function useVoiceController(
  avatarController: AvatarController,
  getPreferences: () => KanaPreferences,
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
  const voiceKeyRef = useRef("");

  const getVoice = useCallback((): VoiceProvider => {
    const prefs = getPreferences();
    const key = `${prefs.voiceMode}:${prefs.qwen3Tts.baseUrl}:${prefs.qwen3Tts.voiceId}:${prefs.qwen3Tts.deliveryMode}`;
    if (voiceRef.current && voiceKeyRef.current === key) {
      return voiceRef.current;
    }

    voiceRef.current?.dispose?.();
    unsubscribeVoiceRef.current?.();
    const provider = new TtsRelayProvider(
      {
        baseUrl: prefs.qwen3Tts.baseUrl,
        voiceId: prefs.qwen3Tts.voiceId,
        deliveryMode: prefs.qwen3Tts.deliveryMode,
      },
      avatarController,
    );
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
    voiceKeyRef.current = key;
    return provider;
  }, [avatarController, getPreferences, onMetrics]);

  const inspectVoiceService = useCallback(
    async (baseUrl: string) => {
      void baseUrl;
      setVoiceRuntimeState("checking");
      const { status: inspection } = await inspectConfiguredTtsProvider();
      setVoiceStatus(inspection);
      setVoiceRuntimeState(inspection.state);
      if (inspection.state === "error" || inspection.state === "unavailable") {
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

  const cloneVoice = useCallback(
    async (baseUrl: string, input: CreateVoiceCloneInput) => {
      const voice = await createQwen3VoiceClone(baseUrl, input);
      const inspection = await inspectQwen3TTSService(baseUrl);
      setVoiceStatus(inspection);
      return voice;
    },
    [],
  );

  const deleteClonedVoice = useCallback(
    async (baseUrl: string, voiceId: string) => {
      await deleteQwen3VoiceClone(baseUrl, voiceId);
      const inspection = await inspectQwen3TTSService(baseUrl);
      setVoiceStatus(inspection);
      return inspection;
    },
    [],
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
    voiceKeyRef.current = "";
    setVoiceRuntimeState("idle");
  }, []);

  return {
    voiceRuntimeState,
    voiceStatus,
    getVoice,
    inspectVoiceService,
    cloneVoice,
    deleteClonedVoice,
    unlockVoice,
    stopVoice,
    cleanupVoice,
  };
}
