import {
  createLipSyncPlugin,
  createMotionUpdateHook,
  type MotionManagerLike,
  type MotionUpdateCoreModel,
} from "./live2d/motion-update";
import type {
  Live2DModelInstance,
  Live2DRuntimeAdapter,
} from "./live2d-avatar-provider";
import { normalizeCubismCoreUrl, normalizeLive2DModelUrl } from "./defaults";
import { assertSupportedMoc3 } from "./live2d/moc3-version";
import { fitLive2DModel, type Live2DModelBounds } from "./live2d/fit-model";
import {
  normalizeLive2DModelLayout,
  type Live2DModelLayout,
} from "./model-layout";
import { withRecoveredLive2DPresets } from "./live2d-model-capabilities";

/**
 * Concrete Live2D runtime built on PixiJS 6 + pixi-live2d-display/cubism4,
 * mirroring AIRI's stage architecture:
 *
 * - one Pixi Application per canvas, reused across model swaps;
 * - models loaded through `Live2DModel.from` for both hosted URLs and
 *   imported folders (the library's FileLoader reads webkitRelativePath,
 *   which Kana's IndexedDB model store restores);
 * - an AIRI-style motion-manager hook whose final-phase plugin owns the
 *   bound mouth parameter during speech playback;
 * - bounds-aware automatic fit with a per-model normalized user adjustment;
 * - pointer focus plus idle Lissajous gaze wander through FocusController;
 * - ticker-level maxFPS and render guarding, pause when hidden/offscreen,
 *   WebGL context-loss recovery, and deferred destruction of retired models.
 */

const loadedCoreScripts = new Map<string, Promise<void>>();

/**
 * pixi-live2d-display 0.4 looks for the first filename that ends in either
 * `model.json` or `model3.json`. A companion file such as
 * `items_pinned_to_model.json` also ends in `model.json`, so the library can
 * parse that unrelated file and reject an otherwise valid Cubism 4 package.
 * Kana's importer already guarantees exactly one `.model3.json`; place that
 * validated settings file first without changing the persisted file order.
 */
export function prioritizeLive2DSettingsFile(files: File[]): File[] {
  const settingsIndex = files.findIndex((file) => {
    const path = (file.webkitRelativePath || file.name)
      .replaceAll("\\", "/")
      .toLowerCase();
    return path.endsWith(".model3.json");
  });
  if (settingsIndex <= 0) return files;
  return [
    files[settingsIndex],
    ...files.slice(0, settingsIndex),
    ...files.slice(settingsIndex + 1),
  ];
}

/**
 * Give imported files root-relative virtual paths before handing them to
 * pixi-live2d-display. Its browser `url.resolve` polyfill resolves a relative
 * settings path such as `Kana/Kana.model3.json` to `/Kana/Kana.moc3`, while
 * the directory picker reports `Kana/Kana.moc3`. Rooting both sides keeps the
 * library's validation and object-URL lookup consistent in production builds.
 */
function filePath(file: File): string {
  return (file.webkitRelativePath || file.name).replace(/\\/g, "/");
}

/** First bytes of the moc3 referenced by an imported package, if present. */
export async function readPackageMoc3Header(files: File[]): Promise<ArrayBuffer | null> {
  const settingsFile = files.find((file) => filePath(file).endsWith(".model3.json"));
  let moc: File | undefined;
  if (settingsFile) {
    try {
      const reference = (JSON.parse(await settingsFile.text()) as {
        FileReferences?: { Moc?: unknown };
      }).FileReferences?.Moc;
      if (typeof reference === "string" && reference.trim()) {
        const base = filePath(settingsFile).split("/").slice(0, -1);
        const segments = [...base];
        for (const part of reference.trim().replace(/\\/g, "/").split("/")) {
          if (!part || part === ".") continue;
          if (part === "..") segments.pop();
          else segments.push(part);
        }
        const resolved = segments.join("/");
        moc = files.find((file) => filePath(file) === resolved);
      }
    } catch {
      // Unreadable settings are reported by the runtime itself.
    }
  }
  moc ??= files.filter((file) => filePath(file).endsWith(".moc3")).at(0);
  return moc ? moc.slice(0, 8).arrayBuffer() : null;
}

