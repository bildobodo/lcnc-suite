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
        return json.loads(path.read_text())
    except (OSError, ValueError) as e:
        missing.append(f"{path.name}: {type(e).__name__} — an artefact of the run is missing")
        return None


def playwright_tests(report: dict) -> dict[tuple, str]:
    """(file, title path, project) → status (passed / failed / skipped / flaky / listed)."""
    out: dict[tuple, str] = {}

    def walk(suite: dict, path: list[str]) -> None:
        for sp in suite.get("specs", []):
            for t in sp.get("tests", []):
                st = {"expected": "passed", "unexpected": "failed", "skipped": "skipped", "flaky": "flaky"}.get(
                    t.get("status"), str(t.get("status")))
                if not t.get("results"):
                    st = "listed"
                out[(sp["file"], " › ".join(path + [sp["title"]]), t.get("projectName"))] = st
        for sub in suite.get("suites", []):
            walk(sub, path + [sub["title"]])
    for s in report.get("suites", []):
        walk(s, [])
    return out


def vitest_tests(listing: list, report: dict | None) -> dict[tuple, str]:
    """(file relative to lcnc-webui/src, full name) → status."""
    out = {}
    for x in listing:
        out[(x["file"].split("/lcnc-webui/src/")[-1], x["name"])] = "listed"
    for f in (report or {}).get("testResults", []):
        rel = f["name"].split("/lcnc-webui/src/")[-1]
        for a in f.get("assertionResults", []):
            out[(rel, " > ".join(a.get("ancestorTitles", []) + [a["title"]]))] = \
                {"passed": "passed", "failed": "failed", "skipped": "skipped", "pending": "skipped",
                 "todo": "skipped"}.get(a.get("status"), str(a.get("status")))
    return out


def junit_tests(path: Path) -> dict[tuple, str]:
    """(test file, node id) → status from the backend step's JUnit XML."""
    out = {}
    for tc in ET.parse(path).getroot().iter("testcase"):
        cls, name = tc.get("classname", ""), tc.get("name", "")
        mod = cls.split(".")[0]
        node = "::".join([mod + ".py", *cls.split(".")[1:], name])
        st = "passed"
        for child in tc:
            st = {"failure": "failed", "error": "failed", "skipped": "skipped"}.get(child.tag, st)
        out[(mod + ".py", node)] = st
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


def verdict(statuses: list[str]) -> str:
    if not statuses:
        return "not collected"
    for s in ("failed", "flaky", "skipped", "listed"):
        if s in statuses:
            return {"listed": "not run", "flaky": "failed"}.get(s, s)
    return "passed"


# ── the report ─────────────────────────────────────────────────────────────

