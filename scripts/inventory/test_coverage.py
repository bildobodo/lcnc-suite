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

#: the run ids the gate made — every record of a run carries its own (R396 VM-I33)
RUNS = {"e2e": "gate-run", "firefox-core": "firefox-run", "backend": "backend-run"}


def gate(tmp: Path, files: dict[str, object], kind: str = "merge") -> Path:
    g = tmp / "gate.json"
    g.write_text(json.dumps({"kind": kind, "head": HEAD, "checks": [
        {"name": "browser-workers", "run": RUNS["e2e"]}, {"name": "firefox-workers", "run": RUNS["firefox-core"]},
        {"name": "backend", "run": RUNS["backend"]}]}))
    logs = tmp / "gate.logs"
    (logs / "backend").mkdir(parents=True)
    for name, body in files.items():
        p = logs / name
        p.write_text(body if isinstance(body, str) else json.dumps(body))
    return g


def pw(project: str, *tests: tuple, listing: bool = False) -> dict:
    """A Playwright record of this run: tests (id, file, title, result) — the
    listing's form (no results) or the report's (one result at retry 0)."""
    def one(result: str) -> dict:
        if listing:
            return {"projectName": project, "expectedStatus": "passed", "status": "skipped", "results": []}
        return {"projectName": project, "expectedStatus": "passed",
                "status": {"passed": "expected", "failed": "unexpected"}[result],
                "results": [{"retry": 0, "status": result}]}
    return {"config": {"metadata": {"run": RUNS[project]}},
            "suites": [{"title": f, "file": f, "specs": [{"id": i, "title": title, "file": f, "tests": [one(r)]}]}
                       for i, f, title, r in tests]}


def ran(project: str, *tests: tuple) -> dict:
    """Listing AND report of the same tests (the names of both records)."""
    lst, rep = ("list-run.json", "playwright.json") if project == "e2e" else ("firefox-list.json", "firefox.json")
    return {lst: pw(project, *tests, listing=True), rep: pw(project, *tests)}


def replay(project: str, *attempts: dict, **extra) -> dict:
    return {"verdict": "PASS", "findings": [], "run": RUNS[project], "attempt_list": list(attempts), **extra}


EMPTY_RUN = {**ran("e2e"), **ran("firefox-core"),
             "unit-light.list.json": [], "unit-light.json": {"testResults": []}, "unit-light.options.json": [],
             "unit-heavy.list.json": [], "unit-heavy.json": {"testResults": []}, "unit-heavy.options.json": [],
             "replay.json": replay("e2e"), "firefox-replay.json": replay("firefox-core"),
             "backend/backend.junit.xml": f'<testsuites><testsuite name="{RUNS["backend"]}"/></testsuites>'}


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
    c = round_gate.coverage_check(logs, HEAD, [])
    assert c["name"] == "coverage" and c["status"] == "FAIL"
    assert any("missing" in w for w in c["why"])
    assert (logs / "coverage.json").is_file() and (logs / "coverage.md").is_file()


# ── the three rules the mutants of 5c need a guard for ──────────────────────

def _run_with(tmp: Path, **files) -> dict:
    """A run of the empty set with some artefacts replaced; the real inventory."""
    tmp.mkdir(parents=True, exist_ok=True)
    body = dict(EMPTY_RUN)
    body.update(files)
    return coverage.coverage(gate(tmp, body), [], [])


def _fn(c: dict, fid: str) -> dict:
    return next(f for f in c["functions"] if f["id"] == fid)


ATT = "x.spec.ts › t [retry 0]"
T1 = ("t-1", "x.spec.ts", "t", "passed")


def att(project: str = "e2e", name: str = ATT, test: str = "t-1", retry: int = 0, status: str = "passed") -> dict:
    return {"name": name, "test": test, "project": project, "retry": retry, "status": status}


def test_an_expected_refusal_is_no_trigger_of_its_command(tmp_path):
    r = replay("e2e", att(), per_attempt={ATT: {"touchoff": 1}}, per_attempt_expected={ATT: {"touchoff": 1}})
    c = _run_with(tmp_path, **ran("e2e", T1), **{"replay.json": r})
    assert _fn(c, "F-TOUCHOFF")["triggered"]["commands"]["touchoff"]["e2e"] == "not sent"
    r["per_attempt_expected"] = {}
    c = _run_with(tmp_path / "b", **ran("e2e", T1), **{"replay.json": r})
    assert _fn(c, "F-TOUCHOFF")["triggered"]["commands"]["touchoff"] == {"e2e": {"touchoff": 1}, "firefox-core": "not sent"}
    assert not [e for e in c["errors"] if "replay" in e]


