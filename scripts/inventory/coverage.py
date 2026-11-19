#!/usr/bin/env python3
"""The coverage of one gate run: the function inventory × the cases it ran
(replay step 5c; Codex FI265-03, R389 5c, R390–R392).

    python3 -I scripts/inventory/coverage.py --gate <gate-merge.json> \\
        [--native-report <report.json> ...] [--live-report <perf_matrix.json> ...] \\
        [--out coverage.json] [--md coverage.md]

Per function, five kinds of evidence, kept apart (FI265-03) — never a
percentage, every gap by name:
  inventoried  its atoms (claims resolved against the adapters)
  triggered    each of its command and route atoms seen or not, in a PASSED
               attempt of the run: a command by its valid frames (an
               expected refusal is the payload checker's counter-check, not
               a trigger), a route by its response path from step 5b
               ("served" is served BY THE MOCK — never gateway evidence)
  checked      each statement's evidence bound to LISTED test ids of the run
               (file, title path, project; a fragment or a template binds by
               the rules of the R393 dry run) and their results: passed
               only when every bound test passed; skipped, failed, not run,
               not at this commit and not proven stay apart
  counter      the payload checker's expected refusals of its commands and
               the native counter rows of its evidence
  native       its native evidence from a report of THIS commit
Red (an evaluation error, never a gap): an artefact of the run missing, an
evidence that binds to no listed test ("not collected"), a report given as
run evidence missing or malformed, a script binding that does not resolve.
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import functions  # noqa: E402
import live_drivers  # noqa: E402

ROOT = HERE.parents[1]
PARAM = re.compile(r"\$\{[^}]+\}|\$[A-Za-z_][\w.]*|%[sdifjoO]|\{[A-Za-z_]\w*\}")
PROJECTS = (("e2e", "list-run.json", "playwright.json"), ("firefox-core", "firefox-list.json", "firefox.json"))
EVIDENCE = frozenset({"served", "fetched"})


# ── reading the run ─────────────────────────────────────────────────────────

def _json(path: Path, missing: list[str]) -> Any:
    try:
        return live_drivers.loads_strict(path.read_text())
    except live_drivers.DuplicateKey as e:
        # json would keep the last of a repeated key: reported AND withheld (R402)
        missing.append(f"{path.name}: {e} — a damaged artefact, withheld")
        return None
    except (OSError, ValueError) as e:
        missing.append(f"{path.name}: {type(e).__name__} — an artefact of the run is missing")
        return None


def _pw_status(t: dict) -> str:
    """A Playwright test's outcome from the reporter's own fields (Codex R396
    VM-I34): passed only when it was expected to pass and its last result
    passed; a test.fail() that failed as expected is "expected to fail" —
    named, never passed; a test without a result is "listed"."""
    res = t.get("results") or []
    if not res:
        return "listed"
    exp, st, last = t.get("expectedStatus"), t.get("status"), res[-1].get("status")
    if exp == "failed":
        return "expected to fail"
    if st == "expected":
        if exp == "passed" and last == "passed":
            return "passed"
        if exp == "skipped":
            return "skipped"
        return f"contradictory (expected {exp}, last result {last})"
    return {"unexpected": "failed", "skipped": "skipped", "flaky": "flaky"}.get(st, str(st))


def _join(listed: dict, ran: dict | None) -> dict:
    """A test of the listing joined with its result: an identity found invalid
    on EITHER side stays invalid (Codex R401) — a clean report never replaces
    a contradictory listing; its results admit no replay attempt."""
    if str(listed.get("status", "")).startswith("contradictory"):
        return {**listed, "results": {}}
    if ran is None:
        return {**listed, "status": "listed", "results": {}}
    return {**listed, "status": ran["status"], "results": ran["results"]}


def run_of(doc: Any) -> Any:
    """The run id a Playwright record carries (config.metadata.run)."""
    return ((doc.get("config") or {}).get("metadata") or {}).get("run") if isinstance(doc, dict) else None


def playwright_index(report: dict, label: str, errors: list[str]) -> dict[tuple, dict]:
    """(test id, project) → {file, path, status, results: {retry: status}} —
    every instance apart: a repeat is its own id (VM-I34); the same id twice
    in one record is an evaluation error, never an overwrite."""
    out: dict[tuple, dict] = {}

    def walk(suite: dict, path: list[str]) -> None:
        for sp in suite.get("specs", []):
            for t in sp.get("tests", []):
                key = (sp.get("id"), t.get("projectName"))
                if key in out:
                    # an id twice: neither instance is evidence (R400 — reported AND withheld)
                    errors.append(f"{label}: test id {key[0]} [{key[1]}] twice — one instance would hide another")
                    out[key] = {**out[key], "status": "contradictory (the id twice)", "results": {}}
                    continue
                retries = Counter(r.get("retry") for r in t.get("results") or [])
                status = _pw_status(t)
                if any(n > 1 for n in retries.values()):
                    # two results for one retry: one would overwrite the other (R398 VM-I33 B);
                    # that retry admits nothing (R400)
                    errors.append(f"{label}: test id {key[0]} [{key[1]}] has two results for one retry {sorted(retries.elements(), key=str)}")
                    status = f"contradictory (two results for one retry: {sorted(retries.elements(), key=str)})"
                out[key] = {"file": sp.get("file"), "path": " › ".join(path + [sp.get("title", "")]),
                            "status": status,
                            "results": {r.get("retry"): r.get("status") for r in t.get("results") or []
                                        if retries[r.get("retry")] == 1}}
        for sub in suite.get("suites", []):
            walk(sub, path + [sub.get("title", "")])
    for s in report.get("suites", []):
        walk(s, [])
    return out


_VITEST = {"passed": "passed", "failed": "failed", "skipped": "skipped", "pending": "skipped", "todo": "skipped"}


def vitest_index(listing: list, report: dict | None, label: str, errors: list[str]) -> dict[tuple, str]:
    """(file relative to lcnc-webui/src, full name) → status. The LISTING is
    the collected set (VM-I33): a result outside it is an evaluation error; a
    name the listing holds n times needs exactly n results (Codex R401 — a
    missing or an extra result is no complete run: an evaluation error, the
    test contradictory, never passed) and takes the worst of them."""
    want: Counter = Counter((x["file"].split("/lcnc-webui/src/")[-1], x["name"]) for x in listing)
    out: dict[tuple, str] = {k: "listed" for k in want}
    got: Counter = Counter()
    for f in (report or {}).get("testResults", []):
        rel = f["name"].split("/lcnc-webui/src/")[-1]
        for a in f.get("assertionResults", []):
            key = (rel, " > ".join(a.get("ancestorTitles", []) + [a["title"]]))
            st = _VITEST.get(a.get("status"), str(a.get("status")))
            if key not in out:
                errors.append(f"{label}: {key[0]} › {key[1][:80]} — a result for a test the listing does not hold")
                continue
            got[key] += 1
            out[key] = _worst(out[key], st) if got[key] > 1 else st
    for key, n in got.items():
        if n != want[key]:
            errors.append(f"{label}: {key[0]} › {key[1][:80]} — {n} result(s) for {want[key]} listed test(s)")
            out[key] = f"contradictory ({n} results for {want[key]} listed)"
    return out


_RANK = {"passed": 0, "skipped": 1, "failed": 2}
_NATIVE_RANK = {"PASS": 0, "SKIP": 1, "incomplete": 2, "FAIL": 3}


def _worst(a: str, b: str) -> str:
    return a if _RANK.get(a, 3) >= _RANK.get(b, 3) else b


def junit_suites(path: Path) -> set[str]:
    """The suite names of the backend step's JUnit — the gate names its run
    there (`junit_suite_name`)."""
    return {s.get("name", "") for s in ET.parse(path).getroot().iter("testsuite")}


def junit_tests(path: Path) -> dict[tuple, str]:
    """(test file, node id) → status from the backend step's JUnit XML."""
    out = {}
    for tc in ET.parse(path).getroot().iter("testcase"):
        cls, name = tc.get("classname", ""), tc.get("name", "")
        mod = cls.split(".")[0]
        node = "::".join([mod + ".py", *cls.split(".")[1:], name])
        st = "passed"
        for child in tc:            # the worst child: a failing subtest marks its parent test (probed)
            st = _worst(st, {"failure": "failed", "error": "failed", "skipped": "skipped"}.get(child.tag, st))
        key = (mod + ".py", node)
        out[key] = _worst(out.get(key, "passed"), st)
    return out