def coverage(gate_path: Path, native_paths: list[Path], live_paths: list[Path], root: Path = ROOT) -> dict:
    gate = json.loads(gate_path.read_text())
    logs = gate_path.with_suffix(".logs")
    head = gate.get("head", "")
    errors: list[str] = []
    web, py, fns = functions.load(root)
    ids = functions.atom_ids(web, py)

    # the run's artefacts — every one required
    tests: dict[str, dict[tuple, str]] = {}
    for project, listing, report in PROJECTS:
        lst, rep = _json(logs / listing, errors), _json(logs / report, errors)
        merged = playwright_tests(lst or {})
        merged.update({k: v for k, v in playwright_tests(rep or {}).items()})
        tests[project] = merged
    unit: dict[tuple, str] = {}
    for name in ("unit-light", "unit-heavy"):
        lst = logs / f"{name}.list.json"
        if name == "unit-heavy" and not lst.is_file() and gate.get("kind") != "merge":
            continue
        unit.update(vitest_tests(_json(lst, errors) or [], _json(logs / f"{name}.json", errors)))
    junit = logs / "backend" / "backend.junit.xml"
    gw = junit_tests(junit) if junit.is_file() else {}
    if not junit.is_file():
        errors.append(f"{junit.name}: an artefact of the run is missing")
    replays = [r for r in (_json(logs / "replay.json", errors), _json(logs / "firefox-replay.json", errors)) if r]

    natives = []
    for p in native_paths:
        r, why = live_drivers.load_report(p)
        if r is None:
            errors.append(f"native report {why} — a run claimed and not shown")
        elif not all(k in r for k in ("commit", "profile", "rows")):
            errors.append(f"native report {p}: no commit, profile or rows")
        else:
            natives.append(r)
    lives = []
    for p in live_paths:
        r, why = live_drivers.load_report(p)
        if r is None:
            errors.append(f"live report {why} — a run claimed and not shown")
        else:
            lives.append(r)
    native_consts = set()
    for f in ("scripts/native_run.py", "scripts/test_support/native_cases.py"):
        for n in ast.walk(ast.parse((root / f).read_text())):
            if isinstance(n, ast.Constant) and isinstance(n.value, str):
                native_consts.add(n.value)

    # triggered: commands and routes from PASSED attempts
    sent: dict[str, Counter] = defaultdict(Counter)
    refused: dict[str, list] = defaultdict(list)
    routes: dict[str, Counter] = defaultdict(Counter)
    for r in replays:
        passed = {a["name"] for a in r.get("attempt_list", []) if a.get("status") == "passed"}
        exp = r.get("per_attempt_expected", {})
        for att, counts in r.get("per_attempt", {}).items():
            if att not in passed:
                continue
            for key, n in counts.items():
                valid = n - exp.get(att, {}).get(key, 0)
                if valid > 0:
                    sent[key.split(":")[0]][key] += valid
        for x in r.get("expected", []):
            refused[x.get("cmd")].append(x)
        for att, rows in r.get("http_paths", {}).get("per_attempt", {}).items():
            if att not in passed:
                continue
            for row in rows:
                if row.get("what", "").split(" ")[0] in ("GET", "POST", "PUT", "DELETE"):
                    routes[row["what"]][row["class"]] += row["n"]

    out_fns, gaps = [], []
    for f in fns["functions"]:
        problems: list[str] = []
        atoms = sorted(functions.claimed(f["atoms"], list(ids), f["id"], problems))
        cmds = [a[4:] for a in atoms if a.startswith("cmd:")]
        rts = [a[5:] for a in atoms if a.startswith("http:") and a[5:].split(" ")[0] in ("GET", "POST", "PUT", "DELETE")]
        trig_c = {c: dict(sent[c]) if sent.get(c) else "not sent" for c in cmds}
        trig_r = {}
        for rt in rts:
            got = dict(routes.get(rt, {}))
            trig_r[rt] = {("served by the mock" if k == "served" else k): v for k, v in got.items()} if got else "not requested"
        gaps += [{"function": f["id"], "kind": "triggered", "item": f"cmd:{c}", "why": "not sent in a passed attempt"}
                 for c, v in trig_c.items() if v == "not sent"]
        gaps += [{"function": f["id"], "kind": "triggered", "item": f"http:{r}",
                  "why": "not requested" if v == "not requested" else "never answered by a server (" + ", ".join(sorted(v)) + ")"}
                 for r, v in trig_r.items() if v == "not requested" or not (set(routes.get(r, {})) & EVIDENCE)]
        stmts, counter_native, native = [], [], []
        for s in f.get("statements", []):
            ev_out = []
            for e in s["evidence"]:
                row: dict[str, Any] = {"layer": e["layer"], "file": e["file"], "title": e["title"]}
                if e["layer"] == "browser":
                    for project in ("e2e", "firefox-core"):
                        cands = [((fl, path, pj), [path.split(" › ")[-1], path]) for (fl, path, pj) in tests[project]
                                 if fl == e["file"] and pj == project]
                        if not cands and project == "firefox-core":
                            continue
                        bound, why = bind(e, cands)
                        st = verdict([tests[project][k] for k in bound]) if not why else "not collected"
                        ev_out.append({**row, "project": project, "bound": [f"{k[0]} › {k[1]}" for k in bound],
                                       "status": st, **({"why": why} if why else {})})
                        if st == "not collected":
                            errors.append(f"{f['id']}.{s['id']}: {e['file']} › {e['title'][:80]} [{project}]: {why}")
                    continue
                if e["layer"] == "unit":
                    cands = [(k, [k[1].split(" > ")[-1], k[1]]) for k in unit if k[0] == e["file"]]
                    bound, why = bind(e, cands)
                    st = verdict([unit[k] for k in bound]) if not why else "not collected"
                    row |= {"bound": [k[1] for k in bound], "status": st, **({"why": why} if why else {})}
                elif e["layer"] == "gateway":
                    bound = [k for k in gw if k[0] == e["file"] and k[1].split("::")[-1].split("[")[0] == e["title"]]
                    st = verdict([gw[k] for k in bound])
                    row |= {"bound": [k[1] for k in bound], "status": st}
                    why = "" if bound else "not collected — no node of that name in the backend step"
                elif e["layer"] == "native":
                    ok = e["title"] in native_consts
                    hits = [rw["status"] for r in natives if r.get("commit") == head and r.get("profile") == e.get("profile")
                            for rw in r.get("rows", []) if rw.get("case") == e["title"] and rw.get("variant") == e.get("variant")]
                    st = hits[-1] if hits else "not at this commit"
                    row |= {"profile": e.get("profile"), "variant": e.get("variant"), "status": st}
                    why = "" if ok else "no string constant of native_run names the case"
                    native.append(row)
                    if ".counter-" in e["title"] or e["title"].endswith(".delayed-order"):
                        counter_native.append(row)
                elif e["layer"] == "script":
                    j = live_drivers.judge(e, root, lives, head)
                    row |= {"status": j["status"], **({"why": j["why"]} if j.get("why") else {})}
                    why = "" if j["resolved"] and j["status"] != "error" else j["why"]
                else:
                    why = f"unknown layer {e['layer']}"
                if why:
                    errors.append(f"{f['id']}.{s['id']}: {e['layer']} {e['file']} › {e['title'][:80]}: {why}")
                ev_out.append(row)
            in_gate = [x for x in ev_out if x["layer"] in ("browser", "unit", "gateway")]
            checked = bool(in_gate) and all(x["status"] == "passed" for x in in_gate)
            stmts.append({"id": s["id"], "kind": s["kind"], "text": s["text"], "evidence": ev_out,
                          "checked": "passed" if checked else "open"})
            if not checked:
                gaps.append({"function": f["id"], "kind": "checked", "item": s["id"],
                             "why": "no gate evidence" if not in_gate else ", ".join(sorted({x['status'] for x in in_gate if x['status'] != 'passed'}))})
        counter = {"payload checker": [{"cmd": c, "refusals": len(refused[c])} for c in cmds if refused.get(c)],
                   "native counter rows": counter_native}
        out_fns.append({"id": f["id"], "name": f["name"], "area": f["area"],
                        "inventoried": {"atoms": len(atoms), "problems": problems},
                        "triggered": {"commands": trig_c, "routes": trig_r},
                        "statements": stmts, "counter": counter, "native": native})
    return {
        "verdict": "FAIL" if errors else "PASS", "head": head, "gate": gate_path.name,
        "functions": out_fns, "gaps": gaps, "errors": errors,
        "payload_checker_refusals": sum(len(v) for v in refused.values()),
        "notes": ["the payload checker's counter-check: replay_refusals.json lists what is expected; "
                  + ("none was expected in this run" if not refused else f"{sum(len(v) for v in refused.values())} expected"),
                  "mutation records of the packages are bound to no statement — outside this report",
                  "native evidence needs a report of THIS commit (--native-report); without one it is 'not at this commit'"],
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