/** First bytes of the moc3 referenced by a hosted model3.json. */
async function readHostedMoc3Header(modelUrl: string): Promise<ArrayBuffer | null> {
  const settings = await fetch(modelUrl, { credentials: "omit" });
  if (!settings.ok) return null;
  const reference = ((await settings.json()) as { FileReferences?: { Moc?: unknown } })
    .FileReferences?.Moc;
  if (typeof reference !== "string" || !reference.trim()) return null;
  const moc = await fetch(new URL(reference.trim(), modelUrl), {
    credentials: "omit",
    headers: { Range: "bytes=0-7" },
  });
  if (!moc.ok) return null;
  return (await moc.arrayBuffer()).slice(0, 8);
}

export function prepareLive2DPackageFiles(files: File[]): File[] {
  return prioritizeLive2DSettingsFile(files).map((file) => {
    const currentPath = (file.webkitRelativePath || file.name)
      .replaceAll("\\", "/")
      .replace(/^\/+/, "");
    const prepared = new File([file], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
    Object.defineProperty(prepared, "webkitRelativePath", {
      configurable: true,
      value: `/${currentPath}`,
    });
    return prepared;
  });
}

/**
 * Kana owns every audible character response through the configured TTS
 * provider. Live2D packages may also attach arbitrary prerecorded audio to a
 * motion (the official Haru sample does this), and pixi-live2d-display enables
 * that audio globally by default. Letting both paths play makes a failed TTS
 * request sound like a short, unrelated Japanese reply from the avatar.
 *
 * Keep expressions and motions enabled, but make their embedded Sound entries
 * presentation-only. This applies uniformly to official, hosted, and imported
 * models without rewriting the user's package.
 */
export function disableLive2DMotionAudio(config: { sound: boolean }): void {
  config.sound = false;
}

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
  coreModel: MotionUpdateCoreModel & {
    /** Cubism SDK's loaded parameter IDs; used only for compatibility detection. */
    _parameterIds?: unknown[];
    /** Final drawable opacity after parts, poses, and motions are applied. */
    getDrawableOpacity?(drawableIndex: number): number;
    getModel?(): { parameters?: { ids?: unknown[] } };
  };
  /** Cubism vertices converted into the model's logical canvas coordinates. */
  getDrawableIDs?(): string[];
  getDrawableVertices?(drawIndex: string | number): number[];
  /** model3.json HitAreas keyed by name, each pointing at a drawable. */
  hitAreas?: Record<string, { index: number }>;
  /** Optional model3.json layout transform applied before rendering. */
  localTransform?: {
    a: number;
    b: number;
    c: number;
    d: number;
    tx: number;
    ty: number;
  };
  focusController: { focus(x: number, y: number, instant?: boolean): void };
  motionManager: MotionManagerLike & {
    expressionManager?: { resetExpression(): void };
    lipSyncIds?: string[];
  };
  renderer?: { setClippingMaskBufferSize?(size: number): void };
};

