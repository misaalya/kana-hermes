// Kana's liquid mode wave, painted on a 2D canvas.
//
// Four flat sheets of water, from a pale mix of the accent and white at the
// back to the accent itself in front, pour down over the screen one after
// another and drain away front first. Every edge is a living wave, not a
// printed tile: three harmonics that drift in their own direction, swell while
// the edge moves, and let the middle of a moving edge lead like poured liquid.
// Foam rides the crests, droplets spray ahead of the pour and drip behind the
// drain, bubbles rise through the front sheet, which carries a faint seigaiha
// (Japanese wave) texture. Everything is a flat shape: no shadow, no glow, no
// blur.
//
// The timeline and geometry are plain functions so they can be tested; the
// painter only draws what they describe.

export type Rgb = readonly [number, number, number];

export const MODE_WAVE_LAYER_COUNT = 4;
const FRONT = MODE_WAVE_LAYER_COUNT - 1;

export const MODE_WAVE_TIMING = {
  /** Each sheet starts this long after the one behind it. */
  coverStaggerMs: 45,
  coverMs: 400,
  /** The least time the covered screen shows before it drains. */
  holdMs: 120,
  /** The front sheet drains first; each one behind follows this much later. */
  revealStaggerMs: 55,
  revealMs: 460,
} as const;

/** Elapsed time at which the front sheet covers the whole screen. */
export const MODE_WAVE_COVER_END_MS =
  (MODE_WAVE_LAYER_COUNT - 1) * MODE_WAVE_TIMING.coverStaggerMs + MODE_WAVE_TIMING.coverMs;

/** From the start of the drain until the last sheet has left the screen. */
export const MODE_WAVE_REVEAL_SPAN_MS =
  (MODE_WAVE_LAYER_COUNT - 1) * MODE_WAVE_TIMING.revealStaggerMs + MODE_WAVE_TIMING.revealMs;

/** Share of the accent in each sheet, back to front; the rest is white. */
const LAYER_ACCENT_SHARE = [0.24, 0.48, 0.74, 1] as const;
/** Crest height and wavelength per sheet, relative to the base values. */
const LAYER_AMPLITUDE = [1.22, 1.1, 1, 0.9] as const;
const LAYER_WAVELENGTH = [1.18, 0.9, 1.05, 0.84] as const;
/** Neighbouring sheets flow in opposite directions. */
const LAYER_FLOW = [1, -1, 1, -1] as const;
/** Three harmonics per crest: share of the height, wavelength, angular speed (rad/s). */
const HARMONICS = [
  { share: 0.55, length: 1, speed: 2.4 },
  { share: 0.3, length: 0.53, speed: -3.6 },
  { share: 0.15, length: 0.29, speed: 5.3 },
] as const;
/** A resting edge keeps a gentle swell; a moving one swells up to the sum. */
const AGITATION_REST = 0.55;
const AGITATION_GAIN = 0.75;
const AGITATION_MAX = AGITATION_REST + AGITATION_GAIN;
const VELOCITY_PROBE_MS = 16;

const MAX_DROPS = 240;
const FOAM = "#ffffff";
const TAU = Math.PI * 2;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function progress(elapsed: number, start: number, duration: number): number {
  return clamp01((elapsed - start) / duration);
}

export function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/** A sheet colour: `share` of the accent over white. */
export function sheetColor(accent: Rgb, share: number): Rgb {
  return [0, 1, 2].map((channel) => Math.round(255 + (accent[channel] - 255) * share)) as unknown as Rgb;
}

function css([red, green, blue]: Rgb): string {
  return `rgb(${red} ${green} ${blue})`;
}

/** Geometry shared by the timeline and the painter, in CSS pixels. */
export type ModeWaveMetrics = {
  width: number;
  height: number;
  /** Base crest height per sheet, back to front. */
  amplitudes: number[];
  /** How far the middle of a moving edge may lead its sides. */
  bulge: number;
  /** How far past the screen an edge starts and ends, so no crest ever shows there. */
  margins: number[];
};

export function modeWaveMetrics(width: number, height: number): ModeWaveMetrics {
  const base = clamp(height * 0.032, 16, 40);
  const amplitudes = LAYER_AMPLITUDE.map((scale) => base * scale);
  const bulge = clamp(height * 0.05, 20, 60);
  const margins = amplitudes.map((amplitude) => amplitude * AGITATION_MAX + bulge + 8);
  return { width, height, amplitudes, bulge, margins };
}

