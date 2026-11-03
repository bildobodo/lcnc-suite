"""Proof that a browser run ran exactly what it should, on whose mock (Codex
R248 TS248-03, R256 TS256-04, R262 PM261-04).

Before the run, `--list` of the select config against `--list` of the full
config: the same files as selected, each in the project the full config
gives it. After the run, every listed test ran exactly once (check_executed)
and, from the per-worker mock fixture's event log, on its own worker's mock,
one test after another inside each worker (check_workers) — the order the
old chain of projects proved is gone with the one shared mock it protected.

Pure: reads the JSON reports and the event log, never runs anything.
"""
from __future__ import annotations

import re


def listed(report: dict) -> dict[str, set[str]]:
    """file → the projects that list it, from a `--list --reporter=json` report."""
    out: dict[str, set[str]] = {}

    def walk(suite: dict):
        for spec in suite.get("specs", []):
            for t in spec.get("tests", []):
                out.setdefault(spec["file"], set()).add(t["projectName"])
        for s in suite.get("suites", []):
            walk(s)

    for s in report.get("suites", []):
        walk(s)
    return out


def check_listing(full: dict, selected: dict, names: list[str]) -> list[str]:
    """Problems of a selected listing; empty = exactly the selection, each file
    in its full-config project."""
    problems = []
    want = {f"{n}.spec.ts" for n in names}
    full_at, sel_at = listed(full), listed(selected)
    for f in sorted(want - set(full_at)):
        problems.append(f"{f}: not a test file of the full config")
    for f in sorted(set(sel_at) - want):
        problems.append(f"{f}: listed but not selected")
    for f in sorted(want - set(sel_at)):
        problems.append(f"{f}: selected but not listed")
    for f in sorted(want & set(sel_at) & set(full_at)):
        if sel_at[f] != full_at[f]:
            problems.append(f"{f}: in {sorted(sel_at[f])}, the full config runs it in {sorted(full_at[f])}")
    return problems


# ── Discovery against execution (Codex R256 TS256-04) ────────────────────
def playwright_tests(report: dict) -> dict[tuple[str, str, str], int]:
    """(file, project, title path) → how many results the report holds for
    it; a `--list` report holds none."""
    out: dict[tuple[str, str, str], int] = {}

    def walk(suite: dict, path: tuple[str, ...]):
        for spec in suite.get("specs", []):
            for t in spec.get("tests", []):
                key = (spec["file"], t["projectName"], " › ".join(path + (spec["title"],)))
                if key in out:
                    raise ValueError(f"two tests share {key}")
                out[key] = len(t.get("results", []))
        for s in suite.get("suites", []):
            walk(s, path + (s["title"],))

    for s in report.get("suites", []):
        walk(s, ())   # the file suite's title is the file: not part of the path
    return out


def check_executed(listing: dict, report: dict) -> list[str]:
    """Every listed test ran exactly once, no test ran that was not listed —
    a focused test, a missing file, a dropped case or a retry each show here."""
    if listing.get("errors") or report.get("errors"):
        return [f"discovery or run errors: {(listing.get('errors') or report.get('errors'))[:2]}"]
    want, got = playwright_tests(listing), playwright_tests(report)
    problems = [f"listed, never ran: {' | '.join(k)}" for k in sorted(set(want) - set(got))]
    problems += [f"ran, never listed: {' | '.join(k)}" for k in sorted(set(got) - set(want))]
    problems += [f"{n} results (retried or run twice): {' | '.join(k)}" for k, n in sorted(got.items()) if k in want and n != 1]
    problems += [f"no result: {' | '.join(k)}" for k, n in sorted(got.items()) if k in want and n == 0]
    if not want:
        problems.append("the listing holds no test")
    return problems


def vitest_listed(rows: list[dict]) -> dict[tuple[str, str], int]:
    """`vitest list --json`: [{name: 'a > b > title', file}] → counts."""
    out: dict[tuple[str, str], int] = {}
    for r in rows:
        key = (r["file"], r["name"])
        out[key] = out.get(key, 0) + 1
    return out