# ── binding evidence to listed tests ────────────────────────────────────────

def _as_regex(title: str) -> re.Pattern:
    parts, pos = [], 0
    for m in PARAM.finditer(title):
        parts += [re.escape(title[pos:m.start()]), "(.+?)"]
        pos = m.end()
    parts.append(re.escape(title[pos:]))
    return re.compile("^" + "".join(parts) + "$")


def bind(e: dict, cands: list[tuple[Any, list[str]]]) -> tuple[list, str]:
    """The listed tests an evidence binds to — or why none (the R393 dry run's
    rules): a template as a whole-title regex whose captures must equal each
    declared instance (or the instance as vitest renders a string, 'x'),
    never a substring; else the exact title or title path; else a fragment."""
    t, inst = e["title"], e.get("instances")
    if inst or PARAM.search(t):
        rx, bound, caps = _as_regex(t), [], set()
        for key, titles in cands:
            m = next((rx.match(x) for x in titles if rx.match(x)), None)
            if m:
                bound.append(key)
                caps.update(m.groups())
        caps |= {c[1:-1] for c in caps if len(c) > 1 and c[0] == c[-1] == "'"}
        missing = [i for i in (inst or []) if i not in caps]
        return (bound, f"instance(s) {missing} bind no listed test") if missing else (bound, "" if bound else "no listed test matches the template")
    exact = [key for key, titles in cands if t in titles]
    if exact:
        return exact, ""
    frag = [key for key, titles in cands if any(t in x for x in titles)]
    return frag, "" if frag else "not collected — no listed test of that title"