def test_a_route_only_the_fallback_answered_is_a_gap_never_server_evidence(tmp_path):
    rows = {ATT: [{"what": "GET /g30", "variant": None, "path": None, "class": "fallback", "transport": "finished",
                   "status": 200, "n": 3}]}
    r = replay("e2e", att(), http_paths={"per_attempt": rows})
    c = _run_with(tmp_path, **ran("e2e", T1), **{"replay.json": r})
    gaps = [g for g in c["gaps"] if g["item"] == "http:GET /g30"]
    assert gaps and gaps[0]["why"] == "never answered by a server (fallback)"
    rows[ATT][0]["class"] = "served"
    c = _run_with(tmp_path / "b", **ran("e2e", T1), **{"replay.json": r})
    assert not [g for g in c["gaps"] if g["item"] == "http:GET /g30"]
    trig = next(f for f in c["functions"] if "GET /g30" in f["triggered"]["routes"])["triggered"]["routes"]["GET /g30"]
    assert trig == {"e2e": {"served by the mock": 3}, "firefox-core": "not requested"}


def _browser_evidence() -> dict:
    fns = json.loads((ROOT / "scripts/inventory/functions.json").read_text())["functions"]
    return next(e for f in fns for s in f.get("statements", []) for e in s["evidence"]
                if e["layer"] == "browser" and "$" not in e["title"] and "{" not in e["title"])


def _rows_of(c: dict, e: dict) -> list[dict]:
    return [x for f in c["functions"] for s in f["statements"] for x in s["evidence"]
            if x.get("file") == e["file"] and x.get("title") == e["title"]]


def test_a_firefox_pass_never_stands_in_for_chromium(tmp_path):
    e = _browser_evidence()
    c = _run_with(tmp_path, **{"list-run.json": pw("e2e", ("c-1", e["file"], e["title"], "passed"), listing=True),
                               "playwright.json": pw("e2e"),
                               **ran("firefox-core", ("f-1", e["file"], e["title"], "passed"))})
    assert {x["project"]: x["status"] for x in _rows_of(c, e)} == {"e2e": "not run", "firefox-core": "passed"}


# ── R396 before the bell: the wiring, an unknown status, the Firefox subset, ──
# ── the JUnit's worst, native reports of this and of another commit       ──

def test_a_merge_ends_with_the_install_probe_then_the_coverage_and_a_round_omits_it(tmp_path, monkeypatch):
    sys.path.insert(0, str(ROOT / "scripts"))
    from test_select import round_gate   # noqa: PLC0415
    calls = []
    monkeypatch.setattr(round_gate, "install_probe", lambda logs, head: calls.append("install-probe") or {"name": "install-probe"})
    monkeypatch.setattr(round_gate, "coverage_check",
                        lambda logs, head, checks: calls.append(("coverage", checks)) or {"name": "coverage"})
    gate_checks = [{"name": "browser-workers", "run": "r"}]
    checks, omitted = round_gate.merge_tail(True, tmp_path, HEAD, gate_checks)
    assert [c["name"] for c in checks] == ["install-probe", "coverage"] and omitted == []
    assert calls == ["install-probe", ("coverage", gate_checks)]       # the coverage gets the gate's own checks
    calls.clear()
    checks, omitted = round_gate.merge_tail(False, tmp_path, HEAD, gate_checks)
    assert checks == [] and calls == [] and omitted == [{"check": "coverage", "reason": round_gate.COVERAGE_ROUND}]


def test_a_status_the_report_does_not_know_is_never_passed():
    assert coverage.verdict(["passed", "timedOut"]) == "unknown status ['timedOut']"
    assert coverage.verdict(["passed", "passed"]) == "passed"


def test_a_title_outside_the_firefox_core_is_named_never_red(tmp_path):
    e = _browser_evidence()
    c = _run_with(tmp_path, **ran("e2e", ("c-1", e["file"], e["title"], "passed")),
                  **ran("firefox-core", ("f-1", e["file"], "another core test", "passed")))
    assert {x["project"]: x["status"] for x in _rows_of(c, e)} == {"e2e": "passed", "firefox-core": "not in the Firefox core"}
    assert not [x for x in c["errors"] if e["title"][:40] in x]


