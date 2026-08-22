import type {
  Live2DModelInstance,
  Live2DRuntimeAdapter,
} from "./live2d-avatar-provider";
import { normalizeCubismCoreUrl, normalizeLive2DModelUrl } from "./defaults";

const loadedCoreScripts = new Map<string, Promise<void>>();
type DestroyableLive2DModel = {
  destroy(options: {
    children: boolean;
    texture: boolean;
    baseTexture: boolean;
  }): void;
};
type CanvasApplication = {
  app: import("pixi.js").Application;
  retiredModels: Set<DestroyableLive2DModel>;
};
const canvasApplications = new WeakMap<
  HTMLCanvasElement,
  Promise<CanvasApplication>
>();
let pluginRegistered = false;

/**
 * Render at (close to) the display's native pixel density so Live2D edges stay
 * crisp. Capping this well below devicePixelRatio was the main cause of
 * jagged/fragmented model outlines on high-DPI screens.
 */
function renderResolution(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

/** Frame pacing depends on device capability, never on render quality. */
function lowPowerDevice(): boolean {
  const capabilities = navigator as Navigator & { deviceMemory?: number };
  return (
    window.matchMedia("(max-width: 700px)").matches ||
    (capabilities.deviceMemory !== undefined && capabilities.deviceMemory <= 4) ||
    navigator.hardwareConcurrency <= 4
  );
}

type CubismInternals = {
  idManager: { getId(id: string): unknown };
  coreModel: {
    setParameterValueById(id: unknown, value: number): void;
  };
  motionManager?: {
    definitions?: Record<string, Array<{ Sound?: string }> | undefined>;
  };
  renderer?: {
    setClippingMaskBufferSize?(size: number): void;
  };
};

function ensureCubismCore(source: string): Promise<void> {
  source = normalizeCubismCoreUrl(source);
  const existing = loadedCoreScripts.get(source);
  if (existing) return existing;

  const loading = new Promise<void>((resolve, reject) => {
    if ("Live2DCubismCore" in window) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = source;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Could not load Live2D Cubism Core.")),
      { once: true },
    );
    document.head.appendChild(script);
  });
  loadedCoreScripts.set(source, loading);
  return loading;
}

export class PixiLive2DRuntimeAdapter implements Live2DRuntimeAdapter {
  constructor(private readonly coreScriptUrl: string) {}

