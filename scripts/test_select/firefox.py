#!/usr/bin/env python3
"""The Firefox core (test strategy TS248-05, plan vor-maschine R385): the
tests lcnc-webui/e2e/firefox-core.json names, run in the PINNED Mozilla
Firefox (lcnc-webui/e2e/firefox.json, scripts/fetch_firefox.py), with the
proof of what ran.

In order, each a check of its own:
  firefox-fetch     the pinned archive of this arch, its SHA256 checked (its
                    seconds named apart from the run's)
  firefox-static    no core spec calls a touch API (silent under BiDi)
  firefox-set       the config's listing IS the core set, test for test — a
                    variant lost, a title renamed, an extra match each named
  firefox-core      the run: no failure, skip, retry or empty run
  firefox-executed  every listed test ran exactly once AND passed (a result
                    "skipped" has the right count too — Codex R385)
  firefox-workers   each test on its own worker's mock (proof.check_workers)
  firefox-browser   every worker's STARTED browser is the pinned version
  firefox-replay    the run's frames against the gateway's rules (gate only)
The record names the pin, the arch, the archive's SHA256, Playwright's
version, the look-up for a newer release (current | newer | unknown) and
every image NOT compared, with its reason (R385 F1 b: references are
linux/arm64; another platform runs every size check and compares no image).

Used by round_gate.py (a merge always, a round when a path selects it) and
by CI through scripts/test_suite.py:

    python3 -I scripts/test_select/firefox.py --out <dir> [--no-replay]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fetch_firefox  # noqa: E402
from test_select import proof  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "lcnc-webui"
CORE = WEB / "e2e/firefox-core.json"
CONFIG = "playwright.firefox.config.ts"
PROJECT = "firefox-core"
#: a touch call in a core spec — silent under BiDi (R385 finding 2)
TOUCH = re.compile(r"\.tap\(|\btouchscreen\b|\bhasTouch\b")


def core_set(core: Path = CORE, required_only: bool = False) -> list[dict]:
    """The core's tests; `required_only` the required part (CI, R385 F3) —
    the config reads the same choice from LCNC_FIREFOX_SET."""
    data = json.loads(core.read_text())
    return [*data["required"], *([] if required_only else data.get("buildup", []))]


def expected_tests(entries: list[dict]) -> set[tuple[str, str, str]]:
    """(file, project, title) of every core test — proof.playwright_tests' key."""
    out = set()
    for e in entries:
        for t in e["titles"]:
            key = (e["file"], PROJECT, t)
            if key in out:
                raise ValueError(f"the core names {e['file']} › {t} twice")
            out.add(key)
    return out


def check_set(entries: list[dict], listing: dict) -> list[str]:
    """The config's listing against the core set: test for test."""
    want, got = expected_tests(entries), set(proof.playwright_tests(listing))
    problems = [f"a core test the config does not list (renamed, gone, a variant lost): {' › '.join((k[0], k[2]))}"
                for k in sorted(want - got)]
    problems += [f"listed, not in the core set: {' › '.join((k[0], k[2]))} [{k[1]}]" for k in sorted(got - want)]
    if not want:
        problems.append("the core set names no test")
    return problems


def touch_calls(entries: list[dict], e2e: Path = WEB / "e2e") -> list[str]:
    """Every touch call in a core spec, file:line. Shared helpers are held at
    run time (e2e/test.ts throws on every touch call in Firefox)."""
    found = []
    for f in sorted({e["file"] for e in entries}):
        for i, line in enumerate((e2e / f).read_text().splitlines(), 1):
            if TOUCH.search(line):
                found.append(f"{f}:{i}: {line.strip()[:120]}")
    return found


def not_passed(report: dict) -> list[str]:
    """Every result that is not a pass — a skip included (Codex R385: an
    identity check alone counts a skipped result as run)."""
    out = []
    for (file, project, title, retry), r in sorted(proof.playwright_results(report).items()):
        if r["status"] != "passed":
            out.append(f"{r['status']}: {file} › {title} [{project}, retry {retry}]")
    return out