/** The lower, leading edge's rest line: above the screen, then past its bottom. */
export function leadingBase(layer: number, elapsed: number, metrics: ModeWaveMetrics): number {
  const margin = metrics.margins[layer];
  const p = easeInOutCubic(
    progress(elapsed, layer * MODE_WAVE_TIMING.coverStaggerMs, MODE_WAVE_TIMING.coverMs),
  );
  return -margin + (metrics.height + 2 * margin) * p;
}

/** The upper, trailing edge's rest line: above the screen until the drain, front sheet first. */
export function trailingBase(
  layer: number,
  elapsed: number,
  revealAt: number | null,
  metrics: ModeWaveMetrics,
): number {
  const margin = metrics.margins[layer];
  if (revealAt === null) return -margin;
  const order = MODE_WAVE_LAYER_COUNT - 1 - layer;
  const p = easeInOutCubic(
    progress(
      elapsed,
      revealAt + order * MODE_WAVE_TIMING.revealStaggerMs,
      MODE_WAVE_TIMING.revealMs,
    ),
  );
  return -margin + (metrics.height + 2 * margin) * p;
}

/** The furthest any point of an edge can sit from its rest line. */
export function edgeReach(layer: number, metrics: ModeWaveMetrics): number {
  return metrics.amplitudes[layer] * AGITATION_MAX + metrics.bulge;
}

type EdgeMotion = {
  base: number;
  /** Pixels per millisecond, positive downward. */
  velocity: number;
  /** 0 at rest to 1 at the edge's top speed: drives the swell and the belly. */
  energy: number;
};

function edgeMotion(sample: (elapsed: number) => number, elapsed: number, peak: number): EdgeMotion {
  const base = sample(elapsed);
  const velocity = (base - sample(elapsed - VELOCITY_PROBE_MS)) / VELOCITY_PROBE_MS;
  return { base, velocity, energy: Math.min(1, Math.abs(velocity) / peak) };
}

type Crest = { k: number[]; w: number[]; phase: number[] };

type Bubble = {
  x: number;
  y: number;
  rise: number;
  radius: number;
  sway: number;
  swayRate: number;
  phase: number;
  ring: boolean;
};

type Drop = {
  layer: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  radius: number;
  age: number;
  life: number;
};

export type ModeWavePainterOptions = {
  width: number;
  height: number;
  /** Device pixels per CSS pixel the canvas was sized with. */
  dpr: number;
  accent: Rgb;
  random?: () => number;
};

/**
 * A seigaiha tile: rows of concentric half-hidden circles, each row offset by
 * half a circle and drawn over the row above it, so the tile repeats seamlessly.
 */
function seigaihaPattern(
  ctx: CanvasRenderingContext2D,
  dpr: number,
): { pattern: CanvasPattern; scaleX: number; scaleY: number } | null {
  if (typeof document === "undefined") return null;
  const radius = 18;
  const tile = document.createElement("canvas");
  tile.width = Math.max(1, Math.round(radius * 2 * dpr));
  tile.height = Math.max(1, Math.round(radius * dpr));
  const paint = tile.getContext("2d");
  if (!paint) return null;
  paint.scale(tile.width / (radius * 2), tile.height / radius);
  paint.strokeStyle = FOAM;
  paint.fillStyle = FOAM;
  paint.lineWidth = 1.5;
  for (let row = -2; row <= 4; row += 1) {
    const cy = (row * radius) / 2;
    const shift = ((row % 2) + 2) % 2 === 1 ? radius : 0;
    for (let column = -1; column <= 2; column += 1) {
      const cx = column * radius * 2 + shift;
      paint.globalCompositeOperation = "destination-out";
      paint.beginPath();
      paint.arc(cx, cy, radius, 0, TAU);
      paint.fill();
      paint.globalCompositeOperation = "source-over";
      for (const ring of [0.9, 0.7, 0.5, 0.3, 0.1]) {
        paint.beginPath();
        paint.arc(cx, cy, radius * ring, 0, TAU);
        paint.stroke();
      }
    }
  }
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern || typeof pattern.setTransform !== "function") return null;
  return { pattern, scaleX: (radius * 2) / tile.width, scaleY: radius / tile.height };
}

