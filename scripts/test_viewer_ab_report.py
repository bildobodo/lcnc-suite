"""scripts/viewer_ab_report.py — the part-B A/B verdict (Codex R39 VP39-03).

Synthetic trace rows in the shape lcnc-webui/src/viewer/abRun.ts emits. The
histogram convention is pinned against the SAME cases the TypeScript twin
reads (scripts/test_fixtures/ab_histogram_cases.json). Run:
  python3 -m pytest scripts/test_viewer_ab_report.py
"""
import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
import viewer_ab_report as rep  # noqa: E402

CASES = json.loads((Path(__file__).parent / "test_fixtures" / "ab_histogram_cases.json").read_text())["cases"]
ORDER = ["gl", "fat", "fat", "gl", "gl", "fat"]
PHASES = ["build", "warmup", "orbit", "fitdetail", "jumps", "overlay_off", "reveal", "release"]
MEM_AT = {"build": "after_load", "orbit": "after_orbit", "fitdetail": "after_lods", "jumps": "after_nav", "reveal": "after_reveal", "release": "after_release"}
MiB = 2 ** 20


def hist_of(samples):
    h = rep.Hist()
    for v, c in samples:
        h.add(v, c)
    return h


def sparse(h):
    out = []
    for b, c in enumerate(h.counts):
        if c:
            out += [b, c]
    return out


# ── the shared histogram cases ────────────────────────────────────────────
def test_shared_cases_match_the_typescript_twin():
    for case in CASES:
        e = case["expect"]
        total = rep.Hist()
        wins = []
        for w in case["windows"]:
            h = hist_of(w)
            wins.append(h.quantile(0.95))
            total.merge(h)
        assert total.quantile(0.95) == e["p95"], case["name"]
        assert max(wins) == e["window_p95_max"], case["name"]
        assert math.isclose(sum(wins) / len(wins), e["window_p95_mean"]), case["name"]
        assert total.at_least(100) == e["at_least_100"], case["name"]
        assert total.at_least(50) == e["at_least_50"], case["name"]
        assert sparse(total) == e["sparse"], case["name"]


def test_p95_within_compares_at_the_bin_resolution():
    # 2 frames at 60 Hz = 33.3 ms: a p95 in the 33 ms bin (upper edge 34) passes, the 34 ms bin fails
    assert rep.p95_within(34, 1000 * 2 / 60)
    assert not rep.p95_within(35, 1000 * 2 / 60)
    assert not rep.p95_within(None, 33.3)


