import type { MotionManagerLike, MotionUpdateCoreModel } from "./live2d/motion-update";
import type {
  Live2DModelInstance,
  Live2DRuntimeAdapter,
} from "./live2d-avatar-provider";
import { normalizeCubismCoreUrl, normalizeLive2DModelUrl } from "./defaults";
import { createLipSyncPlugin, createMotionUpdateHook } from "./live2d/motion-update";
import { fitLive2DModel } from "./live2d/fit-model";

/**
 * Concrete Live2D runtime built on PixiJS 6 + pixi-live2d-display/cubism4,
 * mirroring AIRI's stage architecture:
 *
 * - one Pixi Application per canvas, reused across model swaps;
 * - models loaded through `Live2DModel.from` for both hosted URLs and
 *   imported folders (the library's FileLoader reads webkitRelativePath,
 *   which Kana's IndexedDB model store restores);
 * - an AIRI-style motion-manager hook whose final-phase plugin owns the
 *   bound mouth parameter during Qwen3-TTS playback;
 * - AIRI's fit normalization (model = two canvas heights, upper body shown);
 * - pointer focus plus idle Lissajous gaze wander through FocusController;
 * - ticker-level maxFPS and render guarding, pause when hidden/offscreen,
 *   WebGL context-loss recovery, and deferred destruction of retired models.
 */

const loadedCoreScripts = new Map<string, Promise<void>>();

/* Minimal structural views over the pixi.js / pixi-live2d-display objects we
   touch. Keeping them local stops either library's types from leaking into
   the rest of Kana and keeps the runtime adapter swappable. */
type PixiTickerLike = {
  add(fn: (deltaTime: number) => void): void;
  remove(fn: unknown, context?: unknown): void;
  deltaMS: number;
  maxFPS: number;
  speed: number;
  start(): void;
  stop(): void;
};

type PixiApplicationLike = {
  stage: {
    addChild(child: unknown): void;
    removeChild(child: unknown): void;
    scale: { set(x: number, y?: number): void };
  };
  renderer: { resize(width: number, height: number): void };
  ticker: PixiTickerLike;
  render(): void;
  destroy(): void;
};

type KanaLive2DInternalModel = {
  coreModel: MotionUpdateCoreModel;
  focusController: { focus(x: number, y: number, instant?: boolean): void };
  motionManager: MotionManagerLike;
  renderer?: { setClippingMaskBufferSize?(size: number): void };
};

type KanaLive2DModel = {
  autoUpdate: boolean;
  anchor: { set(x: number, y: number): void };
  x: number;
  y: number;
  width: number;
  height: number;
  scale: { set(x: number, y?: number): void };
  focus(x: number, y: number, instant?: boolean): void;
  expression(name?: string): Promise<unknown>;
  motion(group: string, index?: number, priority?: number): Promise<unknown>;
  update(deltaMS: number): void;
  internalModel: KanaLive2DInternalModel;
  destroy(): void;
};

/** Models awaiting destruction until the replacement frame has rendered. */
type RetirableModel = { destroy(): void };

type CanvasRuntime = {
  app: PixiApplicationLike;
  /** CSS pixels per world unit; the stage is scaled by this. */
  resolution: number;
  retiredModels: Set<RetirableModel>;
  currentModel: KanaLive2DModel | null;
};

const canvasRuntimes = new WeakMap<
  HTMLCanvasElement,
  Promise<CanvasRuntime>
>();
let live2dTickerRegistered = false;

/**
 * Render at (close to) the display's native pixel density so Live2D edges stay
 * crisp on high-DPI screens without paying for more than 2x samples.
 */
