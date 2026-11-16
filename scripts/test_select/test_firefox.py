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
    assert firefox.check_browser(ev, "r", "160.0") == ["worker 1: firefox 159.0, the pin names firefox 160.0"]
    assert firefox.check_browser([], "r", "160.0") == ["no worker reported its started browser"]
    assert firefox.check_browser([{**ev[0], "name": "chromium"}], "r", "160.0") == [
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
