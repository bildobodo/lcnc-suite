#!/usr/bin/env python3
"""Read-only analysis of the supplied R233 render measurements; no browser/sim.

python3 docs/reviews/setup-layout.r233.analysis.py > /tmp/r233-analysis.json
Optional: --repo PATH --renders PATH (the directory containing a/, h/, k/).
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
p.add_argument("--renders", type=Path, default=Path.home() / "claude-work/setup/out-v5")
a = p.parse_args()
source = a.repo / "docs/reviews/setup-layout/report.json"
rows = json.loads(source.read_text())
by_id = {r["id"]: r for r in rows}
landscape = [r for r in rows if "__L" in r["id"]]
configs = ["2-XZ", "3-XYZ", "4-XYZA", "5-XYZAC", "5-TCP", "6-XYZABC",
           "6-TWP", "7-XYZABCU", "8-XYZABCUV", "9-XYZABCUVW"]
widths = []
for c in configs:
    old = by_id[f"0__{c}__L1920__live"]
    new = by_id[f"G__{c}__L1920__live"]
    widths.append({"config": c, "before": old["w"], "G": new["w"],
                   "saved": old["w"] - new["w"],
                   "strip_over_before": old["stripOver"], "strip_over_G": new["stripOver"]})
portrait_pairs = []
for r in rows:
    if not (r["id"].startswith("G__") and "__P900__" in r["id"]):
        continue
    current = a.renders / "a" / (r["id"] + ".png")
    before = current.with_name("0" + current.name[1:])
    if not current.exists() or not before.exists():
        portrait_pairs.append({"id": r["id"], "verified": False, "reason": "image absent"})
        continue
    ca, cb = current.read_bytes(), before.read_bytes()
    portrait_pairs.append({"id": r["id"], "verified": True, "byte_equal": ca == cb,
                           "before_sha256": hashlib.sha256(cb).hexdigest(),
                           "G_sha256": hashlib.sha256(ca).hexdigest()})
print(json.dumps({
    "source": str(source), "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "rows": len(rows),
    "surfaces": dict(collections.Counter(r["id"].split("__")[2] for r in rows)),
    "landscape_cases": len(landscape),
    "landscape_wrap_cut_outside": [r for r in landscape if any(r[k] for k in ("wrapped", "cut", "outside"))],
    "landscape_unexpected_height": [r for r in landscape if r["h"] != (396 if "-150__" in r["id"] else 264)],
    "widths_and_strip_overflow_at_1920": widths,
    "portrait_image_pairs": portrait_pairs,
    "limits": ["Supplied measurements, not an independent rendering run.",
               "Touch plus 150% zoom is absent from the supplied surface matrix.",
               "P900 with keypad and P900-150 are absent from the supplied surface matrix.",
               "Bounding-box containment does not prove hit-testability beside sticky Safety."]
}, indent=2, ensure_ascii=False))