function renderResolution(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function resolveMaxFps(limit: number | undefined): number {
  if (!limit || limit <= 0) return 0;
  return Math.max(1, Math.round(limit));
}

/**
 * Cubism renders clipping masks (hair, eyes, costume overlaps) into an
 * offscreen framebuffer whose default size is only 256px. Raising it sharpens
 * masked edges, but the fill cost grows quadratically, so the buffer is sized
 * from the real backing resolution and capped.
 */
function clippingMaskBufferSize(width: number, height: number): number {
  const backing = Math.ceil(Math.max(width, height) * renderResolution());
  return Math.min(2048, Math.max(256, backing));
}

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


/** AIRI Canvas.vue-style guarded render: a throwing frame must not kill the page. */
function installRenderGuard(app: PixiApplicationLike): void {
  const guardedRender = () => {
    try {
      app.render();
    } catch (error) {
      console.error("[kana-live2d] Render failed.", error);
      app.ticker.stop();
    }
  };
  app.ticker.remove(app.render as never, app);
  app.ticker.add(guardedRender);
}

async function ensureCanvasRuntime(
  canvas: HTMLCanvasElement,
): Promise<CanvasRuntime> {
  const existing = canvasRuntimes.get(canvas);
  if (existing) return existing;

  const creating = (async () => {
    const [{ Application, Ticker }, display] = await Promise.all([
      import("pixi.js"),
      import("pixi-live2d-display/cubism4"),
    ]);

    if (!live2dTickerRegistered) {
      // https://guansss.github.io/pixi-live2d-display/#package-importing
      (
        display.Live2DModel as unknown as {
          registerTicker(tickerClass: unknown): void;
        }
      ).registerTicker(Ticker);
      // Motion definitions may carry sample Sound files (e.g. the official
      // Haru TapBody motions reference raw.githubusercontent.com WAVs). Left
      // enabled, the library plays those instead of Kana's Qwen3-TTS voice
      // and motionSync can block the mouth on a failed cross-origin audio —
      // the reported "no sound" bug. Speech audio comes only from the voice
      // layer, so the library's own sound path stays off.
      const displayConfig = (
        display as unknown as {
          config?: { sound?: boolean; motionSync?: boolean };
        }
      ).config;
      if (displayConfig) {
        displayConfig.sound = false;
        displayConfig.motionSync = false;
      }
      live2dTickerRegistered = true;
    }

    const host = canvas.parentElement;
    if (!host) throw new Error("The Live2D canvas has no layout host.");

    const resolution = renderResolution();
    const bounds = host.getBoundingClientRect();
    // World coordinates stay in CSS-pixel space; the stage scales them up.
    const app = new Application({
      view: canvas,
      width: Math.max(1, Math.round(bounds.width * resolution)),
      height: Math.max(1, Math.round(bounds.height * resolution)),
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: false,
      resolution: 1,
    }) as unknown as PixiApplicationLike;

    installRenderGuard(app);
    app.stage.scale.set(resolution);

    return {
      app,
      resolution,
      retiredModels: new Set(),
      currentModel: null,
    } satisfies CanvasRuntime;
  })();

  canvasRuntimes.set(canvas, creating);
  try {
    return await creating;
  } catch (error) {
    canvasRuntimes.delete(canvas);
    throw error;
  }
}

function flushRetiredModels(runtime: CanvasRuntime): void {
  const retired = [...runtime.retiredModels];
  runtime.retiredModels.clear();
  // Retired models need their Cubism resources released only after the new
  // model has had one render cycle to replace them in Pixi's pipeline.
  requestAnimationFrame(() => {
    for (const model of retired) model.destroy();
  });
}

function retireCurrentModel(runtime: CanvasRuntime): void {
  const previous = runtime.currentModel;
  runtime.currentModel = null;
  if (!previous) return;
  previous.autoUpdate = false;
  runtime.app.stage.removeChild(previous);
  runtime.retiredModels.add(previous);
}
export class PixiLive2DRuntimeAdapter implements Live2DRuntimeAdapter {
  constructor(
    private readonly coreScriptUrl: string,
    private readonly maxFps: number = 0,
  ) {}

  async load({
    canvas,
    modelUrl,
    modelFiles,
    mouthOpenParameterId,
  }: {
    canvas: HTMLCanvasElement;
    modelUrl?: string;
    modelFiles?: File[];
    mouthOpenParameterId: string;
  }): Promise<Live2DModelInstance> {
    await ensureCubismCore(this.coreScriptUrl);

    const [{ Live2DModel }] = await Promise.all([
      import("pixi-live2d-display/cubism4"),
    ]);
    const runtime = await ensureCanvasRuntime(canvas);

    retireCurrentModel(runtime);

    let source: string | File[];
    if (modelFiles?.length) {
      source = modelFiles;
    } else {
      if (!modelUrl) {
        throw new Error("Live2D requires a model URL or imported files.");
      }
      source = normalizeLive2DModelUrl(modelUrl);
    }

    const raw = await Live2DModel.from(source as never, {
      autoInteract: false,
    });
    const model = raw as unknown as KanaLive2DModel;

    // One control point: the app ticker drives both rendering and Cubism
    // updates, so pausing and maxFPS apply uniformly to the whole scene.
    model.autoUpdate = false;
    model.anchor.set(0.5, 0.5);
    runtime.app.stage.addChild(model);
    runtime.currentModel = model;

    runtime.app.ticker.maxFPS = resolveMaxFps(this.maxFps);

    const host = canvas.parentElement;
    if (!host) throw new Error("The Live2D canvas has no layout host.");

    // --- AIRI-style fit normalization -------------------------------------
    const initialWidth = model.width;
    const initialHeight = model.height;
    let appliedMaskSize = -1;

    const applyFit = () => {
      const bounds = host.getBoundingClientRect();
      const fit = fitLive2DModel(
        bounds.width,
        bounds.height,
        initialWidth,
        initialHeight,
      );
      model.scale.set(fit.scale, fit.scale);
      model.x = fit.x;
      model.y = fit.y;
      // Raising the clipping-mask buffer keeps masked edges crisp. The
      // renderer replaces its clipping manager here, and a fresh manager has
      // no GL context until the model re-runs WebGL setup, so only apply the
      // size when it actually changes and force that re-run below.
      const nextMaskSize = clippingMaskBufferSize(
        bounds.width,
        bounds.height,
      );
      if (nextMaskSize !== appliedMaskSize) {
        appliedMaskSize = nextMaskSize;
        if (
          model.internalModel.renderer?.setClippingMaskBufferSize
        ) {
          model.internalModel.renderer.setClippingMaskBufferSize(nextMaskSize);
          // Force Live2DModel._render to re-run updateWebGLContext (which
          // calls renderer.startUp(gl)) on the next frame.
          (model as unknown as { glContextID?: number }).glContextID = -1;
        }
      }
    };

    // --- Speech state feeding the final-phase lip-sync plugin --------------
    const speech = { speaking: false, mouthOpen: 0 };
    const mouthParameterId = mouthOpenParameterId.trim() || "ParamMouthOpenY";

    const motionUpdateHook = createMotionUpdateHook(
      model.internalModel.motionManager,
    );
    motionUpdateHook.register(
      createLipSyncPlugin({
        mouthOpenParameterId: mouthParameterId,
        getMouthOpen: () => speech.mouthOpen,
        isSpeaking: () => speech.speaking,
      }),
      "final",
    );

    // --- Single ticker drives render + Cubism updates ------------------
    // PixiJS v6 Ticker.add callback receives deltaTime (a multiplier, ~1 at
    // 60 fps), not milliseconds. Cubism update() needs real ms, so we read
    // ticker.deltaMS instead of using the callback parameter.
    const updateModel = () => {
      model.update(runtime.app.ticker.deltaMS);
    };
    runtime.app.ticker.add(updateModel);



    // --- Pointer focus + idle gaze wander (AIRI-style cursor focus) --------
    const focusController = model.internalModel.focusController;
    const POINTER_FOCUS_HOLD_MS = 1_000;
    let lastPointerFocusAt = -Number.POSITIVE_INFINITY;
    const handlePointerMove = (event: PointerEvent) => {
      if (document.hidden) return;
      const bounds = host.getBoundingClientRect();
      model.focus(
        (event.clientX - bounds.left) * runtime.resolution,
        (event.clientY - bounds.top) * runtime.resolution,
      );
      lastPointerFocusAt = performance.now();
    };
    const handlePointerLeave = () => {
      lastPointerFocusAt = -Number.POSITIVE_INFINITY;
    };
    host.addEventListener("pointermove", handlePointerMove, { passive: true });
    host.addEventListener("pointerleave", handlePointerLeave);

    let wanderClock = Math.random() * Math.PI * 2;
    const wanderTick = () => {
      if (performance.now() - lastPointerFocusAt < POINTER_FOCUS_HOLD_MS) {
        return;
      }
      wanderClock += runtime.app.ticker.deltaMS / 1000;
      // A slow, small Lissajous drift keeps the avatar looking around while
      // the cursor is idle or outside the stage.
      focusController.focus(
        Math.sin(wanderClock * 0.31) * 0.34,
        Math.sin(wanderClock * 0.19) * 0.22,
      );
    };
    runtime.app.ticker.add(wanderTick);

    // --- Resize / visibility / context-loss lifecycle ----------------------
    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        const bounds = host.getBoundingClientRect();
        runtime.app.renderer.resize(
          Math.max(1, Math.round(bounds.width * runtime.resolution)),
          Math.max(1, Math.round(bounds.height * runtime.resolution)),
        );
        applyFit();
      });
    });
    resizeObserver.observe(host);

    let hostVisible = true;
    const updatePlayback = () => {
      if (document.hidden || !hostVisible) {
        runtime.app.ticker.stop();
      } else {
        runtime.app.ticker.start();
      }
    };
    const intersectionObserver = new IntersectionObserver((entries) => {
      hostVisible = entries.some((entry) => entry.isIntersecting);
      updatePlayback();
    });
    intersectionObserver.observe(host);
    document.addEventListener("visibilitychange", updatePlayback);

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      runtime.app.ticker.stop();
    };
    const handleContextRestored = () => {
      applyFit();
      updatePlayback();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    // Initial layout before the first ticker-driven frame.
    applyFit();

    // The old model is destroyed after the new one has rendered once.
    flushRetiredModels(runtime);

    return {
      destroy() {
        host.removeEventListener("pointermove", handlePointerMove);
        host.removeEventListener("pointerleave", handlePointerLeave);
        runtime.app.ticker.remove(updateModel);
        runtime.app.ticker.remove(wanderTick);
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        document.removeEventListener("visibilitychange", updatePlayback);
        cancelAnimationFrame(resizeFrame);
        canvas.removeEventListener("webglcontextlost", handleContextLost);
        canvas.removeEventListener(
          "webglcontextrestored",
          handleContextRestored,
        );
        if (runtime.currentModel === model) runtime.currentModel = null;
        model.autoUpdate = false;
        runtime.app.stage.removeChild(model);
        runtime.retiredModels.add(model);
        flushRetiredModels(runtime);
      },
      setExpression(name) {
        void model.expression(name);
      },
      startMotion(group, index) {
        // FORCE guarantees emotion-triggered motions interrupt idle motions.
        void model.motion(group, index, 3);
      },
      setParameter(id, value) {
        const clamped = Math.max(0, Math.min(1, value));
        if (id === mouthParameterId) {
          speech.mouthOpen = clamped;
          return;
        }
        model.internalModel.coreModel.setParameterValueById(id, clamped);
      },
      setTalking(value) {
        speech.speaking = value;
        if (!value) speech.mouthOpen = 0;
      },
    };
  }
}

