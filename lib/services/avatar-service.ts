import type { AvatarController } from "@/lib/avatar/avatar-controller";
import type { AvatarModelSummary } from "@/lib/avatar/indexed-db-avatar-model-store";
import { Live2DAvatarProvider } from "@/lib/avatar/live2d-avatar-provider";
import {
  discoverLive2DModelCapabilities,
  suggestLive2DModelBindings,
  type Live2DModelCapabilities,
} from "@/lib/avatar/live2d-model-capabilities";
import { AvatarLoadSupersededError, type ManagedAvatarProvider } from "@/lib/avatar/managed-avatar-provider";
import { live2DModelBindings, live2DModelLayout } from "@/lib/avatar/model-bindings";
import { PixiLive2DRuntimeAdapter } from "@/lib/avatar/pixi-live2d-runtime-adapter";
import type { KanaMessage } from "@/lib/conversation/types";
import type { KanaPreferences } from "@/lib/preferences/types";
import type { AvatarStore } from "@/lib/store/avatar-store";
import type { ErrorStore } from "@/lib/store/error-store";
import type { PreferencesAccess } from "./preferences-service";

export type AvatarModelLibrary = {
  load(id: string): Promise<File[] | null>;
  list(): Promise<AvatarModelSummary[]>;
  import(files: File[]): Promise<AvatarModelSummary>;
  inspect(id: string): Promise<Live2DModelCapabilities | null>;
  delete(id: string): Promise<void>;
  rename(id: string, name: string): Promise<AvatarModelSummary | null>;
};

export type AvatarServiceDependencies = {
  avatar: AvatarStore;
  errors: ErrorStore;
  preferences: PreferencesAccess;
  provider: ManagedAvatarProvider;
  controller: AvatarController;
  models: AvatarModelLibrary;
};

