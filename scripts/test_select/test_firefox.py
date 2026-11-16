"""The Firefox core's runner (scripts/test_select/firefox.py, plan vor-maschine
R385 D): the listing is the core set test for test, no core spec calls a
touch API, a run counts only with every result PASSED (a skip too has the
right count — Codex R385), every worker's started browser is the pin, and
every image not compared is named."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from test_select import firefox  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def report(tests: list[tuple[str, str, str]], status: str = "passed", annotations=None) -> dict:
    """A Playwright JSON report: (file, title, status) per test, one result each."""
    suites = {}
    for file, title, st in tests:
        suites.setdefault(file, []).append({"title": title, "tests": [{
            "projectName": firefox.PROJECT, "annotations": annotations or [],
            "results": [{"status": st or status, "retry": 0, "workerIndex": 0, "parallelIndex": 0}]}]})
    return {"suites": [{"title": f, "file": f, "specs": [{**s, "file": f} for s in specs], "suites": []}
                       for f, specs in suites.items()]}


def listing(tests: list[tuple[str, str]]) -> dict:
    r = report([(f, t, "passed") for f, t in tests])
    for s in r["suites"]:
        for spec in s["specs"]:
            spec["tests"][0]["results"] = []
    return r


CORE = [{"file": "dialogs.spec.ts", "titles": ["a", "b"]}, {"file": "smoke.spec.ts", "titles": ["s"]}]


def test_the_listing_is_the_core_set():
    assert firefox.check_set(CORE, listing([("dialogs.spec.ts", "a"), ("dialogs.spec.ts", "b"), ("smoke.spec.ts", "s")])) == []


def test_a_lost_variant_and_an_extra_match_are_named():
    problems = firefox.check_set(CORE, listing([("dialogs.spec.ts", "a"), ("smoke.spec.ts", "s"), ("smoke.spec.ts", "x")]))
    assert any("does not list" in p and "dialogs.spec.ts › b" in p for p in problems)
    assert any("not in the core set" in p and "smoke.spec.ts › x" in p for p in problems)


def test_an_empty_core_and_a_title_named_twice_are_refused():
    assert firefox.check_set([], listing([])) == ["the core set names no test"]
    with pytest.raises(ValueError, match="twice"):
        firefox.expected_tests([{"file": "a.spec.ts", "titles": ["t", "t"]}])


def test_a_skipped_or_failed_result_is_no_pass():
    r = report([("dialogs.spec.ts", "a", "passed"), ("dialogs.spec.ts", "b", "skipped"), ("smoke.spec.ts", "s", "timedOut")])
    assert firefox.not_passed(r) == [
        "skipped: dialogs.spec.ts › b [firefox-core, retry 0]",
        "timedOut: smoke.spec.ts › s [firefox-core, retry 0]"]


def test_touch_calls_in_a_core_spec_are_found(tmp_path: Path):
    (tmp_path / "dialogs.spec.ts").write_text("await page.click();\nawait btn.tap();\n")
    (tmp_path / "smoke.spec.ts").write_text("await page.touchscreen.tap(1, 2);\nconst ctx = { hasTouch: true };\n")
    assert firefox.touch_calls(CORE, tmp_path) == [
        "dialogs.spec.ts:2: await btn.tap();",
        "smoke.spec.ts:1: await page.touchscreen.tap(1, 2);",
        "smoke.spec.ts:2: const ctx = { hasTouch: true };"]


def test_the_shipped_core_names_existing_specs_without_a_touch_call():
    entries = firefox.core_set()
    assert entries, "the core set is empty"
    for e in entries:
        assert (ROOT / "lcnc-webui/e2e" / e["file"]).is_file(), e["file"]
    assert firefox.touch_calls(entries) == []
    data = json.loads(firefox.CORE.read_text())
    required = {(e["file"], t) for e in data["required"] for t in e["titles"]}
    # TS248-05 / R385 C: the required part — eight procedures, the grid guard's
    # four variants, smoke, the five dialog rows in both layouts
    assert sum(1 for f, _ in required if f == "probe-visual.spec.ts") == 9
    assert sum(1 for f, _ in required if f == "layout.spec.ts") == 4
    assert sum(1 for f, _ in required if f == "smoke.spec.ts") == 3
    assert sum(1 for f, _ in required if f == "dialogs.spec.ts") == 10


def test_the_started_browser_must_be_the_pin():
    ev = [{"event": "browser", "run": "r", "name": "firefox", "version": "160.0", "workerIndex": 0},
          {"event": "browser", "run": "r", "name": "firefox", "version": "159.0", "workerIndex": 1},
          {"event": "browser", "run": "other", "name": "firefox", "version": "1.0", "workerIndex": 2}]
    assert firefox.check_browser(ev, "r", "160.0", {0, 1}) == [
        "a browser record of another run ('other'), not r", "worker 1: firefox 159.0, the pin names firefox 160.0"]
    assert firefox.check_browser(ev[:2], "r", "160.0", {0, 1}) == ["worker 1: firefox 159.0, the pin names firefox 160.0"]
    assert firefox.check_browser([], "r", "160.0", {0}) == ["worker 0: ran tests, recorded no started browser"]
    assert firefox.check_browser([{**ev[0], "name": "chromium"}], "r", "160.0", {0}) == [
        "worker 0: chromium 160.0, the pin names firefox 160.0"]


def test_an_image_not_compared_is_named_with_its_reason():
    r = report([("probe-visual.spec.ts", "Outside", "passed")],
               annotations=[{"type": "images not compared", "description": "references are linux/arm64, this is linux/x64"}])
    assert firefox.images_not_compared(r) == [
        "probe-visual.spec.ts › Outside: references are linux/arm64, this is linux/x64"]


@pytest.mark.parametrize("missing", ["FAIL", "pending"])
def test_a_binary_that_cannot_be_fetched_fails_a_merge_and_stands_pending_in_a_round(missing, tmp_path, monkeypatch):
    """R385 G: never a green skip — the merge gate (and CI) FAIL, a round names it pending."""
    from test_select import round_gate
    monkeypatch.setattr(round_gate, "output", lambda cmd, cwd: "Version x")

    def no_network(pin, arch, *a, **k):
        raise firefox.fetch_firefox.FetchError("network unreachable")
    monkeypatch.setattr(firefox.fetch_firefox, "fetch", no_network)
    r = firefox.core(tmp_path, replay_on=True, missing=missing)
    if missing == "FAIL":
        assert r["pending"] is None and [c["status"] for c in r["checks"]] == ["FAIL"]
        assert "could not be fetched" in r["checks"][0]["why"][0]
    else:
        assert r["checks"] == [] and r["pending"]["status"].startswith("pending: the pinned Firefox")


# ── The unload's receipt (Codex R386 VM-I25) ─────────────────────────────
def unload(title: str, test: str, **kw) -> dict:
    return {"event": "unload", "run": "r", "title": title, "testId": test, "retry": 0, **kw}


DONE = {"nonce": "n", "beacons": 2, "received": 2, "missing": [], "foreign": [], "twice": [], "posts": 2}


def test_an_attempt_whose_app_loaded_needs_its_complete_unload(tmp_path: Path):
    d = tmp_path / "replay"
    d.mkdir()
    lines = [{"kind": "http", "method": "GET", "path": "/", "status": 200, "origin": {"run": "r", "test": t, "retry": 0}}
             for t in ("a", "b", "c", "d")]
    lines += [{"kind": "http", "method": "GET", "path": "/", "status": 200, "origin": {"run": "other", "test": "z", "retry": 0}},
              {"kind": "http", "method": "GET", "path": "/static/x.js", "status": 200, "origin": {"run": "r", "test": "e", "retry": 0}}]
    (d / "r-1.jsonl").write_text("".join(json.dumps(x) + "\n" for x in lines))
    loaded = firefox.loaded_attempts(d, "r")
    assert loaded == {("a", 0), ("b", 0), ("c", 0), ("d", 0)}
    ev = [unload("A", "a", **DONE),
          unload("B", "b", skipped="the page is closed"),                                 # loaded: red
          unload("C", "c", **{**DONE, "received": 1, "missing": ["n.2"]}),                 # incomplete: red
          unload("S", "s", skipped="the page is not the mock's app (http://localhost:4173/)"),  # not loaded: fine
          unload("X", "a", run="other", skipped="x")]                                      # another run: not read
    problems = firefox.check_unloads(ev, "r", loaded)
    assert problems == ["B [retry 0]: its app loaded, its unload skipped: the page is closed",
                        "C [retry 0]: 2 beacon(s), 1 received, missing ['n.2'], foreign [], twice []",
                        "d [retry 0]: its app loaded, no unload event"]
    assert firefox.check_unloads([unload("A", "a", **DONE)], "r", {("a", 0)}) == []


def guard_report(held=("failed", "expected", "failed", "the unload's beacons not received while its context lives: …"),
                 control=("passed", "expected", "passed", "")) -> dict:
    def spec(title, case):
        exp, outcome, status, msg = case
        return {"title": title, "file": "firefox-unload.guard.ts", "tests": [{
            "expectedStatus": exp, "status": outcome,
            "results": [{"status": status, "errors": [{"message": msg}] if msg else []}]}]}
    return {"suites": [{"title": "firefox-unload.guard.ts", "specs": [
        spec("held: the unload's second beacon never reaches the mock while an unrelated POST does", held),
        spec("control: every beacon of the unload reaches the mock", control)], "suites": []}]}


HELD_EV = {"nonce": "n", "beacons": 2, "received": 1, "missing": ["n.2"], "foreign": [], "twice": [], "posts": 2}


def guard_events(held=HELD_EV, control=DONE) -> list[dict]:
    return [unload("held: the unload's second beacon never reaches the mock while an unrelated POST does", "h", **held),
            unload("control: every beacon of the unload reaches the mock", "c", **control)]


def test_the_unload_guard_passes_only_on_its_counter_case():
    assert firefox.judge_unload_guard(guard_report(), guard_events(), "r") == []
    # the held case PASSED (a count-based unload): red
    assert any("not refused" in p for p in firefox.judge_unload_guard(
        guard_report(held=("failed", "unexpected", "passed", "")), guard_events(), "r"))
    # failed for another reason (the app never loaded): red
    assert any("not refused for its beacon" in p for p in firefox.judge_unload_guard(
        guard_report(held=("failed", "expected", "failed", "expect(locator).toBeVisible() failed")), guard_events(), "r"))
    # the event is not the counter-case: fewer POSTs than beacons, the wrong mark, two marks missing
    for ev in ({**HELD_EV, "posts": 1}, {**HELD_EV, "missing": ["n.1"]},
               {**HELD_EV, "received": 0, "missing": ["n.1", "n.2"]}):
        assert any("not the counter-case" in p for p in firefox.judge_unload_guard(guard_report(), guard_events(held=ev), "r")), ev
    # no event for the held case
    assert "held: no unload event" in firefox.judge_unload_guard(guard_report(), guard_events()[1:], "r")
    # the control failed or lost a beacon
    assert any(p.startswith("control: expected") for p in firefox.judge_unload_guard(
        guard_report(control=("passed", "unexpected", "failed", "x")), guard_events(), "r"))
    assert any(p.startswith("control: not every beacon") for p in firefox.judge_unload_guard(
        guard_report(), guard_events(control={**DONE, "received": 1, "missing": ["n.2"]}), "r"))
    # the wrong cases ran
    r = guard_report()
    r["suites"][0]["specs"] = r["suites"][0]["specs"][:1]
    assert firefox.judge_unload_guard(r, guard_events(), "r")[0].startswith("the guard ran")


# ── The graphics path (R387) ─────────────────────────────────────────────
def browser_ev(worker: int, run: str = "r", **kw) -> dict:
    return {"event": "browser", "run": run, "name": "firefox", "version": "160.0", "workerIndex": worker, **kw}


def test_every_worker_must_record_no_webgl():
    W = {0, 1}
    assert firefox.check_graphics([browser_ev(0, webgl=False), browser_ev(1, webgl=False)], "r", W) == []
    # a display gave WebGL: named per worker
    assert firefox.check_graphics([browser_ev(0, webgl=False), browser_ev(1, webgl=True)], "r", W) == [
        "worker 1: WebGL answered — the browser had a display"]
    # no record is no proof
    assert firefox.check_graphics([browser_ev(0)], "r", {0}) == ["worker 0: no WebGL answer recorded"]
    assert firefox.check_graphics([browser_ev(0, webgl=None)], "r", {0}) == ["worker 0: the WebGL answer is no boolean: None"]
    # another run's record is not this run's
    assert firefox.check_graphics([browser_ev(0, run="other", webgl=False)], "r", {0}) == [
        "a browser record of another run ('other'), not r", "worker 0: ran tests, recorded no started browser"]
    assert firefox.check_graphics([], "r", set()) == ["the report names no worker"]


# ── Bound to the report's workers and the known run (Codex R387 VM-I27) ───
OK = dict(webgl=False)


@pytest.mark.parametrize("case,events,workers,expected", [
    ("every worker its own record", [browser_ev(0, **OK), browser_ev(1, **OK), browser_ev(2, **OK)], {0, 1, 2}, []),
    ("one record missing, the others present", [browser_ev(0, **OK), browser_ev(1, **OK)], {0, 1, 2},
     ["worker 2: ran tests, recorded no started browser"]),
    ("only the first worker reports", [browser_ev(0, **OK)], {0, 1, 2},
     ["worker 1: ran tests, recorded no started browser", "worker 2: ran tests, recorded no started browser"]),
    ("one record moved to a worker the report does not name", [browser_ev(99, **OK)], {0},
     ["worker 99: a browser record of a worker the report does not name", "worker 0: ran tests, recorded no started browser"]),
    ("a worker with two records", [browser_ev(0, **OK), browser_ev(0, **OK)], {0}, ["worker 0: more than one browser record"]),
    ("a replacement worker needs its own record", [browser_ev(0, **OK), browser_ev(1, **OK)], {0, 1, 3},
     ["worker 3: ran tests, recorded no started browser"]),
    ("another run's record beside the right ones", [browser_ev(0, **OK), browser_ev(0, run="other", **OK)], {0},
     ["a browser record of another run ('other'), not r"]),
])
def test_one_record_per_worker_the_report_names(case, events, workers, expected):
    assert firefox.check_graphics(events, "r", workers) == expected, case
    assert firefox.check_browser(events, "r", "160.0", workers) == expected, case


def test_the_guard_is_judged_under_its_known_run_id():
    core = [browser_ev(0, **OK), browser_ev(1, **OK)]
    guard = [browser_ev(0, run="g", **OK)]
    assert firefox.browser_proofs([("core", core, "r", {0, 1}), ("guard", guard, "g", {0})], "160.0") == ([], [])
    # the guard's record under another run id: its worker is unproven, never read off the record
    moved = [browser_ev(0, run="not-this-guard", **OK)]
    b, g = firefox.browser_proofs([("core", core, "r", {0, 1}), ("guard", moved, "g", {0})], "160.0")
    assert b == g == ["guard: a browser record of another run ('not-this-guard'), not g",
                      "guard: worker 0: ran tests, recorded no started browser"]
    # a foreign record BESIDE the guard's own: red too, never ignored
    beside = guard + [browser_ev(0, run="not-this-guard", **OK)]
    b, g = firefox.browser_proofs([("core", core, "r", {0, 1}), ("guard", beside, "g", {0})], "160.0")
    assert b == g == ["guard: a browser record of another run ('not-this-guard'), not g"]
    # no guard report: unproven, never green
    b, g = firefox.browser_proofs([("core", core, "r", {0, 1}), ("guard", guard, "g", None)], "160.0")
    assert b == g == ["guard: no report — its browsers are unproven"]


def test_the_report_names_its_workers_replacements_included():
    def res(w, retry=0):
        return {"workerIndex": w, "parallelIndex": 0, "status": "passed", "retry": retry}
    report = {"suites": [{"title": "a.spec.ts", "specs": [
        {"file": "a.spec.ts", "title": "t1", "tests": [{"projectName": "p", "results": [res(0), res(3, 1)]}]},
        {"file": "a.spec.ts", "title": "t2", "tests": [{"projectName": "p", "results": [res(1)]}]},
        {"file": "a.spec.ts", "title": "t3", "tests": [{"projectName": "p", "results": [res(-1)]}]}], "suites": []}]}
    assert firefox.report_workers(report) == {0, 1, 3}


@pytest.mark.parametrize("guard_record_run,green", [("own", True), ("not-this-guard", False)])
def test_the_runner_hands_the_guards_known_run_id_to_the_proofs(guard_record_run, green, tmp_path, monkeypatch):
    """The wiring in firefox.core (Codex R387 VM-I27): the guard's browser
    record under a run id other than the one the runner started it with
    leaves its worker unproven — the run id is never read off the records."""
    from test_select import round_gate
    monkeypatch.setattr(round_gate, "output", lambda cmd, cwd: "Version x")
    monkeypatch.setattr(firefox.fetch_firefox, "fetch",
                        lambda pin, arch, *a, **k: {"sha256": "x", "binary": "/bin/false", "cache": "hit"})
    monkeypatch.setattr(firefox.fetch_firefox, "check_newer", lambda pin, *a, **k: {"status": "current"})
    monkeypatch.setattr(round_gate, "listing", lambda config, env, target: ({"suites": []}, None))
    monkeypatch.setattr(round_gate, "listening", lambda port: False)   # a live run's servers are not this test's

    def report(run: str, workers: list[int]) -> dict:
        return {"config": {"metadata": {"run": run}}, "stats": {"expected": len(workers), "unexpected": 0, "flaky": 0, "skipped": 0},
                "suites": [{"title": "x.spec.ts", "suites": [], "specs": [
            {"file": "x.spec.ts", "title": f"t{w}", "tests": [{"projectName": firefox.PROJECT, "results": [
                {"workerIndex": w, "parallelIndex": w, "status": "passed", "retry": 0}]}]} for w in workers]}]}

    def fake_run(name, cmd, cwd, logs, env=None):
        run = env["LCNC_E2E_RUN"]
        guard = env.get("LCNC_FIREFOX_SET") == "unload-guard"
        workers = [0] if guard else [0, 1]
        Path(env["PLAYWRIGHT_JSON_OUTPUT_FILE"]).write_text(json.dumps(report(run, workers)))
        rec_run = (run if guard_record_run == "own" else guard_record_run) if guard else run
        Path(env["LCNC_E2E_EVENTS"]).write_text("".join(json.dumps(
            {"event": "browser", "run": rec_run, "name": "firefox", "version": firefox.fetch_firefox.load_pin()["version"],
             "workerIndex": w, "webgl": False}) + "\n" for w in workers))
        return {"name": name, "command": "", "status": "PASS", "exit": 0, "seconds": 1}
    monkeypatch.setattr(round_gate, "run", fake_run)
    r = firefox.core(tmp_path, replay_on=False, missing="FAIL")
    by = {c["name"]: c for c in r["checks"]}
    assert "firefox-browser" in by, [(c["name"], c["status"], c.get("why")) for c in r["checks"]]
    for name in ("firefox-browser", "firefox-graphics"):
        assert (by[name]["status"] == "PASS") is green, (name, by[name])
        if not green:
            foreign, missing = by[name]["why"]
            assert foreign.startswith("guard: a browser record of another run ('not-this-guard'), not firefox-guard-")
            assert missing == "guard: worker 0: ran tests, recorded no started browser"
