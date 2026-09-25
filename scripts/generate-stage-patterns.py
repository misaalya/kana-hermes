"""Generate Kana's built-in stage patterns as seamless SVG tiles.

The tiles are alpha masks: app/globals.css paints them with theme tokens, so
one file serves the light and dark themes. Sakura, sparkle, and ribbon have two
layers: kana-pattern-<name>.svg holds the base shapes and
kana-pattern-<name>-detail.svg a deeper tone drawn over them (flower centres,
the larger sparkles, bow folds). Sakura and ribbon motifs are spread by
Poisson-disk sampling on a torus with fixed seeds; sparkle and clouds are plain
repeating grids. Either way the output is reproducible and the tile wraps
without seams: every motif near an edge is repeated on the other side.

Usage: python3 scripts/generate-stage-patterns.py public/backgrounds
"""
import math
import random
import sys
from pathlib import Path

OUT = Path(sys.argv[1])


def f(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


class Tile:
    def __init__(self, size):
        self.size = size
        self.base = []
        self.detail = []

    def place(self, layer, x, y, r, svg):
        """Add an element (drawn around 0,0) at x,y plus its wrapped copies."""
        s = self.size
        for dx in (-s, 0, s):
            for dy in (-s, 0, s):
                cx, cy = x + dx, y + dy
                if -r <= cx <= s + r and -r <= cy <= s + r:
                    getattr(self, layer).append(f'<g transform="translate({f(cx)} {f(cy)})">{svg}</g>')

    def write(self, name):
        for layer in ("base", "detail"):
            body = "".join(getattr(self, layer))
            if not body:
                continue
            suffix = "" if layer == "base" else "-detail"
            svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.size}" height="{self.size}" '
                   f'viewBox="0 0 {self.size} {self.size}">{body}</svg>')
            (OUT / f"kana-pattern-{name}{suffix}.svg").write_text(svg)


def poisson(size, count, spacing, rng, taken=(), tries=4000):
    """Points on a torus at least `spacing` from each other and from `taken` (x, y, r)."""
    points = []
    def wrap(d):
        d = abs(d) % size
        return min(d, size - d)
    for _ in range(tries):
        if len(points) >= count:
            break
        x, y = rng.uniform(0, size), rng.uniform(0, size)
        ok = all(math.hypot(wrap(x - px), wrap(y - py)) >= spacing + pr for px, py, pr in taken)
        ok = ok and all(math.hypot(wrap(x - px), wrap(y - py)) >= spacing for px, py in points)
        if ok:
            points.append((x, y))
    return points


