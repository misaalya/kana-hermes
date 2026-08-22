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

/**
 * Cubism renders clipping masks (hair, eyes, costume overlaps) into an
 * offscreen framebuffer whose default size is only 256px. Raising it sharpens
 * masked edges, but the fill cost grows quadratically, so the buffer is sized
 * from the real backing resolution and capped: never sharper than the canvas
 * itself, never below the SDK default.
 */
function clippingMaskBufferSize(width: number, height: number): number {
  const backing = Math.ceil(Math.max(width, height) * renderResolution());
  return Math.min(1024, Math.max(256, backing));
}

type MotionCurveList = {
  at(index: number): { id?: unknown } | undefined;
  getSize(): number;
};

type CubismInternals = {
  idManager: { getId(id: string): unknown };
  coreModel: {
    setParameterValueById(id: unknown, value: number): void;
  };
  motionManager?: {
    definitions?: Record<string, Array<{ Sound?: string }> | undefined>;
    motionGroups?: Partial<Record<string, Array<unknown | undefined | null>>>;
    on?(
      event: string,
      listener: (...args: unknown[]) => void,
    ): unknown;
  };
  focusController?: {
    focus(x: number, y: number, instant?: boolean): void;
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
          // MSAA is intentionally off: Live2D drawables are alpha-blended
          // textured quads, so multisampling does not soften texture edges but
          // still multiplies the fill cost of a fullscreen canvas on weak GPUs.
          antialias: false,
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
    app.ticker.maxFPS = 60;
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
        // Drive Cubism updates from the application's own ticker instead of
        // the uncapped global Ticker.shared. This keeps motion evaluation
        // locked to rendered frames (no wasted updates on skipped frames or
        // high-refresh displays) and stops it automatically whenever the
        // stage pauses the ticker (hidden tab, offscreen stage, lost context).
        ticker: app.ticker,
        // Keep the engine default full-mipmap texture strategy. Forcing a
        // downsampled "single-auto" atlas halved texture resolution and made
        // fine model edges look broken.
      },
    );

    const internals = model.internalModel as unknown as CubismInternals;
    const hostBounds = host.getBoundingClientRect();
    internals.renderer?.setClippingMaskBufferSize?.(
      clippingMaskBufferSize(hostBounds.width, hostBounds.height),
    );
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

    // --- Cursor focus (eye tracking), modeled on AIRI's Live2D stage -----
    // The avatar watches the pointer while it moves and gently drifts its
    // gaze around after a short pause. All of this lives in the runtime
    // adapter closure: pointer movement must never re-render React
    // components, and the presentation layer stays unaware of it.
    let focusActive = true;
    const focusController = internals.focusController;
    const stripEyeballCurves = (motion: unknown) => {
      const curves = (
        motion as { _motionData?: { curves?: MotionCurveList } } | null
      )?._motionData?.curves;
      if (!curves || typeof curves.at !== "function") return;
      const count = curves.getSize();
      for (let index = 0; index < count; index += 1) {
        const curve = curves.at(index);
        if (!curve) continue;
        const id = curve.id as
          | { getString?(): { s?: string } }
          | string
          | undefined;
        const name =
          typeof id === "string" ? id : (id?.getString?.().s ?? null);
        if (name !== "ParamEyeBallX" && name !== "ParamEyeBallY") continue;
        // Rename the curve to an unknown parameter id. Cubism routes writes
        // to unknown ids into dummy storage, so the motion's eyeball values
        // never reach the real parameters and cannot fight the focus
        // controller, which adds its gaze on top of motion values.
        curve.id = internals.idManager.getId(`_kanaFocus${name}`);
      }
    };
    const motionManager = internals.motionManager;
    if (motionManager) {
      for (const motions of Object.values(
        motionManager.motionGroups ?? {},
      )) {
        for (const motion of motions ?? []) stripEyeballCurves(motion);
      }
      // Motions load lazily; strip each one as it finishes loading.
      motionManager.on?.("motionLoaded", (_group, _index, motion) => {
        if (focusActive) stripEyeballCurves(motion);
      });
    }
    const POINTER_FOCUS_HOLD_MS = 1_000;
    let lastPointerFocusAt = -Number.POSITIVE_INFINITY;
    const handlePointerMove = (event: PointerEvent) => {
      if (document.hidden) return;
      const bounds = host.getBoundingClientRect();
      // The canvas fills the host, so host-relative coordinates are the
      // Pixi world coordinates that model.focus() expects.
      model.focus(event.clientX - bounds.left, event.clientY - bounds.top);
      lastPointerFocusAt = performance.now();
    };
    const handlePointerLeave = () => {
      lastPointerFocusAt = -Number.POSITIVE_INFINITY;
    };
    host.addEventListener("pointermove", handlePointerMove, { passive: true });
    host.addEventListener("pointerleave", handlePointerLeave);
    let wanderClock = Math.random() * Math.PI * 2;
    const wanderTick = (ticker: { deltaMS: number }) => {
      if (!focusActive) return;
      if (performance.now() - lastPointerFocusAt < POINTER_FOCUS_HOLD_MS) {
        return;
      }
      wanderClock += ticker.deltaMS / 1000;
      // A slow, small Lissajous drift keeps the avatar looking around
      // while the cursor is idle or outside the stage.
      focusController?.focus(
        Math.sin(wanderClock * 0.31) * 0.34,
        Math.sin(wanderClock * 0.19) * 0.22,
      );
    };
    app.ticker.add(wanderTick);

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
        focusActive = false;
        host.removeEventListener("pointermove", handlePointerMove);
        host.removeEventListener("pointerleave", handlePointerLeave);
        app.ticker.remove(wanderTick);
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
