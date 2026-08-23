"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AvatarController } from "@/lib/avatar/avatar-controller";
import type { AvatarModelSummary } from "@/lib/avatar/indexed-db-avatar-model-store";
import { Live2DAvatarProvider } from "@/lib/avatar/live2d-avatar-provider";
import { ManagedAvatarProvider } from "@/lib/avatar/managed-avatar-provider";
import { live2DModelBindings } from "@/lib/avatar/model-bindings";
import { MockAvatarProvider } from "@/lib/avatar/mock-avatar-provider";
import { PixiLive2DRuntimeAdapter } from "@/lib/avatar/pixi-live2d-runtime-adapter";
import type { AvatarSnapshot } from "@/lib/avatar/types";
import type {
  KanaErrorCategory,
  KanaErrorSource,
} from "@/lib/diagnostics/types";
import type { KanaPreferences } from "@/lib/preferences/types";
import type { KanaMessage } from "@/lib/conversation/types";

type AvatarMetricsCallback = (metrics: {
  lastAvatarLoadDurationMs: number;
}) => void;

const EMPTY_AVATAR: AvatarSnapshot = {
  loaded: false,
  renderMode: "mock",
  emotion: "neutral",
  emotionIntensity: 0.2,
  mouthOpen: 0,
  talking: false,
};

