#!/usr/bin/env python3
"""The selector's dry run (test strategy step 3): beside a full gate that runs
anyway, what the selection would have run, how long it would have taken, and
whether every failure of the full run lay inside it.

    python3 -I scripts/test_select/dryrun.py --selection sel.json \\
        --vitest vitest.json --playwright playwright.json [--out dry.json]

`vitest.json` / `playwright.json` are the full run's JSON reports (the gate's
logs). Exit 0 when every failure (and every flaky test) lay in the selection,
1 when one did not — the selection would have missed it — 2 on unusable input
(a missing or empty report is never "no failures").
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from test_select.rules import FULL, HEAVY_UNIT  # noqa: E402


def unit_rows(vitest: dict) -> list[dict]:
    rows = []
    for r in vitest.get("testResults", []):
        name = r["name"]
        rel = "lcnc-webui/" + name.split("/lcnc-webui/", 1)[1] if "/lcnc-webui/" in name else name
        rows.append({"file": rel, "status": r["status"],
                     "ms": max(0.0, r.get("endTime", 0) - r.get("startTime", 0))})
    return rows


def browser_rows(pw: dict) -> list[dict]:
    rows = []

    def walk(suite: dict):
        for spec in suite.get("specs", []):
            for t in spec.get("tests", []):
                results = t.get("results", [])
                rows.append({"file": spec["file"], "title": spec["title"],
                             "project": t.get("projectName"), "status": t.get("status"),
                             "retries": max(0, len(results) - 1),
                             "ms": sum(r.get("duration", 0) for r in results)})
        for s in suite.get("suites", []):
            walk(s)

    for s in pw.get("suites", []):
        walk(s)
    return rows


def dry_run(sel: dict, vitest: dict, pw: dict) -> dict:
    units, tests = unit_rows(vitest), browser_rows(pw)
    if not units or not tests:
        raise ValueError("a full run's report is missing or empty — never read as 'no failures'")
    heavy_on = sel["unit"]["heavy"]
    changed_units = set(sel["unit"]["changed"])
    browser = sel["browser"]["run"]
    chosen_specs = None if browser == FULL else {f"{n}.spec.ts" for n in browser}

    def unit_selected(f: str) -> bool:
        return f not in HEAVY_UNIT or heavy_on or f in changed_units

    def spec_selected(f: str) -> bool:
        return chosen_specs is None or f in chosen_specs

    unit_fail = [u for u in units if u["status"] != "passed"]
    test_fail = [t for t in tests if t["status"] in ("unexpected", "flaky")]
    missed = ([{"unit": u["file"], "status": u["status"]} for u in unit_fail if not unit_selected(u["file"])]
              + [{"spec": t["file"], "title": t["title"], "status": t["status"]}
                 for t in test_fail if not spec_selected(t["file"])])

    sel_units = [u for u in units if unit_selected(u["file"])]
    sel_tests = [t for t in tests if spec_selected(t["file"])]
    return {
        "base": sel["base"], "head": sel["head"],
        "full_run": {"unit_files": len(units), "unit_cpu_s": round(sum(u["ms"] for u in units) / 1000),
                     "browser_tests": len(tests), "browser_s": round(sum(t["ms"] for t in tests) / 1000),
                     "unit_failures": [u["file"] for u in unit_fail],
                     "browser_failures": [f'{t["file"]}: {t["title"]} ({t["status"]})' for t in test_fail]},
        "selection": {"heavy": heavy_on,
                      "unit_files": len(sel_units), "unit_cpu_s": round(sum(u["ms"] for u in sel_units) / 1000),
                      "browser": browser if browser == FULL else sorted(chosen_specs),
                      "browser_tests": len(sel_tests),
                      "browser_s": round(sum(t["ms"] for t in sel_tests) / 1000)},
        "missed": missed,
        "verdict": "every failure lay in the selection" if not missed else "the selection MISSED a failure",
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--selection", type=Path, required=True)
    ap.add_argument("--vitest", type=Path, required=True)
    ap.add_argument("--playwright", type=Path, required=True)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args(argv)
    try:
        result = dry_run(json.loads(a.selection.read_text()), json.loads(a.vitest.read_text()),
                         json.loads(a.playwright.read_text()))
    except (OSError, ValueError, KeyError) as e:
        print(f"dryrun: {e}", file=sys.stderr)
        return 2
    text = json.dumps(result, indent=2, ensure_ascii=False)
    if a.out:
        a.out.write_text(text + "\n")
    print(text)
    return 0 if not result["missed"] else 1


if __name__ == "__main__":
    sys.exit(main())
