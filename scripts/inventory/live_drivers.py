"""The live script evidence (layer `script`, `live: true`) resolved statically
and judged by a run report (replay step 5c; Codex R389 VM389-02, R390–R392).

Static (`ast` only — a driver is never imported or started):
  - the TWP drivers' check lines: the first argument of `check(...)`, a str
    constant or an f-string whose placeholders are plain names; a name that
    is a parameter of the enclosing function resolves through every call of
    that function with a constant there → the declared instances;
  - perf_matrix's scenarios: the constant of every `@scenario("…")`.
A binding resolves when its title is a constant, a scenario, or a template
whose every declared instance is one of the template's instances. A check
line that cannot be resolved statically is named, never red: a binding must
resolve positively (R390).

Run evidence: only perf_matrix writes a report. A scenario counts only from a
report of THIS commit (`commit`, full) with a clean tree (`dirty: false`);
its status in the order of R392: form and contradiction (evaluation error) →
skip (SKIP with its reason) → an error record (run, not passed — success
fields may be missing) → a success record (every property of the scenario's
success definition present; any not true = not passed; all true = passed).
A bound scenario without a success definition is a binding error. The TWP
drivers write no report: their evidence is "not proven: no run report".
"""
from __future__ import annotations

import ast
import json
from pathlib import Path
from typing import Any

#: the properties a bound scenario's success needs — each must be present and true
SUCCESS = {"sigstop_trip": ("sticky_ok", "recovered_ok")}
PERF_MATRIX = "perf_matrix.py"


def _parents(tree: ast.AST) -> dict[ast.AST, ast.AST]:
    return {ch: node for node in ast.walk(tree) for ch in ast.iter_child_nodes(node)}


def _template(js: ast.JoinedStr, fn: ast.AST | None, calls: dict[str, list[ast.Call]]) -> tuple[str | None, Any]:
    text, holes = "", {}
    for v in js.values:
        if isinstance(v, ast.Constant):
            text += str(v.value)
            continue
        if not (isinstance(v, ast.FormattedValue) and isinstance(v.value, ast.Name)
                and v.conversion == -1 and v.format_spec is None):
            return None, f"a placeholder that is not a plain name (line {js.lineno})"
        name = v.value.id
        text += "{" + name + "}"
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            return None, f"placeholder {name} outside a function (line {js.lineno})"
        params = [a.arg for a in fn.args.args]
        if name not in params:
            return None, f"placeholder {name} is not a parameter of {fn.name}"
        idx, vals = params.index(name), set()
        for call in calls.get(fn.name, []):
            arg = call.args[idx] if idx < len(call.args) else None
            for kw in call.keywords:
                if kw.arg == name:
                    arg = kw.value
            if not (isinstance(arg, ast.Constant) and isinstance(arg.value, str)):
                return None, f"a call of {fn.name} passes no constant for {name} (line {call.lineno})"
            vals.add(arg.value)
        if not vals:
            return None, f"{fn.name} is never called"
        holes[name] = vals
    return text, holes