def test_the_junit_keeps_the_worst_result_per_node(tmp_path):
    p = tmp_path / "j.xml"
    p.write_text('<testsuites><testsuite>'
                 '<testcase classname="test_a.T" name="test_x"><failure/></testcase>'
                 '<testcase classname="test_a.T" name="test_x"/>'      # a later pass never hides the failure
                 '<testcase classname="test_a.T" name="test_y"><skipped/><failure/></testcase>'
                 '<testcase classname="test_a.T" name="test_z"/>'
                 '</testsuite></testsuites>')
    got = coverage.junit_tests(p)
    assert got == {("test_a.py", "test_a.py::T::test_x"): "failed", ("test_a.py", "test_a.py::T::test_y"): "failed",
                   ("test_a.py", "test_a.py::T::test_z"): "passed"}


def _declared() -> dict:
    return {k: set(v) for k, v in coverage._literal(ROOT / "scripts/test_support/native_cases.py", "REPORT_CASES").items()}


def _native_report(path: Path, rows: list[dict], commit: str = HEAD, variant: str | None = None, **extra) -> Path:
    path.write_text(json.dumps({"commit": commit, "profile": "3axis_xyz", "variant": variant, "rows": rows, **extra}))
    return path


def _full_rows(variant, **status) -> list[dict]:
    """A complete run of the variant: every declared case once, PASS unless named."""
    return [{"case": c, "status": status.get(c, "PASS"), **({"variant": variant} if variant else {})}
            for c in sorted(_declared()[variant])]


def test_a_native_report_counts_only_at_this_commit_and_its_counter_flag_decides(tmp_path):
    fns = json.loads((ROOT / "scripts/inventory/functions.json").read_text())["functions"]
    e = next(e for f in fns for s in f.get("statements", []) for e in s["evidence"]
             if e["layer"] == "native" and ".counter-" in e["title"])
    rows = [{**r, **({"counter": True} if r["case"] == e["title"] else {})} for r in _full_rows(e.get("variant"))]
    mine = _native_report(tmp_path / "mine.json", rows, variant=e.get("variant"))
    other = _native_report(tmp_path / "other.json", rows, commit="d" * 40, variant=e.get("variant"))
    for report, want, basis in ((mine, "PASS", "the report's counter flag"), (other, "not at this commit", "by its name")):
        d = tmp_path / report.stem
        d.mkdir()
        c = coverage.coverage(gate(d, dict(EMPTY_RUN)), [report], [])
        row = next(x for f in c["functions"] for x in f["native"] if x["title"] == e["title"])
        assert row["status"] == want
        counter = next(x for f in c["functions"] for x in f["counter"]["native counter rows"] if x["title"] == e["title"])
        assert counter["basis"].startswith(basis)
        assert not [x for x in c["errors"] if "native report" in x]


def test_triggering_is_kept_per_project(tmp_path):
    r = replay("firefox-core", att("firefox-core", test="f-1"), per_attempt={ATT: {"touchoff": 2}})
    c = _run_with(tmp_path, **ran("firefox-core", ("f-1", "x.spec.ts", "t", "passed")), **{"firefox-replay.json": r})
    assert _fn(c, "F-TOUCHOFF")["triggered"]["commands"]["touchoff"] == {"e2e": "not sent", "firefox-core": {"touchoff": 2}}
    # the gap is the full Chromium run's: a command only the Firefox core sent is still one
    assert [g for g in c["gaps"] if g["item"] == "cmd:touchoff"]


# ── Codex R396: VM-I33 the run's identity, VM-I34 the reporter's own forms, ──
# ── VM-I35 declared native cases, VM-I36 a present null, VM-I37 the         ──
# ── inventory's open variants — and their siblings                          ──

IDENTITY = ("another run's", "the listing does not hold", "the listing's", "is of project", "no run id", "twice — one instance")


def _identity_errors(c: dict) -> list[str]:
    return [e for e in c["errors"] if any(w in e for w in IDENTITY)]