def _shown(tests: dict[tuple, dict], keys: list) -> list[str]:
    return [f"{tests[k]['file']} › {tests[k]['path']} [{k[0]}]" for k in keys]


def verdict(statuses: list[str]) -> str:
    """passed only when EVERY bound status is exactly passed — a status this
    report does not know is never passed (R396 pre-bell)."""
    if not statuses:
        return "not collected"
    for s in ("failed", "flaky", "expected to fail", "skipped", "listed"):
        if s in statuses:
            return {"listed": "not run", "flaky": "failed"}.get(s, s)
    odd = sorted({s for s in statuses if s != "passed"})
    return f"unknown status {odd}" if odd else "passed"


def _native_worst(statuses: list) -> str:
    """The worst of a case's rows over every report of this commit — a later
    row or report never hides an earlier failure (VM-I34's class)."""
    odd = sorted({str(s) for s in statuses if s not in _NATIVE_RANK})
    return f"unknown status {odd}" if odd else max(statuses, key=lambda s: _NATIVE_RANK[s])


def replay_attempts(project: str, r: dict | None, listed: dict[tuple, dict], ref: Any,
                    errors: list[str]) -> set[str] | None:
    """The names of a replay's attempts that may count as triggers (Codex R396
    VM-I33): a GREEN replay of THIS run, the attempt unique, passed, its test
    a listed test of this project with the report's result at that retry
    "passed". Anything else is an evaluation error — a counted attempt name
    the attempt list does not hold too."""
    if r is None:
        return None
    label = "replay.json" if project == "e2e" else "firefox-replay.json"
    if r.get("verdict") != "PASS" or r.get("findings"):
        errors.append(f"{label}: verdict {r.get('verdict')!r}, {len(r.get('findings') or [])} finding(s) — "
                      "a red replay is no source of triggers")
        return None
    if not ref:
        errors.append(f"{label}: this project has no known run id — no attempt is admitted (R402)")
        return None
    if r.get("run") != ref:
        errors.append(f"{label}: run {r.get('run')!r}, this run {ref!r} — another run's replay")
        return None
    attempts = r.get("attempt_list", [])
    names = Counter(a.get("name") for a in attempts)
    for n, k in names.items():
        if k > 1:
            errors.append(f"{label}: attempt {str(n)[:80]} listed {k} times")
    # the identity is (run, test id, project, retry), never the readable name:
    # one attempt under two names would count twice (R398 VM-I33 A)
    ident = Counter((r.get("run"), a.get("test"), a.get("project"), a.get("retry")) for a in attempts)
    for i, k in ident.items():
        if k > 1:
            errors.append(f"{label}: attempt identity test {i[1]} [{i[2]}] retry {i[3]} listed {k} times")
    ok: set[str] = set()
    for a in attempts:
        if (a.get("status") != "passed" or names[a.get("name")] != 1
                or ident[(r.get("run"), a.get("test"), a.get("project"), a.get("retry"))] != 1):
            continue
        t = listed.get((a.get("test"), a.get("project")))
        if a.get("project") != project or t is None:
            errors.append(f"{label}: {str(a.get('name'))[:80]} — test {a.get('test')} [{a.get('project')}] "
                          "is no listed test of this run")
            continue
        got = t["results"].get(a.get("retry"))
        if got != "passed":
            errors.append(f"{label}: {str(a.get('name'))[:80]} passed in the replay; the report has {got!r} "
                          f"at retry {a.get('retry')}")
            continue
        ok.add(a["name"])
    counted = (set(r.get("per_attempt", {})) | set(r.get("per_attempt_expected", {}))
               | set((r.get("http_paths") or {}).get("per_attempt", {}))
               | {x.get("where") for x in r.get("expected", []) if x.get("where") not in (None, "?")})
    for att in sorted(str(x) for x in counted - set(names)):
        errors.append(f"{label}: {att[:80]} counted, not in its attempt list")
    return ok


def _literal(path: Path, name: str) -> Any:
    """A module-level literal (`NAME = …` / `NAME: T = …`) read by ast, never
    imported — the run's tree may not be this interpreter's."""
    for n in ast.parse(path.read_text()).body:
        targets = n.targets if isinstance(n, ast.Assign) else [n.target] if isinstance(n, ast.AnnAssign) else []
        if any(getattr(x, "id", "") == name for x in targets) and n.value is not None:
            return ast.literal_eval(n.value)
    raise LookupError(f"{path.name} declares no {name}")