def vitest_ran(report: dict) -> dict[tuple[str, str], int]:
    out: dict[tuple[str, str], int] = {}
    for f in report.get("testResults", []):
        for a in f.get("assertionResults", []):
            key = (f["name"], " > ".join(a.get("ancestorTitles", []) + [a["title"]]))
            out[key] = out.get(key, 0) + 1
    return out


def vitest_retried(report: dict) -> list[str]:
    """A test that passed only on a later attempt: Vitest reports ONE
    assertion result, `passed`, whose failureMessages still hold the earlier
    attempts' failures (Codex R257, vitest 4.1.8). No PASS after a retry."""
    return [f"passed only after a failed attempt: {f['name']} > {' > '.join(a.get('ancestorTitles', []) + [a['title']])}"
            for f in report.get("testResults", []) for a in f.get("assertionResults", [])
            if a.get("status") == "passed" and a.get("failureMessages")]


def check_unit_executed(listed: list[dict], report: dict) -> list[str]:
    want, got = vitest_listed(listed), vitest_ran(report)
    problems = [f"listed, never ran: {f} > {n}" for (f, n) in sorted(set(want) - set(got))]
    problems += [f"ran, never listed: {f} > {n}" for (f, n) in sorted(set(got) - set(want))]
    problems += [f"listed {want[k]}, ran {got[k]}: {k[0]} > {k[1]}" for k in sorted(set(want) & set(got)) if want[k] != got[k]]
    problems += vitest_retried(report)
    if not want:
        problems.append("the listing holds no test")
    return problems


# ── Who ran each test, on which mock (per-worker mock, Codex R262 PM261-04) ──
def check_workers(report: dict, events: list[dict]) -> list[str]:
    """From the fixture's event log: every test of the report has its
    test-start and test-end on one slot, worker and mock instance; inside a
    worker process the tests run one after another; a mock instance has ONE
    owner worker; two workers active at once never share an instance. A
    missing event is a problem, never a skipped proof."""
    problems: list[str] = []
    bound = {e["instance"]: e for e in events if e.get("event") == "bound"}
    starts: dict[tuple, dict] = {}
    spans: list[tuple[float, float, int, str, tuple]] = []
    for e in events:
        if e.get("event") not in ("test-start", "test-end"):
            continue
        key = (e["file"], e["project"], e["title"], e.get("retry", 0))
        if e["event"] == "test-start":
            if key in starts:
                problems.append(f"started twice: {' | '.join(map(str, key))}")
            starts[key] = e
        else:
            s = starts.pop(key, None)
            if s is None:
                problems.append(f"ended, never started: {' | '.join(map(str, key))}")
            elif (s["workerIndex"], s["instance"]) != (e["workerIndex"], e["instance"]):
                problems.append(f"started and ended on different workers or mocks: {' | '.join(map(str, key))}")
            else:
                spans.append((s["t"], e["t"], s["workerIndex"], s["instance"], key))
    problems += [f"started, never ended: {' | '.join(map(str, k))}" for k in starts]
    ran = {(k[0], k[1], k[2]) for _, _, _, _, k in spans}
    for k in sorted(playwright_tests(report)):
        if k not in ran:
            problems.append(f"no worker event for: {' | '.join(k)}")
    owner: dict[str, int] = {}
    for _, _, w, inst, key in spans:
        if inst not in bound:
            problems.append(f"a test on a mock never bound: {inst}")
        if owner.setdefault(inst, w) != w:
            problems.append(f"mock {inst} owned by workers {owner[inst]} and {w}")
    by_worker: dict[int, list] = {}
    for a, b, w, inst, key in spans:
        by_worker.setdefault(w, []).append((a, b, key))
    for w, xs in by_worker.items():
        xs.sort()
        for (a1, b1, k1), (a2, b2, k2) in zip(xs, xs[1:]):
            if a2 < b1:
                problems.append(f"worker {w} ran two tests at once: {k1[2]} / {k2[2]}")
    return problems
