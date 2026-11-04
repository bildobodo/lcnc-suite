"""The gateway side of the function inventory (Codex R265–R269 FI265-01).

One adapter per source family, each with the forms it recognises, its atoms
and three kinds of site it did not turn into an atom:

  unresolved    a site that may hide a mandatory source — the inventory is
                NOT complete while one is listed, with a reason or without;
  excluded      a site outside the declared boundary, bound to its file, form
                and expression, with the reason — visible, never coverage;
  variantsOpen  an atom whose variants are not derived — named, no
                completeness term.

Pure source reading with `ast` and fixed text forms: nothing here imports the
gateway (an import binds the live sim). No line numbers in the result.

    python3 -I scripts/inventory/py_atoms.py           # print
    python3 -I scripts/inventory/py_atoms.py --write   # scripts/inventory/atoms.py.json
"""
from __future__ import annotations

import ast
import configparser
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GATEWAY = ROOT / "lcnc-gateway"
OUT = Path(__file__).resolve().parent / "atoms.py.json"

# Gateway modules that are not product code: the test doubles and the
# probes the tests run in a subprocess.
NOT_PRODUCT = {"conftest.py", "fake_hal.py", "fake_linuxcnc.py", "writer_fixture.py",
               "native_pinned_probe.py", "native_start_probe.py", "suite_py_bind_probe.py"}


def gateway_sources(root: Path = ROOT) -> dict[str, str]:
    return {p.name: p.read_text() for p in sorted((root / "lcnc-gateway").glob("*.py"))
            if not p.name.startswith("test_") and p.name not in NOT_PRODUCT}


def site(file: str, form: str, expr: str) -> dict:
    """A site bound to its file, form and expression (and the expression's
    hash — the binding an exclusion names)."""
    return {"file": file, "form": form, "expr": expr[:100],
            "hash": hashlib.sha256(f"{file}|{form}|{expr}".encode()).hexdigest()[:12]}


def adapter(source: str, forms: list[str], atoms: dict[str, dict], unresolved: list[dict],
            excluded: list[dict] | None = None, variants_open: list[dict] | None = None,
            limit: str | None = None) -> dict:
    if not atoms:
        raise RuntimeError(f"{source}: the adapter found nothing — no answer is never \"no atoms\"")
    out: dict = {"source": source, "forms": forms}
    if limit:
        out["limit"] = limit
    out["atoms"] = sorted(atoms.values(), key=lambda a: a["id"])
    out["unresolved"] = sorted({u["hash"]: u for u in unresolved}.values(), key=lambda u: (u["file"], u["expr"]))
    if excluded:
        out["excluded"] = sorted({u["hash"]: u for u in excluded}.values(), key=lambda u: (u["file"], u["expr"]))
    if variants_open:
        out["variantsOpen"] = sorted({u["hash"]: u for u in variants_open}.values(), key=lambda u: (u["file"], u["expr"]))
    return out


# ── HTTP ─────────────────────────────────────────────────────────────────

def http_adapter(sources: dict[str, str]) -> dict:
    atoms: dict[str, dict] = {}
    unresolved: list[dict] = []
    for name, text in sources.items():
        tree = ast.parse(text)
        for n in ast.walk(tree):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for d in n.decorator_list:
                    if not (isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute)
                            and isinstance(d.func.value, ast.Name) and d.func.value.id == "app"):
                        continue
                    arg = d.args[0] if d.args else None
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        kind = d.func.attr.upper()
                        atoms[f"{kind} {arg.value}"] = {"id": f"http:{kind} {arg.value}"}
                    else:
                        unresolved.append(site(name, "@app.<method>(path)", ast.unparse(d)))
            if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "mount"
                    and isinstance(n.func.value, ast.Name) and n.func.value.id == "app"):
                arg = n.args[0] if n.args else None
                if isinstance(arg, ast.Constant):
                    atoms[f"MOUNT {arg.value}"] = {"id": f"http:MOUNT {arg.value}"}
                else:
                    unresolved.append(site(name, "app.mount(path)", ast.unparse(n)))
    return adapter("lcnc-gateway/*.py (product modules)", ["@app.get|post|put|delete|websocket|middleware(literal)", "app.mount(literal)"],
                   atoms, unresolved)