# ── synthetic runs ────────────────────────────────────────────────────────
def run_rows(run="ab-test", order=ORDER, frames=None, cal=None, flags=None, mem=None, skip=None, drop_part=None,
             drop_series=(), drop_memory=False, cancelled=False, split=False, build_ms=None, block_ms=None,
             generations=None, peak=None, released=None, eager=None):
    """A whole A/B run in the shape abRun.ts emits. frames(variant, rep, phase)
    → [(ms, count)] frame gaps; cal → the calibration's gaps; flags / mem /
    skip per phase; drop_series = {(phase, series)} left out everywhere."""
    frames = frames or (lambda v, r, p: [(16.7, 180)])
    cal = cal or [(16.7, 180)]
    build_ms = build_ms or (lambda v, r: 400 if v == "gl" else 450)
    block_ms = block_ms or (lambda v, r: 110 if v == "gl" else 120)
    generations = generations or (lambda v, r: r + 1)
    peak = peak or (lambda v, r: (120 if v == "gl" else 170) * MiB)
    released = released or (lambda v, r: 0)
    eager = eager or (lambda v, r: {"estimate": 60 * MiB, "packed": 60 * MiB} if v == "fat" else {"estimate": 0, "packed": 0})
    rows = [{"tag": "browser.viewer.abrun", "run": run, "seq": 0, "phase": "meta", "commit": "abc1234", "order": ",".join(order),
             "build": "production", "file": "/prog.ngc", "viewport": [800, 600], "pixel_ratio": 2}]
    seq = 1

    def emit(rec, hists, why):
        rows.append(rec)
        if why:
            return
        for kind, h in hists:
            if (rec["phase"], kind) in drop_series:
                continue
            bins = sparse(h)
            chunks = [bins[:2], bins[2:]] if (split and len(bins) > 2) else [bins]
            for i, chunk in enumerate(chunks):
                if drop_part == (rec["rep"], rec["phase"]) and kind == "raf" and i == 1:
                    continue
                rows.append({"tag": "browser.viewer.abhist", "run": run, "seq": rec["seq"], "rep": rec["rep"], "variant": rec["variant"],
                             "phase": rec["phase"], "series": kind, "part": i, "parts": len(chunks), "n": h.n, "max": h.max, "bins": chunk})

    c = hist_of(cal)
    emit({"tag": "browser.viewer.abrun", "run": run, "seq": seq, "rep": -1, "variant": "none", "phase": "calibrate",
          "status": "ran", "ms": 3000, "hidden": False, "dialog": False, "interacted": False, "sweep_busy": False,
          "raf": {"n": c.n}, "mt": {}, "gpu": {}}, [("raf", c), ("mt", hist_of([(1, c.n)]))], None)
    seq += 1
    for r, v in enumerate(order):
        for ph in PHASES:
            why = skip(v, r, ph) if skip else None
            f = (flags(v, r, ph) if flags else None) or {}
            raf = hist_of(frames(v, r, ph))
            mt = hist_of([(1, raf.n)] if ph != "build" else [(1, 10), (block_ms(v, r), 1)])
            gpu = hist_of([(9 if v == "fat" else 5, raf.n)])
            rec = {"tag": "browser.viewer.abrun", "run": run, "seq": seq, "rep": r, "variant": v, "phase": ph,
                   "status": "skipped" if why else "ran", "ms": build_ms(v, r) if ph == "build" else 1000,
                   "hidden": False, "dialog": False, "interacted": False, "sweep_busy": False,
                   "raf": {"n": raf.n, "win_p95_max": raf.quantile(0.95)}, "mt": {"max": mt.max}, "gpu": {}, "render": {}}
            if why:
                rec["reason"] = why
            rec.update(f)
            if ph in MEM_AT and not drop_memory:
                payload = 20 * MiB
                if ph == "release":
                    left = released(v, r)
                    cpu = {"total": payload + left, "payload": payload}
                    gpu_mem = {"total": 0}
                else:
                    tot = (mem(v, r, ph) if mem else None) or (100 * MiB if v == "gl" else 150 * MiB)
                    cpu = {"total": tot, "payload": payload}
                    gpu_mem = {"total": tot - 30 * MiB}
                rec["memory_at"] = MEM_AT[ph]
                rec["memory"] = {"mode": v, "cpu": cpu, "gpu": gpu_mem, "peak": peak(v, r), "generation": generations(v, r),
                                 "eager": eager(v, r),
                                 "allocated": 0, "pairs": {"source": 1, "lod": 1, "drawn": 1}}
            emit(rec, [("raf", raf), ("mt", mt), ("gpu", gpu)], why)
            seq += 1
    rows.append({"tag": "browser.viewer.abrun", "run": run, "seq": seq, "phase": "end", "cancelled": cancelled})
    return rows


def failing(r):
    return [c["check"] for c in r["checks"] if c["ok"] is False]


def unmeasured(r):
    return [c["check"] for c in r["checks"] if c["ok"] is None]


def test_equal_renderers_pass_at_60_hz():
    r = rep.analyse(run_rows())
    assert r["verdict"] == "PASS", (failing(r), unmeasured(r), r["excluded"])
    assert (r["rate_hz"], r["rate_source"]) == (60, "calibration")
    assert math.isclose(r["limit_ms"], 1000 * 2 / 60)
    assert r["excluded"] == []


def test_percentiles_are_never_averaged_codex_r39():
    # B's orbit: one repetition of long frames (p95 100 ms), two of short ones —
    # the merged p95 stays short; an average of the three would read ~34 ms.
    def frames(v, rp, ph):
        if v == "fat" and ph == "orbit" and rp == 1:
            return [(99.5, 20)]
        return [(0.5, 380)] if ph == "orbit" else [(16.7, 180)]
    r = rep.analyse(run_rows(frames=frames))
    orbit = next(t for t in r["table"] if t["phase"] == "orbit")
    assert orbit["b_p95"] == 1
    assert orbit["b_win_p95_max"] == 100          # the worst window is reported beside it


def test_slow_b_fails_the_frame_limit_and_the_ratio():
    r = rep.analyse(run_rows(frames=lambda v, rp, ph: [(40, 180)] if v == "fat" and ph == "fitdetail" else [(16.7, 180)]))
    assert r["verdict"] == "FAIL"
    assert "fitdetail: B p95 within 2 frames" in failing(r)
    assert "fitdetail: B p95 ≤ 1.20 × A" in failing(r)


