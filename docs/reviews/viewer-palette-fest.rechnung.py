"""Viewer palette: fixed colours for every theme — the arithmetic behind
docs/reviews/viewer-palette-fest.ideen.md (2026-09-28). Scratch evidence,
not a test. Same formulas as lcnc-webui/src/themeTokens.test.ts: WCAG 2.x
contrast, OKLab distance, Machado 2009 severity-1 dichromat matrices.

    python3 docs/reviews/viewer-palette-fest.rechnung.py

1. the CURRENT palette, every pair of line-ish roles, light and dark theme;
2. what a FIXED colour (same in every theme) can reach: a colour that holds
   3 : 1 on white, on the dark theme's #0b0f14 and on the lit table #e0e0e0
   sits in one luminance band — how many roles stay apart there;
3. the candidate: three fixed line colours (feed, rapid, limit), the
   collision tint, the selection core on its halo.
"""
import itertools
import math
import random
import re
from pathlib import Path

CSS = (Path(__file__).resolve().parents[2] / "lcnc-webui/src/style.css").read_text()


def hx(h):
    n = int(h.strip()[1:], 16)
    return ((n >> 16) & 255, (n >> 8) & 255, n & 255)


def tohex(c):
    return "#%02x%02x%02x" % tuple(int(round(v)) for v in c)


def lin(v):
    v /= 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def unlin(v):
    v = min(1, max(0, v))
    return 255 * (12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055)


def lum(c):
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])


def contrast(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True)
    return (x + 0.05) / (y + 0.05)


def oklab(c):
    r, g, b = map(lin, c)
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s)


def okd(a, b):
    return math.dist(oklab(a), oklab(b))


MACHADO = {
    "protan": [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    "deutan": [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    "tritan": [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}


def sim(c, k):
    l = [lin(x) for x in c]
    return tuple(unlin(sum(r[i] * l[i] for i in range(3))) for r in MACHADO[k])


def cvd(a, b):
    """The smallest OKLab distance under the three simulated dichromacies."""
    return min(okd(sim(a, k), sim(b, k)) for k in MACHADO)


def oklch(L, C, h):
    a, b = C * math.cos(h), C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    rgb = (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
           -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
           -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    if min(rgb) < -1e-4 or max(rgb) > 1 + 1e-4:
        return None
    return tuple(unlin(v) for v in rgb)


def block(theme):
    i = CSS.index(f':root[data-theme="{theme}"] {{')
    body = CSS[CSS.index("{", i) + 1:CSS.index("}", i)]
    return dict(re.findall(r"(--[\w-]+):\s*([^;]+);", body))


WHITE, DARK, TABLE = hx("#ffffff"), hx("#0b0f14"), hx("#e0e0e0")
BACKGROUNDS = (WHITE, DARK, TABLE)

# 1 ── the current palette ────────────────────────────────────────────────
ROLES = ["feed", "rapid", "backplot", "limit", "selection", "collision", "bounds", "toolpath-bounds"]
print("1. CURRENT palette — the closest pairs (normal / worst dichromat; rule 0.12)")
for theme in ("light", "dark"):
    b = block(theme)
    c = {r: hx(b["--viewer-" + r]) for r in ROLES}
    rows = sorted((cvd(c[x], c[y]), okd(c[x], c[y]), x, y) for x, y in itertools.combinations(ROLES, 2))
    print(f"  {theme}: " + "; ".join(f"{x}/{y} {n:.3f}/{w:.3f}" for w, n, x, y in rows[:8]))

# 2 ── the fixed-colour band ──────────────────────────────────────────────
pool = {}
for L in [x / 100 for x in range(40, 68)]:
    for C in [x / 100 for x in range(0, 30, 2)]:
        for hd in range(0, 360, 4):
            c = oklch(L, C, math.radians(hd))
            if c and all(contrast(c, bg) >= 3.0 for bg in BACKGROUNDS):
                pool.setdefault((hd, C > 0.06), []).append(c)
chroma = [c for (h, chromatic), cs in pool.items() if chromatic for c in cs]
grey = hx("#6f6f6f")
print(f"\n2. FIXED colours: {len(chroma)} chromatic candidates hold 3 : 1 on white, #0b0f14 and #e0e0e0")
print(f"   grey {tohex(grey)}: white {contrast(grey, WHITE):.1f}, dark {contrast(grey, DARK):.1f}, table {contrast(grey, TABLE):.1f}")
random.seed(1)
for k in (2, 3, 4):
    best = 0.0
    for _ in range(20000):
        s = random.sample(chroma, k) + [grey]
        best = max(best, min(min(okd(a, b), cvd(a, b)) for a, b in itertools.combinations(s, 2)))
    print(f"   {k} chromatic + grey: best smallest pair over all four views {best:.3f}")

# 3 ── the candidate ──────────────────────────────────────────────────────
CAND = {"feed": "#395afa", "rapid": "#e118b6", "limit": "#9f6700", "collision": "#c8102e"}
SEL_CORE, SEL_HALO = "#22b8cf", "#0b0f14"
print("\n3. CANDIDATE — the same values in every theme")
for r, v in CAND.items():
    c = hx(v)
    print(f"   {r:<9} {v}  white {contrast(c, WHITE):.1f}  dark {contrast(c, DARK):.1f}  table {contrast(c, TABLE):.1f}")
for x, y in itertools.combinations(CAND, 2):
    print(f"   {x}/{y}: normal {okd(hx(CAND[x]), hx(CAND[y])):.3f}  worst dichromat {cvd(hx(CAND[x]), hx(CAND[y])):.3f}")
core, halo = hx(SEL_CORE), hx(SEL_HALO)
print(f"   selection core {SEL_CORE} on halo {SEL_HALO}: {contrast(core, halo):.1f}; core on dark bg {contrast(core, DARK):.1f};"
      f" halo on white {contrast(halo, WHITE):.1f}, on table {contrast(halo, TABLE):.1f}")
for r in ("feed", "rapid", "limit"):
    print(f"   selection core / {r}: normal {okd(core, hx(CAND[r])):.3f}  worst dichromat {cvd(core, hx(CAND[r])):.3f}")