def _rel(f: str) -> str:
    return f.split("/lcnc-webui/src/")[-1]


#: an expected failure's state, ordered: a later record never lowers it (R400)
_FAILS_RANK = {"plain": 0, "fails": 1, "unknown": 2}


def vitest_options(opts: Any, listed: Counter, label: str, errors: list[str]) -> dict[tuple, str]:
    """(file relative to lcnc-webui/src, full name) → "plain" | "fails" |
    "unknown" for exactly this group's listed tests — the RESOLVED option the
    run wrote (vitest_options_reporter.mjs, R398 VM-I34): Vitest's JSON report
    reads `it.fails` as passed with no mark. A record needs a file and a full
    name as strings and `fails` as a boolean; the group's records must be its
    listing's, one per listed test (a name the listing holds twice needs two);
    anything else is an evaluation error and leaves the test unknown — never
    plain (R400)."""
    out = {k: "unknown" for k in listed}
    if opts is None:
        return out                                  # a missing file: _json said so
    if not isinstance(opts, list):
        errors.append(f"{label}: no list of test option records")
        return out
    seen: Counter = Counter()
    fails: dict[tuple, list[bool]] = defaultdict(list)
    broken: set = set()
    for x in opts:
        named = isinstance(x, dict) and isinstance(x.get("file"), str) and isinstance(x.get("fullName"), str)
        key = (_rel(x["file"]), x["fullName"]) if named else None
        if not named or not isinstance(x.get("fails"), bool):
            errors.append(f"{label}: a record without a file, a full name and a boolean fails: {str(x)[:100]}")
            if key is not None:
                broken.add(key)
            continue
        if key not in listed:
            errors.append(f"{label}: options of {key[0]} › {str(key[1])[:80]} — a test this group's listing does not hold")
            continue
        seen[key] += 1
        fails[key].append(x["fails"])
    for key, n in listed.items():
        if key in broken or seen[key] != n:
            if key not in broken:
                errors.append(f"{label}: {key[0]} › {str(key[1])[:80]}: {seen[key]} option record(s) for {n} listed "
                              "test(s) — its expected failure unknown")
            out[key] = "unknown"
        else:
            out[key] = "fails" if any(fails[key]) else "plain"
    return out


def _sites(sides: tuple, key: str) -> list[dict]:
    return [{"side": side, "adapter": n, **x} for side, s in sides for n, a in s["adapters"].items() for x in a.get(key, [])]


# ── the report ─────────────────────────────────────────────────────────────

def coverage(gate_path: Path, native_paths: list[Path], live_paths: list[Path], root: Path = ROOT) -> dict:
    """From a gate's record (its head and kind) and its logs folder."""
    gate = live_drivers.loads_strict(gate_path.read_text())
    return coverage_of(gate_path.with_suffix(".logs"), gate.get("head", ""), gate.get("kind", ""),
                       native_paths, live_paths, root, gate_path.name, runs=gate_runs(gate.get("checks", [])))


#: the gate's checks that name each set's run id (round_gate / firefox)
RUN_CHECKS = {"e2e": "browser-workers", "firefox-core": "firefox-workers", "backend": "backend"}


@dataclass(frozen=True)
class RunConflict:
    """The gate names one set's run check more than once: no reference — the
    order of two sources never chooses (Codex R402 VM-I33)."""
    check: str
    runs: tuple


def gate_runs(checks: list[dict]) -> dict[str, Any]:
    """The run ids the gate itself made — the known ids every record of the
    run must carry (Codex R396 VM-I33); a check name twice is a RunConflict."""
    out: dict[str, Any] = {}
    for k, v in RUN_CHECKS.items():
        named = [c for c in checks if isinstance(c, dict) and c.get("name") == v]
        out[k] = (RunConflict(v, tuple(c.get("run") for c in named)) if len(named) > 1
                  else named[0].get("run") if named else None)
    return out


def _reference(ref: Any, what: str, errors: list[str]) -> Any:
    """A run reference as evidence may use it: a known id, or None (said why).
    A missing id is no identity even where it is missing everywhere — None ==
    None binds nothing (Codex R402 VM-I33 B)."""
    if isinstance(ref, RunConflict):
        errors.append(f"{what}: the gate names {ref.check} {len(ref.runs)} times (runs {list(ref.runs)}) — "
                      "a contradictory reference binds nothing")
        return None
    if not ref:
        errors.append(f"{what}: no known run id — nothing binds to an unknown run")
        return None
    return ref


