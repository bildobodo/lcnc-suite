"""Replay step 5c (coverage.py, live_drivers.py): the binding rules of the
R393 dry run, the run status of a live report in the order of R392, and the
evaluation errors — each red for its own reason; a gap is never red."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import coverage  # noqa: E402
import live_drivers  # noqa: E402

ROOT = HERE.parents[1]
HEAD = "c" * 40


# ── binding evidence to listed tests ────────────────────────────────────────

def cands(*titles: str) -> list:
    return [(t, [t.split(" › ")[-1], t]) for t in titles]


def test_exact_title_and_title_path_bind():
    assert coverage.bind({"title": "a test"}, cands("d › a test", "d › b test")) == (["d › a test"], "")
    assert coverage.bind({"title": "d › a test"}, cands("d › a test")) == (["d › a test"], "")


def test_a_fragment_binds_every_test_that_contains_it_and_nothing_is_not_collected():
    assert coverage.bind({"title": "rename moves"}, cands("x › a rename moves the file")) == (["x › a rename moves the file"], "")
    bound, why = coverage.bind({"title": "never written"}, cands("x › a test"))
    assert bound == [] and why.startswith("not collected")


def test_a_template_binds_by_its_captures_never_a_substring():
    e = {"title": "{label}: G54 moved", "instances": ["A=3"]}
    bound, why = coverage.bind(e, cands("A=35: G54 moved"))
    assert why == "instance(s) ['A=3'] bind no listed test"          # A=3 is no capture of A=35
    e["instances"] = ["A=35"]
    assert coverage.bind(e, cands("A=35: G54 moved", "A=0: G54 moved")) == (["A=35: G54 moved", "A=0: G54 moved"], "")


def test_a_vitest_string_instance_binds_in_its_quotes():
    e = {"title": "$action ($want.cmd): its command", "instances": ["start"]}
    assert coverage.bind(e, cands("'start' ('cycle_start'): its command", "'start' ('cycle_resume'): its command"))[1] == ""


@pytest.mark.parametrize("statuses,want", [
    (["passed", "passed"], "passed"), (["passed", "failed"], "failed"), (["passed", "skipped"], "skipped"),
    (["listed"], "not run"), (["flaky"], "failed"), ([], "not collected")])
def test_every_bound_test_must_pass_and_a_listed_name_that_never_ran_is_no_run(statuses, want):
    assert coverage.verdict(statuses) == want


# ── the live evidence (R390–R392) ───────────────────────────────────────────

def report(direct: dict, *, fail: str | None = None, commit: str = HEAD, dirty: bool = False) -> dict:
    entry = {"direct": direct, **({"FAIL": fail} if fail else {})}
    return {"commit": commit, "dirty": dirty, "run_id": "r1", "scenarios": {"sigstop_trip": entry}}


@pytest.mark.parametrize("r,want", [
    (report({"skipped": "needs --allow-trip (trips the HAL safety latch)"}), ("skip", "needs --allow-trip (trips the HAL safety latch)")),
    (report({"sticky_ok": True, "recovered_ok": True}), ("passed", "")),
    (report({"sticky_ok": True, "recovered_ok": False}, fail="recovered_ok False"), ("failed", "recovered_ok False")),
    (report({"error": "no gateway pid"}, fail="error: no gateway pid"), ("failed", "error: no gateway pid")),   # R391: early error
    (report({"sticky_ok": True}), ("error", "sigstop_trip: no ['recovered_ok'] in a record that is neither a skip nor an error")),
    (report({"skipped": "x"}, fail="y"), ("error", "sigstop_trip: skipped AND failed — a contradiction")),
    ({"scenarios": {"sigstop_trip": {"FAIL": "x"}}}, ("error", "sigstop_trip: no direct result")),
    ({"no": "scenarios"}, ("error", "the report has no scenarios object")),
])
def test_the_status_is_decided_by_result_kind_in_the_agreed_order(r, want):
    assert live_drivers.scenario_status(r, "sigstop_trip") == want


def evidence(title: str = "sigstop_trip", file: str = "perf_matrix.py", **kw) -> dict:
    return {"layer": "script", "file": file, "title": title, "live": True, **kw}


def test_a_report_of_another_commit_or_a_dirty_tree_is_no_run_at_this_commit():
    ok = report({"sticky_ok": True, "recovered_ok": True})
    assert live_drivers.judge(evidence(), ROOT, [ok], HEAD)["status"] == "passed"
    for other in (report({"sticky_ok": True, "recovered_ok": True}, commit="d" * 40),
                  report({"sticky_ok": True, "recovered_ok": True}, dirty=True)):
        assert live_drivers.judge(evidence(), ROOT, [other], HEAD)["status"] == "not at this commit"
    assert live_drivers.judge(evidence(), ROOT, [], HEAD)["status"] == "not at this commit"


def test_a_twp_binding_without_a_report_is_named_open_and_a_wrong_binding_is_red():
    e = evidence("{label}: G54 moved by the touch-off amount", "twp_touchoff_plane_check.py", instances=["A=0", "A=35"])
    assert live_drivers.judge(e, ROOT, [], HEAD) == {"resolved": True, "status": "not proven", "why": "the driver writes no run report"}
    assert live_drivers.judge({**e, "instances": ["A=7"]}, ROOT, [], HEAD)["status"] == "binding error"
    assert live_drivers.judge(evidence("no_such_scenario"), ROOT, [], HEAD)["status"] == "binding error"


def test_a_bound_scenario_without_a_success_definition_is_a_binding_error(monkeypatch):
    monkeypatch.setattr(live_drivers, "SUCCESS", {})
    j = live_drivers.judge(evidence(), ROOT, [], HEAD)
    assert j["status"] == "binding error" and "no success definition" in j["why"]


def test_every_shipped_script_binding_resolves():
    fns = json.loads((ROOT / "scripts/inventory/functions.json").read_text())["functions"]
    es = [e for f in fns for s in f.get("statements", []) for e in s["evidence"] if e["layer"] == "script"]
    assert es and all(live_drivers.judge(e, ROOT, [], HEAD)["resolved"] for e in es)


# ── the evaluation errors of a run ──────────────────────────────────────────

def gate(tmp: Path, files: dict[str, object], kind: str = "merge") -> Path:
    g = tmp / "gate.json"
    g.write_text(json.dumps({"kind": kind, "head": HEAD}))
    logs = tmp / "gate.logs"
    (logs / "backend").mkdir(parents=True)
    for name, body in files.items():
        p = logs / name
        p.write_text(body if isinstance(body, str) else json.dumps(body))
    return g


EMPTY_RUN = {"list-run.json": {"suites": []}, "playwright.json": {"suites": []},
             "firefox-list.json": {"suites": []}, "firefox.json": {"suites": []},
             "unit-light.list.json": [], "unit-light.json": {"testResults": []},
             "unit-heavy.list.json": [], "unit-heavy.json": {"testResults": []},
             "replay.json": {}, "firefox-replay.json": {}, "backend/backend.junit.xml": "<testsuites/>"}


def test_a_missing_artefact_is_red():
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        files = {k: v for k, v in EMPTY_RUN.items() if k != "playwright.json"}
        c = coverage.coverage(gate(Path(d), files), [], [])
        assert any("playwright.json" in e and "missing" in e for e in c["errors"])


def test_evidence_no_listed_test_carries_is_not_collected_and_red(tmp_path):
    c = coverage.coverage(gate(tmp_path, EMPTY_RUN), [], [])
    assert c["verdict"] == "FAIL"
    assert any("not collected" in e for e in c["errors"])


def test_a_report_given_as_run_evidence_that_does_not_exist_is_red(tmp_path):
    c = coverage.coverage(gate(tmp_path, EMPTY_RUN), [tmp_path / "missing-native.json"], [tmp_path / "missing-live.json"])
    assert any(e.startswith("native report") for e in c["errors"]) and any(e.startswith("live report") for e in c["errors"])


def test_the_merge_gate_s_coverage_step_is_red_on_a_run_without_its_artefacts(tmp_path):
    sys.path.insert(0, str(ROOT / "scripts"))
    from test_select import round_gate   # noqa: PLC0415
    logs = tmp_path / "gate.logs"
    (logs / "backend").mkdir(parents=True)
    c = round_gate.coverage_check(logs, HEAD)
    assert c["name"] == "coverage" and c["status"] == "FAIL"
    assert any("missing" in w for w in c["why"])
    assert (logs / "coverage.json").is_file() and (logs / "coverage.md").is_file()