# ── Codex R47 VP-I13: incomplete data is never a PASS ─────────────────────
def test_no_memory_points_is_incomplete():
    r = rep.analyse(run_rows(drop_memory=True))
    assert r["verdict"] == "INCOMPLETE"
    assert any("no memory at after_load" in x for x in r["excluded"])


def test_no_build_histograms_is_incomplete():
    r = rep.analyse(run_rows(drop_series={("build", "raf"), ("build", "mt"), ("build", "gpu")}))
    assert r["verdict"] == "INCOMPLETE"
    assert "gl build: 3 valid repetitions" in unmeasured(r)


def test_one_repetition_per_variant_is_incomplete():
    r = rep.analyse(run_rows(order=["gl", "fat"]))
    assert r["verdict"] == "INCOMPLETE"
    assert "gl: 3 repetitions planned" in unmeasured(r)


def test_a_missing_mt_series_is_incomplete_not_an_exception():
    r = rep.analyse(run_rows(drop_series={("orbit", "mt")}))
    assert r["verdict"] == "INCOMPLETE"
    assert any("orbit" in x and "no mt histogram" in x for x in r["excluded"])


def test_unequal_valid_time_is_never_a_count_difference():
    # A: three orbits with two long gaps each; B: only one valid orbit with four
    # (the others excluded) — a count difference read 4 − 6 as fine
    def frames(v, rp, ph):
        if ph == "orbit":
            return [(16.7, 178), (150, 2)] if v == "gl" else [(16.7, 176), (150, 4)]
        return [(16.7, 180)]
    lost = rep.analyse(run_rows(frames=frames, flags=lambda v, rp, ph: {"interacted": True} if v == "fat" and ph == "orbit" and rp != 1 else None))
    assert lost["verdict"] == "INCOMPLETE"
    full = rep.analyse(run_rows(frames=frames))
    assert "orbit: no new recurring gaps ≥ 100 ms" in failing(full)   # 12 in B's time where A's rate predicts 6


def test_one_extra_long_gap_is_no_recurring_regression():
    r = rep.analyse(run_rows(frames=lambda v, rp, ph: [(16.7, 179), (150, 1)] if (v, rp, ph) == ("fat", 1, "orbit") else [(16.7, 180)]))
    assert "orbit: no new recurring gaps ≥ 100 ms" not in failing(r)


# ── Codex R47 VP-I16 / VP-I14: the build ──────────────────────────────────
def test_a_longer_build_block_fails_though_the_count_is_equal():
    r = rep.analyse(run_rows(block_ms=lambda v, rp: 110 if v == "gl" else 1500))
    assert "build: B's longest main-thread block ≤ 1.5 × A + 100 ms" in failing(r)
    ok = rep.analyse(run_rows(block_ms=lambda v, rp: 110 if v == "gl" else 260))
    assert "build: B's longest main-thread block ≤ 1.5 × A + 100 ms" not in failing(ok)


def test_the_build_duration_rule():
    assert "build: B's duration ≤ 1.5 × A + 100 ms" not in failing(rep.analyse(run_rows(build_ms=lambda v, rp: 400 if v == "gl" else 700)))
    assert "build: B's duration ≤ 1.5 × A + 100 ms" in failing(rep.analyse(run_rows(build_ms=lambda v, rp: 400 if v == "gl" else 800)))


def test_a_build_phase_without_a_new_generation_fails():
    r = rep.analyse(run_rows(generations=lambda v, rp: 7))
    assert "gl build: every build phase a real build" in failing(r)


# ── Codex R47 answer 1: the reference rate ────────────────────────────────
def test_the_rate_comes_from_the_calibration_never_the_variants():
    # a slow warm-up (the variants) must not widen the limit: calibration at 120 Hz
    r = rep.analyse(run_rows(cal=[(8.33, 360)], frames=lambda v, rp, ph: [(20.0, 180)]))
    assert (r["rate_hz"], r["rate_source"]) == (120, "calibration")
    assert "orbit: B p95 within 2 frames" in failing(r)       # 20 ms frames against 2 × 8.3 ms
    # the class tolerance, said: at 120 Hz a p95 below 17 ms passes 16.7 ms
    assert "below 17 ms passes" in next(c["detail"] for c in r["checks"] if c["check"] == "orbit: B p95 within 2 frames")
    assert rep.analyse(run_rows(cal=[(8.33, 360)]), rate=60)["rate_source"] == "--rate"