def scan(path: Path) -> dict:
    """A driver's check constants, templates (with their instances), the
    lines that do not resolve, and its scenarios."""
    tree = ast.parse(path.read_text())
    par = _parents(tree)
    calls: dict[str, list[ast.Call]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            calls.setdefault(node.func.id, []).append(node)
    out: dict[str, Any] = {"constants": set(), "templates": {}, "unresolved": [], "scenarios": set()}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "check" and node.args:
            a = node.args[0]
            if isinstance(a, ast.Constant) and isinstance(a.value, str):
                out["constants"].add(a.value)
            elif isinstance(a, ast.JoinedStr):
                fn: ast.AST | None = node
                while fn is not None and not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    fn = par.get(fn)
                t, holes = _template(a, fn, calls)
                if t is None:
                    out["unresolved"].append({"line": node.lineno, "why": holes})
                else:
                    out["templates"][t] = holes
            else:
                out["unresolved"].append({"line": node.lineno, "why": f"a check name of type {type(a).__name__}"})
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for d in node.decorator_list:
                if isinstance(d, ast.Call) and isinstance(d.func, ast.Name) and d.func.id == "scenario" \
                        and d.args and isinstance(d.args[0], ast.Constant):
                    out["scenarios"].add(d.args[0].value)
    return out


def resolve(evidence: dict, scanned: dict) -> tuple[bool, str]:
    """(resolved, why not) for one script evidence."""
    title, inst = evidence["title"], evidence.get("instances")
    if title in scanned["scenarios"]:
        return (True, "") if title in SUCCESS else (False, f"scenario {title} has no success definition")
    if title in scanned["constants"] and not inst:
        return True, ""
    if title in scanned["templates"]:
        holes = scanned["templates"][title]
        if not inst:
            return False, "a template bound without instances"
        if len(holes) != 1:
            return False, f"{len(holes)} placeholders, the instances name one"
        (_, declared), = holes.items()
        missing = [i for i in inst if i not in declared]
        return (False, f"instance(s) {missing} not declared ({sorted(declared)})") if missing else (True, "")
    return False, "no check line or scenario of that title"


def scenario_status(report: Any, scenario: str) -> tuple[str, str]:
    """A perf_matrix scenario's status, ordered by result kind (R392):
    ('error', why) | ('absent', '') | ('skip', reason) | ('failed', why) | ('passed', '')."""
    if not isinstance(report, dict) or not isinstance(report.get("scenarios"), dict):
        return "error", "the report has no scenarios object"
    entry = report["scenarios"].get(scenario)
    if entry is None:
        return "absent", ""
    direct = entry.get("direct") if isinstance(entry, dict) else None
    if not isinstance(direct, dict):
        return "error", f"{scenario}: no direct result"
    skipped, error, fail = direct.get("skipped"), direct.get("error"), entry.get("FAIL")
    if skipped is not None and (error is not None or fail is not None):
        return "error", f"{scenario}: skipped AND failed — a contradiction"
    if skipped is not None:
        return "skip", str(skipped)
    if error is not None or fail is not None:
        return "failed", str(fail or error)
    need = SUCCESS.get(scenario, ())
    missing = [p for p in need if p not in direct]
    if missing:
        return "error", f"{scenario}: no {missing} in a record that is neither a skip nor an error"
    bad = [p for p in need if direct[p] is not True]
    return ("failed", f"{scenario}: {bad} not true") if bad else ("passed", "")


def load_report(path: Path) -> tuple[dict | None, str]:
    """A live run report given as evidence — or why it is no evidence at all
    (a missing or unreadable file is an evaluation error: a run claimed and
    not shown)."""
    try:
        r = json.loads(path.read_text())
    except (OSError, ValueError) as e:
        return None, f"{path}: {type(e).__name__}"
    if not isinstance(r, dict):
        return None, f"{path}: not an object"
    return r, ""


def judge(evidence: dict, root: Path, reports: list[dict], head: str) -> dict:
    """One live evidence: resolved or not, and its run status at this commit."""
    f = root / "scripts" / evidence["file"]
    if not f.is_file():
        return {"resolved": False, "why": f"no file scripts/{evidence['file']}", "status": "binding error"}
    ok, why = resolve(evidence, scan(f))
    if not ok:
        return {"resolved": False, "why": why, "status": "binding error"}
    if evidence["file"] != PERF_MATRIX:
        return {"resolved": True, "status": "not proven", "why": "the driver writes no run report"}
    mine = [r for r in reports if r.get("commit") == head and r.get("dirty") is False]
    other = [r for r in reports if r not in mine]
    for r in reversed(mine):
        st, why = scenario_status(r, evidence["title"])
        if st == "absent":
            continue
        return {"resolved": True, "status": st, "why": why, "report": r.get("run_id")}
    return {"resolved": True, "status": "not at this commit",
            "why": "no report of this commit with a clean tree" + (f" ({len(other)} of another commit or dirty)" if other else "")}