export function useAvatarController(
  avatarProvider: ManagedAvatarProvider,
  avatarModelStore: { load: (id: string) => Promise<File[] | null>; list: () => Promise<AvatarModelSummary[]>; import: (files: File[]) => Promise<AvatarModelSummary>; delete: (id: string) => Promise<void>; rename: (id: string, name: string) => Promise<AvatarModelSummary | null> },
  avatarController: AvatarController,
  getPreferences: () => KanaPreferences,
  savePreferences: (prefs: KanaPreferences) => void,
  onError: (source: KanaErrorSource, value: unknown, category?: KanaErrorCategory) => void,
  onMetrics: AvatarMetricsCallback,
) {
  const [avatar, setAvatar] = useState<AvatarSnapshot>(EMPTY_AVATAR);
  const avatarCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const avatarKeyRef = useRef("");
  const avatarPreviewTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    const unsubscribe = avatarProvider.subscribe((snapshot) => {
      setAvatar((prev) => {
        if (
          prev.emotion === snapshot.emotion &&
          prev.talking === snapshot.talking &&
          prev.loaded === snapshot.loaded &&
          prev.renderMode === snapshot.renderMode
        ) {
          return prev;
        }
        return snapshot;
      });
    });
    return unsubscribe;
  }, [avatarProvider]);

  const configureAvatar = useCallback(
    async (next: KanaPreferences, selectedModelFiles?: File[], force?: boolean) => {
      const canvas = avatarCanvasRef.current;
      if (!canvas) return false;
      const startedAt = performance.now();
      try {
        let modelFiles = selectedModelFiles;
        if (
          !modelFiles?.length &&
          next.avatarMode === "live2d" &&
          next.live2d.modelId
        ) {
          modelFiles =
            (await avatarModelStore.load(next.live2d.modelId)) ?? undefined;
          if (!modelFiles?.length) {
            throw new Error(
              `The saved Live2D model "${next.live2d.modelName || next.live2d.modelId}" is no longer available.`,
            );
          }
        }

        const bindings = live2DModelBindings(next.live2d);
        const key = modelFiles?.length
          ? `files:${modelFiles
              .map(
                (file) =>
                  `${file.webkitRelativePath}:${file.size}:${file.lastModified}`,
              )
              .join("|")}:${JSON.stringify(bindings)}`
          : next.avatarMode === "live2d"
            ? `live2d:${next.live2d.coreScriptUrl}:${next.live2d.modelId || next.live2d.modelUrl}:${JSON.stringify(bindings)}`
            : "mock";
        if (!force && avatarKeyRef.current === key) return true;

        if (next.avatarMode === "mock" && !modelFiles?.length) {
          await avatarProvider.use(new MockAvatarProvider(), {
            id: "kana-mock",
            name: "Kana preview",
          });
        } else {
          const runtime = new PixiLive2DRuntimeAdapter(
            next.live2d.coreScriptUrl.trim(),
          );
          const provider = new Live2DAvatarProvider(runtime, bindings);
          await avatarProvider.use(provider, {
            id: modelFiles?.length ? "imported-live2d" : "configured-live2d",
            name: modelFiles?.length ? "Imported Live2D model" : "Live2D model",
            canvas,
            modelFiles,
            modelUrl: modelFiles?.length
              ? undefined
              : next.live2d.modelUrl.trim(),
          });
        }
        avatarKeyRef.current = key;
        avatarController.presentEmotion("neutral");
        onMetrics({
          lastAvatarLoadDurationMs: Math.round(performance.now() - startedAt),
        });
        return true;
      } catch (avatarError) {
        avatarKeyRef.current = "mock-fallback";
        onError(
          "avatar",
          avatarError instanceof Error
            ? `Live2D could not load: ${avatarError.message}`
            : "Live2D could not load. Kana is using the CSS preview.",
          "avatar",
        );
        return false;
      }
    },
    [avatarController, avatarModelStore, avatarProvider, onError, onMetrics],
  );

  const attachAvatarCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      avatarCanvasRef.current = canvas;
      if (canvas) void configureAvatar(getPreferences());
    },
    [configureAvatar, getPreferences],
  );

  const importAvatarFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) throw new Error("Choose a Live2D model folder first.");
      const previous = getPreferences();
      const imported = await avatarModelStore.import(files);
      const next = {
        ...previous,
        avatarMode: "live2d" as const,
        live2d: {
          ...previous.live2d,
          modelId: imported.id,
          modelName: imported.name,
        },
      };
      avatarKeyRef.current = "";
      const loaded = await configureAvatar(next, files);
      if (!loaded) {
        await avatarModelStore.delete(imported.id);
        avatarKeyRef.current = "";
        await configureAvatar(previous);
        throw new Error(
          "The selected folder could not be loaded. Include the model3.json file and every referenced asset.",
        );
      }
      savePreferences(next);
      return imported;
    },
    [avatarModelStore, configureAvatar, getPreferences, savePreferences],
  );

  const listAvatarModels = useCallback(
    () => avatarModelStore.list(),
    [avatarModelStore],
  );

  const selectAvatarModel = useCallback(
    async (id: string) => {
      const previous = getPreferences();
      const model = (await avatarModelStore.list()).find(
        (item) => item.id === id,
      );
      if (!model) throw new Error("The selected Live2D model no longer exists.");
      const files = await avatarModelStore.load(id);
      if (!files?.length)
        throw new Error("The selected Live2D package is empty.");
      const next: KanaPreferences = {
        ...previous,
        avatarMode: "live2d",
        live2d: {
          ...previous.live2d,
          modelId: model.id,
          modelName: model.name,
        },
      };
      avatarKeyRef.current = "";
      if (!(await configureAvatar(next, files))) {
        avatarKeyRef.current = "";
        await configureAvatar(previous);
        throw new Error(
          "The saved Live2D package could not be loaded. Kana restored the previous avatar.",
        );
      }
      savePreferences(next);
      return model;
    },
    [avatarModelStore, configureAvatar, getPreferences, savePreferences],
  );

  const renameAvatarModel = useCallback(
    async (id: string, name: string) => {
      const renamed = await avatarModelStore.rename(id, name);
      if (!renamed)
        throw new Error("The selected Live2D model no longer exists.");
      const prefs = getPreferences();
      if (prefs.live2d.modelId === id) {
        const next = {
          ...prefs,
          live2d: {
            ...prefs.live2d,
            modelName: renamed.name,
          },
        };
        savePreferences(next);
      }
      return renamed;
    },
    [avatarModelStore, getPreferences, savePreferences],
  );

  const deleteAvatarModel = useCallback(
    async (id: string) => {
      const prefs = getPreferences();
      if (prefs.live2d.modelId === id) {
        throw new Error(
          "Switch to another avatar before deleting the active model.",
        );
      }
      await avatarModelStore.delete(id);
    },
    [avatarModelStore, getPreferences],
  );

  const previewAvatarEmotion = useCallback(
    async (next: KanaPreferences, emotion: KanaMessage["emotion"]) => {
      if (!emotion || !(await configureAvatar(next))) return;
      avatarController.presentEmotion(emotion);
    },
    [avatarController, configureAvatar],
  );

  const previewAvatarMotion = useCallback(
    async (next: KanaPreferences, motion: string) => {
      if (!(await configureAvatar(next))) return;
      avatarController.provider.playMotion(motion);
    },
    [avatarController, configureAvatar],
  );

  const previewAvatarTalking = useCallback(
    async (next: KanaPreferences) => {
      if (!(await configureAvatar(next))) return;
      for (const timer of avatarPreviewTimersRef.current)
        globalThis.clearTimeout(timer);
      avatarPreviewTimersRef.current = [];
      avatarController.setTalking(true);
      avatarController.setMouthOpen(0.8);
      avatarPreviewTimersRef.current.push(
        globalThis.setTimeout(() => avatarController.setMouthOpen(0.25), 300),
        globalThis.setTimeout(() => avatarController.setMouthOpen(0.7), 520),
        globalThis.setTimeout(() => avatarController.setTalking(false), 850),
      );
    },
    [avatarController, configureAvatar],
  );

  const cleanupAvatar = useCallback(() => {
    avatarKeyRef.current = "";
    for (const timer of avatarPreviewTimersRef.current)
      globalThis.clearTimeout(timer);
    avatarPreviewTimersRef.current = [];
  }, []);

  return {
    avatar,
    configureAvatar,
    attachAvatarCanvas,
    importAvatarFiles,
    listAvatarModels,
    selectAvatarModel,
    renameAvatarModel,
    deleteAvatarModel,
    previewAvatarEmotion,
    previewAvatarMotion,
    previewAvatarTalking,
    cleanupAvatar,
  };
}