  async load({
    canvas,
    modelUrl,
    modelFiles,
  }: {
    canvas: HTMLCanvasElement;
    modelUrl?: string;
    modelFiles?: File[];
  }): Promise<Live2DModelInstance> {
    await ensureCubismCore(this.coreScriptUrl);

    const [{ Application, extensions }, { Live2DModel, Live2DPlugin }] =
      await Promise.all([
        import("pixi.js"),
        import("untitled-pixi-live2d-engine/cubism"),
      ]);

    if (!pluginRegistered) {
      extensions.add(Live2DPlugin);
      pluginRegistered = true;
    }

    const host = canvas.parentElement;
    if (!host) throw new Error("Live2D canvas is not attached to the avatar stage.");

    let application = canvasApplications.get(canvas);
    if (!application) {
      const nextApplication = new Application();
      application = nextApplication
        .init({
          canvas,
          antialias: true,
          autoDensity: true,
          backgroundAlpha: 0,
          preference: "webgl",
          resolution: renderResolution(),
          powerPreference: "high-performance",
        })
        .then(() => ({
          app: nextApplication,
          retiredModels: new Set<DestroyableLive2DModel>(),
        }));
      canvasApplications.set(canvas, application);
    }
    let canvasApplication: CanvasApplication;
    try {
      canvasApplication = await application;
    } catch (error) {
      canvasApplications.delete(canvas);
      throw error;
    }
    const { app } = canvasApplication;
    app.ticker.maxFPS = lowPowerDevice() ? 30 : 60;
    // Reuse the renderer when a user replaces a model. Destroying and
    // immediately recreating a Pixi application on the same browser canvas
    // can stall WebGL; one weakly-held application also bounds context usage.
    app.stop();

    const source = modelFiles?.length
      ? modelFiles
      : modelUrl
        ? normalizeLive2DModelUrl(modelUrl)
        : undefined;
    if (!source) {
      throw new Error("No Live2D model source was provided.");
    }

    const model = await Live2DModel.from(
      source as Parameters<typeof Live2DModel.from>[0],
      {
        anchorMode: "drawable",
        autoFocus: false,
        autoHitTest: false,
        crossOrigin: "anonymous",
        // Keep the engine default full-mipmap texture strategy. Forcing a
        // downsampled "single-auto" atlas halved texture resolution and made
        // fine model edges look broken.
      },
    );

    const internals = model.internalModel as unknown as CubismInternals;
    // Cubism renders clipping masks (hair, eyes, costume overlaps) into a
    // framebuffer that defaults to only 256px, which fragments visible edges.
    // Raise it once per load; the engine rebuilds its mask buffers for us.
    internals.renderer?.setClippingMaskBufferSize?.(2048);
    for (const definitions of Object.values(
      internals.motionManager?.definitions ?? {},
    )) {
      for (const definition of definitions ?? []) delete definition.Sound;
    }

    model.anchor.set(0.5, 0.5);
    app.stage.addChild(model);

    let resizeFrame = 0;
    const resizeNow = () => {
      const bounds = host.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      app.renderer.resize(width, height);
      model.scale.set(1);
      const baseWidth = Math.max(1, model.width);
      const baseHeight = Math.max(1, model.height);
      const fitScale = Math.min((width * 0.9) / baseWidth, (height * 0.93) / baseHeight);
      model.scale.set(fitScale * 2);
      model.position.set(width / 2, height * 0.75);
    };
    const resize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(resizeNow);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    let stageVisible = true;
    const updatePlayback = () => {
      if (document.hidden || !stageVisible) app.stop();
      else app.start();
    };
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        stageVisible = Boolean(entry?.isIntersecting);
        updatePlayback();
      },
      { threshold: 0.01 },
    );
    visibilityObserver.observe(host);
    document.addEventListener("visibilitychange", updatePlayback);
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      app.stop();
    };
    const handleContextRestored = () => {
      resize();
      updatePlayback();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    resizeNow();
    // Render once while retired models are still intact. This replaces Pixi's
    // previous instruction list with the new model before their textures and
    // Cubism internals are released.
    app.render();
    const retiredModels = [...canvasApplication.retiredModels];
    canvasApplication.retiredModels.clear();
    updatePlayback();
    // Pixi can retain a submitted Live2D instruction for one animation tick.
    // Two frames give the new stage time to replace it before old textures are
    // released, avoiding a transient null-texture render error.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const retired of retiredModels) {
          retired.destroy({
            children: false,
            // Loader textures can still be referenced by Pixi's Live2D pipe
            // and asset cache. Keep those cache-owned resources alive; the
            // model's Cubism internals and generated LOD textures are still
            // released by destroy().
            texture: false,
            baseTexture: false,
          });
        }
      });
    });

    return {
      destroy() {
        observer.disconnect();
        visibilityObserver.disconnect();
        document.removeEventListener("visibilitychange", updatePlayback);
        cancelAnimationFrame(resizeFrame);
        canvas.removeEventListener("webglcontextlost", handleContextLost);
        canvas.removeEventListener("webglcontextrestored", handleContextRestored);
        app.stop();
        model.automator.autoUpdate = false;
        app.stage.removeChild(model);
        canvasApplication.retiredModels.add(model);
        // The weakly-held application is restarted by the next model load and
        // is reclaimed with the canvas when the avatar stage leaves the page.
        // Retiring rather than immediately destroying the model avoids Pixi
        // executing one stale render instruction against released textures.
      },
      setExpression(name) {
        void model.expression(name);
      },
      startMotion(group, index) {
        void model.motion(group, index, 3);
      },
      setParameter(id, value) {
        internals.coreModel.setParameterValueById(
          internals.idManager.getId(id),
          value,
        );
      },
    };
  }
}
