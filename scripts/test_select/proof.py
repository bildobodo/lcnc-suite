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


# ── Who ran each test, on which mock (per-worker mock, Codex R262 PM261-04, R263 PM263-02) ──
SLOT_BASE = 4500   # e2e/mockSlot.mjs: worker slot i's mock listens on SLOT_BASE + i


def playwright_results(report: dict) -> dict[tuple[str, str, str, int], dict]:
    """(file, project, title path, retry) → that result's workerIndex,
    parallelIndex and status, as the report gives them."""
    out: dict[tuple[str, str, str, int], dict] = {}

    def walk(suite: dict, path: tuple[str, ...]):
        for spec in suite.get("specs", []):
            for t in spec.get("tests", []):
                for r in t.get("results", []):
                    key = (spec["file"], t["projectName"], " › ".join(path + (spec["title"],)), r.get("retry", 0))
                    if key in out:
                        raise ValueError(f"two results share {key}")
                    out[key] = {"workerIndex": r.get("workerIndex"), "parallelIndex": r.get("parallelIndex"),
                                "status": r.get("status")}
        for s in suite.get("suites", []):
            walk(s, path + (s["title"],))

    for s in report.get("suites", []):
        walk(s, ())
    return out


def report_run(report: dict) -> str | None:
    """The run the report names (playwright.config.ts `metadata.run`)."""
    return (report.get("config") or {}).get("metadata", {}).get("run")


def check_report_run(report: dict, run: str) -> list[str]:
    """The report is the one of the run the gate started (Codex R263 PM263-02)."""
    named = report_run(report)
    if named is None:
        return ["the report names no run (config.metadata.run)"]
    return [] if named == run else [f"the report names run {named}, the gate ran {run}"]


def check_workers(report: dict, events: list[dict], run: str) -> list[str]:
    """From the fixture's event log, bound to ONE run (Codex R262 PM261-04,
    R263 PM263-02): every event carries that run; every mock instance is
    bound once, on its slot's port and endpoint, and stopped once by the
    same worker; every reported result has exactly one test-start/test-end
    pair with its retry, on the worker (`workerIndex`) and slot
    (`parallelIndex`) the report names, on the mock that worker bound, inside
    that mock's life; a pair no result reports is foreign; inside a worker
    the tests run one after another; on a slot the mocks follow each other
    (a replacement's tests never interleave with its predecessor's). A
    `skipped` result needs no pair (a static skip runs no fixture); if it
    has one, the pair must match it. Order is the log's LINE order — one
    append per event — never its clock (a stepped clock would reorder it).
    A missing event is a problem, never a skipped proof."""
    problems: list[str] = []
    name = lambda k: " | ".join(map(str, k))  # noqa: E731
    foreign: dict[str, int] = {}
    for e in events:
        if e.get("run") != run:
            foreign[str(e.get("run"))] = foreign.get(str(e.get("run")), 0) + 1
    problems += [f"{n} events of another run ({r}), not {run}" for r, n in sorted(foreign.items())]
    events = [e for e in events if e.get("run") == run]

    bound: dict[str, tuple[int, dict]] = {}
    stopped: dict[str, int] = {}
    for i, e in enumerate(events):
        inst = e.get("instance")
        if e.get("event") == "bound":
            if inst in bound:
                problems.append(f"mock {inst} bound twice")
                continue
            bound[inst] = (i, e)
            slot, port = e.get("slot"), e.get("port")
            if not isinstance(slot, int) or port != SLOT_BASE + slot:
                problems.append(f"mock {inst}: port {port} is not slot {slot}'s")
            if e.get("endpoint") != f"http://localhost:{port}/":
                problems.append(f"mock {inst}: endpoint {e.get('endpoint')} is not port {port}'s")
        elif e.get("event") == "stopped":
            b = bound.get(inst)
            if b is None:
                problems.append(f"stopped, never bound: {inst}")
            elif inst in stopped:
                problems.append(f"mock {inst} stopped twice")
            else:
                stopped[inst] = i
                if (e.get("slot"), e.get("workerIndex"), e.get("pid")) != (b[1]["slot"], b[1]["workerIndex"], b[1].get("pid")):
                    problems.append(f"mock {inst} stopped by another worker or slot than bound it")
    problems += [f"mock {inst} bound, never stopped" for inst in bound if inst not in stopped]

    starts: dict[tuple, tuple[int, dict]] = {}
    pairs: dict[tuple, dict] = {}
    open_on: dict[int, tuple] = {}
    slot_order: dict[int, list[str]] = {}
    for i, e in enumerate(events):
        if e.get("event") not in ("test-start", "test-end"):
            continue
        key = (e["file"], e["project"], e["title"], e.get("retry", 0))
        inst, w = e.get("instance"), e.get("workerIndex")
        b = bound.get(inst)
        if b is None:
            problems.append(f"a test on a mock never bound: {inst}")
        else:
            owner = b[1]
            if (e.get("slot"), w, e.get("pid")) != (owner["slot"], owner["workerIndex"], owner.get("pid")):
                problems.append(f"a test on mock {inst} from another worker or slot than bound it: {name(key)}")
            if not b[0] < i < stopped.get(inst, len(events)):
                problems.append(f"a test outside mock {inst}'s life: {name(key)}")
        order = slot_order.setdefault(e.get("slot"), [])
        if not order or order[-1] != inst:
            order.append(inst)
        if e["event"] == "test-start":
            if key in starts or key in pairs:
                problems.append(f"started twice: {name(key)}")
                continue
            if w in open_on:
                problems.append(f"worker {w} ran two tests at once: {open_on[w][2]} / {key[2]}")
            open_on[w] = key
            starts[key] = (i, e)
        else:
            if open_on.get(w) == key:
                del open_on[w]
            s = starts.pop(key, None)
            if s is None:
                problems.append(f"ended, never started: {name(key)}")
            elif (s[1]["workerIndex"], s[1]["instance"], s[1].get("slot")) != (w, inst, e.get("slot")):
                problems.append(f"started and ended on different workers or mocks: {name(key)}")
            else:
                pairs[key] = s[1]
    problems += [f"started, never ended: {name(k)}" for k in starts]
    for slot, order in sorted(slot_order.items(), key=lambda x: str(x[0])):
        if len(order) != len(set(order)):
            problems.append(f"slot {slot}: the tests of its mocks interleave ({' → '.join(order)})")

    results = playwright_results(report)
    for k, r in sorted(results.items()):
        p = pairs.get(k)
        if p is None:
            if r["status"] != "skipped":
                problems.append(f"no worker event for: {name(k)}")
        elif (p["workerIndex"], p.get("slot")) != (r["workerIndex"], r["parallelIndex"]):
            problems.append(f"worker {r['workerIndex']} slot {r['parallelIndex']} by the report, "
                            f"worker {p['workerIndex']} slot {p.get('slot')} by the events: {name(k)}")
    problems += [f"an event pair no result reports: {name(k)}" for k in sorted(set(pairs) - set(results))]
    return problems