def grid(size, period):
    """Top-left corners of the cells of a square grid filling the tile."""
    return [(i * period, j * period) for i in range(size // period) for j in range(size // period)]


# ----------------------------------------------------------------- sakura

def petal(length, rot=0.0):
    """Classic sakura petal pointing up from its base at 0,0, notched at the tip."""
    L = length
    d = (f"M0 0C{f(-0.44*L)} {f(-0.2*L)} {f(-0.52*L)} {f(-0.74*L)} {f(-0.24*L)} {f(-L)}"
         f"L0 {f(-0.86*L)}L{f(0.24*L)} {f(-L)}"
         f"C{f(0.52*L)} {f(-0.74*L)} {f(0.44*L)} {f(-0.2*L)} 0 0Z")
    return f'<path d="{d}" transform="rotate({f(rot)})"/>'


def blossom(r, rot):
    return "".join(petal(r, rot + i * 72) for i in range(5))


def blossom_center(r, rot):
    parts = [f'<circle r="{f(0.2*r)}"/>']
    for i in range(5):
        a = math.radians(rot + 36 + i * 72 - 90)
        x, y = math.cos(a) * 0.46 * r, math.sin(a) * 0.46 * r
        parts.append(f'<path d="M0 0L{f(x)} {f(y)}" stroke="#000" stroke-width="{f(0.07*r)}" stroke-linecap="round"/>')
        parts.append(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(0.09*r)}"/>')
    return "".join(parts)


def sakura():
    rng = random.Random(7)
    t = Tile(360)
    big = poisson(360, 5, 104, rng)
    taken = []
    for (x, y), r in zip(big, (30, 26, 24, 28, 22)):
        rot = rng.uniform(0, 72)
        t.place("base", x, y, r + 2, blossom(r, rot))
        t.place("detail", x, y, r, blossom_center(r, rot))
        taken.append((x, y, r))
    small = poisson(360, 4, 58, rng, taken)
    for x, y in small:
        r = rng.uniform(12, 15)
        rot = rng.uniform(0, 72)
        t.place("base", x, y, r + 2, f'<g opacity="0.8">{blossom(r, rot)}</g>')
        t.place("detail", x, y, r, f'<g opacity="0.8">{blossom_center(r, rot)}</g>')
        taken.append((x, y, r))
    # Loose petals drifting between the flowers, a few in the deeper tone.
    for i, (x, y) in enumerate(poisson(360, 16, 30, rng, taken)):
        L = rng.uniform(9, 14)
        layer = "detail" if i % 5 == 0 else "base"
        t.place(layer, x, y, L, f'<g opacity="{f(rng.uniform(0.55, 0.9))}">{petal(L, rng.uniform(0, 360))}</g>')
    t.write("sakura")


# ---------------------------------------------------------------- sparkle

def star4(r, pinch=0.14, squash=0.78):
    """Anime four-point sparkle: long vertical arms, concave sides."""
    h, c = r * squash, r * pinch
    d = (f"M0 {f(-r)}Q{f(c)} {f(-c)} {f(h)} 0Q{f(c)} {f(c)} 0 {f(r)}"
         f"Q{f(-c)} {f(c)} {f(-h)} 0Q{f(-c)} {f(-c)} 0 {f(-r)}Z")
    return f'<path d="{d}"/>'


def sparkle():
    t = Tile(340)
    # A checkerboard of large sparkles in the deeper tone and small ones between.
    for x, y in grid(340, 170):
        t.place("detail", x + 42.5, y + 42.5, 17, star4(17))
        t.place("base", x + 127.5, y + 127.5, 8, star4(8))
    t.write("sparkle")


# ----------------------------------------------------------------- clouds

def cloud(w):
    """Puffy cloud with a flat, rounded base, about w wide."""
    h = w * 0.34
    parts = [
        f'<rect x="{f(-w/2)}" y="{f(-h/2)}" width="{f(w)}" height="{f(h)}" rx="{f(h/2)}"/>',
        f'<circle cx="{f(-w*0.2)}" cy="{f(-h*0.55)}" r="{f(w*0.2)}"/>',
        f'<circle cx="{f(w*0.08)}" cy="{f(-h*0.85)}" r="{f(w*0.26)}"/>',
        f'<circle cx="{f(w*0.31)}" cy="{f(-h*0.4)}" r="{f(w*0.15)}"/>',
    ]
    return "".join(parts)


def clouds():
    t = Tile(380)
    # One cloud shape in offset rows, like wallpaper.
    for x, y in grid(380, 190):
        t.place("base", x + 47.5, y + 55, 44, cloud(72))
        t.place("base", x + 142.5, y + 150, 44, cloud(72))
    t.write("clouds")


# ----------------------------------------------------------------- ribbon

def bow(s):
    """A ribbon bow about 2s wide: round loops, a soft knot, and flowing notched tails."""
    loop = (f"M{f(-0.12*s)} {f(-0.1*s)}C{f(-0.3*s)} {f(-0.56*s)} {f(-0.86*s)} {f(-0.74*s)} {f(-1.03*s)} {f(-0.36*s)}"
            f"C{f(-1.16*s)} {f(-0.05*s)} {f(-0.9*s)} {f(0.3*s)} {f(-0.55*s)} {f(0.22*s)}"
            f"C{f(-0.35*s)} {f(0.18*s)} {f(-0.2*s)} {f(0.1*s)} {f(-0.12*s)} {f(0.06*s)}Z")
    tail = (f"M{f(-0.1*s)} {f(0.08*s)}C{f(-0.24*s)} {f(0.36*s)} {f(-0.22*s)} {f(0.62*s)} {f(-0.5*s)} {f(0.98*s)}"
            f"L{f(-0.32*s)} {f(0.93*s)}L{f(-0.27*s)} {f(1.1*s)}"
            f"C{f(-0.05*s)} {f(0.8*s)} {f(-0.02*s)} {f(0.42*s)} {f(0.05*s)} {f(0.12*s)}Z")
    knot = f'<rect x="{f(-0.19*s)}" y="{f(-0.2*s)}" width="{f(0.38*s)}" height="{f(0.36*s)}" rx="{f(0.15*s)}"/>'
    return (f'<path d="{loop}"/><path d="{loop}" transform="scale(-1 1)"/>'
            f'<path d="{tail}"/><path d="{tail}" transform="scale(-1 1)"/>{knot}')


def bow_folds(s):
    """Inner fold of each loop, in the deeper tone."""
    fold = (f"M{f(-0.2*s)} {f(-0.04*s)}C{f(-0.38*s)} {f(-0.38*s)} {f(-0.78*s)} {f(-0.5*s)} {f(-0.87*s)} {f(-0.26*s)}"
            f"C{f(-0.93*s)} {f(-0.08*s)} {f(-0.72*s)} {f(0.08*s)} {f(-0.46*s)} {f(0.05*s)}"
            f"C{f(-0.34*s)} {f(0.03*s)} {f(-0.26*s)} {f(0.0*s)} {f(-0.2*s)} {f(-0.04*s)}Z")
    return f'<path d="{fold}"/><path d="{fold}" transform="scale(-1 1)"/>'


def heart(s):
    d = (f"M0 {f(0.36*s)}C{f(-0.56*s)} {f(-0.04*s)} {f(-0.5*s)} {f(-0.56*s)} {f(-0.2*s)} {f(-0.56*s)}"
         f"C{f(-0.06*s)} {f(-0.56*s)} 0 {f(-0.44*s)} 0 {f(-0.36*s)}"
         f"C0 {f(-0.44*s)} {f(0.06*s)} {f(-0.56*s)} {f(0.2*s)} {f(-0.56*s)}"
         f"C{f(0.5*s)} {f(-0.56*s)} {f(0.56*s)} {f(-0.04*s)} 0 {f(0.36*s)}Z")
    return f'<path d="{d}"/>'


def ribbon():
    rng = random.Random(5)
    t = Tile(400)
    taken = []
    for (x, y), sz in zip(poisson(400, 4, 150, rng), (34, 30, 32, 28)):
        rot = rng.uniform(-14, 14)
        t.place("base", x, y, sz * 1.2, f'<g transform="rotate({f(rot)})">{bow(sz)}</g>')
        t.place("detail", x, y, sz * 1.2, f'<g transform="rotate({f(rot)})">{bow_folds(sz)}</g>')
        taken.append((x, y, sz * 1.05))
    for x, y in poisson(400, 3, 70, rng, taken):
        sz = rng.uniform(19, 22)
        rot = rng.uniform(-18, 18)
        t.place("base", x, y, sz * 1.2, f'<g opacity="0.8" transform="rotate({f(rot)})">{bow(sz)}</g>')
        t.place("detail", x, y, sz * 1.2, f'<g opacity="0.8" transform="rotate({f(rot)})">{bow_folds(sz)}</g>')
        taken.append((x, y, sz * 1.05))
    for x, y in poisson(400, 7, 40, rng, taken):
        sz = rng.uniform(13, 17)
        t.place("detail", x, y, sz, f'<g opacity="0.65" transform="rotate({f(rng.uniform(-20, 20))})">{heart(sz)}</g>')
        taken.append((x, y, sz * 0.5))
    for x, y in poisson(400, 26, 24, rng, taken):
        t.place("base", x, y, 4, f'<circle r="{f(rng.uniform(2.6, 3.8))}" opacity="0.6"/>')
    t.write("ribbon")


# ---------------------------------------------------------------- seigaiha

def tile(width, height, body, defs=""):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">'
        f"{f'<defs>{defs}</defs>' if defs else ''}{body}</svg>\n"
    )


def seigaiha():
    r = 26
    w, h = 2 * r, r
    rings = [(r - 2, 1.6, 1), (r - 8, 1.4, 0.8), (r - 14, 1.2, 0.6), (r - 20, 1.2, 0.45)]
    centers = []
    for row in range(-2, 5):
        y = row * r / 2
        offset = r if row % 2 else 0
        for col in range(-2, 3):
            centers.append((row, col * w + offset, y + r / 2))
    defs, body = "", ""
    for index, (row, cx, cy) in enumerate(centers):
        later = [(x, y) for (other_row, x, y) in centers if other_row > row and abs(x - cx) < 2 * r and abs(y - cy) < 2 * r]
        mask_id = f"m{index}"
        holes = "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="#000"/>' for x, y in later)
        defs += f'<mask id="{mask_id}" maskUnits="userSpaceOnUse" x="-100" y="-100" width="300" height="300"><rect x="-100" y="-100" width="300" height="300" fill="#fff"/>{holes}</mask>'
        circles = "".join(
            f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{radius}" fill="none" stroke="#000" stroke-width="{stroke}" opacity="{opacity}"/>'
            for radius, stroke, opacity in rings
        )
        body += f'<g mask="url(#{mask_id})">{circles}</g>'
    return tile(w, h, body, defs)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    sakura()
    sparkle()
    clouds()
    ribbon()
    (OUT / "kana-pattern-seigaiha.svg").write_text(seigaiha())
