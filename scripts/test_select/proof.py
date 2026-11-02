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
