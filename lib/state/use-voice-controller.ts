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
import { Qwen3TTSProvider } from "@/lib/voice/qwen3-tts-provider";
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
  const [voiceCanReplay, setVoiceCanReplay] = useState(false);

  const voiceRef = useRef<VoiceProvider | null>(null);
  const unsubscribeVoiceRef = useRef<(() => void) | null>(null);
  const voiceKeyRef = useRef("");

  const getVoice = useCallback((): VoiceProvider => {
    const prefs = getPreferences();
    const key = `${prefs.voiceMode}:${prefs.qwen3Tts.baseUrl}:${prefs.qwen3Tts.voiceId}:${prefs.qwen3Tts.deliveryMode}`;
    if (voiceRef.current && voiceKeyRef.current === key) {
      return voiceRef.current;
    }

    voiceRef.current?.stop();
    unsubscribeVoiceRef.current?.();
    const provider = new Qwen3TTSProvider(
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
      setVoiceCanReplay(snapshot.canReplay);
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

  const recreateVoice = useCallback(() => {
    voiceRef.current?.stop();
    setVoiceRuntimeState("idle");
    setVoiceCanReplay(false);
    unsubscribeVoiceRef.current?.();
    unsubscribeVoiceRef.current = null;
    voiceRef.current = null;
    voiceKeyRef.current = "";
  }, []);

  const inspectVoiceService = useCallback(
    async (baseUrl: string) => {
      setVoiceRuntimeState("checking");
      const inspection = await inspectQwen3TTSService(baseUrl);
      setVoiceStatus(inspection);
      setVoiceRuntimeState(inspection.state);
      if (inspection.state === "error" || inspection.state === "unavailable") {
        onError(
          "voice",
          inspection.message || "Qwen3-TTS is unavailable.",
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

  const replayVoice = useCallback(async () => {
    const voice = voiceRef.current;
    if (!voice || !voice.getSnapshot().canReplay) {
      onError("voice", "There is no generated speech to replay yet.", "voice");
      return;
    }
    try {
      await voice.replay();
    } catch (replayError) {
      if (
        replayError instanceof Error &&
        replayError.name === "AbortError"
      )
        return;
      onError("voice", replayError, "voice");
    }
  }, [onError]);

  const stopVoice = useCallback(() => {
    voiceRef.current?.stop();
  }, []);

  const cleanupVoice = useCallback(() => {
    unsubscribeVoiceRef.current?.();
    unsubscribeVoiceRef.current = null;
    voiceRef.current?.stop();
    voiceRef.current = null;
    voiceKeyRef.current = "";
    setVoiceRuntimeState("idle");
    setVoiceCanReplay(false);
  }, []);

  return {
    voiceRuntimeState,
    voiceCanReplay,
    voiceStatus,
    getVoice,
    recreateVoice,
    inspectVoiceService,
    cloneVoice,
    deleteClonedVoice,
    replayVoice,
    stopVoice,
    cleanupVoice,
  };
}