#!/usr/bin/env python3
"""R390 dry run: the planned static resolution of the `script` + `live: true` evidence
(VM389-02) over every such binding in scripts/inventory/functions.json — `ast` only,
no driver is imported or started.   live-drivers-dryrun.py REPO_ROOT

Check lines: the first argument of a call to `check(...)` — a str constant, or an
f-string whose every placeholder is a plain name; a name that is a parameter of the
enclosing function resolves through every call of that function in the module with a
constant at that parameter's position (positional or keyword) → the declared instances.
perf_matrix scenarios: the constant of every `@scenario("…")` decorator."""
import ast, json, sys
from pathlib import Path

root = Path(sys.argv[1])
fns = json.loads((root / "scripts/inventory/functions.json").read_text())["functions"]
bindings = [(f["id"], s["id"], e) for f in fns for s in f.get("statements", []) for e in s.get("evidence", [])
            if e.get("layer") == "script" and e.get("live")]


def parents(tree):
    p = {}
    for node in ast.walk(tree):
        for ch in ast.iter_child_nodes(node):
            p[ch] = node
    return p


def template(js, fn, calls_by_fn):
    """An f-string → (template text, {placeholder: declared instances}) or (None, why)."""
    text, holes = "", {}
    for v in js.values:
        if isinstance(v, ast.Constant):
            text += str(v.value)
        elif isinstance(v, ast.FormattedValue) and isinstance(v.value, ast.Name) and v.conversion == -1 and v.format_spec is None:
            name = v.value.id
            text += "{" + name + "}"
            if fn is None:
                return None, f"placeholder {name} outside a function"
            params = [a.arg for a in fn.args.args]
            if name not in params:
                return None, f"placeholder {name} is not a parameter of {fn.name}"
            idx = params.index(name)
            vals = set()
            for call in calls_by_fn.get(fn.name, []):
                arg = None
                if idx < len(call.args):
                    arg = call.args[idx]
                for kw in call.keywords:
                    if kw.arg == name:
                        arg = kw.value
                if not (isinstance(arg, ast.Constant) and isinstance(arg.value, str)):
                    return None, f"a call of {fn.name} passes no constant for {name} (line {call.lineno})"
                vals.add(arg.value)
            if not vals:
                return None, f"{fn.name} is never called with {name}"
            holes[name] = vals
        else:
            return None, f"a placeholder that is not a plain name (line {js.lineno})"
    return text, holes


def scan(path):
    tree = ast.parse(path.read_text())
    par = parents(tree)
    calls_by_fn = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            calls_by_fn.setdefault(node.func.id, []).append(node)
    consts, templates, unresolved, scenarios = set(), {}, [], set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "check" and node.args:
            a = node.args[0]
            if isinstance(a, ast.Constant) and isinstance(a.value, str):
                consts.add(a.value)
            elif isinstance(a, ast.JoinedStr):
                fn = node
                while fn is not None and not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    fn = par.get(fn)
                t, holes = template(a, fn, calls_by_fn)
                if t is None:
                    unresolved.append((node.lineno, holes))
                else:
                    templates[t] = holes
            else:
                unresolved.append((node.lineno, f"a check name that is neither a constant nor an f-string ({type(a).__name__})"))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for d in node.decorator_list:
                if isinstance(d, ast.Call) and isinstance(d.func, ast.Name) and d.func.id == "scenario" \
                        and d.args and isinstance(d.args[0], ast.Constant):
                    scenarios.add(d.args[0].value)
    return consts, templates, unresolved, scenarios


cache, out = {}, []
for fid, sid, e in bindings:
    f = root / "scripts" / e["file"]
    if f not in cache:
        cache[f] = scan(f)
    consts, templates, unresolved, scenarios = cache[f]
    title, inst = e["title"], e.get("instances")
    if title in scenarios:
        verdict = "resolved: scenario"
    elif title in consts and not inst:
        verdict = "resolved: check line"
    elif title in templates:
        holes = templates[title]
        if not inst:
            verdict = "RED: a template bound without instances"
        elif len(holes) != 1:
            verdict = f"RED: {len(holes)} placeholders, instances name one"
        else:
            (name, declared), = holes.items()
            missing = [i for i in inst if i not in declared]
            verdict = f"RED: instance(s) {missing} not declared {sorted(declared)}" if missing \
                else f"resolved: template, {name} ∈ {sorted(declared)}"
    else:
        verdict = "RED: unknown check line / scenario"
    out.append({"function": fid, "statement": sid, "file": e["file"], "title": title, "instances": inst, "verdict": verdict})
files = {str(f.relative_to(root)): {"check_constants": len(c), "templates": len(t), "unresolved": [list(u) for u in un],
                                    "scenarios": len(s)} for f, (c, t, un, s) in cache.items()}
print(json.dumps({"bindings": len(out), "resolved": sum(o["verdict"].startswith("resolved") for o in out),
                  "red": [o for o in out if not o["verdict"].startswith("resolved")], "per_binding": out, "files": files},
                 indent=1, ensure_ascii=False))