# ── INI ──────────────────────────────────────────────────────────────────

# The read registry (Codex R267/R268/R270): wrappers by module and name with
# the index of their INI-object parameter (None: it reads an object of an
# enclosing scope) and of their section and key; consumers that take a read
# function, with its parameter. A wrapper's own parametric read is its call
# sites'; anything else in its body is read like any other code.
WRAPPERS = {("gateway.py", "_ini_float"): (0, 1, 2), ("gcode_parse_worker.py", "_ini_vel"): (None, 0, 1)}
CONSUMERS = {("gateway_util.py", "read_axis_limits"): "ini_find"}
# Functions that return an INI object (their `return linuxcnc.ini(…)` is the
# form; a name bound from their call is an INI object).
FACTORY_FUNCTIONS = {("gateway.py", "_g30_ini")}
# What makes an INI object, the reads it offers and the loads it may take.
FACTORIES = {"linuxcnc.ini": ("find", "findall"), "configparser.ConfigParser": ("get",)}
LOADS = {"configparser.ConfigParser": ("read", "read_string", "read_file", "has_section", "has_option")}
FAMILY_KEY = re.compile(r"\{[^}]*\}")
SCOPES = (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)


def _string(node: ast.AST, scope: ast.AST | None) -> str | None:
    """A literal, an f-string as its family pattern (`AXIS_{l}` → `AXIS_*`),
    or a name bound ONCE in its function to one of those; else None."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        return FAMILY_KEY.sub("*", ast.unparse(node)[2:-1])
    if isinstance(node, ast.Name) and scope is not None:
        binds = [a.value for a in ast.walk(scope) if isinstance(a, ast.Assign)
                 and any(isinstance(t, ast.Name) and t.id == node.id for t in a.targets)]
        if len(binds) == 1:
            return _string(binds[0], None)
    return None


def _factory_value(v: ast.AST | None, file: str = "") -> ast.Call | None:
    """The factory call an assigned value is: the call itself (a factory or a
    registered factory function), or the one branch of
    `factory(…) if cond else None`."""
    if isinstance(v, ast.Call) and (ast.unparse(v.func) in FACTORIES or (file, ast.unparse(v.func)) in FACTORY_FUNCTIONS):
        return v
    if isinstance(v, ast.IfExp):
        branches = [v.body, v.orelse]
        calls = [b for b in branches if isinstance(b, ast.Call) and ast.unparse(b.func) in FACTORIES]
        nones = [b for b in branches if isinstance(b, ast.Constant) and b.value is None]
        if len(calls) == 1 and len(nones) == 1:
            return calls[0]
    return None


def _bindings(scope: ast.AST, file: str) -> dict[str, str | None]:
    """The names a scope binds itself (nested scopes excluded): name → the
    factory it is bound from, or None for any other binding. A registered
    wrapper's INI parameter is bound from linuxcnc.ini."""
    out: dict[str, str | None] = {}
    if not isinstance(scope, ast.Module):
        a = scope.args
        for x in [*a.posonlyargs, *a.args, *a.kwonlyargs, *([a.vararg] if a.vararg else []), *([a.kwarg] if a.kwarg else [])]:
            out[x.arg] = None
        w = WRAPPERS.get((file, getattr(scope, "name", "")))
        if w and w[0] is not None:
            out[(a.posonlyargs + a.args)[w[0]].arg] = "linuxcnc.ini"

    def visit(n: ast.AST):
        for c in ast.iter_child_nodes(n):
            if isinstance(c, SCOPES):
                if not isinstance(c, ast.Lambda):
                    out.setdefault(c.name, None)
                continue
            if isinstance(c, (ast.Assign, ast.AnnAssign)):
                call = _factory_value(c.value, file)
                for t in (c.targets if isinstance(c, ast.Assign) else [c.target]):
                    if isinstance(t, ast.Name):
                        f = ast.unparse(call.func) if call is not None else None
                        kind = f if f in FACTORIES or f is None else "linuxcnc.ini"
                        out[t.id] = kind if out.get(t.id, kind) == kind else "mixed"
                    else:
                        visit(t)
                if c.value is not None:
                    visit(c.value)
                continue
            if isinstance(c, ast.Name) and isinstance(c.ctx, ast.Store):
                out[c.id] = None if out.get(c.id) is None else "mixed"
            visit(c)
    visit(scope)
    return out