def test_the_listing_bounds_the_results_and_every_record_is_this_runs(tmp_path):
    def errs(name: str, **files) -> list[str]:
        return _run_with(tmp_path / name, **files)["errors"]
    # a result the listing does not hold (the listing empty, the report not)
    assert any("a result for a test the listing does not hold" in e
               for e in errs("a", **{"list-run.json": pw("e2e", listing=True), "playwright.json": pw("e2e", T1)}))
    # another run's report, listing and JUnit
    foreign = pw("e2e", T1)
    foreign["config"]["metadata"]["run"] = "another-run"
    assert any("another run's record" in e for e in errs("b", **{**ran("e2e", T1), "playwright.json": foreign}))
    assert any("list-run.json: run" in e for e in errs("c", **{**ran("e2e", T1), "list-run.json": {**pw("e2e", T1, listing=True),
                                                                                              "config": {"metadata": {"run": "x"}}}}))
    assert any("another run's JUnit" in e for e in errs(
        "d", **{"backend/backend.junit.xml": '<testsuites><testsuite name="another"/></testsuites>'}))
    # the same id with another title; a test of another project in the listing
    renamed = pw("e2e", ("t-1", "x.spec.ts", "a renamed test", "passed"))
    assert any("the listing's" in e for e in errs("e", **{**ran("e2e", T1), "playwright.json": renamed}))
    other = pw("e2e", T1, listing=True)
    other["suites"][0]["specs"][0]["tests"][0]["projectName"] = "firefox-core"
    assert any("is of project 'firefox-core'" in e for e in errs("f", **{"list-run.json": other, "playwright.json": pw("e2e")}))
    # the control: a consistent run carries none of these
    assert not [e for e in errs("g", **ran("e2e", T1)) if any(w in e for w in IDENTITY)]


def test_without_the_gate_s_ids_each_listing_s_own_run_is_the_reference(tmp_path):
    """A run judged after the fact (coverage_of without `runs`): the listing's
    run id is the reference, the JUnit is not compared — and the report says so."""
    g = gate(tmp_path, {**EMPTY_RUN, **ran("e2e", T1)})
    c = coverage.coverage_of(g.with_suffix(".logs"), HEAD, "merge", [], [])
    assert _identity_errors(c) == [] and c["runs"]["given"] is False
    assert any("not given" in n for n in c["notes"])
    rep = pw("e2e", T1)
    rep["config"]["metadata"]["run"] = "x"
    (g.with_suffix(".logs") / "playwright.json").write_text(json.dumps(rep))
    c = coverage.coverage_of(g.with_suffix(".logs"), HEAD, "merge", [], [])
    assert any("playwright.json: run 'x'" in e for e in c["errors"])


def test_the_gate_s_run_ids_come_from_its_own_checks():
    checks = [{"name": "browser-workers", "run": "a"}, {"name": "firefox-workers", "run": "b"}, {"name": "backend", "run": "c"}]
    assert coverage.gate_runs(checks) == {"e2e": "a", "firefox-core": "b", "backend": "c"}
    assert coverage.gate_runs([]) == {"e2e": None, "firefox-core": None, "backend": None}


def test_a_replay_attempt_counts_only_as_a_passed_listed_instance_of_this_run(tmp_path):
    def run(name: str, r: dict, tests=(T1,)) -> dict:
        return _run_with(tmp_path / name, **ran("e2e", *tests), **{"replay.json": r})
    def sent(c: dict):
        return _fn(c, "F-TOUCHOFF")["triggered"]["commands"]["touchoff"]["e2e"]
    sends = {"per_attempt": {ATT: {"touchoff": 1}}}
    c = run("ok", replay("e2e", att(), **sends))
    assert sent(c) == {"touchoff": 1}                                             # the control
    for name, r, why in (
            ("not-listed", replay("e2e", att(test="t-9"), **sends), "is no listed test of this run"),
            ("retry", replay("e2e", att(retry=1), **sends), "the report has None at retry 1"),
            ("run", {**replay("e2e", att(), **sends), "run": "another"}, "another run's replay"),
            ("red", {**replay("e2e", att(), **sends), "verdict": "FAIL"}, "a red replay is no source of triggers"),
            ("finding", {**replay("e2e", att(), **sends), "findings": ["x"]}, "a red replay is no source of triggers"),
            ("twice", replay("e2e", att(), att(), **sends), "listed 2 times"),
            ("orphan", replay("e2e", **sends), "counted, not in its attempt list")):
        c = run(name, r)
        assert any(why in e for e in c["errors"]), (name, c["errors"])
        assert sent(c) == "not sent", name                                        # no trigger taken from it
    # a failed result in the report under a replay that says passed
    c = run("failed", replay("e2e", att(), **sends), tests=(("t-1", "x.spec.ts", "t", "failed"),))
    assert any("the report has 'failed' at retry 0" in e for e in c["errors"]) and sent(c) == "not sent"


