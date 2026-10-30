#!/usr/bin/env python3
"""R234 design arithmetic and supplied-report analysis; no product/browser code.

Run: python3 docs/reviews/setup-layout.r234.analysis.py
Widths are the proposal's scoring classes, not new rendered measurements.
The plane trio is an admissibility constraint, never a high-cost split.
"""
import hashlib
import itertools
import json
import math
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "docs/reviews/setup-layout/r234/report.json"
WIDTHS = {"base": {1: 206, 2: 236}, "goto": {1: 206, 2: 236, 3: 318}, "plane": {3: 360}}


def design(n, twp):
    if twp and n <= 6:
        return {"axes": n, "twp": twp, "form": "existing rows"}
    if n in (5, 6):
        return {"axes": n, "twp": twp, "form": "action column"}
    last_axes = n if n <= 6 else n - 6
    free = 6 - last_axes
    groups = [("base", 2), ("goto", 3)] + ([("plane", 3)] if twp else [])
    candidates = []
    for capacities in itertools.product(*(WIDTHS[g].keys() for g, _ in groups)):
        used = sum(math.ceil(count / cap) for (_, count), cap in zip(groups, capacities))
        if used > free:
            continue
        width = max(WIDTHS[g][cap] for (g, _), cap in zip(groups, capacities))
        # Lexicographic tie break: wider row of the earlier group first.
        score = (width, -used, tuple(-cap for cap in capacities))
        candidates.append((score, capacities))
    score, capacities = min(candidates)
    rows = {g: [min(cap, count - i) for i in range(0, count, cap)]
            for (g, count), cap in zip(groups, capacities)}
    return {"axes": n, "twp": twp, "form": "under", "last_axis_rows": last_axes,
            "action_rows_available": free, "action_rows_used": -score[1],
            "width_class": score[0], "groups": rows}


data = json.loads(REPORT.read_text())
landscape = [r for r in data if "__L" in r["id"]]
q = [r for r in data if r["id"].startswith("Q__")]
lookup = {r["id"]: r for r in data}
comparisons = []
for n in (7, 8, 9):
    before, after = (lookup[f"{v}__{n}-TWP__L1280__live"]["w"] for v in ("0", "Q"))
    comparisons.append({"axes": n, "before": before, "Q": after, "saved": before - after})
print(json.dumps({
    "report_sha256": hashlib.sha256(REPORT.read_bytes()).hexdigest(),
    "report_records": len(data), "landscape_records": len(landscape),
    "landscape_defects": [r for r in landscape if any(r[k] for k in ("wrapped", "cut", "outside"))],
    "landscape_height_mismatches": [r for r in landscape if r["h"] != (396 if "-150__" in r["id"] else 264)],
    "Q_records": len(q), "Q_surfaces": dict(Counter(r["id"].split("__")[2] for r in q)),
    "Q_comparisons": comparisons,
    "portrait_expected": "existing rows for every n and capability",
    "landscape_contract": [design(n, twp) for twp in (False, True) for n in range(1, 10)],
    "scope": "Independent evaluation of provided data and design rule, no new rendering run; forced TWP axis counts prove layout only."
}, indent=2, ensure_ascii=False))