def _truth_test(n: ast.AST, parent: dict) -> bool:
    """The name is only tested: a condition, `not`, `is (not) None`, or an
    `and`/`or` that is itself a condition (`x = ini or y` is a use)."""
    up = parent.get(n)
    if isinstance(up, (ast.If, ast.While, ast.IfExp)) and up.test is n:
        return True
    if isinstance(up, ast.UnaryOp) and isinstance(up.op, ast.Not):
        return True
    if isinstance(up, ast.BoolOp):
        return _truth_test(up, parent)
    return isinstance(up, ast.Compare) and all(isinstance(o, (ast.Is, ast.IsNot)) for o in up.ops) \
        and all(isinstance(c, ast.Constant) and c.value is None for c in up.comparators)


def ini_adapter(sources: dict[str, str], example_inis: dict[str, str]) -> dict:
    """Every INI read: a factory call (`linuxcnc.ini(…)`, `ConfigParser(…)`) is
    bound to a name or read on the spot; a name bound from one (in the
    innermost scope that binds it) is read, loaded, handed to a registered
    wrapper or consumer — any other use of either is unresolved."""
    atoms: dict[str, dict] = {}
    unresolved: list[dict] = []

    def read(file: str, sec: str | None, key: str | None, form: str, expr: str, many: bool = False):
        if sec is None or key is None:
            unresolved.append(site(file, form, expr))
            return
        aid = f"ini:{sec}/{key}"
        a = atoms.setdefault(aid, {"id": aid})
        if many:
            a["many"] = True
        if "*" in sec:
            a["members"] = _family_members(sec, key, example_inis)

    for file, text in sources.items():
        tree = ast.parse(text)
        parent = {c: n for n in ast.walk(tree) for c in ast.iter_child_nodes(n)}
        binds = {s: _bindings(s, file) for s in ast.walk(tree) if isinstance(s, SCOPES)}

        def chain(n: ast.AST) -> list[ast.AST]:
            out = []
            while n in parent:
                n = parent[n]
                if isinstance(n, SCOPES):
                    out.append(n)
            return out

        def kind(name: ast.Name) -> str | None:
            for s in chain(name):
                if name.id in binds[s]:
                    return binds[s][name.id]
            return None

        def fn_of(n: ast.AST):
            return next((s for s in chain(n) if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef))), None)

        def params(fn) -> list[str]:
            return [] if fn is None else [x.arg for x in fn.args.posonlyargs + fn.args.args]

        def read_call(call: ast.Call, attr: str, form: str):
            fn = fn_of(call)
            w = WRAPPERS.get((file, getattr(fn, "name", "")))
            if len(call.args) < 2:
                unresolved.append(site(file, form, ast.unparse(call)))
                return
            own = params(fn)
            if w and all(isinstance(a, ast.Name) for a in call.args[:2]) \
                    and [a.id for a in call.args[:2]] == [own[w[1]], own[w[2]]]:
                return   # the wrapper's own parametric read: its call sites'
            sec, key = _string(call.args[0], fn), _string(call.args[1], fn)
            if (sec is None or key is None) and all(isinstance(a, ast.Name) and a.id in own for a in call.args[:2]):
                unresolved.append(site(file, "an unregistered wrapper", f"{fn.name}: {ast.unparse(call)}"))
                return
            read(file, sec, key, form, ast.unparse(call), many=attr == "findall")

        for n in ast.walk(tree):
            up = parent.get(n)
            # a factory call: bound to names, or read on the spot
            if isinstance(n, ast.Call) and ast.unparse(n.func) in FACTORIES:
                f = ast.unparse(n.func)
                assign = parent.get(up) if isinstance(up, ast.IfExp) else up
                if isinstance(assign, ast.Assign) and _factory_value(assign.value) is n \
                        and all(isinstance(t, ast.Name) for t in assign.targets):
                    pass
                elif isinstance(assign, ast.Return) and (file, getattr(fn_of(n), "name", "")) in FACTORY_FUNCTIONS:
                    pass   # a registered factory function's return
                elif isinstance(up, ast.Attribute) and up.attr in FACTORIES[f] and isinstance(parent.get(up), ast.Call) \
                        and parent[up].func is up:
                    read_call(parent[up], up.attr, f"{f}(…).{up.attr}(S, N)")
                else:
                    unresolved.append(site(file, "an INI object handed on", ast.unparse(up if up is not None else n)))
            # a name bound from a factory
            elif isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load) and kind(n) not in (None,):
                k = kind(n)
                call = parent.get(up) if isinstance(up, ast.Attribute) else None
                if k == "mixed":
                    unresolved.append(site(file, "a name bound to an INI object and to something else", ast.unparse(up or n)))
                elif isinstance(up, ast.Attribute) and up.attr in FACTORIES[k] and isinstance(call, ast.Call) and call.func is up:
                    read_call(call, up.attr, f"<ini>.{up.attr}(S, N)")
                elif isinstance(up, ast.Attribute) and up.attr in LOADS.get(k, ()) and isinstance(call, ast.Call) and call.func is up:
                    pass
                elif isinstance(up, ast.Attribute) and up.attr in FACTORIES[k] and isinstance(call, ast.Call) and up in call.args \
                        and isinstance(call.func, ast.Name) and any(name == call.func.id for (_, name) in CONSUMERS):
                    pass   # the read function handed to a registered consumer
                elif _truth_test(n, parent):
                    pass   # `if ini …`, `ini is None`: a check, no use
                elif isinstance(up, ast.Call) and isinstance(up.func, ast.Name) and (file, up.func.id) in WRAPPERS \
                        and WRAPPERS[(file, up.func.id)][0] is not None and up.args[WRAPPERS[(file, up.func.id)][0]:][:1] == [n]:
                    pass   # the object handed to a registered wrapper
                elif isinstance(up, ast.Attribute):
                    unresolved.append(site(file, "an INI read function handed on", ast.unparse(parent.get(up) or up)))
                else:
                    unresolved.append(site(file, "an INI object used another way", ast.unparse(up if up is not None else n)))
            # a registered wrapper's call site
            elif isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and (file, n.func.id) in WRAPPERS:
                _, si, ki = WRAPPERS[(file, n.func.id)]
                if len(n.args) <= max(si, ki):
                    unresolved.append(site(file, f"{n.func.id}(…)", ast.unparse(n)))
                else:
                    read(file, _string(n.args[si], fn_of(n)), _string(n.args[ki], fn_of(n)), f"{n.func.id}(S, N)", ast.unparse(n))
            # a registered consumer's reads through its read-function parameter
            elif isinstance(n, ast.Call) and isinstance(n.func, ast.Name):
                fn = fn_of(n)
                if fn is not None and CONSUMERS.get((file, fn.name)) == n.func.id:
                    read(file, _string(n.args[0], fn) if n.args else None, _string(n.args[1], fn) if len(n.args) > 1 else None,
                         f"{fn.name}'s {n.func.id}(S, N)", ast.unparse(n))
    return adapter("lcnc-gateway/*.py — every INI read", [
        "<ini>.find|findall(S, N) on a name the innermost scope binds from linuxcnc.ini(…) / configparser.ConfigParser(…) "
        "(also `factory(…) if c else None`); ConfigParser's read/has_section/has_option load",
        "linuxcnc.ini(…).find(S, N)", "any other use of a factory call or a bound name: unresolved",
        *[f"{f}:{n}(…, S, N)" for (f, n) in WRAPPERS],
        *[f"{f}:{n}({p}) — its {p}(S, N) calls" for (f, n), p in CONSUMERS.items()],
        "an f-string section is a family: its members from the shipped example INIs",
    ], atoms, unresolved, limit="the launcher's reads are the launcher adapter's")


