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
PHASES = ["build", "warmup", "orbit", "fitdetail", "jumps", "overlay_off", "reveal"]
MEM_AT = {"build": "after_load", "orbit": "after_orbit", "fitdetail": "after_lods", "jumps": "after_nav", "reveal": "after_reveal"}
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
def run_rows(run="ab-test", frames=None, flags=None, mem=None, skip=None, drop_part=None, cancelled=False, split=False):
    """A whole A/B run. frames(variant, rep, phase) → [(ms, count)] frame gaps;
    flags / mem / skip likewise per phase; drop_part = (rep, phase) whose raf
    histogram loses a part."""
    frames = frames or (lambda v, r, p: [(16.7, 180)])
    rows = [{"tag": "browser.viewer.abrun", "run": run, "seq": 0, "phase": "meta", "commit": "abc1234",
             "build": "production", "file": "/prog.ngc", "viewport": [800, 600], "pixel_ratio": 2}]
    seq = 1
    for r, v in enumerate(ORDER):
        for ph in PHASES:
            why = skip(v, r, ph) if skip else None
            f = (flags(v, r, ph) if flags else None) or {}
            raf = hist_of(frames(v, r, ph))
            mt = hist_of([(1, raf.n)] if ph != "build" else [(1, 10), (120 if v == "fat" else 110, 1)])
            gpu = hist_of([(9 if v == "fat" else 5, raf.n)])
            rec = {"tag": "browser.viewer.abrun", "run": run, "seq": seq, "rep": r, "variant": v, "phase": ph,
                   "status": "skipped" if why else "ran", "ms": 1000,
                   "hidden": False, "dialog": False, "interacted": False, "sweep_busy": False,
                   "raf": {"n": raf.n, "win_p95_max": raf.quantile(0.95)}, "mt": {}, "gpu": {}, "render": {}}
            if why:
                rec["reason"] = why
            rec.update(f)
            if ph in MEM_AT:
                cpu = (mem(v, r, ph) if mem else None) or (100 * MiB if v == "gl" else 150 * MiB)
                rec["memory_at"] = MEM_AT[ph]
                rec["memory"] = {"mode": v, "cpu": {"total": cpu}, "gpu": {"total": cpu - 10 * MiB}}
            rows.append(rec)
            if not why:
                for kind, h in (("raf", raf), ("mt", mt), ("gpu", gpu)):
                    bins = sparse(h)
                    chunks = [bins[:2], bins[2:]] if (split and len(bins) > 2) else [bins]
                    for i, chunk in enumerate(chunks):
                        if drop_part == (r, ph) and kind == "raf" and i == 1:
                            continue
                        rows.append({"tag": "browser.viewer.abhist", "run": run, "seq": seq, "rep": r, "variant": v,
                                     "phase": ph, "series": kind, "part": i, "parts": len(chunks), "n": h.n, "max": h.max,
                                     "bins": chunk})
            seq += 1
    rows.append({"tag": "browser.viewer.abrun", "run": run, "seq": seq, "phase": "end", "cancelled": cancelled})
    return rows


def failing(r):
    return [c["check"] for c in r["checks"] if c["ok"] is False]


def test_equal_renderers_pass_at_60_hz():
    r = rep.analyse(run_rows())
    assert r["verdict"] == "PASS", failing(r)
    assert r["rate_hz"] == 60
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


def test_new_recurring_long_gaps_fail_one_does_not():
    one = rep.analyse(run_rows(frames=lambda v, rp, ph: [(16.7, 179), (150, 1)] if (v, rp, ph) == ("fat", 1, "orbit") else [(16.7, 180)]))
    assert "orbit: no new recurring gaps ≥ 100 ms" not in failing(one)
    two = rep.analyse(run_rows(frames=lambda v, rp, ph: [(16.7, 178), (150, 2)] if (v, rp, ph) == ("fat", 1, "orbit") else [(16.7, 180)]))
    assert "orbit: no new recurring gaps ≥ 100 ms" in failing(two)


def test_the_build_may_not_add_a_main_thread_block():
    # the fake build: A and B each one block (110 / 120 ms) — equal counts pass
    r = rep.analyse(run_rows())
    assert next(c for c in r["checks"] if c["check"].startswith("build"))["ok"] is True
    assert r["build"]["b_mt_max"] == 120


def test_a_touched_or_hidden_phase_is_excluded_and_named():
    r = rep.analyse(run_rows(flags=lambda v, rp, ph: {"interacted": True} if (rp, ph) == (1, "orbit") else
                             ({"hidden": True, "sweep_busy": True} if (rp, ph) == (3, "jumps") else None)))
    assert "2/fat/orbit: camera moved by hand" in r["excluded"]
    assert "4/gl/jumps: tab hidden, collision sweep running" in r["excluded"]
    assert r["verdict"] == "PASS"                 # the other repetitions still measure both


def test_a_phase_skipped_everywhere_is_incomplete_never_pass():
    r = rep.analyse(run_rows(skip=lambda v, rp, ph: "Machine is on — the simulation needs it off" if ph == "jumps" else None))
    assert r["verdict"] == "INCOMPLETE"
    assert "1/gl/jumps: skipped: Machine is on — the simulation needs it off" in r["excluded"]
    assert any(c["check"] == "jumps: measured" and c["ok"] is None for c in r["checks"])


def test_split_histograms_merge_and_a_missing_part_is_named():
    whole = rep.analyse(run_rows(split=True, frames=lambda v, rp, ph: [(16.7, 170), (33.4, 10)]))
    assert whole["verdict"] == "PASS"
    broken = rep.analyse(run_rows(split=True, drop_part=(2, "orbit"), frames=lambda v, rp, ph: [(16.7, 170), (33.4, 10)]))
    assert "3/fat/orbit: raf histogram incomplete (1/2 parts)" in broken["excluded"]


def test_memory_budget_is_checked_per_point_cpu_and_gpu():
    r = rep.analyse(run_rows(mem=lambda v, rp, ph: 300 * MiB if (v, ph) == ("fat", "build") else None))
    assert "memory after_load cpu: B − A ≤ 128 MiB" in failing(r)
    assert "memory after_load gpu: B − A ≤ 128 MiB" in failing(r)
    assert "memory after_orbit cpu: B − A ≤ 128 MiB" not in failing(r)


def test_120_hz_halves_the_frame_limit():
    r = rep.analyse(run_rows(frames=lambda v, rp, ph: [(8.33, 360)]))
    assert r["rate_hz"] == 120
    assert math.isclose(r["limit_ms"], 1000 * 2 / 120)
    slow = rep.analyse(run_rows(frames=lambda v, rp, ph: [(8.33, 360)] if ph == "warmup" or v == "gl" else [(20, 360)]))
    assert "orbit: B p95 within 2 frames" in failing(slow)


def test_a_cancelled_run_is_incomplete():
    r = rep.analyse(run_rows(cancelled=True))
    assert r["verdict"] == "INCOMPLETE"


def test_the_last_run_by_default_and_a_named_one(tmp_path):
    rows = run_rows(run="ab-old", frames=lambda v, rp, ph: [(40, 180)] if v == "fat" and ph != "warmup" else [(16.7, 180)]) + run_rows(run="ab-new")
    trace = tmp_path / "trace.ndjson"
    trace.write_text("\n".join(json.dumps(x) for x in rows) + "\n")
    assert rep.main(["--trace", str(trace)]) == 0
    assert rep.main(["--trace", str(trace), "--run", "ab-old"]) == 1
    empty = tmp_path / "empty.ndjson"
    empty.write_text("")
    assert rep.main(["--trace", str(empty)]) == 2
