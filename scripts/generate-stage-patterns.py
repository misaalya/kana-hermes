"""Generate Kana's built-in stage patterns as seamless SVG tiles.

The tiles are single-color alpha masks: app/globals.css paints them with a
theme token, so one file serves the light and dark themes. Shape opacity
carries the hierarchy (larger motifs stronger, filler dots faint).

Usage: python3 scripts/generate-stage-patterns.py public/backgrounds
"""
import math
import sys

OUT = sys.argv[1]


def tile(width, height, body, defs=""):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">'
        f"{f'<defs>{defs}</defs>' if defs else ''}{body}</svg>\n"
    )


def wrapped(width, height, x, y, draw):
    """Draw a motif plus its copies across the tile edges so tiling is seamless."""
    return "".join(draw(x + dx, y + dy) for dx in (-width, 0, width) for dy in (-height, 0, height))


# Sakura: notched five-petal blossoms on an offset grid with loose petals.
def blossom(x, y, scale, rotation, opacity):
    petal = "M0 -3C-5.5 -6.5 -7 -14 -3 -18.5L0 -15.8L3 -18.5C7 -14 5.5 -6.5 0 -3Z"
    petals = "".join(f'<path d="{petal}" transform="rotate({rotation + k * 72:.1f})"/>' for k in range(5))
    return f'<g transform="translate({x:.1f} {y:.1f}) scale({scale})" opacity="{opacity}">{petals}<circle r="1.6"/></g>'


def loose_petal(x, y, rotation, opacity):
    return f'<path d="M0 -6C4 -6 5.5 -1 0 6C-5.5 -1 -4 -6 0 -6Z" transform="translate({x} {y}) rotate({rotation})" opacity="{opacity}"/>'


def sakura():
    w = h = 128
    body = (
        blossom(32, 34, 1.0, 8, 1)
        + blossom(96, 98, 0.78, 40, 0.8)
        + wrapped(w, h, 100, 30, lambda x, y: loose_petal(x, y, 35, 0.55))
        + wrapped(w, h, 30, 100, lambda x, y: loose_petal(x, y, -50, 0.45))
        + "".join(
            wrapped(w, h, x, y, lambda px, py, r=r, o=o: f'<circle cx="{px}" cy="{py}" r="{r}" opacity="{o}"/>')
            for x, y, r, o in [(64, 66, 1.6, 0.4), (4, 64, 1.2, 0.35), (64, 4, 1.2, 0.35)]
        )
    )
    return tile(w, h, body)


# Sparkle: four-point anime sparkles with small dots.
def sparkle_path(x, y, size, opacity):
    c = size * 0.16
    return (
        f'<path d="M{x} {y - size}Q{x + c} {y - c} {x + size} {y}Q{x + c} {y + c} {x} {y + size}'
        f'Q{x - c} {y + c} {x - size} {y}Q{x - c} {y - c} {x} {y - size}Z" opacity="{opacity}"/>'
    )


def sparkle():
    w = h = 112
    body = (
        sparkle_path(30, 32, 11, 1)
        + sparkle_path(84, 86, 7, 0.75)
        + sparkle_path(88, 24, 4, 0.5)
        + sparkle_path(24, 90, 4.5, 0.5)
        + "".join(
            f'<circle cx="{x}" cy="{y}" r="{r}" opacity="{o}"/>'
            for x, y, r, o in [(58, 56, 1.8, 0.45), (104, 58, 1.3, 0.35), (56, 104, 1.3, 0.35), (46, 12, 1.1, 0.3)]
        )
    )
    return tile(w, h, body)


# Clouds: small puffy clouds in half-offset rows.
def cloud(x, y, s, opacity):
    return (
        f'<g transform="translate({x} {y}) scale({s})" opacity="{opacity}">'
        '<circle cx="-11" cy="2" r="8"/><circle cx="0" cy="-4" r="11"/><circle cx="12" cy="1" r="8.5"/>'
        '<rect x="-19" y="0" width="39" height="10" rx="5"/></g>'
    )


def clouds():
    w, h = 160, 112
    body = (
        cloud(40, 30, 1.0, 1)
        + cloud(120, 86, 0.85, 0.8)
        + "".join(
            f'<circle cx="{x}" cy="{y}" r="{r}" opacity="{o}"/>'
            for x, y, r, o in [(104, 26, 1.6, 0.4), (30, 88, 1.6, 0.4), (80, 58, 1.2, 0.3)]
        )
    )
    return tile(w, h, body)


# Seigaiha: Japanese overlapping wave scales. Each scale is clipped by the
# scales drawn after it (the row below), which is what makes the pattern read.
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


# Ribbon: small bows with tiny dots, like a hair ribbon.
def bow(x, y, scale, rotation, opacity):
    # Full loops with a small fold near the knot (evenodd cut-outs), then two
    # gently curved tails with notched ends.
    loops = (
        "M-3 -2C-8 -11 -20 -13 -21 -4C-21.8 3 -13 7 -3 2Z"
        "M-6 -1.2L-11.5 -5.2L-11 0.8Z"
        "M3 -2C8 -11 20 -13 21 -4C21.8 3 13 7 3 2Z"
        "M6 -1.2L11.5 -5.2L11 0.8Z"
    )
    return (
        f'<g transform="translate({x} {y}) rotate({rotation}) scale({scale})" opacity="{opacity}">'
        f'<path fill-rule="evenodd" d="{loops}"/>'
        '<rect x="-4" y="-4.5" width="8" height="8" rx="3"/>'
        '<path d="M-2.5 2.5C-4 8 -7 12 -10.5 17L-6.5 16L-5 19.5C-1.5 14 0 8 0.5 3Z"/>'
        '<path d="M2.5 2.5C4 8 7 12 10.5 17L6.5 16L5 19.5C1.5 14 0 8 -0.5 3Z"/></g>'
    )


def ribbon():
    w = h = 128
    body = (
        bow(32, 30, 1.15, -8, 1)
        + bow(96, 94, 0.9, 12, 0.75)
        + "".join(
            wrapped(w, h, x, y, lambda px, py, r=r, o=o: f'<circle cx="{px}" cy="{py}" r="{r}" opacity="{o}"/>')
            for x, y, r, o in [(96, 30, 2.2, 0.45), (30, 96, 1.8, 0.4), (64, 64, 1.4, 0.35), (4, 64, 1.1, 0.3), (64, 4, 1.1, 0.3)]
        )
    )
    return tile(w, h, body)


for name, build in [("sakura", sakura), ("sparkle", sparkle), ("clouds", clouds), ("seigaiha", seigaiha), ("ribbon", ribbon)]:
    with open(f"{OUT}/kana-pattern-{name}.svg", "w") as handle:
        handle.write(build())
