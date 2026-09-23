"""Reproduce the static inventory and sRGB contrast calculations for the review.

Run from the repository root. This does not modify product files.
"""
from pathlib import Path
import collections
import json
import re

src = Path("lcnc-webui/src")
strip_comments = lambda s: re.sub(r"/\*.*?\*/", "", s, flags=re.S)
css = strip_comments((src / "style.css").read_text())
tokens = set(re.findall(r"(--[\w-]+)\s*:", css))
files = [p for p in src.rglob("*") if p.suffix in (".vue", ".css", ".ts") and ".test." not in p.name]
text = "\n".join(strip_comments(p.read_text()) for p in files)
# Include dynamic token references expressed as string values, not just var().
refs = set(re.findall(r"--[\w-]+", re.sub(r"--[\w-]+\s*:", "", text)))
catalog = (src / "machineControls.ts").read_text().split("export const BUTTON_TYPES = {")[1].split("} as const")[0]
entries = re.findall(r"^\s*(\w+):\s*\{([^\n}]+)\}", catalog, re.M)
groups = collections.defaultdict(list)
for name, attributes in entries:
    groups[re.sub(r"\s+", "", attributes)].append(name)
vue = "\n".join(p.read_text() for p in files if p.suffix == ".vue")
inventory = {
    "global_custom_properties": len(tokens),
    "base_root_properties": len(set(re.findall(r"(--[\w-]+)\s*:", css.split("@media")[0]))),
    "button_catalog_types": len(entries),
    "static_machinebtn_tags": len(re.findall(r"<MachineBtn\b", vue)),
    "raw_button_tags": len(re.findall(r"<button\b", vue)),
    "font_tokens": sorted(t for t in tokens if t.startswith("--fs-")),
    "radius_tokens": sorted(t for t in tokens if t.startswith("--radius-")),
    "gap_tokens": sorted(t for t in tokens if t.startswith("--gap-")),
    "unreferenced_candidates": sorted(tokens - refs),
    "same_catalog_definition": [names for names in groups.values() if len(names) > 1],
}

def rgb(h):
    return [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]

def luminance(c):
    linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in c]
    return sum(v * w for v, w in zip(linear, (.2126, .7152, .0722)))

def contrast(a, b):
    low, high = sorted((luminance(a), luminance(b)))
    return (high + .05) / (low + .05)

def blend(a, b, alpha):
    return [x * alpha + y * (1 - alpha) for x, y in zip(a, b)]

current = {"feed": "#22b8cf", "rapid": "#f5a623", "bounds": "#ffffff", "backplot": "#ff00ff", "outside_limits": "#ffcc00", "selected": "#ff3333"}
proposed = {"bounds": ("#475569", "#CBD5E1"), "feed": ("#0072B2", "#56B4E9"),
            "rapid": ("#9A6700", "#E69F00"), "backplot": ("#007F75", "#2DD4BF"),
            "selected": ("#7E22CE", "#D8B4FE"), "collision": ("#B91C1C", "#FF8585")}
themes = json.loads(Path("runlogs/ui-consistency-20260922/accessibility.json").read_text())["themes"]
contrasts = {"method": "WCAG sRGB source-colour ratios; not antialiased pixel measurements or a WCAG certification", "themes": [], "proposed": []}
for theme in themes:
    t = theme["tokens"]
    bg, panel, fg = (rgb(t[k]) for k in ("--bg", "--panel", "--fg"))
    contrasts["themes"].append({"theme": theme["theme"],
        "viewer": {k: round(contrast(rgb(v), bg), 4) for k, v in current.items()},
        "syntax_against_bg_before_comment_opacity": {k: round(contrast(rgb(v), bg), 4) for k, v in t.items() if k.startswith("--syntax-")},
        "muted_on_panel": round(contrast(blend(fg, panel, .6), panel), 4),
        "info_on_bg": round(contrast(rgb(t["--info"]), bg), 4)})
for name, (light, dark) in proposed.items():
    contrasts["proposed"].append({"role": name, "light": light, "dark": dark,
        "on_white": round(contrast(rgb(light), rgb("#ffffff")), 4),
        "on_dark": round(contrast(rgb(dark), rgb("#0b0f14")), 4)})
print(json.dumps({"inventory": inventory, "contrasts": contrasts}, indent=2))