/** Live2D stage: loads the configured model onto the canvas and manages the model library. */
export class AvatarService {
  private canvas: HTMLCanvasElement | null = null;
  /** Identity of the loaded model and bindings; an unchanged key only updates layout. */
  private loadedKey = "";
  private lastLoadError: Error | null = null;
  private previewTimers: Array<ReturnType<typeof setTimeout>> = [];
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: AvatarServiceDependencies) {}

  get controller(): AvatarController {
    return this.deps.controller;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.deps.avatar.getState().apply(this.deps.provider.getSnapshot());
    this.unsubscribe = this.deps.provider.subscribe((snapshot) => this.deps.avatar.getState().apply(snapshot));
  }

  async configure(next: KanaPreferences, selectedModelFiles?: File[], force?: boolean): Promise<boolean> {
    const canvas = this.canvas;
    if (!canvas) return false;
    const startedAt = performance.now();
    try {
      let modelFiles = selectedModelFiles;
      if (!modelFiles?.length && next.live2d.modelId) {
        modelFiles = (await this.deps.models.load(next.live2d.modelId)) ?? undefined;
        if (!modelFiles?.length) {
          throw new Error(
            `The saved Live2D model "${next.live2d.modelName || next.live2d.modelId}" is no longer available.`,
          );
        }
      }

      let bindings = live2DModelBindings(next.live2d);
      if (bindings.mouthOpenParameter === "auto" && modelFiles?.length) {
        const capabilities = await discoverLive2DModelCapabilities(modelFiles);
        if (capabilities.suggestedMouthParameter) {
          bindings = { ...bindings, mouthOpenParameter: capabilities.suggestedMouthParameter };
        }
      }
      const layout = live2DModelLayout(next.live2d);
      const key = modelFiles?.length
        ? `files:${modelFiles
            .map((file) => `${file.webkitRelativePath}:${file.size}:${file.lastModified}`)
            .join("|")}:${JSON.stringify(bindings)}`
        : `live2d:${next.live2d.coreScriptUrl}:${next.live2d.modelId || next.live2d.modelUrl}:${JSON.stringify(bindings)}`;
      if (!force && this.loadedKey === key) {
        this.deps.controller.setLayout(layout);
        return true;
      }

      const runtime = new PixiLive2DRuntimeAdapter(next.live2d.coreScriptUrl.trim());
      const provider = new Live2DAvatarProvider(runtime, bindings, layout);
      await this.deps.provider.use(provider, {
        id: modelFiles?.length ? "imported-live2d" : "configured-live2d",
        name: modelFiles?.length ? "Imported Live2D model" : "Live2D model",
        canvas,
        modelFiles,
        modelUrl: modelFiles?.length ? undefined : next.live2d.modelUrl.trim(),
      });
      this.loadedKey = key;
      this.lastLoadError = null;
      this.deps.controller.presentEmotion("neutral");
      this.deps.errors.getState().accumulateMetrics({
        lastAvatarLoadDurationMs: Math.round(performance.now() - startedAt),
      });
      return true;
    } catch (avatarError) {
      // A newer configure call owns the stage; leave its state alone.
      if (avatarError instanceof AvatarLoadSupersededError) return false;
      this.lastLoadError = avatarError instanceof Error ? avatarError : new Error("Unknown Live2D runtime error.");
      this.loadedKey = "mock-fallback";
      this.deps.errors.getState().report(
        "avatar",
        avatarError instanceof Error
          ? `Live2D could not load: ${avatarError.message}`
          : "Live2D could not load. Kana is using the CSS preview.",
        "avatar",
      );
      return false;
    }
  }

  attachCanvas(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    if (canvas) void this.configure(this.deps.preferences.current());
  }

  async importFiles(files: File[]): Promise<AvatarModelSummary> {
    if (!files.length) throw new Error("Choose a Live2D model folder first.");
    const previous = this.deps.preferences.current();
    const imported = await this.deps.models.import(files);
    const capabilities = imported.capabilities ?? (await this.deps.models.inspect(imported.id));
    const sourceKey = `import:${imported.id}`;
    const next: KanaPreferences = {
      ...previous,
      live2d: {
        ...previous.live2d,
        modelId: imported.id,
        modelName: imported.name,
        bindingProfiles: {
          ...previous.live2d.bindingProfiles,
          ...(capabilities ? { [sourceKey]: suggestLive2DModelBindings(capabilities) } : {}),
        },
      },
    };
    this.loadedKey = "";
    if (!(await this.configure(next, files))) {
      const detail = this.lastLoadError?.message;
      await this.deps.models.delete(imported.id);
      this.loadedKey = "";
      await this.configure(previous);
      throw new Error(`The selected folder could not be loaded.${detail ? ` ${detail}` : ""}`);
    }
    this.deps.preferences.persist(next);
    return imported;
  }

  listModels(): Promise<AvatarModelSummary[]> {
    return this.deps.models.list();
  }

  async inspectModel(id: string): Promise<Live2DModelCapabilities> {
    const capabilities = await this.deps.models.inspect(id);
    if (!capabilities) throw new Error("The selected Live2D model no longer exists.");
    return capabilities;
  }

  async selectModel(id: string): Promise<AvatarModelSummary> {
    const previous = this.deps.preferences.current();
    const model = (await this.deps.models.list()).find((item) => item.id === id);
    if (!model) throw new Error("The selected Live2D model no longer exists.");
    const files = await this.deps.models.load(id);
    if (!files?.length) throw new Error("The selected Live2D package is empty.");
    const next: KanaPreferences = {
      ...previous,
      live2d: { ...previous.live2d, modelId: model.id, modelName: model.name },
    };
    this.loadedKey = "";
    if (!(await this.configure(next, files))) {
      const detail = this.lastLoadError?.message;
      this.loadedKey = "";
      await this.configure(previous);
      throw new Error(
        `The saved Live2D package could not be loaded. Kana restored the previous avatar.${detail ? ` ${detail}` : ""}`,
      );
    }
    this.deps.preferences.persist(next);
    return model;
  }

  async renameModel(id: string, name: string): Promise<AvatarModelSummary> {
    const renamed = await this.deps.models.rename(id, name);
    if (!renamed) throw new Error("The selected Live2D model no longer exists.");
    const preferences = this.deps.preferences.current();
    if (preferences.live2d.modelId === id) {
      this.deps.preferences.persist({
        ...preferences,
        live2d: { ...preferences.live2d, modelName: renamed.name },
      });
    }
    return renamed;
  }

  async deleteModel(id: string): Promise<void> {
    const preferences = this.deps.preferences.current();
    if (preferences.live2d.modelId === id) {
      throw new Error("Switch to another avatar before deleting the active model.");
    }
    await this.deps.models.delete(id);
    const sourceKey = `import:${id}`;
    if (preferences.live2d.bindingProfiles?.[sourceKey] || preferences.live2d.layoutProfiles?.[sourceKey]) {
      const bindingProfiles = { ...preferences.live2d.bindingProfiles };
      const layoutProfiles = { ...preferences.live2d.layoutProfiles };
      delete bindingProfiles[sourceKey];
      delete layoutProfiles[sourceKey];
      this.deps.preferences.persist({
        ...preferences,
        live2d: { ...preferences.live2d, bindingProfiles, layoutProfiles },
      });
    }
  }

  async previewEmotion(next: KanaPreferences, emotion: KanaMessage["emotion"]): Promise<void> {
    if (!emotion || !(await this.configure(next))) return;
    this.deps.controller.presentEmotion(emotion);
  }

  async previewTalking(next: KanaPreferences): Promise<void> {
    if (!(await this.configure(next))) return;
    this.clearPreviewTimers();
    const controller = this.deps.controller;
    controller.setTalking(true);
    controller.setMouthOpen(0.8);
    this.previewTimers.push(
      globalThis.setTimeout(() => controller.setMouthOpen(0.25), 300),
      globalThis.setTimeout(() => controller.setMouthOpen(0.7), 520),
      globalThis.setTimeout(() => controller.setTalking(false), 850),
    );
  }

  /** Unload the model; attaching a canvas again reloads it. */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clearPreviewTimers();
    this.loadedKey = "";
    this.deps.provider.unload();
  }

  private clearPreviewTimers(): void {
    for (const timer of this.previewTimers) globalThis.clearTimeout(timer);
    this.previewTimers = [];
  }
}