def _family_members(sec: str, key: str, example_inis: dict[str, str]) -> list[str]:
    pat = re.compile("^" + re.escape(sec).replace(r"\*", ".+") + "$")
    out = set()
    for name, text in example_inis.items():
        cp = configparser.ConfigParser(strict=False, interpolation=None)
        cp.optionxform = str
        cp.read_string(text)
        out |= {f"{name}:{s}" for s in cp.sections() if pat.match(s) and cp.has_option(s, key)}
    return sorted(out)


# ── The launcher ─────────────────────────────────────────────────────────

def launcher_adapter(text: str) -> dict:
    atoms: dict[str, dict] = {}
    unresolved: list[dict] = []
    text = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))   # comments
    for m in re.finditer(r"\bini_get\s+([^\s)};|&]+)", text):
        arg = m.group(1)
        if re.fullmatch(r"[A-Z][A-Z0-9_]*", arg):
            atoms[arg] = {"id": f"ini:DISPLAY/{arg}", "via": "launcher"}
        elif not arg.startswith("()"):
            unresolved.append(site("lcnc-suite", "ini_get NAME", m.group(0)))
    for m in re.finditer(r"inivar\b[^\n]*?-sec\s+(\S+)[^\n]*?-var\s+(\S+)|inivar\b[^\n]*?-var\s+(\S+)[^\n]*?-sec\s+(\S+)", text):
        sec, var = (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(3))
        if re.fullmatch(r"[A-Z][A-Z0-9_]*", sec) and re.fullmatch(r"[A-Z][A-Z0-9_]*", var):
            atoms[f"{sec}/{var}"] = {"id": f"ini:{sec}/{var}", "via": "launcher"}
        elif sec != "DISPLAY" or var != '"$1"':
            unresolved.append(site("lcnc-suite", "inivar -sec S -var N", m.group(0)))
    return adapter("lcnc-suite (the launcher)", ["ini_get NAME", "inivar … -sec S -var N",
                                                  "ini_get's own body (inivar -sec DISPLAY -var \"$1\")"], atoms, unresolved)