REAL = Path(ROOT / "scripts/test_fixtures/coverage/playwright-status-report.json")


def _listing_of(report: dict) -> dict:
    """The listing's form of a report: the same specs, no results (as `--list`)."""
    doc = json.loads(json.dumps(report))

    def strip(s: dict) -> None:
        for sp in s.get("specs", []):
            for t in sp["tests"]:
                t.update(status="skipped", results=[])
        for sub in s.get("suites", []):
            strip(sub)
    for s in doc["suites"]:
        strip(s)
    return doc


def test_the_real_reporter_forms_an_expected_failure_is_no_pass_and_every_repeat_counts():
    """Codex's real Playwright run (R396 VM-I34): `test.fail()` failing as
    expected, and a test whose first repeat fails — repeatEach 2, four ids."""
    errors: list[str] = []
    idx = coverage.playwright_index(json.loads(REAL.read_text()), "real", errors)
    assert errors == [] and len(idx) == 4
    by: dict[str, list[str]] = {}
    for v in idx.values():
        by.setdefault(v["path"].split(" › ")[-1], []).append(v["status"])
    assert sorted(by["expected assertion failure is not a passing assertion"]) == ["expected to fail"] * 2
    assert sorted(by["both repeated instances must pass"]) == ["failed", "passed"]
    assert coverage.verdict(by["expected assertion failure is not a passing assertion"]) == "expected to fail"
    assert coverage.verdict(by["both repeated instances must pass"]) == "failed"
    # bound by title, both instances are bound — the failed one decides
    cands = [(k, [v["path"].split(" › ")[-1], v["path"]]) for k, v in idx.items()]
    bound, why = coverage.bind({"title": "both repeated instances must pass"}, cands)
    assert why == "" and len(bound) == 2 and coverage.verdict([idx[k]["status"] for k in bound]) == "failed"
    # the listing's form of the same run reads every instance as listed
    assert {v["status"] for v in coverage.playwright_index(_listing_of(json.loads(REAL.read_text())), "l", []).values()} == {"listed"}


def test_the_same_test_id_twice_in_one_record_is_an_error_never_an_overwrite():
    doc = pw("e2e", T1, ("t-1", "x.spec.ts", "t", "failed"))
    errors: list[str] = []
    idx = coverage.playwright_index(doc, "playwright.json", errors)
    assert any("twice" in e for e in errors) and len(idx) == 1


def test_a_vitest_result_outside_its_listing_is_an_error_and_a_repeated_name_keeps_the_worst(tmp_path):
    f = "/x/lcnc-webui/src/a.test.ts"
    listing = [{"file": f, "name": "d > t"}]
    def res(*sts):
        return {"testResults": [{"name": f, "assertionResults": [
            {"ancestorTitles": ["d"], "title": "t", "status": s} for s in sts]}]}
    errors: list[str] = []
    assert coverage.vitest_index(listing, res("failed", "passed"), "u", errors) == {("a.test.ts", "d > t"): "failed"}
    assert errors == []
    coverage.vitest_index([], res("passed"), "unit-light.json", errors)
    assert any("a result for a test the listing does not hold" in e for e in errors)


def _native_errors(c: dict) -> list[str]:
    return [e for e in c["errors"] if e.startswith(("native report", "the native declarations"))
            or "(native_cases.REPORT_CASES)" in e or "is no native_run profile" in e]


def test_native_evidence_binds_only_to_a_declared_case_of_its_variant_and_profile(tmp_path, monkeypatch):
    import functions   # noqa: PLC0415 — the module coverage reads the inventory through
    web, py, fns = functions.load(ROOT)
    (tmp_path / "ok").mkdir()
    c = coverage.coverage(gate(tmp_path / "ok", dict(EMPTY_RUN)), [], [])
    assert _native_errors(c) == []                                    # every shipped native evidence binds
    natives = [e for f in fns["functions"] for s in f.get("statements", []) for e in s["evidence"] if e["layer"] == "native"]
    assert len(natives) == 70
    for i, (title, variant, profile, why) in enumerate((
            ("commit", None, "3axis_xyz", "no declared case 'commit'"),        # Codex's counter-case: a metadata word
            ("home-all", "latch-delayed", "3axis_xyz", "no declared case 'home-all' of variant 'latch-delayed'"),
            ("home-all", None, "5axis_xyzac", "profile '5axis_xyzac' is no native_run profile"))):
        changed = json.loads(json.dumps(fns))
        e = next(e for f in changed["functions"] for s in f.get("statements", []) for e in s["evidence"] if e["layer"] == "native")
        e.update(title=title, variant=variant, profile=profile)
        monkeypatch.setattr(functions, "load", lambda root, c=changed: (web, py, c))
        (tmp_path / str(i)).mkdir()
        c = coverage.coverage(gate(tmp_path / str(i), dict(EMPTY_RUN)), [], [])
        assert any(why in x for x in c["errors"]), (title, c["errors"][:3])


