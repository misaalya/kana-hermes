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
  return Math.min(2048, Math.max(256, backing));
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
        // Drive Cubism updates from the application's own ticker so motion
        // evaluation is locked to rendered frames (no wasted updates on
        // skipped frames) and automatically pauses when hidden.
        ticker: app.ticker,
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

    // Compute initial layout before adding to stage so the model never
    // renders at the 0,0 default position even for a single frame.
    const initWidth = Math.max(1, Math.round(hostBounds.width));
    const initHeight = Math.max(1, Math.round(hostBounds.height));
    model.scale.set(1);
    const baseWidth = Math.max(1, model.width);
    const baseHeight = Math.max(1, model.height);
    const fitScale = Math.min(
      (initWidth * 0.9) / baseWidth,
      (initHeight * 0.93) / baseHeight,
    );
    model.scale.set(fitScale * 2);
    model.position.set(initWidth / 2, initHeight * 0.75);

    app.stage.addChild(model);

    let resizeFrame = 0;
    const resizeNow = () => {
      const bounds = host.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      app.renderer.resize(width, height);
      model.scale.set(1);
      const baseW = Math.max(1, model.width);
      const baseH = Math.max(1, model.height);
      const s = Math.min((width * 0.9) / baseW, (height * 0.93) / baseH);
      model.scale.set(s * 2);
      model.position.set(width / 2, height * 0.75);
    };
    const resize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(resizeNow);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    // Pause the ticker when the page or stage is hidden instead of stopping
    // it. Setting speed to 0 keeps the ticker's timing alive and avoids the
    // startup jitter of a full stop/start cycle when the user returns.
    let stageVisible = true;
    const updatePlayback = () => {
      app.ticker.speed = document.hidden || !stageVisible ? 0 : 1;
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
      motionManager.on?.("motionLoaded", (_group, _index, motion) => {
        if (focusActive) stripEyeballCurves(motion);
      });
    }
    const POINTER_FOCUS_HOLD_MS = 1_000;
    let lastPointerFocusAt = -Number.POSITIVE_INFINITY;
    const handlePointerMove = (event: PointerEvent) => {
      if (document.hidden) return;
      const bounds = host.getBoundingClientRect();
      model.focus(event.clientX - bounds.left, event.clientY - bounds.top);
      lastPointerFocusAt = performance.now();
    };
    const handlePointerLeave = () => {
      lastPointerFocusAt = -Number.POSITIVE_INFINITY;
    };
    host.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    host.addEventListener("pointerleave", handlePointerLeave);
    let wanderClock = Math.random() * Math.PI * 2;
    const wanderTick = (ticker: { deltaMS: number }) => {
      if (!focusActive) return;
      if (
        performance.now() - lastPointerFocusAt < POINTER_FOCUS_HOLD_MS
      ) {
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
      app.ticker.speed = 0;
    };
    const handleContextRestored = () => {
      resize();
      updatePlayback();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    resizeNow();
    // Render one initial frame so the canvas isn't blank while the ticker
    // settles. The ticker handles all subsequent frames.
    app.render();
    const retiredModels = [...canvasApplication.retiredModels];
    canvasApplication.retiredModels.clear();
    updatePlayback();
    // Retired models from a previous session need their Cubism resources
    // released after the new model has had one render cycle to replace
    // them in Pixi's instruction pipeline.
    requestAnimationFrame(() => {
      for (const retired of retiredModels) {
        retired.destroy({
          children: false,
          texture: false,
          baseTexture: false,
        });
      }
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
        canvas.removeEventListener(
          "webglcontextrestored",
          handleContextRestored,
        );
        app.ticker.speed = 0;
        model.automator.autoUpdate = false;
        app.stage.removeChild(model);
        canvasApplication.retiredModels.add(model);
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