# ── Settings sections, the status message, routines, remaps, profiles ────

def _literal_set(text: str, name: str) -> list[str] | None:
    for n in ast.walk(ast.parse(text)):
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in n.targets):
            try:
                v = ast.literal_eval(n.value.args[0] if isinstance(n.value, ast.Call) else n.value)
            except ValueError:
                return None
            return sorted(v)
    return None


def sections_adapter(sources: dict[str, str]) -> dict:
    text = sources["settings_store.py"]
    valid, free = _literal_set(text, "VALID_SECTIONS"), _literal_set(text, "FREE_SECTIONS")
    unresolved = [] if valid is not None and free is not None else [site("settings_store.py", "literal set", "VALID_SECTIONS / FREE_SECTIONS")]
    atoms = {s: {"id": f"section:{s}", **({"free": True} if s in (free or []) else {})} for s in valid or []}
    return adapter("settings_store.py VALID_SECTIONS, FREE_SECTIONS", ["a literal set"], atoms, unresolved)


def status_adapter(sources: dict[str, str], web_text: str) -> dict:
    """The status message: StatusPayload's fields (the `data`) and the
    envelope build_status_envelope assembles; each marked when no web source
    names it (`.f`, `["f"]`, `'f'`)."""
    atoms: dict[str, dict] = {}
    unresolved: list[dict] = []
    named = lambda f: re.search(rf"[.\"'`]{re.escape(f)}\b", web_text) is not None
    for n in ast.walk(ast.parse(sources["status_runtime.py"])):
        if isinstance(n, ast.ClassDef) and n.name == "StatusPayload":
            for b in n.body:
                if isinstance(b, ast.AnnAssign) and isinstance(b.target, ast.Name):
                    f = b.target.id
                    atoms[f"data.{f}"] = {"id": f"status:data.{f}", **({} if named(f) else {"unread": True})}
    for n in ast.walk(ast.parse(sources["ws_fanout.py"])):
        if isinstance(n, ast.FunctionDef) and n.name == "build_status_envelope":
            for m in ast.walk(n):
                keys: list = []
                if isinstance(m, ast.Dict):
                    keys = m.keys
                elif isinstance(m, ast.Assign) and isinstance(m.targets[0], ast.Subscript):
                    keys = [m.targets[0].slice]
                for k in keys:
                    if isinstance(k, ast.Constant) and isinstance(k.value, str):
                        atoms[k.value] = {"id": f"status:{k.value}", **({} if named(k.value) else {"unread": True})}
                    elif k is not None:
                        unresolved.append(site("ws_fanout.py", "envelope key", ast.unparse(k)))
    return adapter("status_runtime.py StatusPayload, ws_fanout.py build_status_envelope",
                   ["dataclass field", "envelope dict key", "envelope msg[\"key\"] = …"], atoms, unresolved,
                   limit="read = the name appears in a web source; a field read through a computed key shows as unread")