def test_a_native_report_of_this_commit_is_held_against_the_declared_set(tmp_path):
    def errs(name: str, report: Path) -> list[str]:
        d = tmp_path / name
        d.mkdir()
        return _native_errors(coverage.coverage(gate(d, dict(EMPTY_RUN)), [report], []))
    full = _full_rows(None)
    assert errs("ok", _native_report(tmp_path / "ok.json", full)) == []
    assert any("undeclared case(s) ['commit']" in e
               for e in errs("extra", _native_report(tmp_path / "extra.json", full + [{"case": "commit", "status": "PASS"}])))
    assert any("a complete run without ['home-all']" in e
               for e in errs("short", _native_report(tmp_path / "short.json", [r for r in full if r["case"] != "home-all"])))
    # a run that ended early names its error: the cases it never reached are no error
    assert errs("early", _native_report(tmp_path / "early.json", full[:3], error="StepFailed: x")) == []
    other = [{**r, "variant": "other"} for r in full]                # a consistent report of an unknown variant
    assert any("declares no cases" in e for e in errs("variant", _native_report(tmp_path / "v.json", other, variant="other")))


def test_a_native_case_is_its_worst_row_over_every_report_of_this_commit(tmp_path):
    case = sorted(_declared()[None])[0]
    a = _native_report(tmp_path / "a.json", _full_rows(None, **{case: "FAIL"}))
    b = _native_report(tmp_path / "b.json", _full_rows(None))                        # a later green run
    c = coverage.coverage(gate(tmp_path, dict(EMPTY_RUN)), [a, b], [])
    rows = [x for f in c["functions"] for x in f["native"] if x["title"] == case]
    assert rows and all(x["status"] == "FAIL" for x in rows)
    assert coverage._native_worst(["PASS", "SKIP"]) == "SKIP" and coverage._native_worst(["PASS", "odd"]) == "unknown status ['odd']"


def test_a_present_scenario_without_a_record_is_an_error_never_a_missing_run():
    assert live_drivers.scenario_status({"scenarios": {}}, "sigstop_trip") == ("absent", "")
    st, why = live_drivers.scenario_status({"scenarios": {"sigstop_trip": None}}, "sigstop_trip")
    assert st == "error" and "NoneType" in why
    assert live_drivers.scenario_status({"scenarios": {"sigstop_trip": []}}, "sigstop_trip")[0] == "error"
    j = live_drivers.judge(evidence(), ROOT, [{"commit": HEAD, "dirty": False, "run_id": "n", "scenarios": {"sigstop_trip": None}}], HEAD)
    assert j["status"] == "error"


def test_a_scenario_is_its_worst_over_every_report_of_this_commit():
    failed = report({"sticky_ok": True, "recovered_ok": False}, fail="recovered_ok False")
    passed = report({"sticky_ok": True, "recovered_ok": True})
    for order in ((failed, passed), (passed, failed)):
        j = live_drivers.judge(evidence(), ROOT, list(order), HEAD)
        assert j["status"] == "failed" and j["reports"] == 2
    skip = report({"skipped": "needs --allow-trip"})
    assert live_drivers.judge(evidence(), ROOT, [passed, skip], HEAD)["status"] == "skip"


def test_the_report_keeps_the_inventory_s_open_variants_and_exclusions_with_their_origin(tmp_path):
    import functions   # noqa: PLC0415
    web, py, _ = functions.load(ROOT)
    comp = functions.completeness(web, py)
    c = coverage.coverage(gate(tmp_path, dict(EMPTY_RUN)), [], [])
    inv = c["inventory"]
    assert len(inv["variantsOpen"]) == comp["variantsOpen"] and len(inv["excluded"]) == comp["excluded"]
    assert inv["complete"] == comp["complete"] and len(inv["unresolved"]) == len(comp["unresolved"])
    assert all({"side", "adapter", "file", "form", "expr"} <= set(x) for x in inv["variantsOpen"])
    assert not [g for g in c["gaps"] if "variant" in g["kind"]]                  # never added to the gaps
    md = coverage.markdown(c)
    assert "## Inventory (source level)" in md and md.count("- open variant:") == comp["variantsOpen"]
    f = next(f for f in c["functions"] if f["id"] == "F-ARM")
    assert isinstance(f["inventoried"]["atoms"], list) and "cmd:arm" in f["inventoried"]["atoms"]


