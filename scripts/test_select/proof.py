"""Proof that a selected browser run ran exactly the selection, in the full
run's order (Codex R248 TS248-03, R250: "the order of CLI file arguments is
no proof — the runner must produce and show it").

Before the run, `--list` of the select config against `--list` of the full
config: the same files as selected, each in the project the full config
gives it. After the run, the JSON report's start times: every project's tests
after the projects it follows in the full chain, and inside a serial project
one file after the other in path order.

Pure: reads the JSON reports and the full config's text, never runs anything.
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


def project_blocks(config_text: str) -> list[str]:
    """The text of each object in the config's `projects: [...]`."""
    at = config_text.index("projects: [") + len("projects: [")
    blocks, depth, begin, i = [], 0, None, at
    while i < len(config_text):
        c = config_text[i]
        if config_text.startswith("//", i):
            i = config_text.index("\n", i)
            continue
        if c == '"':
            i = config_text.index('"', i + 1) + 1
            continue
        if c == "{":
            if depth == 0:
                begin = i
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                blocks.append(config_text[begin: i + 1])
        elif c == "]" and depth == 0:
            return blocks
        i += 1
    raise ValueError("the config's projects list does not close")


def full_chain(config_text: str) -> list[tuple[str, bool]]:
    """(project, serial) of playwright.config.ts in run order: each project
    after the ones it depends on."""
    projects, deps = [], {}
    for block in project_blocks(config_text):
        name = re.search(r'\bname:\s*"([\w-]+)"', block)
        if not name:
            raise ValueError(f"a project without a name: {block[:60]}")
        d = re.search(r'\bdependencies:\s*\[([^\]]*)\]', block)
        deps[name.group(1)] = re.findall(r'"([\w-]+)"', d.group(1)) if d else []
        projects.append((name.group(1), re.search(r'\bworkers:\s*1\b', block) is not None))
    order, placed = [], set()
    while len(order) < len(projects):
        nxt = next((p for p in projects if p[0] not in placed and all(x in placed for x in deps[p[0]])), None)
        if nxt is None:
            raise ValueError("the full config's projects form no chain")
        order.append(nxt)
        placed.add(nxt[0])
    return order


def check_order(report: dict, chain: list[tuple[str, bool]]) -> list[str]:
    """Problems of a finished run's order: projects in chain order, and in a
    serial project file after file in path order."""
    runs: list[tuple[float, float, str, str]] = []   # start, end, project, file

    def walk(suite: dict):
        for spec in suite.get("specs", []):
            for t in spec.get("tests", []):
                for r in t.get("results", []):
                    start = _ms(r["startTime"])
                    runs.append((start, start + r.get("duration", 0), t["projectName"], spec["file"]))
        for s in suite.get("suites", []):
            walk(s)

    for s in report.get("suites", []):
        walk(s)
    if not runs:
        return ["the report holds no test results"]
    rank = {name: i for i, (name, _) in enumerate(chain)}
    serial = {name for name, s in chain if s}
    problems = []
    unknown = sorted({p for _, _, p, _ in runs if p not in rank})
    if unknown:
        return [f"projects outside the full chain: {unknown}"]
    span: dict[str, tuple[float, float]] = {}
    for start, end, p, _ in runs:
        lo, hi = span.get(p, (start, end))
        span[p] = (min(lo, start), max(hi, end))
    ran = sorted(span, key=rank.__getitem__)
    for a, b in zip(ran, ran[1:]):
        if span[b][0] < span[a][1]:
            problems.append(f"{b} began before {a} ended")
    for p in serial & set(span):
        files: dict[str, tuple[float, float]] = {}
        for start, end, q, f in runs:
            if q == p:
                lo, hi = files.get(f, (start, end))
                files[f] = (min(lo, start), max(hi, end))
        by_start = sorted(files, key=lambda f: files[f][0])
        if by_start != sorted(files):
            problems.append(f"{p}: files ran {by_start}, path order is {sorted(files)}")
        for a, b in zip(by_start, by_start[1:]):
            if files[b][0] < files[a][1]:
                problems.append(f"{p}: {b} began before {a} ended")
    return problems


def _ms(iso: str) -> float:
    from datetime import datetime
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000


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
