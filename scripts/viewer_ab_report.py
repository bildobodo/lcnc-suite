#!/usr/bin/env python3
"""Verdict of a part-B A/B measurement (Codex R39 VP39-03).

Settings → Debug → "Run A/B measurement" drives the viewer through a fixed
sequence, alternating the previous GL line (A, "gl") and the 2 CSS px line
(B, "fat"): A, B, B, A, A, B. Every phase emits `browser.viewer.abrun` (its
summary, conditions, memory ledger) and `browser.viewer.abhist` (its raw
frame-gap / main-thread / GPU histograms, 1 ms bins) into trace.ndjson.
This report merges the repetitions of each variant and phase and applies
the limits fixed BEFORE the measurement:

  steady phases (orbit, fitdetail, jumps, overlay_off, reveal), per phase:
    - B's frame-gap p95 (of the merged samples — never an average of
      percentiles) within 2 nominal frame periods (33.3 ms at 60 Hz; the
      nominal rate is the common rate nearest the warm-up's median gap);
    - B's p95 at most 20 % above A's;
    - no NEW recurring gaps >= 100 ms (B - A < 2) and no new main-thread
      blocks >= 50 ms (B - A < 2);
  build (the rebuild in each renderer): B's blocks >= 50 ms not above A's;
  memory: B - A at every ledger point <= 128 MiB, CPU and GPU separately.

p95 and limits compare at the histogram's resolution: a p95 passes when its
bin is not above the limit's bin (quantiles are bin upper edges —
lcnc-webui/src/viewer/abHistogram.ts, the same convention, both pinned by
scripts/test_fixtures/ab_histogram_cases.json).

A phase recorded hidden, under a dialog, with the camera touched by hand or
with the collision sweep running is EXCLUDED and named; so is a skipped
phase (its reason) and a histogram with a missing part.

Usage:
  python3 scripts/viewer_ab_report.py                    # the last run in the trace
  python3 scripts/viewer_ab_report.py --run ab-lx2k9 --json
  python3 scripts/viewer_ab_report.py --log-dir ~/lcnc-suite/runlogs
A limit not measurable (a phase skipped in every repetition, no warm-up,
a cancelled run) makes the verdict INCOMPLETE, never PASS.

Exit: 0 PASS, 1 FAIL, 2 INCOMPLETE or no run.
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lcnc-gateway"))

# ── the histogram convention (twin of abHistogram.ts) ──────────────────────
FINE_MS = 200
COARSE_MS = 10
MAX_MS = 1000
BINS = FINE_MS + (MAX_MS - FINE_MS) // COARSE_MS + 1


def bin_of(ms: float) -> int:
    if not ms > 0:
        return 0
    if ms < FINE_MS:
        return int(math.floor(ms))
    if ms < MAX_MS:
        return FINE_MS + int(math.floor((ms - FINE_MS) / COARSE_MS))
    return BINS - 1


def bin_high(b: int) -> float:
    if b < FINE_MS:
        return b + 1
    if b < BINS - 1:
        return FINE_MS + (b - FINE_MS + 1) * COARSE_MS
    return math.inf


def bin_low(b: int) -> float:
    return b if b < FINE_MS else FINE_MS + (b - FINE_MS) * COARSE_MS


class Hist:
    def __init__(self) -> None:
        self.counts = [0] * BINS
        self.n = 0
        self.max = 0.0

    def add_sparse(self, pairs: list[int], mx: float = 0.0) -> None:
        for i in range(0, len(pairs) - 1, 2):
            self.counts[pairs[i]] += pairs[i + 1]
            self.n += pairs[i + 1]
        self.max = max(self.max, mx)

    def add(self, ms: float, count: int = 1) -> None:
        self.counts[bin_of(ms)] += count
        self.n += count
        self.max = max(self.max, ms)

    def merge(self, o: "Hist") -> None:
        for b in range(BINS):
            self.counts[b] += o.counts[b]
        self.n += o.n
        self.max = max(self.max, o.max)

    def quantile(self, q: float) -> float | None:
        if self.n == 0:
            return None
        rank = max(1, math.ceil(q * self.n))
        acc = 0
        for b in range(BINS):
            acc += self.counts[b]
            if acc >= rank:
                return bin_high(b)
        return bin_high(BINS - 1)

    def median_mid(self) -> float | None:
        """The median bin's midpoint (the refresh estimate)."""
        if self.n == 0:
            return None
        rank = max(1, math.ceil(0.5 * self.n))
        acc = 0
        for b in range(BINS):
            acc += self.counts[b]
            if acc >= rank:
                return (bin_low(b) + min(bin_high(b), MAX_MS)) / 2
        return None

    def at_least(self, ms: float) -> int:
        return sum(self.counts[b] for b in range(bin_of(ms), BINS) if bin_low(b) >= ms)