def test_no_calibration_is_incomplete():
    rows = [x for x in run_rows() if x.get("phase") != "calibrate"]
    assert rep.analyse(rows)["verdict"] == "INCOMPLETE"


# ── Codex R47 VP-I17: memory ──────────────────────────────────────────────
def test_the_build_peak_and_the_release_are_checked():
    r = rep.analyse(run_rows(peak=lambda v, rp: (100 if v == "gl" else 300) * MiB))
    assert "memory peak (every phase): B − A ≤ 128 MiB" in failing(r)
    left = rep.analyse(run_rows(released=lambda v, rp: 4096 if v == "fat" else 0))
    assert "fat release: every path byte freed" in failing(left)
    assert "gl release: every path byte freed" not in failing(left)


# ── conditions and parts ──────────────────────────────────────────────────
def test_a_touched_or_hidden_phase_is_excluded_named_and_incomplete():
    r = rep.analyse(run_rows(flags=lambda v, rp, ph: {"interacted": True} if (rp, ph) == (1, "orbit") else
                             ({"hidden": True, "sweep_busy": True} if (rp, ph) == (3, "jumps") else None)))
    assert "2/fat/orbit: camera moved by hand" in r["excluded"]
    assert "4/gl/jumps: tab hidden, collision sweep running" in r["excluded"]
    assert r["verdict"] == "INCOMPLETE"      # three valid repetitions are the contract


def test_a_phase_skipped_everywhere_is_incomplete_never_pass():
    r = rep.analyse(run_rows(skip=lambda v, rp, ph: "Machine is on — the simulation needs it off" if ph == "jumps" else None))
    assert r["verdict"] == "INCOMPLETE"
    assert "1/gl/jumps: skipped: Machine is on — the simulation needs it off" in r["excluded"]


def test_split_histograms_merge_and_a_missing_part_is_named():
    whole = rep.analyse(run_rows(split=True, frames=lambda v, rp, ph: [(16.7, 170), (33.4, 10)]))
    assert whole["verdict"] == "PASS", (failing(whole), unmeasured(whole))
    broken = rep.analyse(run_rows(split=True, drop_part=(2, "orbit"), frames=lambda v, rp, ph: [(16.7, 170), (33.4, 10)]))
    assert "3/fat/orbit: raf histogram incomplete (1/2 parts)" in broken["excluded"]


def test_memory_budget_is_checked_per_point_cpu_and_gpu():
    r = rep.analyse(run_rows(mem=lambda v, rp, ph: 300 * MiB if (v, ph) == ("fat", "build") else None))
    assert "memory after_load cpu: B − A ≤ 128 MiB" in failing(r)
    assert "memory after_load gpu: B − A ≤ 128 MiB" in failing(r)
    assert "memory after_orbit cpu: B − A ≤ 128 MiB" not in failing(r)


def test_a_cancelled_run_is_incomplete():
    assert rep.analyse(run_rows(cancelled=True))["verdict"] == "INCOMPLETE"


def test_the_last_run_by_default_and_a_named_one(tmp_path):
    rows = run_rows(run="ab-old", frames=lambda v, rp, ph: [(40, 180)] if v == "fat" else [(16.7, 180)]) + run_rows(run="ab-new")
    trace = tmp_path / "trace.ndjson"
    trace.write_text("\n".join(json.dumps(x) for x in rows) + "\n")
    assert rep.main(["--trace", str(trace)]) == 0
    assert rep.main(["--trace", str(trace), "--run", "ab-old"]) == 1
    empty = tmp_path / "empty.ndjson"
    empty.write_text("")
    assert rep.main(["--trace", str(empty)]) == 2


# ── Codex R48: required values inside a record, and every peak ───────────
def _strip(rows, pred, path):
    """Remove the key at `path` (a tuple) from every row `pred` selects."""
    for e in rows:
        if not pred(e):
            continue
        d = e
        for k in path[:-1]:
            d = d.get(k) if isinstance(d, dict) else None
            if d is None:
                break
        if isinstance(d, dict):
            d.pop(path[-1], None)
    return rows


def _rec(phase=None, variant=None, rep_=None):
    return lambda e: (e.get("tag") == "browser.viewer.abrun" and "variant" in e
                      and (phase is None or e.get("phase") == phase)
                      and (variant is None or e.get("variant") == variant)
                      and (rep_ is None or e.get("rep") == rep_))