def coverage_of(logs: Path, head: str, kind: str, native_paths: list[Path], live_paths: list[Path],
                root: Path = ROOT, label: str = "", runs: dict[str, Any] | None = None) -> dict:
    """The coverage of a run from its logs folder — the merge gate calls this
    before its own record is written, with the run ids it made (`runs`).
    Without them (a run evaluated after the fact) each listing's own run id is
    the reference, and the backend's JUnit is not compared — said so."""
    gate = {"kind": kind, "head": head}
    errors: list[str] = []
    web, py, fns = functions.load(root)
    ids = functions.atom_ids(web, py)

    # the run's artefacts — every one required; the LISTINGS are the collected
    # sets and every record carries this run's id (Codex R396 VM-I33)
    tests: dict[str, dict[tuple, dict]] = {}
    refs: dict[str, Any] = {}
    for project, listing, report in PROJECTS:
        lst, rep = _json(logs / listing, errors), _json(logs / report, errors)
        ref = _reference((runs or {}).get(project) if runs is not None else run_of(lst),
                         f"{project} ({'the gate' if runs is not None else listing})", errors)
        foreign = set()
        for name, doc in ((listing, lst), (report, rep)):
            if ref is None:
                foreign.add(name)            # an unknown reference: nothing of this set binds (R402)
            elif doc is not None and run_of(doc) != ref:
                errors.append(f"{name}: run {run_of(doc)!r}, this run {ref!r} — another run's record")
                foreign.add(name)
        # another run's record is reported AND withheld: none of its tests or
        # results is evidence of this run (R400)
        listed = playwright_index(lst if lst is not None and listing not in foreign else {}, listing, errors)
        ran = playwright_index(rep if rep is not None and report not in foreign else {}, report, errors)
        for key, x in listed.items():
            if key[1] != project:
                errors.append(f"{listing}: {x['file']} › {x['path'][:80]} is of project {key[1]!r}, not {project}")
        for key, x in ran.items():
            have = listed.get(key)
            if have is None:
                errors.append(f"{report}: {x['file']} › {x['path'][:80]} [{key[0]}] — a result for a test the "
                              "listing does not hold")
            elif (have["file"], have["path"]) != (x["file"], x["path"]):
                errors.append(f"{report}: test {key[0]} is {x['file']} › {x['path'][:60]}, the listing's "
                              f"{have['file']} › {have['path'][:60]}")
                ran[key] = {**x, "status": "contradictory (the report names another test)", "results": {}}
        tests[project] = {k: _join(v, ran.get(k)) for k, v in listed.items() if k[1] == project}
        refs[project] = ref
    unit: dict[tuple, str] = {}
    unit_fails: dict[tuple, str] = {}
    for name in ("unit-light", "unit-heavy"):
        lst = logs / f"{name}.list.json"
        if name == "unit-heavy" and not lst.is_file() and gate.get("kind") != "merge":
            continue
        listing_doc = _json(lst, errors) or []
        part = vitest_index(listing_doc, _json(logs / f"{name}.json", errors), f"{name}.json", errors)
        listed = Counter((_rel(str(x.get("file", ""))), x.get("name")) for x in listing_doc if isinstance(x, dict))
        state = vitest_options(_json(logs / f"{name}.options.json", errors), listed, f"{name}.options.json", errors)
        for key, st in part.items():           # across the groups: never lowered (R401, as the options)
            unit[key] = st if key not in unit else _worst(unit[key], st)
        for key, s in state.items():          # across the groups: never lowered (R400)
            unit_fails[key] = max(unit_fails.get(key, "plain"), s, key=_FAILS_RANK.__getitem__)
    junit = logs / "backend" / "backend.junit.xml"
    gw = junit_tests(junit) if junit.is_file() else {}
    # the backend's reference normalised ONCE — for the JUnit and for the report (a RunConflict
    # reached the report raw and broke its serialisation, Codex R403)
    bref = _reference(runs.get("backend"), "backend (the gate)", errors) if runs is not None else None
    if not junit.is_file():
        errors.append(f"{junit.name}: an artefact of the run is missing")
    elif runs is not None and bref is None:
        gw = {}                                    # an unknown reference binds nothing (R402)
    elif runs is not None and junit_suites(junit) != {bref}:
        errors.append(f"{junit.name}: suite {sorted(junit_suites(junit))}, this run {bref!r} — "
                      "another run's JUnit")
        gw = {}                                    # reported AND withheld (R400)
    # each project's replay apart (R389: Chromium and Firefox stay distinguishable)
    replays = {"e2e": _json(logs / "replay.json", errors), "firefox-core": _json(logs / "firefox-replay.json", errors)}

    natives = []
    for p in native_paths:
        r, why = live_drivers.load_report(p)
        if r is None:
            errors.append(f"native report {why} — a run claimed and not shown")
        elif not all(k in r for k in ("commit", "profile", "rows")):
            errors.append(f"native report {p}: no commit, profile or rows")
        elif not isinstance(r["rows"], list) or not all(isinstance(x, dict) for x in r["rows"]):
            # present but damaged: an evaluation error, never a traceback (VM-I36's class)
            errors.append(f"native report {p}: rows is no list of row objects")
        else:
            natives.append(r)
    lives = []
    for p in live_paths:
        r, why = live_drivers.load_report(p)
        if r is None:
            errors.append(f"live report {why} — a run claimed and not shown")
        else:
            lives.append(r)
    # native evidence binds to the DECLARED cases of its variant and a
    # profile of native_run (VM-I35 — a string somewhere is no case); every
    # native report of this commit is held against that set
    try:
        declared = {k: set(v) for k, v in _literal(root / "scripts/test_support/native_cases.py", "REPORT_CASES").items()}
        profiles = set(_literal(root / "scripts/native_run.py", "PROFILES"))
    except (OSError, LookupError, ValueError, SyntaxError) as e:
        errors.append(f"the native declarations: {type(e).__name__}: {e}")
        declared, profiles = {}, set()
    rejected: set = set()          # (profile, variant) of THIS commit's rejected reports (R400)
    valid: list[dict] = []
    for r in natives:
        if r.get("commit") != head:
            valid.append(r)            # no evidence anyway (another commit): kept for the counter rows' naming
            continue
        v = r.get("variant")
        # the report's own identity before its completeness — the same the
        # evidence search uses (R398 VM-I35): a known profile, every row of
        # the report's variant
        if r.get("profile") not in profiles:
            errors.append(f"native report {r.get('run_id', '')}: profile {r.get('profile')!r} is no native_run profile")
            rejected.add((r.get("profile"), v))
            continue
        other = sorted({str(row.get("case")) for row in r["rows"] if row.get("variant") != v})
        if other:
            errors.append(f"native report (variant {v}): rows of another variant {other[:10]}")
            rejected.add((r.get("profile"), v))
            continue
        if v not in declared:
            errors.append(f"native report {r.get('run_id', '')}: variant {v!r} declares no cases")
            rejected.add((r.get("profile"), v))
            continue
        twice = sorted(str(c) for c, n in Counter(row.get("case") for row in r["rows"]).items() if n > 1)
        if twice:
            # a case twice in one report: one row would stand for another (R402 class check)
            errors.append(f"native report (variant {v}): case(s) {twice[:10]} twice")
            rejected.add((r.get("profile"), v))
            continue
        got = {row.get("case") for row in r.get("rows", [])}
        extra, missing = sorted(str(c) for c in got - declared[v]), sorted(declared[v] - got)
        if extra:
            errors.append(f"native report (variant {v}): rows of undeclared case(s) {extra}")
        if missing and not r.get("error"):
            errors.append(f"native report (variant {v}): a complete run without {missing}")
        if extra or (missing and not r.get("error")):
            rejected.add((r.get("profile"), v))
            continue
        valid.append(r)
    natives = valid                    # the evidence search reads only what passed (R400)

    # triggered: commands and routes from PASSED attempts, per project; the
    # gap is judged on the full Chromium run (the Firefox core is a subset)
    sent: dict[str, dict[str, Counter]] = {p: defaultdict(Counter) for p in replays}
    refused: dict[str, list] = defaultdict(list)
    routes: dict[str, dict[str, Counter]] = {p: defaultdict(Counter) for p in replays}
    for project, r in replays.items():
        if not r:
            continue
        passed = replay_attempts(project, r, tests[project], refs.get(project), errors)
        if passed is None:
            continue
        exp = r.get("per_attempt_expected", {})
        for att, counts in r.get("per_attempt", {}).items():
            if att not in passed:
                continue
            for key, n in counts.items():
                valid = n - exp.get(att, {}).get(key, 0)
                if valid > 0:
                    sent[project][key.split(":")[0]][key] += valid
        # an expected refusal is counter-evidence only of an attempt that
        # counts — a failed or unlisted one's is none (VM-I33's class)
        for x in r.get("expected", []):
            if x.get("where") in passed:
                refused[x.get("cmd")].append(x)
        for att, rows in r.get("http_paths", {}).get("per_attempt", {}).items():
            if att not in passed:
                continue
            for row in rows:
                if row.get("what", "").split(" ")[0] in ("GET", "POST", "PUT", "DELETE"):
                    routes[project][row["what"]][row["class"]] += row["n"]

    out_fns, gaps = [], []
    for f in fns["functions"]:
        problems: list[str] = []
        atoms = sorted(functions.claimed(f["atoms"], list(ids), f["id"], problems))
        cmds = [a[4:] for a in atoms if a.startswith("cmd:")]
        rts = [a[5:] for a in atoms if a.startswith("http:") and a[5:].split(" ")[0] in ("GET", "POST", "PUT", "DELETE")]
        trig_c = {c: {p: dict(sent[p][c]) if sent[p].get(c) else "not sent" for p in replays} for c in cmds}
        trig_r = {rt: {p: ({("served by the mock" if k == "served" else k): v for k, v in routes[p][rt].items()}
                           if routes[p].get(rt) else "not requested") for p in replays} for rt in rts}
        gaps += [{"function": f["id"], "kind": "triggered", "item": f"cmd:{c}", "why": "not sent in a passed Chromium attempt"}
                 for c, v in trig_c.items() if v["e2e"] == "not sent"]
        gaps += [{"function": f["id"], "kind": "triggered", "item": f"http:{r}",
                  "why": "not requested" if v["e2e"] == "not requested"
                  else "never answered by a server (" + ", ".join(sorted(v["e2e"])) + ")"}
                 for r, v in trig_r.items() if v["e2e"] == "not requested" or not (set(routes["e2e"].get(r, {})) & EVIDENCE)]
        stmts, counter_native, native = [], [], []
        for s in f.get("statements", []):
            ev_out = []
            for e in s["evidence"]:
                row: dict[str, Any] = {"layer": e["layer"], "file": e["file"], "title": e["title"]}
                if e["layer"] == "browser":
                    for project in ("e2e", "firefox-core"):
                        cands = [(k, [v["path"].split(" › ")[-1], v["path"]]) for k, v in tests[project].items()
                                 if v["file"] == e["file"]]
                        if not cands and project == "firefox-core":
                            continue
                        bound, why = bind(e, cands)
                        if why and project == "firefox-core":
                            # the core is a SUBSET of the full run by title: a title
                            # or an instance outside it is named, never red
                            ev_out.append({**row, "project": project, "bound": _shown(tests[project], bound),
                                           "status": "not in the Firefox core", "why": why})
                            continue
                        st = verdict([tests[project][k]["status"] for k in bound]) if not why else "not collected"
                        ev_out.append({**row, "project": project, "bound": _shown(tests[project], bound),
                                       "status": st, **({"why": why} if why else {})})
                        if st == "not collected":
                            errors.append(f"{f['id']}.{s['id']}: {e['file']} › {e['title'][:80]} [{project}]: {why}")
                    continue
                if e["layer"] == "unit":
                    cands = [(k, [k[1].split(" > ")[-1], k[1]]) for k in unit if k[0] == e["file"]]
                    bound, why = bind(e, cands)
                    st = verdict([unit[k] for k in bound]) if not why else "not collected"
                    states = {unit_fails.get(k, "unknown") for k in bound}
                    if not why and "fails" in states:
                        why = ("a bound test declares an expected failure — Vitest's JSON report reads it as "
                               "passed (R398 VM-I34)")
                        st = "expected to fail"
                    elif not why and "unknown" in states:
                        why = "a bound test's expected failure is unknown — no valid options record (R400)"
                        st = "unknown"
                    row |= {"bound": [k[1] for k in bound], "status": st, **({"why": why} if why else {})}
                elif e["layer"] == "gateway":
                    bound = [k for k in gw if k[0] == e["file"] and k[1].split("::")[-1].split("[")[0] == e["title"]]
                    st = verdict([gw[k] for k in bound])
                    row |= {"bound": [k[1] for k in bound], "status": st}
                    why = "" if bound else "not collected — no node of that name in the backend step"
                elif e["layer"] == "native":
                    v = e.get("variant")
                    hits = [rw for r in natives if r.get("commit") == head and r.get("profile") == e.get("profile")
                            and r.get("variant") == v
                            for rw in r.get("rows", []) if rw.get("case") == e["title"] and rw.get("variant") == v]
                    st = (_native_worst([rw.get("status") for rw in hits]) if hits
                          else "invalid report of this commit" if (e.get("profile"), v) in rejected
                          else "not at this commit")
                    row |= {"profile": e.get("profile"), "variant": v, "status": st}
                    why = ("" if e["title"] in declared.get(v, ()) and e.get("profile") in profiles
                           else f"profile {e.get('profile')!r} is no native_run profile" if e.get("profile") not in profiles
                           else f"no declared case {e['title']!r} of variant {v!r} (native_cases.REPORT_CASES)")
                    native.append(row)
                    # a counter row: the report's own flag when this commit's report
                    # has the row; without one, by its name — and said so
                    if hits:
                        if any(h.get("counter") is True for h in hits):
                            counter_native.append({**row, "basis": "the report's counter flag"})
                    elif ".counter-" in e["title"] or e["title"].endswith(".delayed-order"):
                        counter_native.append({**row, "basis": "by its name (no report of this commit)"})
                elif e["layer"] == "script":
                    j = live_drivers.judge(e, root, lives, head)
                    row |= {"status": j["status"], **({"why": j["why"]} if j.get("why") else {})}
                    why = "" if j["resolved"] and j["status"] != "error" else j["why"]
                else:
                    why = f"unknown layer {e['layer']}"
                if why:
                    errors.append(f"{f['id']}.{s['id']}: {e['layer']} {e['file']} › {e['title'][:80]}: {why}")
                ev_out.append(row)
            in_gate = [x for x in ev_out if x["layer"] in ("browser", "unit", "gateway")
                       and x.get("status") != "not in the Firefox core"]
            checked = bool(in_gate) and all(x["status"] == "passed" for x in in_gate)
            stmts.append({"id": s["id"], "kind": s["kind"], "text": s["text"], "evidence": ev_out,
                          "checked": "passed" if checked else "open"})
            if not checked:
                gaps.append({"function": f["id"], "kind": "checked", "item": s["id"],
                             "why": "no gate evidence" if not in_gate else ", ".join(sorted({x['status'] for x in in_gate if x['status'] != 'passed'}))})
        counter = {"payload checker": [{"cmd": c, "refusals": len(refused[c])} for c in cmds if refused.get(c)],
                   "native counter rows": counter_native}
        roles = (f.get("feature") or {}).get("roles", {})
        out_fns.append({"id": f["id"], "name": f["name"], "area": f["area"],
                        "inventoried": {"atoms": atoms, "variants": sorted(c for c, r in roles.items() if r == "variant"),
                                        "problems": problems},
                        "triggered": {"commands": trig_c, "routes": trig_r},
                        "statements": stmts, "counter": counter, "native": native})
    comp = functions.completeness(web, py)
    sides = (("web", web), ("py", py))
    inventory = {"complete": comp["complete"], "atoms": len(ids),
                 "unresolved": [{"adapter": n, "site": u} for n, u in comp["unresolved"]],
                 "excluded": _sites(sides, "excluded"), "variantsOpen": _sites(sides, "variantsOpen"),
                 "level": "the source inventory: an open variant is a site whose members are not derived — "
                          "assigned to no function, counted apart from the gaps (Codex R396 VM-I37)"}
    return {
        "verdict": "FAIL" if errors else "PASS", "head": head, "gate": label or logs.name,
        "runs": {**refs, "backend": bref} if runs is not None else {**refs, "given": False},
        "inventory": inventory,
        "functions": out_fns, "gaps": gaps, "errors": errors,
        "payload_checker_refusals": sum(len(v) for v in refused.values()),
        "notes": ["the payload checker's counter-check: replay_refusals.json lists what is expected; "
                  + ("none was expected in this run" if not refused else f"{sum(len(v) for v in refused.values())} expected"),
                  "mutation records of the packages are bound to no statement — outside this report",
                  "native evidence needs a report of THIS commit (--native-report); without one it is 'not at this commit'",
                  "run ids " + ("from the gate" if runs is not None
                                else "not given: each listing's own is the reference; the backend's JUnit is not compared")],
    }