type KanaLive2DModel = {
  autoUpdate: boolean;
  anchor: { set(x: number, y: number): void };
  pivot: { x: number; y: number };
  x: number;
  y: number;
  width: number;
  height: number;
  getLocalBounds(): { x: number; y: number; width: number; height: number };
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
let pixiUnsafeEvalInstalled = false;

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
    // Pixi's default shader generator relies on `new Function`, which Kana's
    // production CSP intentionally blocks. The official Pixi adapter replaces
    // that generator and must be installed before a renderer is constructed.
    // Keep the CSP strict: avatar rendering should adapt to it, not weaken it.
    const [unsafeEval, { Application, ShaderSystem, Ticker }, display] =
      await Promise.all([
        import("@pixi/unsafe-eval"),
        import("pixi.js"),
        import("pixi-live2d-display/cubism4"),
      ]);
    if (!pixiUnsafeEvalInstalled) {
      unsafeEval.install({ ShaderSystem });
      pixiUnsafeEvalInstalled = true;
    }

    if (!live2dTickerRegistered) {
      // https://guansss.github.io/pixi-live2d-display/#package-importing
      (
        display.Live2DModel as unknown as {
          registerTicker(tickerClass: unknown): void;
        }
      ).registerTicker(Ticker);
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

/**
 * Measure the visible Cubism drawables instead of only the model canvas.
 * Some packages reserve a large transparent margin (or put the character
 * below the canvas midpoint); fitting the canvas in that case still leaves
 * the artwork cropped. The internal model exposes drawable vertices after
 * applying PixelsPerUnit and the canvas origin, so this remains independent
 * of texture resolution and works for imported model3.json packages.
 */
/** Hit area names that mark a model's head across common authoring conventions. */
const HEAD_HIT_AREA = /^(head|face|atama|kao)$|頭|顔/i;
/** Drawables fainter than this are hidden variants (alternate arms, effects). */
const VISIBLE_OPACITY = 0.01;
/**
 * Updates to run before measuring. Freshly loaded meshes are undeformed and
 * every alternate part is still opaque; a few updates apply deformers, poses,
 * and part opacity so the bounds match what is actually drawn.
 */
const MEASURE_WARMUP_UPDATES = 3;

/** Share of the model height, from the top, treated as the head band. */
const CROWN_BAND = 0.18;

function drawableBox(
  internal: KanaLive2DInternalModel,
  indices: Iterable<string | number>,
  maximumY = Number.POSITIVE_INFINITY,
): Live2DModelBounds | null {
  const getVertices = internal.getDrawableVertices;
  if (!getVertices) return null;
  const transform = internal.localTransform;
  const a = Number.isFinite(transform?.a) ? transform!.a : 1;
  const b = Number.isFinite(transform?.b) ? transform!.b : 0;
  const c = Number.isFinite(transform?.c) ? transform!.c : 0;
  const d = Number.isFinite(transform?.d) ? transform!.d : 1;
  const tx = Number.isFinite(transform?.tx) ? transform!.tx : 0;
  const ty = Number.isFinite(transform?.ty) ? transform!.ty : 0;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const index of indices) {
    let vertices: number[];
    try {
      vertices = getVertices.call(internal, index);
    } catch {
      continue;
    }
    for (let offset = 0; offset + 1 < vertices.length; offset += 2) {
      const sourceX = vertices[offset];
      const sourceY = vertices[offset + 1];
      if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) continue;
      const x = a * sourceX + c * sourceY + tx;
      const y = b * sourceX + d * sourceY + ty;
      if (y > maximumY) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const width = maxX - minX;
  const height = maxY - minY;
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { x: minX, y: minY, width, height };
}

/** Visible drawable bounds and the head hit area, in model canvas units. */
function measureModelGeometry(model: KanaLive2DModel): {
  bounds: Live2DModelBounds;
  head: Live2DModelBounds | null;
  crown: Live2DModelBounds | null;
} | null {
  const internal = model.internalModel;
  const ids = internal.getDrawableIDs?.();
  if (!ids?.length || !internal.getDrawableVertices) return null;

  for (let step = 0; step < MEASURE_WARMUP_UPDATES; step += 1) {
    try {
      model.update(16);
    } catch {
      break;
    }
  }

  const opacity = internal.coreModel.getDrawableOpacity;
  const visible = ids
    .map((_, index) => index)
    .filter((index) => {
      if (!opacity) return true;
      try {
        return opacity.call(internal.coreModel, index) > VISIBLE_OPACITY;
      } catch {
        return true;
      }
    });
  const drawn = visible.length ? visible : ids;
  const bounds = drawableBox(internal, drawn) ?? drawableBox(internal, ids);
  if (!bounds) return null;

  const headEntry = Object.entries(internal.hitAreas ?? {})
    .find(([name]) => HEAD_HIT_AREA.test(name.trim()));
  const head = headEntry && Number.isInteger(headEntry[1]?.index) && headEntry[1].index >= 0
    ? drawableBox(internal, [headEntry[1].index])
    : null;
  const crown = drawableBox(internal, drawn, bounds.y + bounds.height * CROWN_BAND);
  return { bounds, head, crown };
}

/** Reads a registered `<length>` custom property that CSS resolved to pixels. */
function readPixelProperty(element: Element, name: string): number {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  if (!value.endsWith("px")) return 0;
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) && pixels > 0 ? pixels : 0;
}

function retireCurrentModel(runtime: CanvasRuntime): void {
  const previous = runtime.currentModel;
  runtime.currentModel = null;
  if (!previous) return;
  previous.autoUpdate = false;
  runtime.app.stage.removeChild(previous);
  runtime.retiredModels.add(previous);
}

function parameterId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const candidate = value as { s?: unknown; id?: unknown; toString?(): string };
  if (typeof candidate.s === "string") return candidate.s;
  if (typeof candidate.id === "string") return candidate.id;
  const text = candidate.toString?.();
  return text && text !== "[object Object]" ? text : null;
}

