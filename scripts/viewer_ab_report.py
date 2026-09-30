#!/usr/bin/env python3
"""Verdict of a part-B A/B measurement (Codex R39 VP39-03).

Settings → Debug → "Run A/B measurement" drives the viewer through a fixed
sequence, alternating the previous GL line (A, "gl") and the 2 CSS px line
(B, "fat"): A, B, B, A, A, B. Every phase emits `browser.viewer.abrun` (its
summary, conditions, memory ledger) and `browser.viewer.abhist` (its raw
frame-gap / main-thread / GPU histograms, 1 ms bins) into trace.ndjson.
This report merges the repetitions of each variant and phase and applies
the limits fixed BEFORE the measurement (Codex R39/R47):

  completeness: THREE valid repetitions of every phase per variant (build,
    orbit, fitdetail, jumps, overlay_off, reveal, release) with their raf
    and mt histograms and their memory point — anything missing, skipped or
    excluded makes the verdict INCOMPLETE with the reason, never PASS;
  reference rate: the calibration phase (before any build, the path hidden)
    or --rate — never the variants under test; its limit is compared in the
    histogram's 1 ms classes (at 60 Hz a p95 below 34 ms passes 33.3 ms);
  steady phases (orbit, fitdetail, jumps, overlay_off, reveal), per phase:
    - B's frame-gap p95 (of the merged samples — never an average of
      percentiles) within 2 reference frame periods;
    - B's p95 at most 20 % above A's;
    - no NEW recurring gaps >= 100 ms or main-thread blocks >= 50 ms: B's
      count minus what A's RATE predicts for B's time stays below 2;
  build (a REAL rebuild each time — distinct path generations): B's median
    duration and median longest main-thread block at most 1.5 x A's + 100 ms,
    and the eager pack's capacity estimated before it (the ledger's
    `eager`) at least what it then allocated;
  memory: B - A <= 128 MiB at every ledger point and for the peak bound of
    every phase (a reveal raises it), CPU and GPU separately; after each
    release no path byte is left; a record without a required value (its
    duration, held totals, peak, generation, payload, a histogram maximum)
    is excluded — INCOMPLETE, never a dropped check.

p95 and limits compare at the histogram's resolution: a p95 passes when its
bin is not above the limit's bin (quantiles are bin upper edges —
lcnc-webui/src/viewer/abHistogram.ts, the same convention, both pinned by
scripts/test_fixtures/ab_histogram_cases.json).

A phase recorded hidden, under a dialog, with the camera touched by hand or
with the collision sweep running is EXCLUDED and named; so is a skipped
phase (its reason), a missing or partial histogram and a missing memory
point.

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
NEW_EVENTS = 2            # B's gaps / blocks beyond what A's RATE predicts for B's time: 2+ = new and recurring
BUILD_RATIO = 1.5         # a build: B's median duration and longest main-thread block
BUILD_SLACK_MS = 100.0    #   at most 1.5 × A's + 100 ms (the pack is main-thread work)
MEMORY_MAX_BYTES = 128 * 1024 * 1024
REPS_REQUIRED = 3         # valid repetitions per variant and phase
STEADY = ("orbit", "fitdetail", "jumps", "overlay_off", "reveal")
REQUIRED_SERIES = ("raf", "mt")          # gpu fences: diagnosis only (absent without WebGL2)
PHASE_MEMORY = {"build": "after_load", "orbit": "after_orbit", "fitdetail": "after_lods",
                "jumps": "after_nav", "reveal": "after_reveal", "release": "after_release"}
REQUIRED_PHASES = ("build",) + STEADY + ("release",)


def nominal_rate(frame_ms: float | None) -> int | None:
    if not frame_ms:
        return None
    hz = 1000.0 / frame_ms
    return min(COMMON_RATES, key=lambda r: abs(r - hz))


def median(xs: list[float]) -> float | None:
    """The median; a missing value is an error, never dropped (Codex R48: a
    missing 300 ms maximum turned a 300 ms median into 155 ms)."""
    if any(x is None for x in xs):
        raise ValueError("median of a sample with a missing value")
    xs = sorted(xs)
    if not xs:
        return None
    m = len(xs) // 2
    return xs[m] if len(xs) % 2 else (xs[m - 1] + xs[m]) / 2


def _number(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _at(d, path: tuple):
    for k in path:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def missing_values(p: dict) -> list[str]:
    """The required values a RAN record lacks (Codex R48 VP-I13): its
    duration, and at its memory point the held CPU / GPU totals and the peak
    bound — plus the build's path generation and the release's payload. A
    missing value excludes the record (→ INCOMPLETE), never drops a check."""
    need = [("ms",)]
    if p.get("phase") in PHASE_MEMORY:
        need += [("memory", "cpu", "total"), ("memory", "gpu", "total"), ("memory", "peak")]
        if p["phase"] == "build":
            need += [("memory", "generation"), ("memory", "eager", "estimate"), ("memory", "eager", "packed")]
        if p["phase"] == "release":
            need.append(("memory", "cpu", "payload"))
    return [".".join(k) for k in need if not _number(_at(p, k))]


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
def analyse(rows: list[dict], run: str | None = None, rate: int | None = None) -> dict:
    runs = [e["run"] for e in rows if e.get("tag") == "browser.viewer.abrun" and e.get("phase") == "meta"]
    if not runs:
        return {"ok": None, "error": "no A/B run in the trace"}
    run = run or runs[-1]
    mine = [e for e in rows if e.get("run") == run]
    meta = next((e for e in mine if e.get("phase") == "meta"), None) or {}
    end = next((e for e in mine if e.get("phase") == "end"), None)
    phases = {e["seq"]: e for e in mine if e.get("tag") == "browser.viewer.abrun" and "variant" in e}
    parts: dict[tuple[int, str], dict[int, dict]] = defaultdict(dict)
    for e in mine:
        if e.get("tag") == "browser.viewer.abhist":
            parts[(e["seq"], e["series"])][e["part"]] = e

    checks: list[dict] = []

    def check(name: str, ok: bool | None, detail: str) -> None:
        checks.append({"check": name, "ok": ok, "detail": detail})

    # ── every record: its histograms whole, its conditions clean ──
    excluded: list[str] = []
    valid: dict[tuple[str, str], list[dict]] = defaultdict(list)   # (variant, phase) → records
    hist: dict[int, dict[str, Hist]] = {}                          # seq → series → histogram
    for seq, p in sorted(phases.items()):
        label = f"{p['rep'] + 1}/{p['variant']}/{p['phase']}"
        why = []
        if p.get("status") != "ran":
            why.append(f"skipped: {p.get('reason', '?')}")
        for flag, text in (("hidden", "tab hidden"), ("dialog", "a dialog was open"),
                           ("interacted", "camera moved by hand"), ("sweep_busy", "collision sweep running")):
            if p.get(flag):
                why.append(text)
        kinds: dict[str, Hist] = {}
        for series in ("raf", "mt", "gpu"):
            got = parts.get((seq, series), {})
            if not got:
                if series in REQUIRED_SERIES and p.get("status") == "ran" and p["phase"] != "release":
                    why.append(f"no {series} histogram")
                continue
            want = next(iter(got.values()))["parts"]
            if len(got) != want:
                why.append(f"{series} histogram incomplete ({len(got)}/{want} parts)")
                continue
            no_max = [i for i in range(want) if not _number(got[i].get("max"))]
            if no_max:
                why.append(f"{series} histogram part {no_max[0]} without max")
                continue
            h = Hist()
            for i in range(want):
                h.add_sparse(got[i]["bins"], got[i]["max"])
            if h.n != got[0]["n"]:
                why.append(f"{series} histogram count {h.n} ≠ {got[0]['n']}")
                continue
            kinds[series] = h
        point = PHASE_MEMORY.get(p["phase"])
        if point and (p.get("memory_at") != point or not isinstance(p.get("memory"), dict)):
            why.append(f"no memory at {point}")
        elif p.get("status") == "ran":
            why += [f"no {k}" for k in missing_values(p)]
        if why:
            excluded.append(f"{label}: {', '.join(why)}")
            continue
        hist[seq] = kinds
        valid[(p["variant"], p["phase"])].append(p)

    # ── the reference rate: the calibration (path hidden), never the variants ──
    cal = Hist()
    for p in valid.get(("none", "calibrate"), []):
        if "raf" in hist[p["seq"]]:
            cal.merge(hist[p["seq"]]["raf"])
    frame_ms = cal.median_mid()
    rate_source = "--rate" if rate else "calibration"
    rate = rate or nominal_rate(frame_ms)
    limit_ms = P95_FRAMES * 1000.0 / rate if rate else None
    if limit_ms is None:
        check("reference frame rate", None, "no calibration phase measured and no --rate")

    # ── the required matrix: three valid repetitions of every phase ──
    order = str(meta.get("order", "")).split(",") if meta.get("order") else []
    reps_planned = {v: order.count(v) for v in ("gl", "fat")}
    complete: set[tuple[str, str]] = set()
    for v in ("gl", "fat"):
        if reps_planned.get(v, 0) < REPS_REQUIRED:
            check(f"{v}: {REPS_REQUIRED} repetitions planned", None, f"the run planned {reps_planned.get(v, 0)}")
        for ph in REQUIRED_PHASES:
            n = len(valid.get((v, ph), []))
            if n < REPS_REQUIRED:
                check(f"{v} {ph}: {REPS_REQUIRED} valid repetitions", None, f"{n} valid — see excluded")
            else:
                complete.add((v, ph))

    def merged(v: str, ph: str, series: str) -> Hist:
        h = Hist()
        for p in valid.get((v, ph), []):
            if series in hist[p["seq"]]:
                h.merge(hist[p["seq"]][series])
        return h

    def seconds(v: str, ph: str) -> float:
        return sum(p.get("ms", 0) for p in valid.get((v, ph), [])) / 1000.0

    def win_max(v: str, ph: str) -> float | None:
        """The highest window p95 of the repetitions (diagnosis) — unmeasured
        when any repetition lacks it, never read as 0."""
        vals = [_at(p, ("raf", "win_p95_max")) for p in valid.get((v, ph), [])]
        return max(vals) if vals and all(_number(x) for x in vals) else None

    # ── steady phases: p95, ratio, new recurring events by RATE ──
    table = []
    for ph in STEADY:
        row: dict = {"phase": ph}
        if not {("gl", ph), ("fat", ph)} <= complete:
            table.append(row)
            continue
        a, b = merged("gl", ph, "raf"), merged("fat", ph, "raf")
        am, bm = merged("gl", ph, "mt"), merged("fat", ph, "mt")
        ag, bg = merged("gl", ph, "gpu"), merged("fat", ph, "gpu")
        ta, tb = seconds("gl", ph), seconds("fat", ph)
        row.update({
            "a_p95": a.quantile(0.95), "b_p95": b.quantile(0.95),
            "a_win_p95_max": win_max("gl", ph), "b_win_p95_max": win_max("fat", ph),
            "a_gaps100": a.at_least(100), "b_gaps100": b.at_least(100),
            "a_blocks50": am.at_least(50), "b_blocks50": bm.at_least(50),
            "a_s": round(ta, 1), "b_s": round(tb, 1),
            "gpu_a_p95": ag.quantile(0.95), "gpu_b_p95": bg.quantile(0.95)})
        table.append(row)
        if limit_ms is not None:
            check(f"{ph}: B p95 within {P95_FRAMES} frames", p95_within(row["b_p95"], limit_ms),
                  f"B p95 {row['b_p95']} ms, limit {limit_ms:.1f} ms at {rate} Hz ({rate_source}; 1 ms classes: "
                  f"below {bin_high(bin_of(limit_ms)):.0f} ms passes)")
        check(f"{ph}: B p95 ≤ {RATIO_MAX:.2f} × A", p95_within(row["b_p95"], RATIO_MAX * row["a_p95"]),
              f"A {row['a_p95']} ms, B {row['b_p95']} ms")
        for name, ca, cb in (("gaps ≥ 100 ms", row["a_gaps100"], row["b_gaps100"]),
                             ("main-thread blocks ≥ 50 ms", row["a_blocks50"], row["b_blocks50"])):
            expected = ca / ta * tb if ta > 0 else 0.0
            check(f"{ph}: no new recurring {name}", cb - expected < NEW_EVENTS,
                  f"A {ca} in {ta:.1f} s, B {cb} in {tb:.1f} s (A's rate predicts {expected:.1f})")

    # ── builds: real rebuilds, duration and longest block ──
    build = {}
    if {("gl", "build"), ("fat", "build")} <= complete:
        for v in ("gl", "fat"):
            recs = valid[("gl" if v == "gl" else "fat", "build")]
            gens = [p["memory"].get("generation") for p in recs]
            # the longest block from the VALIDATED histogram (Codex R48), never
            # the phase summary a missing field could shorten
            eager = [(p["memory"]["eager"]["estimate"], p["memory"]["eager"]["packed"]) for p in recs]
            build[v] = {"ms": [p["ms"] for p in recs], "mt_max": [hist[p["seq"]]["mt"].max for p in recs],
                        "generations": gens, "eager": eager}
            check(f"{v} build: every build phase a real build", len(set(gens)) == len(gens) and None not in gens,
                  f"path generations {gens}")
            # the capacity estimated BEFORE the pack (Codex R39/R48) must bound it
            check(f"{v} build: the eager estimate bounds the pack", all(e >= k for e, k in eager),
                  "estimate / packed MiB: " + ", ".join(f"{e / 2**20:.1f} / {k / 2**20:.1f}" for e, k in eager))
        for key, name in (("ms", "duration"), ("mt_max", "longest main-thread block")):
            ma, mb = median(build["gl"][key]), median(build["fat"][key])
            if ma is None or mb is None:
                check(f"build {name}", None, "not measured")
                continue
            lim = BUILD_RATIO * ma + BUILD_SLACK_MS
            check(f"build: B's {name} ≤ {BUILD_RATIO} × A + {BUILD_SLACK_MS:.0f} ms", mb <= lim,
                  f"median A {ma:.0f} ms, B {mb:.0f} ms, limit {lim:.0f} ms")

    # ── memory: held at every point, the build's peak, the release ──
    memory = []
    for point in PHASE_MEMORY.values():
        row = {"point": point}
        ph = next(k for k, v in PHASE_MEMORY.items() if v == point)
        for side in ("cpu", "gpu"):
            for v, tag in (("gl", "a"), ("fat", "b")):
                vals = [p["memory"][side]["total"] for p in valid.get((v, ph), [])]
                row[f"{side}_{tag}"] = max(vals) if vals else None
            if row[f"{side}_a"] is not None and row[f"{side}_b"] is not None and point != "after_release":
                check(f"memory {point} {side}: B − A ≤ 128 MiB", row[f"{side}_b"] - row[f"{side}_a"] <= MEMORY_MAX_BYTES,
                      f"A {row[f'{side}_a'] / 2**20:.1f} MiB, B {row[f'{side}_b'] / 2**20:.1f} MiB")
        memory.append(row)
    # the peak bound of EVERY memory record (Codex R48 VP-I17): a reveal or a
    # jump after the build raises it, and that value counts
    peaks = {v: [p["memory"]["peak"] for ph in PHASE_MEMORY for p in valid.get((v, ph), [])] for v in ("gl", "fat")}
    if all(peaks[v] for v in ("gl", "fat")):
        pa, pb = max(peaks["gl"]), max(peaks["fat"])
        check("memory peak (every phase): B − A ≤ 128 MiB", pb - pa <= MEMORY_MAX_BYTES,
              f"A {pa / 2**20:.1f} MiB, B {pb / 2**20:.1f} MiB (upper bound: every allocation of a build alive at once)")
    for v in ("gl", "fat"):
        recs = valid.get((v, "release"), [])
        if not recs:
            continue
        left = [(p["memory"]["cpu"]["total"] - p["memory"]["cpu"]["payload"], p["memory"]["gpu"]["total"]) for p in recs]
        check(f"{v} release: every path byte freed", all(c == 0 and g == 0 for c, g in left),
              f"CPU / GPU left besides the program: {left}")

    complete_run = bool(end) and not (end or {}).get("cancelled")
    if not complete_run:
        check("run complete", None, "cancelled" if end else "no end record")
    ok = False if any(c["ok"] is False for c in checks) else (None if any(c["ok"] is None for c in checks) else True)
    verdict = {True: "PASS", False: "FAIL", None: "INCOMPLETE"}[ok]
    return {"ok": ok, "verdict": verdict, "run": run, "meta": meta, "frame_ms": frame_ms, "rate_hz": rate,
            "rate_source": rate_source, "limit_ms": limit_ms, "table": table, "build": build, "memory": memory,
            "checks": checks, "excluded": excluded, "complete": complete_run}


def render(r: dict) -> str:
    if "error" in r:
        return r["error"]
    m = r.get("meta") or {}
    out = [f"A/B run {r['run']} — commit {m.get('commit')} ({m.get('build')}), {m.get('file')}",
           f"  viewport {m.get('viewport')} at pixel ratio {m.get('pixel_ratio')} (device {m.get('device_pixel_ratio')}, zoom {m.get('zoom')}),"
           f" {m.get('feed_segs')} feed / {m.get('rapid_segs')} rapid points, overlays {m.get('overlays')}",
           f"  reference {r['rate_hz']} Hz ({r['rate_source']}; calibration median gap {r['frame_ms']} ms) → p95 limit "
           f"{r['limit_ms'] and round(r['limit_ms'], 1)} ms, compared in 1 ms classes",
           "", "  phase        A p95  B p95  A win  B win  A≥100 B≥100  A mt≥50 B mt≥50  A s    B s    gpu A  gpu B"]
    for t in r["table"]:
        if "a_p95" not in t:
            out.append(f"  {t['phase']:<12} (not all repetitions valid — see excluded)")
            continue
        out.append("  {phase:<12} {a_p95!s:>5}  {b_p95!s:>5}  {a_win_p95_max!s:>5}  {b_win_p95_max!s:>5}  "
                   "{a_gaps100!s:>5} {b_gaps100!s:>5}  {a_blocks50!s:>7} {b_blocks50!s:>7}  {a_s!s:>5}  {b_s!s:>5}  "
                   "{gpu_a_p95!s:>5}  {gpu_b_p95!s:>5}".format(**t))
    b = r["build"]
    if b:
        out += ["", f"  build ms  A {b['gl']['ms']}  B {b['fat']['ms']}; longest main-thread block A {b['gl']['mt_max']}  B {b['fat']['mt_max']}",
                f"  eager pack MiB (estimated before / packed)  B " + ", ".join(f"{e / 2**20:.1f} / {k / 2**20:.1f}" for e, k in b['fat']['eager'])]
    out += ["", "  memory (MiB, highest of the repetitions)"]
    f = lambda x: "—" if x is None else f"{x / 2**20:.1f}"  # noqa: E731
    for row in r["memory"]:
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
    ap.add_argument("--rate", type=int, default=None, help="the display's refresh rate (Hz), instead of the calibration")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    paths = a.trace or trace_files(a.log_dir or _default_log_dir())
    r = analyse(load(paths), a.run, a.rate)
    print(json.dumps(r, indent=2, default=str) if a.json else render(r))
    if r.get("ok") is None:
        return 2
    return 0 if r["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