def test_missing_peaks_are_incomplete_never_a_dropped_check_codex_r48():
    rows = _strip(run_rows(), _rec(), ("memory", "peak"))
    r = rep.analyse(rows)
    assert r["verdict"] == "INCOMPLETE", (failing(r), r["excluded"])
    assert any("memory.peak" in x for x in r["excluded"])


def test_a_missing_gpu_total_is_incomplete_not_an_exception_codex_r48():
    rows = _strip(run_rows(), _rec(), ("memory", "gpu", "total"))
    r = rep.analyse(rows)
    assert r["verdict"] == "INCOMPLETE"
    assert any("memory.gpu.total" in x for x in r["excluded"])


def test_a_later_peak_counts_codex_r48():
    # B's reveal raises the build's bound to 512 MiB (A 120): the held values
    # are unchanged, the peak alone is over the budget
    def pk(v, r_):
        return (120 if v == "gl" else 170) * MiB
    rows = run_rows(peak=pk)
    for e in rows:
        if _rec("reveal", "fat")(e):
            e["memory"]["peak"] = 512 * MiB
    r = rep.analyse(rows)
    assert r["verdict"] == "FAIL"
    assert any("peak" in c for c in failing(r)), failing(r)


def test_the_build_block_comes_from_the_validated_histogram_codex_r48():
    # B's longest blocks 300 / 10 / 300 ms against A's 110: FAIL — and still
    # FAIL with one summary maximum removed (the histogram carries it)
    rows = run_rows(block_ms=lambda v, r_: 110 if v == "gl" else (10 if r_ == 2 else 300))
    assert rep.analyse(rows)["verdict"] == "FAIL"
    _strip(rows, _rec("build", rep_=1), ("mt", "max"))
    r = rep.analyse(rows)
    assert r["verdict"] == "FAIL", (r["excluded"], r["checks"])
    assert sorted(r["build"]["fat"]["mt_max"]) == [10, 300, 300]


def test_a_histogram_part_without_its_maximum_is_incomplete_codex_r48():
    rows = run_rows()
    for e in rows:
        if e.get("tag") == "browser.viewer.abhist" and e["phase"] == "build" and e["variant"] == "fat" and e["rep"] == 1 and e["series"] == "mt":
            e.pop("max")
    r = rep.analyse(rows)
    assert r["verdict"] == "INCOMPLETE"
    assert any("mt histogram part 0 without max" in x for x in r["excluded"]), r["excluded"]


def test_a_record_without_its_duration_generation_or_payload_is_incomplete_codex_r48():
    for phase, path in (("build", ("ms",)), ("build", ("memory", "generation")), ("release", ("memory", "cpu", "payload"))):
        rows = _strip(run_rows(), _rec(phase, "fat", 2), path)
        r = rep.analyse(rows)
        assert r["verdict"] == "INCOMPLETE", (phase, path, failing(r))
        assert any(".".join(path) in x for x in r["excluded"]), (path, r["excluded"])


def test_a_missing_window_maximum_reads_unmeasured_never_zero_codex_r48():
    rows = _strip(run_rows(), _rec("orbit"), ("raf", "win_p95_max"))
    orbit = next(t for t in rep.analyse(rows)["table"] if t["phase"] == "orbit")
    assert orbit["a_win_p95_max"] is None and orbit["b_win_p95_max"] is None


def test_the_median_refuses_a_missing_value():
    import pytest
    with pytest.raises(ValueError):
        rep.median([1.0, None, 3.0])


def test_the_eager_estimate_must_bound_the_pack_codex_r48():
    ok = rep.analyse(run_rows())
    assert "fat build: the eager estimate bounds the pack" not in failing(ok), failing(ok)
    low = rep.analyse(run_rows(eager=lambda v, r: {"estimate": 50 * MiB, "packed": 60 * MiB} if (v == "fat" and r == 2)
                               else {"estimate": 60 * MiB, "packed": 60 * MiB}))
    assert "fat build: the eager estimate bounds the pack" in failing(low)
    rows = run_rows()
    for e in rows:
        if e.get("phase") == "build" and "memory" in e:
            e["memory"].pop("eager")
    r = rep.analyse(rows)
    assert r["verdict"] == "INCOMPLETE" and any("no memory.eager.estimate" in x for x in r["excluded"]), r["excluded"]