def markdown(c: dict) -> str:
    lines = [f"# Coverage at `{c['head'][:8]}` — {c['verdict']}", "",
             f"{len(c['functions'])} functions; {len(c['gaps'])} gaps by name; {len(c['errors'])} evaluation errors.", ""]
    if c["errors"]:
        lines += ["## Evaluation errors", ""] + [f"- {e}" for e in c["errors"]] + [""]
    lines += ["## Gaps", ""]
    by: dict[str, list] = defaultdict(list)
    for g in c["gaps"]:
        by[g["function"]].append(g)
    for fid, gs in by.items():
        lines.append(f"- **{fid}:** " + "; ".join(f"{g['kind']} {g['item']} ({g['why']})" for g in gs))
    inv = c.get("inventory") or {}
    if inv:
        lines += ["", "## Inventory (source level)", "",
                  f"{inv['atoms']} atoms; complete: {inv['complete']}; unresolved {len(inv['unresolved'])}, "
                  f"excluded {len(inv['excluded'])}, open variants {len(inv['variantsOpen'])} — {inv['level']}.", ""]
        lines += [f"- open variant: {x['side']} {x['adapter']} — {x.get('file')} · {x.get('form')} · `{x.get('expr')}`"
                  for x in inv["variantsOpen"]]
        lines += [f"- excluded: {x['side']} {x['adapter']} — {x.get('file')} · `{x.get('expr')}` ({x.get('why', '')})"
                  for x in inv["excluded"]]
    lines += ["", "## Notes", ""] + [f"- {n}" for n in c["notes"]]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--gate", type=Path, required=True)
    ap.add_argument("--native-report", type=Path, action="append", default=[])
    ap.add_argument("--live-report", type=Path, action="append", default=[])
    ap.add_argument("--out", type=Path)
    ap.add_argument("--md", type=Path)
    a = ap.parse_args(argv)
    c = coverage(a.gate, a.native_report, a.live_report)
    if a.out:
        a.out.write_text(json.dumps(c, indent=1, ensure_ascii=False) + "\n")
    if a.md:
        a.md.write_text(markdown(c))
    print(f"coverage: {c['verdict']} — {len(c['gaps'])} gaps, {len(c['errors'])} errors")
    return 0 if c["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