function loadedParameterIds(model: KanaLive2DModel): string[] {
  const core = model.internalModel.coreModel;
  const raw = core._parameterIds ?? core.getModel?.().parameters?.ids ?? [];
  return raw.map(parameterId).filter((id): id is string => Boolean(id));
}

function looksLikeMouthParameter(id: string): boolean {
  const normalized = id.toLowerCase();
  return (
    id === "ParamA" ||
    ((normalized.includes("mouth") || normalized.includes("lip")) &&
      (normalized.includes("open") || normalized.endsWith("a") || normalized.includes("vowel")))
  );
}

/**
 * Resolve lip-sync internally. A stale/manual body parameter is deliberately
 * rejected instead of making the avatar move incorrectly while speaking.
 */
export function selectLive2DMouthParameterId(options: {
  configured: string;
  loaded: string[];
  registered: string[];
}): string | null {
  const loaded = new Set(options.loaded);
  const configured = options.configured.trim();

  // A manual choice is an explicit expert override. Respect it even when it
  // is unconventional, but only if it exists in the loaded model.
  if (configured && configured !== "auto" && loaded.has(configured)) {
    return configured;
  }

  const registeredCandidates = options.registered.filter(
    (id) => !loaded.size || loaded.has(id),
  );
  // Some exporters register both ParamMouthForm and ParamMouthOpenY in the
  // LipSync group. Form controls the vowel shape, not whether the mouth is
  // open, so prefer the actual opening control when more than one is present.
  const registeredMatch = registeredCandidates.length === 1
    ? registeredCandidates[0]
    : registeredCandidates.find(looksLikeMouthParameter);
  if (registeredMatch) return registeredMatch;

  const candidates = [
    "ParamMouthOpenY",
    "ParamA",
    ...loaded,
  ];
  return candidates.find((id) => (
    id && id !== "auto" && looksLikeMouthParameter(id) && (!loaded.size || loaded.has(id))
  )) ?? null;
}

