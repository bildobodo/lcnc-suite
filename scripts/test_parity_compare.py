"""The parity gate's comparison (scripts/sim_parity.py compare_files): two-way
path deviation within the tolerance — and on a probe's braking range
(docs/reviews/parity-ef.plan.md F2/F4, Codex R123) a COVERAGE proof: the truth
must lie on the sim path, the hull may reach past the truth and is reported
apart. Pure: temporary capture files, no LinuxCNC."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sim_parity  # noqa: E402


def _write(tmp_path, truth, sim, band=()):
    t = tmp_path / "truth.ndjson"
    t.write_text("\n".join([json.dumps({"header": True})] +
                           [json.dumps({"joints": j}) for j in truth]) + "\n")
    s = tmp_path / "sim.jsonl"
    s.write_text("\n".join([json.dumps({"meta": True})] +
                           [json.dumps({"joints": j, **({"band": 1} if i in band else {})})
                            for i, j in enumerate(sim)]) + "\n")
    return str(t), str(s)


# The truth probes down to −102.13 (2.13 past the trip point −100) and climbs
# back to −97; the sim's hull goes to −102.84 and back.
TRUTH = [[10, 10, z] for z in (-95, -100, -102.13, -99.13, -97, -80)]
SIM = [[10, 10, z] for z in (-95, -100, -102.84, -99.84, -97, -80)]


def test_the_hull_covers_the_truth_and_is_reported_apart(tmp_path):
    ok, rep = sim_parity.compare_files(*_write(tmp_path, TRUTH, SIM, band={2, 3, 4}), tol=0.5)
    assert ok, rep
    assert "braking range: 3 sim samples" in rep
    assert "0.710 past the truth" in rep


def test_without_the_marking_the_hull_fails_the_two_way_gate(tmp_path):
    ok, rep = sim_parity.compare_files(*_write(tmp_path, TRUTH, SIM), tol=0.5)
    assert not ok, rep


def test_a_hull_that_misses_the_truth_fails(tmp_path):
    # the brake leg left out: the sim stops at the trip point, the truth goes
    # 2.13 below it — truth→sim catches it, marking or not (missing coverage)
    sim = [[10, 10, z] for z in (-95, -100, -97, -80)]
    ok, rep = sim_parity.compare_files(*_write(tmp_path, TRUTH, sim, band={2}), tol=0.5)
    assert not ok, rep


def test_a_marking_past_the_range_end_does_not_hide_a_deviation(tmp_path):
    # the sim leaves the range and goes 3 mm off where the truth does not:
    # unmarked, sim→truth fails; marked past the range's end it would hide it
    # — the gate still fails on truth→sim only if the truth strays, so the
    # marking must stop at the range's end (the worker's band_anchor_indices
    # and the client's `band`); here: unmarked → red
    sim = SIM[:-1] + [[13, 10, -80]]
    truth = TRUTH[:-1] + [[10, 10, -80]]
    ok, _ = sim_parity.compare_files(*_write(tmp_path, truth, sim, band={2, 3, 4}), tol=0.5)
    assert not ok