def p95_within(p95: float | None, limit_ms: float) -> bool:
    """At the histogram's resolution: the p95's bin is not above the limit's."""
    if p95 is None:
        return False
    return bin_of(p95 - 1e-9) <= bin_of(limit_ms)


# ── limits (fixed before the measurement) ─────────────────────────────────
COMMON_RATES = (60, 75, 90, 100, 120, 144, 165, 240)
P95_FRAMES = 2
RATIO_MAX = 1.20
NEW_GAPS_MAX = 1          # B - A gaps >= 100 ms per phase; 2+ = new and recurring
NEW_BLOCKS_MAX = 1        # B - A main-thread blocks >= 50 ms per phase
MEMORY_MAX_BYTES = 128 * 1024 * 1024
STEADY = ("orbit", "fitdetail", "jumps", "overlay_off", "reveal")
MEMORY_POINTS = ("after_load", "after_orbit", "after_lods", "after_nav", "after_reveal")


def nominal_rate(frame_ms: float | None) -> int | None:
    if not frame_ms:
        return None
    hz = 1000.0 / frame_ms
    return min(COMMON_RATES, key=lambda r: abs(r - hz))


# ── reading the trace ─────────────────────────────────────────────────────
def _default_log_dir() -> str:
    try:
        import lcnc_paths
        return lcnc_paths.resolve()[0]
    except Exception:  # safe-silent: fall back to the resolver's documented default
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "runlogs")