def test_the_merge_gate_binds_the_coverage_to_the_run_ids_its_own_checks_made(tmp_path):
    sys.path.insert(0, str(ROOT / "scripts"))
    from test_select import round_gate   # noqa: PLC0415
    g = gate(tmp_path, {**EMPTY_RUN, **ran("e2e", T1)})
    own = [{"name": "browser-workers", "run": RUNS["e2e"]}, {"name": "firefox-workers", "run": RUNS["firefox-core"]},
           {"name": "backend", "run": RUNS["backend"]}]
    c = round_gate.coverage_check(g.with_suffix(".logs"), HEAD, own)
    report = json.loads((g.with_suffix(".logs") / "coverage.json").read_text())
    assert _identity_errors(report) == [] and report["runs"]["e2e"] == RUNS["e2e"]
    other = [{**x, "run": "another"} for x in own]
    c = round_gate.coverage_check(g.with_suffix(".logs"), HEAD, other)
    assert c["status"] == "FAIL" and any("another run's" in w for w in c["why"])


def test_the_gate_names_the_backend_s_run_and_hands_it_to_the_step():
    """The backend step's command carries --run-id and its check the same id
    (round_gate.main, by its syntax: running the gate is the merge gate's job)."""
    import ast   # noqa: PLC0415
    tree = ast.parse((ROOT / "scripts/test_select/round_gate.py").read_text())
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    src = ast.unparse(main)
    assert "backend_run = f'backend-{uuid.uuid4()}'" in src
    call = next(n for n in ast.walk(main) if isinstance(n, ast.Call) and ast.unparse(n.func) == "run"
                and n.args and isinstance(n.args[0], ast.Constant) and n.args[0].value == "backend")
    assert "'--run-id', backend_run" in ast.unparse(call)
    assert "'run': backend_run" in src


# ── before R398: the siblings of VM-I33 / VM-I34 / VM-I36 ──────────────────

def test_an_expected_refusal_counts_only_from_an_attempt_that_counts(tmp_path):
    refusal = {"where": ATT, "cmd": "touchoff", "refusal": "out of range"}

    def payload_checker(name: str, attempt: dict) -> list:
        c = _run_with(tmp_path / name, **ran("e2e", T1), **{"replay.json": replay("e2e", attempt, expected=[refusal])})
        return _fn(c, "F-TOUCHOFF")["counter"]["payload checker"]
    assert payload_checker("passed", att()) == [{"cmd": "touchoff", "refusals": 1}]          # the control
    assert payload_checker("failed", att(status="failed")) == []
    c = _run_with(tmp_path / "unlisted", **ran("e2e", T1),
                  **{"replay.json": replay("e2e", att(), expected=[{**refusal, "where": "y.spec.ts › z [retry 0]"}])})
    assert _fn(c, "F-TOUCHOFF")["counter"]["payload checker"] == []
    assert any("y.spec.ts › z [retry 0] counted, not in its attempt list" in e for e in c["errors"])


def test_a_native_report_whose_rows_are_no_objects_is_an_evaluation_error(tmp_path):
    for i, rows in enumerate((None, [1], ["home-all"], {"case": "home-all"})):
        r = tmp_path / f"r{i}.json"
        r.write_text(json.dumps({"commit": HEAD, "profile": "3axis_xyz", "variant": None, "rows": rows}))
        (tmp_path / str(i)).mkdir()
        c = coverage.coverage(gate(tmp_path / str(i), dict(EMPTY_RUN)), [r], [])    # no traceback
        assert any("rows is no list of row objects" in e for e in c["errors"]), rows


