#!/usr/bin/env python3
"""Independent numeric evidence for the viewer contrast plan at dac5249.

Run from any directory; stdout is JSON. No server, machine, settings writes,
third-party packages, or product imports. This is a calculation, not a rendered
scene test. Machado severity 1 matrices are applied to LINEAR sRGB, then clipped
to the display gamut before OKLab conversion. Thresholds are project heuristics.

Matrix data: Machado, Oliveira, Fernandes (2009), DOI 10.1109/TVCG.2009.113;
verified against colorspacious/cvd.py (severity 100):
https://raw.githubusercontent.com/njsmith/colorspacious/master/colorspacious/cvd.py
Linear-RGB convention:
https://colorspace.r-forge.r-project.org/reference/simulate_cvd.html
"""

import itertools
import json
import math
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
CSS = (ROOT / "lcnc-webui/src/style.css").read_text()
MATRICES = {
    "normal": ((1, 0, 0), (0, 1, 0), (0, 0, 1)),
    "protan": ((0.152286, 1.052583, -0.204868),
               (0.114503, 0.786281, 0.099216),
               (-0.003882, -0.048116, 1.051998)),
    "deutan": ((0.367322, 0.860646, -0.227968),
               (0.280085, 0.672501, 0.047413),
               (-0.011820, 0.042940, 0.968881)),
    "tritan": ((1.255528, -0.076749, -0.178779),
               (-0.078411, 0.930809, 0.147602),
               (0.004733, 0.691367, 0.303900)),
}
THEMES = {
    "light": ':root[data-theme="light"]',
    "dark": ':root[data-theme="dark"]',
    "auto-dark": ':root:not([data-theme])',
    "hc-light": ':root[data-theme="hc-light"]',
    "hc-dark": ':root[data-theme="hc-dark"]',
}
PROPOSED = {
    "light": ("#1663dc", "#b4098b"),
    "dark": ("#066be3", "#be0692"),
    "auto-dark": ("#066be3", "#be0692"),
    "hc-light": ("#0238ab", "#6f0b55"),
    "hc-dark": ("#057df3", "#db11a3"),
}


def rgb(value):
    return tuple(int(value[i:i+2], 16) / 255 for i in (1, 3, 5))


def linear(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def oklab(c, vision="normal"):
    c = tuple(map(linear, rgb(c)))
    r, g, b = (max(0, min(1, dot(row, c))) for row in MATRICES[vision])
    l = (0.4122214708*r + 0.5363325363*g + 0.0514459929*b) ** (1/3)
    m = (0.2119034982*r + 0.6806995451*g + 0.1073969566*b) ** (1/3)
    s = (0.0883024619*r + 0.2817188376*g + 0.6299787005*b) ** (1/3)
    return (0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
            1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
            0.0259040371*l + 0.7827717662*m - 0.8086757660*s)


def distances(a, b):
    return {v: math.dist(oklab(a, v), oklab(b, v)) for v in MATRICES}


def contrast_rgb(a, b):
    def lum(c):
        return dot((0.2126, 0.7152, 0.0722), tuple(map(linear, c)))
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def contrast(a, b):
    return contrast_rgb(rgb(a), rgb(b))


def tokens(selector):
    start = CSS.index(selector + " {")
    body = CSS[CSS.index("{", start) + 1:CSS.index("}", start)]
    return dict(re.findall(r"(--[\w-]+):\s*([^;]+);", body))


def main():
    result = {"head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "kind": "numeric probe; not rendered pixels or an accessibility certification",
              "pipeline": "sRGB decode -> Machado 1.0 -> clamp [0,1] -> OKLab",
              "themes": {}}
    for name, selector in THEMES.items():
        t = tokens(selector)
        roles = ("feed", "rapid", "backplot", "limit", "collision")
        before = {r: t["--viewer-" + r].strip() for r in roles}
        after = {**before, "feed": PROPOSED[name][0], "backplot": PROPOSED[name][1]}
        pairs = {}
        for a, b in itertools.combinations(roles, 2):
            pairs[a + "/" + b] = {
                "before": distances(before[a], before[b]),
                "proposed": distances(after[a], after[b]),
                "proposed_luminance_contrast": contrast(after[a], after[b]),
            }
        bg = t["--bg"].strip()
        result["themes"][name] = {
            "before": before, "proposed": after, "pairs": pairs,
            "normal_sight_shift": {r: math.dist(oklab(before[r]), oklab(after[r])) for r in ("feed", "backplot")},
            "line_contrast": {r: {s: contrast(after[r], c) for s, c in {
                "background": bg, "table_test": "#e0e0e0", "table_measured": "#e1e1e1",
                "side_dark": "#7e7f7f", "side_light": "#8d8e8f",
            }.items()} for r in roles},
        }
    result["midgrey_counterexample"] = {
        "black_line": {c: contrast("#000000", c) for c in ("#ffffff", "#e1e1e1", "#7e7f7f", "#8d8e8f")},
        "white_line": {c: contrast("#ffffff", c) for c in ("#0b0f14", "#7e7f7f", "#8d8e8f")},
    }
    # Optimistic full-pixel coverage, no antialiasing: even a black grid is
    # too weak over white at the current alpha. Include both compositing
    # conventions to keep this bound independent of renderer configuration.
    result["twp_grid_alpha_035_best_on_white"] = {
        "srgb_composite_rgb": [0.65]*3,
        "srgb_composite_contrast": contrast_rgb((0.65,)*3, (1,)*3),
        "linear_composite_contrast": 1.05 / (0.65 + 0.05),
        "note": "Analytic upper bound for black at opacity .35 over white, not a screenshot measurement.",
    }
    print(json.dumps(result, indent=2) + "\n", end="")


if __name__ == "__main__":
    main()