def load(paths: list[str]) -> list[dict]:
    rows = []
    for fn in paths:
        with open(fn, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if "browser.viewer.ab" not in line:
                    continue
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if e.get("tag") in ("browser.viewer.abrun", "browser.viewer.abhist"):
                    rows.append(e)
    return rows


def trace_files(log_dir: str) -> list[str]:
    files = glob.glob(os.path.join(log_dir, "trace.ndjson*"))
    # oldest rotation first: trace.ndjson.5 … .1, then trace.ndjson
    return sorted(files, key=lambda p: -int(p.rsplit(".", 1)[1]) if p[-1].isdigit() else 0)


# ── the verdict ───────────────────────────────────────────────────────────
def analyse(rows: list[dict], run: str | None = None) -> dict:
    runs = [e["run"] for e in rows if e.get("tag") == "browser.viewer.abrun" and e.get("phase") == "meta"]
    if not runs:
        return {"ok": None, "error": "no A/B run in the trace"}
    run = run or runs[-1]
    mine = [e for e in rows if e.get("run") == run]
    meta = next((e for e in mine if e.get("phase") == "meta"), None)
    end = next((e for e in mine if e.get("phase") == "end"), None)
    phases = {e["seq"]: e for e in mine if e.get("tag") == "browser.viewer.abrun" and "variant" in e}
    parts: dict[tuple[int, str], dict[int, dict]] = defaultdict(dict)
    for e in mine:
        if e.get("tag") == "browser.viewer.abhist":
            parts[(e["seq"], e["series"])][e["part"]] = e

    excluded: list[str] = []
    hists: dict[tuple[str, str, str], Hist] = {}          # (variant, phase, kind) → merged
    by_vp: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for seq, p in sorted(phases.items()):
        label = f"{p['rep'] + 1}/{p['variant']}/{p['phase']}"
        why = []
        if p.get("status") != "ran":
            why.append(f"skipped: {p.get('reason', '?')}")
        for flag, text in (("hidden", "tab hidden"), ("dialog", "a dialog was open"),
                           ("interacted", "camera moved by hand"), ("sweep_busy", "collision sweep running")):
            if p.get(flag):
                why.append(text)
        kinds = {}
        for kind in ("raf", "mt", "gpu"):
            got = parts.get((seq, kind), {})
            if not got:
                continue
            want = next(iter(got.values()))["parts"]
            if len(got) != want:
                why.append(f"{kind} histogram incomplete ({len(got)}/{want} parts)")
                continue
            h = Hist()
            for i in range(want):
                h.add_sparse(got[i]["bins"], got[i].get("max", 0.0))
            if h.n != got[0]["n"]:
                why.append(f"{kind} histogram count {h.n} ≠ {got[0]['n']}")
                continue
            kinds[kind] = h
        if why:
            excluded.append(f"{label}: {', '.join(why)}")
            continue
        by_vp[(p["variant"], p["phase"])].append(p)
        for kind, h in kinds.items():
            hists.setdefault((p["variant"], p["phase"], kind), Hist()).merge(h)

    warm = Hist()
    for v in ("gl", "fat"):
        if (v, "warmup", "raf") in hists:
            warm.merge(hists[(v, "warmup", "raf")])
    frame_ms = warm.median_mid()
    rate = nominal_rate(frame_ms)
    limit_ms = P95_FRAMES * 1000.0 / rate if rate else None

    checks: list[dict] = []

    def check(name: str, ok: bool | None, detail: str) -> None:
        checks.append({"check": name, "ok": ok, "detail": detail})

    table = []
    for ph in STEADY:
        a, b = hists.get(("gl", ph, "raf")), hists.get(("fat", ph, "raf"))
        am, bm = hists.get(("gl", ph, "mt")), hists.get(("fat", ph, "mt"))
        wa = max((r["raf"].get("win_p95_max") or 0 for r in by_vp.get(("gl", ph), [])), default=None)
        wb = max((r["raf"].get("win_p95_max") or 0 for r in by_vp.get(("fat", ph), [])), default=None)
        row = {"phase": ph,
               "a_p95": a.quantile(0.95) if a else None, "b_p95": b.quantile(0.95) if b else None,
               "a_win_p95_max": wa, "b_win_p95_max": wb,
               "a_gaps100": a.at_least(100) if a else None, "b_gaps100": b.at_least(100) if b else None,
               "a_blocks50": am.at_least(50) if am else None, "b_blocks50": bm.at_least(50) if bm else None,
               "a_n": a.n if a else 0, "b_n": b.n if b else 0,
               "gpu_a_p95": hists[("gl", ph, "gpu")].quantile(0.95) if ("gl", ph, "gpu") in hists else None,
               "gpu_b_p95": hists[("fat", ph, "gpu")].quantile(0.95) if ("fat", ph, "gpu") in hists else None}
        table.append(row)
        if not a or not b:
            check(f"{ph}: measured", None, "no complete A and B samples — see excluded" if a or b else "not measured — see excluded")
            continue
        if limit_ms is not None:
            check(f"{ph}: B p95 within {P95_FRAMES} frames", p95_within(row["b_p95"], limit_ms),
                  f"B p95 {row['b_p95']} ms, limit {limit_ms:.1f} ms at {rate} Hz")
        check(f"{ph}: B p95 ≤ {RATIO_MAX:.2f} × A", p95_within(row["b_p95"], RATIO_MAX * row["a_p95"]),
              f"A {row['a_p95']} ms, B {row['b_p95']} ms")
        check(f"{ph}: no new recurring gaps ≥ 100 ms", row["b_gaps100"] - row["a_gaps100"] <= NEW_GAPS_MAX,
              f"A {row['a_gaps100']}, B {row['b_gaps100']}")
        check(f"{ph}: no new main-thread blocks ≥ 50 ms", row["b_blocks50"] - row["a_blocks50"] <= NEW_BLOCKS_MAX,
              f"A {row['a_blocks50']}, B {row['b_blocks50']}")
    if limit_ms is None:
        check("refresh rate measured", None, "no warm-up samples")

    ba, bb = hists.get(("gl", "build", "mt")), hists.get(("fat", "build", "mt"))
    build = {"a_ms": [r["ms"] for r in by_vp.get(("gl", "build"), [])],
             "b_ms": [r["ms"] for r in by_vp.get(("fat", "build"), [])],
             "a_blocks50": ba.at_least(50) if ba else None, "b_blocks50": bb.at_least(50) if bb else None,
             "a_mt_max": ba.max if ba else None, "b_mt_max": bb.max if bb else None}
    if ba and bb:
        check("build: no new main-thread blocks ≥ 50 ms", bb.at_least(50) <= ba.at_least(50),
              f"A {ba.at_least(50)} (max {ba.max:.0f} ms), B {bb.at_least(50)} (max {bb.max:.0f} ms)")

    memory = []
    for point in MEMORY_POINTS:
        def peak(v: str, side: str) -> int | None:
            vals = [r["memory"][side]["total"] for (vv, _), rs in by_vp.items() if vv == v
                    for r in rs if r.get("memory_at") == point]
            return max(vals) if vals else None
        row = {"point": point}
        for side in ("cpu", "gpu"):
            a, b = peak("gl", side), peak("fat", side)
            row[f"{side}_a"], row[f"{side}_b"] = a, b
            if a is not None and b is not None:
                check(f"memory {point} {side}: B − A ≤ 128 MiB", b - a <= MEMORY_MAX_BYTES,
                      f"A {a / 2**20:.1f} MiB, B {b / 2**20:.1f} MiB, +{(b - a) / 2**20:.1f} MiB")
        memory.append(row)

    complete = bool(end) and not (end or {}).get("cancelled")
    if not complete:
        check("run complete", None, "cancelled" if end else "no end record")
    # FAIL if any limit is broken; INCOMPLETE if something was not measured.
    ok = False if any(c["ok"] is False for c in checks) else (None if any(c["ok"] is None for c in checks) else True)
    verdict = {True: "PASS", False: "FAIL", None: "INCOMPLETE"}[ok]
    return {"ok": ok, "verdict": verdict, "run": run, "meta": meta, "frame_ms": frame_ms, "rate_hz": rate, "limit_ms": limit_ms,
            "table": table, "build": build, "memory": memory, "checks": checks, "excluded": excluded,
            "complete": complete}


def render(r: dict) -> str:
    if "error" in r:
        return r["error"]
    m = r.get("meta") or {}
    out = [f"A/B run {r['run']} — commit {m.get('commit')} ({m.get('build')}), {m.get('file')}",
           f"  viewport {m.get('viewport')} at pixel ratio {m.get('pixel_ratio')} (device {m.get('device_pixel_ratio')}, zoom {m.get('zoom')}),"
           f" {m.get('feed_segs')} feed / {m.get('rapid_segs')} rapid points, overlays {m.get('overlays')}",
           f"  refresh ≈ {r['rate_hz']} Hz (median gap {r['frame_ms']} ms) → p95 limit {r['limit_ms'] and round(r['limit_ms'], 1)} ms",
           "", "  phase        A p95  B p95  A win  B win  A≥100 B≥100  A mt≥50 B mt≥50  gpu A  gpu B"]
    for t in r["table"]:
        out.append("  {phase:<12} {a_p95!s:>5}  {b_p95!s:>5}  {a_win_p95_max!s:>5}  {b_win_p95_max!s:>5}  "
                   "{a_gaps100!s:>5} {b_gaps100!s:>5}  {a_blocks50!s:>7} {b_blocks50!s:>7}  {gpu_a_p95!s:>5}  {gpu_b_p95!s:>5}".format(**t))
    b = r["build"]
    out += ["", f"  build ms  A {b['a_ms']}  B {b['b_ms']}; blocks ≥ 50 ms A {b['a_blocks50']} B {b['b_blocks50']}", "", "  memory (MiB, peak of the repetitions)"]
    for row in r["memory"]:
        f = lambda x: "—" if x is None else f"{x / 2**20:.1f}"  # noqa: E731
        out.append(f"  {row['point']:<13} CPU A {f(row['cpu_a'])} B {f(row['cpu_b'])}   GPU A {f(row['gpu_a'])} B {f(row['gpu_b'])}")
    if r["excluded"]:
        out += ["", "  excluded:"] + [f"    {x}" for x in r["excluded"]]
    mark = {True: "PASS", False: "FAIL", None: "N/A "}
    out += [""] + [f"  {mark[c['ok']]}  {c['check']} — {c['detail']}" for c in r["checks"]]
    out += ["", f"verdict: {r['verdict']}"]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--log-dir", default=None)
    ap.add_argument("--trace", action="append", help="a trace file (repeatable); default: the log dir's rotations")
    ap.add_argument("--run", default=None)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    paths = a.trace or trace_files(a.log_dir or _default_log_dir())
    r = analyse(load(paths), a.run)
    print(json.dumps(r, indent=2, default=str) if a.json else render(r))
    if r.get("ok") is None:
        return 2
    return 0 if r["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