function resolveMouthParameterId(
  model: KanaLive2DModel,
  configured: string,
): string | null {
  return selectLive2DMouthParameterId({
    configured,
    loaded: loadedParameterIds(model),
    registered: model.internalModel.motionManager.lipSyncIds ?? [],
  });
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
    layout,
  }: {
    canvas: HTMLCanvasElement;
    modelUrl?: string;
    modelFiles?: File[];
    mouthOpenParameterId: string;
    layout: Live2DModelLayout;
  }): Promise<Live2DModelInstance> {
    await ensureCubismCore(this.coreScriptUrl);

    const [{ Live2DModel, config: live2dConfig }] = await Promise.all([
      import("pixi-live2d-display/cubism4"),
    ]);
    disableLive2DMotionAudio(live2dConfig);
    const runtime = await ensureCanvasRuntime(canvas);

    retireCurrentModel(runtime);

    let source: string | File[];
    if (modelFiles?.length) {
      // Imports are validated, but packages saved before that check existed
      // are verified here so an unsupported moc3 fails with a clear reason.
      const header = await readPackageMoc3Header(modelFiles);
      if (header) assertSupportedMoc3(header);
      source = prepareLive2DPackageFiles(
        await withRecoveredLive2DPresets(modelFiles),
      );
    } else {
      if (!modelUrl) {
        throw new Error("Live2D requires a model URL or imported files.");
      }
      source = normalizeLive2DModelUrl(modelUrl);
    }

    let raw: unknown;
    try {
      raw = await Live2DModel.from(source as never, {
        autoInteract: false,
      });
    } catch (error) {
      // The Core rejects a newer moc3 with only a console log, so the SDK
      // reports "Unknown error". Diagnose hosted models once the load fails
      // rather than paying an extra request on every successful load.
      if (typeof source === "string") {
        const header = await readHostedMoc3Header(source).catch(() => null);
        if (header) assertSupportedMoc3(header);
      }
      throw error;
    }
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

    // --- Model-geometry-aware framing -------------------------------------
    // Vertices are read after a short warm-up so deformers, poses, and part
    // opacity apply; hidden variants and effects would otherwise inflate the
    // bounds. Pixi's getLocalBounds() ignores the anchor pivot, so every box is
    // converted into the model's anchored coordinate space before framing.
    const measured = measureModelGeometry(model);
    const toAnchored = (box: Live2DModelBounds): Live2DModelBounds => ({
      x: box.x - model.pivot.x,
      y: box.y - model.pivot.y,
      width: box.width,
      height: box.height,
    });
    const fallbackBounds = model.getLocalBounds();
    const geometry = measured
      ? {
          bounds: toAnchored(measured.bounds),
          head: measured.head ? toAnchored(measured.head) : null,
          crown: measured.crown ? toAnchored(measured.crown) : null,
        }
      : {
          bounds: Number.isFinite(fallbackBounds.width) && fallbackBounds.width > 0 &&
            Number.isFinite(fallbackBounds.height) && fallbackBounds.height > 0
            ? toAnchored(fallbackBounds)
            : {
                x: -model.width / 2,
                y: -model.height / 2,
                width: model.width,
                height: model.height,
              },
          head: null,
        };
    let activeLayout = normalizeLive2DModelLayout(layout);
    let appliedMaskSize = -1;

    const applyFit = () => {
      const bounds = host.getBoundingClientRect();
      const fit = fitLive2DModel(
        bounds.width,
        bounds.height,
        geometry,
        activeLayout,
        {
          top: readPixelProperty(host, "--kana-avatar-safe-top"),
          bottom: readPixelProperty(host, "--kana-avatar-safe-bottom"),
        },
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

    // --- Speech state feeding the proven motion-manager lip-sync hook ------
    const speech = { speaking: false, mouthOpen: 0 };
    const mouthParameterId = resolveMouthParameterId(
      model,
      mouthOpenParameterId.trim() || "auto",
    );

    if (mouthParameterId) {
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
    }

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
      clearExpression() {
        model.internalModel.motionManager.expressionManager?.resetExpression();
      },
      startMotion(group, index) {
        // FORCE guarantees emotion-triggered motions interrupt idle motions.
        void model.motion(group, index, 3);
      },
      setMouthOpen(value) {
        speech.mouthOpen = Math.max(0, Math.min(1, value));
      },
      setTalking(value) {
        speech.speaking = value;
        if (!value) speech.mouthOpen = 0;
      },
      setLayout(nextLayout) {
        activeLayout = normalizeLive2DModelLayout(nextLayout);
        applyFit();
      },
    };
  }
}