def images_not_compared(report: dict) -> list[str]:
    """The tests that compared no image, with the annotation's reason."""
    out = []

    def walk(suite: dict, path: tuple[str, ...]):
        for spec in suite.get("specs", []):
            for t in spec.get("tests", []):
                for a in t.get("annotations", []) + [a for r in t.get("results", []) for a in r.get("annotations", [])]:
                    if a.get("type") == "images not compared":
                        out.append(f"{spec['file']} › {' › '.join(path + (spec['title'],))}: {a.get('description')}")
        for s in suite.get("suites", []):
            walk(s, path + (s["title"],))
    for s in report.get("suites", []):
        walk(s, ())
    return sorted(set(out))


def check_browser(events: list[dict], run: str, pinned: str) -> list[str]:
    """Every worker of this run started the pinned Firefox (e2e/test.ts
    browserPin writes the started browser's own version)."""
    seen = [e for e in events if e.get("event") == "browser" and e.get("run") == run]
    if not seen:
        return ["no worker reported its started browser"]
    return [f"worker {e.get('workerIndex')}: {e.get('name')} {e.get('version')}, the pin names firefox {pinned}"
            for e in seen if e.get("name") != "firefox" or e.get("version") != pinned]


def core(logs: Path, *, replay_on: bool, missing: str, required_only: bool = False) -> dict:
    """The Firefox core's checks into `logs`. `missing` is what a binary
    that cannot be fetched makes of the step: "FAIL" (the merge gate, CI) or
    "pending" (a round). Returns {"checks", "pending", "info"}."""
    from test_select import round_gate as rg   # the gate's run helpers (round_gate imports this module lazily)
    logs.mkdir(parents=True, exist_ok=True)
    checks: list[dict] = []
    pin = fetch_firefox.load_pin()
    info: dict = {"pinned": pin["version"], "playwright": rg.output(["npx", "playwright", "--version"], WEB)}

    t0 = time.monotonic()
    try:
        arch = fetch_firefox.this_arch()
        fetched = fetch_firefox.fetch(pin, arch)
        info.update(arch=arch, archive_sha256=fetched["sha256"], binary=fetched["binary"], cache=fetched["cache"])
        checks.append({"name": "firefox-fetch", "status": "PASS", "seconds": round(time.monotonic() - t0, 1),
                       "cache": fetched["cache"]})
    except Exception as e:   # noqa: BLE001 — no binary: the step is FAIL or pending, never green
        why = f"the pinned Firefox {pin['version']} could not be fetched: {type(e).__name__}: {e}"
        if missing == "pending":
            return {"checks": checks, "pending": {"check": "firefox-core", "status": f"pending: {why}"}, "info": info}
        checks.append({"name": "firefox-fetch", "status": "FAIL", "why": [why]})
        return {"checks": checks, "pending": None, "info": info}
    info["newer"] = fetch_firefox.check_newer(pin)

    entries = core_set(required_only=required_only)
    info["set"] = "required" if required_only else "required + build-up"
    touch = touch_calls(entries)
    checks.append({"name": "firefox-static", "status": "FAIL" if touch else "PASS",
                   **({"why": [f"a touch call in the core (silent under BiDi): {t}" for t in touch]} if touch else {})})

    report, events = logs / "firefox.json", logs / "firefox-mock-events.jsonl"
    run_id = f"firefox-{uuid.uuid4()}"
    events.unlink(missing_ok=True)
    replay_dir = logs / "firefox-replay"
    import shutil
    shutil.rmtree(replay_dir, ignore_errors=True)
    env = {"PLAYWRIGHT_JSON_OUTPUT_FILE": str(report), "PLAYWRIGHT_JSON_OUTPUT_NAME": str(report),
           "LCNC_E2E_EVENTS": str(events), "LCNC_E2E_RUN": run_id, "LCNC_E2E_WORKERS": str(rg.WORKERS),
           "LCNC_E2E_REPLAY_DIR": str(replay_dir), "LCNC_FIREFOX": fetched["binary"],
           "LCNC_FIREFOX_SET": "required" if required_only else "all"}
    listed, err = rg.listing(CONFIG, env, logs / "firefox-list.json")
    if err:
        checks.append({"name": "firefox-set", "status": "FAIL", "why": [err]})
        return {"checks": checks, "pending": None, "info": info}
    problems = check_set(entries, listed)
    checks.append({"name": "firefox-set", "status": "FAIL" if problems else "PASS",
                   **({"why": problems[:20]} if problems else {"tests": len(expected_tests(entries))})})
    busy = [p for p in rg.ports() if rg.listening(p)]
    if busy:
        checks.append({"name": "firefox-ports-free", "status": "FAIL",
                       "why": [f"port {p} already serves something: a foreign server would be tested" for p in busy]})
        return {"checks": checks, "pending": None, "info": info}

    c = rg.run("firefox-core", ["npx", "playwright", "test", "-c", CONFIG, "--forbid-only", "--trace", "off",
                                "--reporter=line,json"], WEB, logs, env)
    rg.judge(c, rg.playwright_counts(report))
    checks.append(c)
    if not (report.is_file() and report.stat().st_size):
        return {"checks": checks, "pending": None, "info": info}
    ran = json.loads(report.read_text())
    executed = proof.check_executed(listed, ran) + not_passed(ran)
    checks.append({"name": "firefox-executed", "status": "FAIL" if executed else "PASS",
                   **({"why": executed[:20]} if executed else {"tests": len(proof.playwright_tests(listed))})})
    log = [json.loads(line) for line in events.read_text().splitlines()] if events.is_file() else []
    owners = proof.check_report_run(ran, run_id) + (
        proof.check_workers(ran, log, run_id) if log else ["the fixture's event log is missing or empty"])
    checks.append({"name": "firefox-workers", "status": "FAIL" if owners else "PASS", "run": run_id,
                   **({"why": owners[:20]} if owners else {})})
    started = check_browser(log, run_id, pin["version"])
    info["started"] = sorted({f"{e.get('name')} {e.get('version')}" for e in log
                              if e.get("event") == "browser" and e.get("run") == run_id})
    checks.append({"name": "firefox-browser", "status": "FAIL" if started else "PASS",
                   **({"why": started} if started else {"version": pin["version"]})})
    info["images_not_compared"] = images_not_compared(ran)
    # the run's real worker count and duration (Codex R385 F3: CI names them)
    info["workers"] = {"asked": rg.WORKERS, "report": (ran.get("config") or {}).get("workers"),
                       "seconds": c.get("seconds")}
    info["unloads"] = [{k: e.get(k) for k in ("title", "beacons", "recorded")} for e in log
                       if e.get("event") == "unload" and e.get("run") == run_id]
    if replay_on:
        t1 = time.monotonic()
        r = rg.replay_check(replay_dir, events, run_id, logs / "firefox-replay.json")
        r["name"], r["seconds"] = "firefox-replay", round(time.monotonic() - t1, 1)
        checks.append(r)
    return {"checks": checks, "pending": None, "info": info}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True, help="a folder for the logs and firefox-core.json")
    ap.add_argument("--no-replay", action="store_true", help="CI: the replay stays with the gate (R385 F3)")
    ap.add_argument("--required-only", action="store_true", help="CI: the required part of the core (R385 F3)")
    a = ap.parse_args(argv)
    out = a.out if a.out.is_absolute() else Path.cwd() / a.out
    result = core(out, replay_on=not a.no_replay, missing="FAIL", required_only=a.required_only)
    verdict = "PASS" if result["checks"] and all(c["status"] == "PASS" for c in result["checks"]) else "FAIL"
    (out / "firefox-core.json").write_text(json.dumps({"verdict": verdict, **result}, indent=2, ensure_ascii=False) + "\n")
    for c in result["checks"]:
        print(f"{c['status']:4s} {c['name']}" + (f" — {c['why'][0]}" if c.get("why") else ""))
    for line in result["info"].get("images_not_compared", []):
        print(f"     image not compared: {line}")
    print(f"firefox core: {verdict} (pin {result['info'].get('pinned')}, started {result['info'].get('started')}, "
          f"newer: {result['info'].get('newer', {}).get('status')})")
    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