def test_a_bound_unit_test_that_declares_an_expected_failure_is_no_pass(tmp_path):
    """Vitest's JSON report writes `it.fails` as passed with no mark (measured);
    the run's own options record (vitest_options_reporter.mjs) says what the
    runner ran — every spelling alike (R398 VM-I34)."""
    fns = json.loads((ROOT / "scripts/inventory/functions.json").read_text())["functions"]
    e = next(e for f in fns for s in f.get("statements", []) for e in s["evidence"]
             if e["layer"] == "unit" and "$" not in e["title"] and "{" not in e["title"])
    full = f"/x/lcnc-webui/src/{e['file']}"
    listing = [{"file": full, "name": e["title"]}]
    report = {"testResults": [{"name": full, "assertionResults": [{"ancestorTitles": [], "title": e["title"], "status": "passed"}]}]}

    def unit_row(name: str, options) -> dict:
        c = _run_with(tmp_path / name, **{"unit-light.list.json": listing, "unit-light.json": report,
                                          "unit-light.options.json": options})
        rows = [x for f in c["functions"] for s in f["statements"] for x in s["evidence"]
                if x["layer"] == "unit" and x["file"] == e["file"] and x["title"] == e["title"]]
        return {"status": rows[0]["status"],
                "errors": [x for x in c["errors"] if "options.json" in x or "expected failure" in x]}
    ok = unit_row("plain", [{"file": full, "fullName": e["title"], "fails": False, "mode": "run"}])
    assert ok == {"status": "passed", "errors": []}                                           # the control
    xf = unit_row("fails", [{"file": full, "fullName": e["title"], "fails": True, "mode": "run"}])
    assert xf["status"] == "expected to fail" and any("expected failure" in x for x in xf["errors"])
    gone = unit_row("no-record", [])
    assert any("its expected failure unknown" in x for x in gone["errors"])
    broken = unit_row("broken", {"not": "a list"})
    assert any("no list of test option records" in x for x in broken["errors"])


# ── R398: the rests of VM-I33 / VM-I35 ──────────────────────────────────────

def test_one_attempt_identity_under_two_names_counts_once_and_is_an_error(tmp_path):
    other = "x.spec.ts › t (renamed) [retry 0]"
    r = replay("e2e", att(), att(name=other), per_attempt={ATT: {"touchoff": 1}, other: {"touchoff": 1}})
    c = _run_with(tmp_path, **ran("e2e", T1), **{"replay.json": r})
    assert any("attempt identity test t-1 [e2e] retry 0 listed 2 times" in e for e in c["errors"])
    assert _fn(c, "F-TOUCHOFF")["triggered"]["commands"]["touchoff"]["e2e"] == "not sent"


def test_two_results_for_one_retry_are_an_error_never_an_overwrite():
    doc = pw("e2e", T1)
    t = doc["suites"][0]["specs"][0]["tests"][0]
    t["results"] = [{"retry": 0, "status": "failed"}, {"retry": 0, "status": "passed"}]
    errors: list[str] = []
    idx = coverage.playwright_index(doc, "playwright.json", errors)
    assert any("two results for one retry" in e for e in errors)
    assert next(iter(idx.values()))["status"].startswith("contradictory")


def test_a_native_report_of_another_profile_or_with_rows_of_another_variant_is_an_error(tmp_path):
    full = _full_rows(None)
    def errs(name: str, report: Path) -> list[str]:
        d = tmp_path / name
        d.mkdir()
        return _native_errors(coverage.coverage(gate(d, dict(EMPTY_RUN)), [report], []))
    assert errs("ok", _native_report(tmp_path / "ok.json", full)) == []                       # the control
    mixed = [{**r, "variant": "latch-delayed"} if r["case"] == "home-all" else r for r in full]
    assert any("rows of another variant ['home-all']" in e for e in errs("mixed", _native_report(tmp_path / "m.json", mixed)))
    p = tmp_path / "p.json"
    p.write_text(json.dumps({"commit": HEAD, "profile": "unknown_profile", "variant": None, "rows": full}))
    assert any("profile 'unknown_profile' is no native_run profile" in e for e in errs("profile", p))


def test_the_gate_s_unit_steps_write_each_test_s_options():
    """round_gate.unit runs the options reporter beside the JSON report and
    names its artefact (R398 VM-I34) — by its syntax: running it is the gate's."""
    import ast   # noqa: PLC0415
    tree = ast.parse((ROOT / "scripts/test_select/round_gate.py").read_text())
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "unit")
    src = ast.unparse(fn)
    assert "f'--reporter={OPTIONS_REPORTER}'" in src
    assert "'LCNC_VITEST_OPTIONS_OUT': str(options)" in src and "options = logs / f'{name}.options.json'" in src
    assert (ROOT / "scripts/test_select/vitest_options_reporter.mjs").is_file()