CALL_RE = re.compile(r"o<([^>]+)>\s*call", re.I)


def routines_adapter(sources: dict[str, str]) -> dict:
    """The routines the gateway starts itself: `O<name> CALL` in its strings."""
    atoms: dict[str, dict] = {}
    unresolved: list[dict] = []
    variants_open: list[dict] = []
    for file, text in sources.items():
        tree = ast.parse(text)
        # docstrings and bare strings describe, they call nothing
        prose = {id(n.value) for n in ast.walk(tree) if isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)}
        parts = {id(v) for n in ast.walk(tree) if isinstance(n, ast.JoinedStr) for v in n.values}
        for n in ast.walk(tree):
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in prose and id(n) not in parts:
                text_ = n.value
            elif isinstance(n, ast.JoinedStr):
                text_ = ast.unparse(n)
            else:
                continue
            for m in CALL_RE.finditer(text_):
                if re.fullmatch(r"[\w-]+", m.group(1)):
                    atoms.setdefault(m.group(1).lower(), {"id": f"routine:{m.group(1).lower()}", "via": []})["via"].append(file)
                elif file == "macro_files.py" and "meta['name']" in m.group(1):
                    variants_open.append(site(file, "the macro class", m.group(0)))
                else:
                    unresolved.append(site(file, "o<…> call with a computed name", m.group(0)))
    for a in atoms.values():
        a["via"] = sorted(set(a["via"]))
    return adapter("lcnc-gateway/*.py string constants", ["O<name> CALL literal", "macro_files.py o<{name}> call: the macro class"],
                   atoms, unresolved, variants_open=variants_open,
                   limit="f-strings building a call are unresolved unless named (the macro class)")


def remaps_adapter(example_inis: dict[str, str]) -> dict:
    atoms: dict[str, dict] = {}
    unresolved: list[dict] = []
    for name, text in example_inis.items():
        for m in re.finditer(r"^\s*REMAP\s*=\s*(\S+)(.*)$", text, re.M):
            code = m.group(1).upper()
            if re.fullmatch(r"[GMT][\d.]+", code):
                atoms.setdefault(code, {"id": f"remap:{code}", "members": []})["members"].append(name)
            else:
                unresolved.append(site(name, "REMAP=code", m.group(0).strip()))
    for a in atoms.values():
        a["members"] = sorted(set(a["members"]))
    return adapter("examples/sim_config/*.ini REMAP", ["REMAP=<code> …"], atoms, unresolved)


def profiles_adapter(text: str) -> dict:
    atoms: dict[str, dict] = {}
    unresolved: list[dict] = []
    for p in json.loads(text)["profiles"]:
        if isinstance(p.get("id"), str):
            atoms[p["id"]] = {"id": f"profile:{p['id']}", "members": [p.get("name", ""), p.get("ini", "")]}
        else:
            unresolved.append(site("profiles.json", "a profile with an id", json.dumps(p)[:80]))
    return adapter("examples/sim_config/profiles.json", ["profiles[].id"], atoms, unresolved)


def py_atoms(root: Path = ROOT) -> dict:
    sources = gateway_sources(root)
    inis = {p.name: p.read_text() for p in sorted((root / "examples/sim_config").glob("*.ini"))}
    web = "\n".join(p.read_text() for p in sorted((root / "lcnc-webui/src").rglob("*"))
                    if p.suffix in (".ts", ".vue") and not p.name.endswith(".test.ts") and "inventory" not in p.parts)
    return {"adapters": {
        "http": http_adapter(sources),
        "ini": ini_adapter(sources, inis),
        "launcher": launcher_adapter((root / "lcnc-suite").read_text()),
        "sections": sections_adapter(sources),
        "status": status_adapter(sources, web),
        "routines": routines_adapter(sources),
        "remaps": remaps_adapter(inis),
        "profiles": profiles_adapter((root / "examples/sim_config/profiles.json").read_text()),
    }, "excludedFiles": {f: "a test double or a test-run probe, not product code" for f in sorted(NOT_PRODUCT)}}


def main() -> int:
    text = json.dumps(py_atoms(), indent=1, ensure_ascii=False) + "\n"
    if "--write" in sys.argv[1:]:
        OUT.write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