export class ModeWavePainter {
  private readonly metrics: ModeWaveMetrics;
  private readonly dpr: number;
  private readonly random: () => number;
  private readonly xs: Float64Array;
  private readonly step: number;
  private readonly bell: Float64Array;
  private readonly tops: Float64Array[];
  private readonly bottoms: Float64Array[];
  private readonly colors: string[];
  private readonly crests: Crest[];
  private readonly coverPeak: number[];
  private readonly revealPeak: number[];
  private readonly bubbles: Bubble[];
  private readonly drops: Drop[] = [];
  private readonly spawnDebt: number[];
  private readonly texture: ReturnType<typeof seigaihaPattern>;
  private readonly widthScale: number;
  private lastElapsed: number | null = null;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    options: ModeWavePainterOptions,
  ) {
    const { width, height, dpr, accent } = options;
    this.metrics = modeWaveMetrics(width, height);
    this.dpr = dpr;
    this.random = options.random ?? Math.random;
    this.step = Math.max(8, width / 170);
    const count = Math.ceil((width + this.step * 2) / this.step) + 1;
    this.xs = new Float64Array(count);
    this.bell = new Float64Array(count);
    for (let index = 0; index < count; index += 1) {
      const x = -this.step + index * this.step;
      this.xs[index] = x;
      this.bell[index] = 0.5 - 0.5 * Math.cos((TAU * x) / Math.max(1, width));
    }
    this.tops = Array.from({ length: MODE_WAVE_LAYER_COUNT }, () => new Float64Array(count));
    this.bottoms = Array.from({ length: MODE_WAVE_LAYER_COUNT }, () => new Float64Array(count));
    this.colors = LAYER_ACCENT_SHARE.map((share) => css(sheetColor(accent, share)));
    const baseLength = clamp(width * 0.45, 280, 820);
    this.crests = LAYER_WAVELENGTH.map((scale, layer) => ({
      k: HARMONICS.map((harmonic) => TAU / (baseLength * scale * harmonic.length)),
      w: HARMONICS.map((harmonic) => harmonic.speed * LAYER_FLOW[layer]),
      phase: HARMONICS.map(() => this.random() * TAU),
    }));
    this.coverPeak = this.metrics.margins.map(
      (margin) => (1.5 * (height + 2 * margin)) / MODE_WAVE_TIMING.coverMs,
    );
    this.revealPeak = this.metrics.margins.map(
      (margin) => (1.5 * (height + 2 * margin)) / MODE_WAVE_TIMING.revealMs,
    );
    this.widthScale = clamp(width / 1280, 0.45, 1.5);
    this.spawnDebt = Array.from({ length: MODE_WAVE_LAYER_COUNT }, () => 0);
    const bubbleCount = Math.round(clamp((width * height) / 34_000, 16, 64));
    this.bubbles = Array.from({ length: bubbleCount }, () => {
      const size = this.random();
      return {
        x: this.random() * width,
        y: height * (0.06 + this.random() * 1.15),
        rise: 0.05 + this.random() * 0.15,
        radius: 2.5 + size * size * 9,
        sway: 3 + this.random() * 10,
        swayRate: 0.002 + this.random() * 0.003,
        phase: this.random() * TAU,
        ring: this.random() < 0.7,
      };
    });
    this.texture = seigaihaPattern(ctx, dpr);
  }

  /**
   * Paint the frame `elapsed` ms after the pour began. `revealAt` is the
   * elapsed time the drain began, or null while the screen is still covered.
   */
  draw(elapsed: number, revealAt: number | null): void {
    const { ctx, metrics } = this;
    const { width, height } = metrics;
    const dt = this.lastElapsed === null ? 16 : clamp(elapsed - this.lastElapsed, 0, 50);
    this.lastElapsed = elapsed;
    const seconds = elapsed / 1000;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = 1;
    this.ageDrops(dt);

    let frontPath: Path2D | null = null;
    for (let layer = 0; layer < MODE_WAVE_LAYER_COUNT; layer += 1) {
      const lead = edgeMotion((t) => leadingBase(layer, t, metrics), elapsed, this.coverPeak[layer]);
      const trail = edgeMotion(
        (t) => trailingBase(layer, t, revealAt, metrics),
        elapsed,
        this.revealPeak[layer],
      );
      const reach = edgeReach(layer, metrics);
      // A sheet wholly above or below the screen paints nothing.
      if (lead.base + reach < 0 || trail.base - reach > height) continue;

      const top = this.edge(layer, trail, seconds, this.tops[layer]);
      const bottom = this.edge(layer, lead, seconds, this.bottoms[layer]);
      const path = this.sheet(top, bottom);
      ctx.fillStyle = this.colors[layer];
      ctx.fill(path);

      if (layer === FRONT) {
        this.paintTexture(path, lead.base, seconds);
        frontPath = path;
      }
      if (layer >= FRONT - 1) {
        this.paintFoam(layer, bottom, lead, -1, seconds);
        this.paintFoam(layer, top, trail, 1, seconds);
        this.spawnDrops(layer, lead, trail, top, bottom, dt);
      }
      this.paintDrops(layer);
    }

    if (frontPath) {
      ctx.save();
      ctx.clip(frontPath);
      this.paintBubbles(elapsed);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private edge(layer: number, motion: EdgeMotion, seconds: number, out: Float64Array): Float64Array {
    const amplitude = this.metrics.amplitudes[layer] * (AGITATION_REST + AGITATION_GAIN * motion.energy);
    const belly = this.metrics.bulge * motion.energy * Math.sign(motion.velocity);
    const crest = this.crests[layer];
    for (let index = 0; index < this.xs.length; index += 1) {
      const x = this.xs[index];
      let wave = 0;
      for (let harmonic = 0; harmonic < HARMONICS.length; harmonic += 1) {
        wave += HARMONICS[harmonic].share
          * Math.sin(crest.k[harmonic] * x + crest.w[harmonic] * seconds + crest.phase[harmonic]);
      }
      out[index] = motion.base + amplitude * wave + belly * this.bell[index];
    }
    return out;
  }

  private sheet(top: Float64Array, bottom: Float64Array): Path2D {
    const path = new Path2D();
    path.moveTo(this.xs[0], top[0]);
    for (let index = 1; index < this.xs.length; index += 1) path.lineTo(this.xs[index], top[index]);
    for (let index = this.xs.length - 1; index >= 0; index -= 1) path.lineTo(this.xs[index], bottom[index]);
    path.closePath();
    return path;
  }

  /** The edge's height at any x, from the sampled points. */
  private edgeAt(ys: Float64Array, x: number): number {
    const position = clamp((x - this.xs[0]) / this.step, 0, this.xs.length - 1.001);
    const index = Math.floor(position);
    const fraction = position - index;
    return ys[index] + (ys[index + 1] - ys[index]) * fraction;
  }

  private paintTexture(path: Path2D, frontBase: number, seconds: number): void {
    if (!this.texture) return;
    const { ctx } = this;
    const { pattern, scaleX, scaleY } = this.texture;
    // The texture travels with the water while it pours, and drifts sideways.
    pattern.setTransform(new DOMMatrix([scaleX, 0, 0, scaleY, seconds * 14, frontBase]));
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = pattern;
    ctx.fill(path);
    ctx.restore();
  }

  /**
   * Foam on a moving crest: a translucent band just inside the edge and broken
   * dashes of white that run along it. `inward` is -1 for a lower edge (the
   * water is above it) and 1 for an upper edge.
   */
  private paintFoam(layer: number, ys: Float64Array, motion: EdgeMotion, inward: number, seconds: number): void {
    if (motion.energy < 0.04) return;
    const { ctx } = this;
    const height = this.metrics.height;
    const reach = edgeReach(layer, this.metrics);
    if (motion.base + reach < -12 || motion.base - reach > height + 12) return;
    const inset = clamp(this.metrics.amplitudes[layer] * 0.42, 7, 15);
    const line = clamp(this.metrics.width / 600, 2.5, 4);
    const fade = clamp01(motion.energy * 1.6);
    const flow = LAYER_FLOW[layer];

    const stroke = (offset: number, alpha: number, width: number, dash: number[], speed: number) => {
      ctx.beginPath();
      ctx.moveTo(this.xs[0], ys[0] + offset * inward);
      for (let index = 1; index < this.xs.length; index += 1) {
        ctx.lineTo(this.xs[index], ys[index] + offset * inward);
      }
      ctx.save();
      ctx.globalAlpha = alpha * fade;
      ctx.strokeStyle = FOAM;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash(dash);
      ctx.lineDashOffset = -seconds * speed * flow;
      ctx.stroke();
      ctx.restore();
    };

    if (layer === FRONT) {
      stroke(inset * 0.55, 0.16, inset * 1.1, [], 0);
      stroke(inset, 0.62, line, [110, 24, 16, 24], 70);
      stroke(inset * 2.3, 0.28, line * 0.7, [36, 54], 46);
    } else {
      stroke(inset, 0.45, line * 0.85, [84, 30, 12, 30], 58);
    }
  }

  private spawnDrops(
    layer: number,
    lead: EdgeMotion,
    trail: EdgeMotion,
    top: Float64Array,
    bottom: Float64Array,
    dt: number,
  ): void {
    const { width, height } = this.metrics;
    const front = layer === FRONT;
    // Spray runs ahead of a pouring edge...
    if (lead.energy > 0.3 && lead.base > 0 && lead.base < height) {
      this.spawnDebt[layer] += (front ? 0.06 : 0.03) * this.widthScale * lead.energy * dt;
      while (this.spawnDebt[layer] >= 1 && this.drops.length < MAX_DROPS) {
        this.spawnDebt[layer] -= 1;
        const x = this.random() * width;
        this.drops.push({
          layer,
          x,
          y: this.edgeAt(bottom, x) - 1,
          vx: (this.random() - 0.5) * 0.08,
          vy: lead.velocity * (1.04 + this.random() * 0.3) + 0.02,
          gravity: 0.0006,
          radius: 1.8 + this.random() * (front ? 3.8 : 2.8),
          age: 0,
          life: 220 + this.random() * 240,
        });
      }
    }
    // ...and the front sheet drips behind it as it drains.
    if (front && trail.energy > 0.3 && trail.base > 0 && trail.base < height) {
      this.spawnDebt[layer] += 0.045 * this.widthScale * trail.energy * dt;
      while (this.spawnDebt[layer] >= 1 && this.drops.length < MAX_DROPS) {
        this.spawnDebt[layer] -= 1;
        const x = this.random() * width;
        this.drops.push({
          layer,
          x,
          y: this.edgeAt(top, x) - (2 + this.random() * 8),
          vx: (this.random() - 0.5) * 0.05,
          vy: trail.velocity * (0.12 + this.random() * 0.4),
          gravity: 0.0024,
          radius: 1.6 + this.random() * 3.2,
          age: 0,
          life: 300 + this.random() * 260,
        });
      }
    }
    if (this.spawnDebt[layer] > 1) this.spawnDebt[layer] = 0;
  }

  private ageDrops(dt: number): void {
    for (let index = this.drops.length - 1; index >= 0; index -= 1) {
      const drop = this.drops[index];
      drop.age += dt;
      if (drop.age >= drop.life) {
        this.drops.splice(index, 1);
        continue;
      }
      drop.vy += drop.gravity * dt;
      drop.x += drop.vx * dt;
      drop.y += drop.vy * dt;
    }
  }

  private paintDrops(layer: number): void {
    const { ctx } = this;
    ctx.fillStyle = this.colors[layer];
    for (const drop of this.drops) {
      if (drop.layer !== layer) continue;
      const life = drop.age / drop.life;
      ctx.globalAlpha = 1 - life * life;
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, Math.max(0.6, drop.radius * (1 - 0.35 * life)), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private paintBubbles(elapsed: number): void {
    const { ctx } = this;
    const span = this.metrics.height + 40;
    ctx.strokeStyle = FOAM;
    ctx.fillStyle = FOAM;
    for (const bubble of this.bubbles) {
      // Bubbles keep rising for as long as the screen stays covered.
      const travelled = bubble.y - bubble.rise * elapsed + 20;
      const y = (((travelled % span) + span) % span) - 20;
      const x = bubble.x + bubble.sway * Math.sin(bubble.phase + bubble.swayRate * elapsed);
      if (bubble.ring) {
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = Math.max(1.4, bubble.radius * 0.22);
        ctx.beginPath();
        ctx.arc(x, y, bubble.radius, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(x - bubble.radius * 0.38, y - bubble.radius * 0.38, Math.max(1, bubble.radius * 0.22), 0, TAU);
        ctx.fill();
      } else {
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(x, y, bubble.radius * 0.8, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
