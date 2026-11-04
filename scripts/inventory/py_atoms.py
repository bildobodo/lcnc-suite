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

# The read registry (Codex R267/R268): wrappers by module and name with the
# positions of their section and key arguments; consumers that take a read
# function, with the parameter that carries it.
WRAPPERS = {("gateway.py", "_ini_float"): (1, 2), ("gcode_parse_worker.py", "_ini_vel"): (0, 1)}
CONSUMERS = {("gateway_util.py", "read_axis_limits"): "ini_find"}
FAMILY_KEY = re.compile(r"\{[^}]*\}")


def _receivers(tree: ast.AST) -> set[str]:
    """Names bound from linuxcnc.ini(…) or configparser.ConfigParser(…)."""
    out = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Assign) and isinstance(n.value, ast.Call):
            f = ast.unparse(n.value.func)
            if f in ("linuxcnc.ini", "configparser.ConfigParser"):
                out |= {t.id for t in n.targets if isinstance(t, ast.Name)}
    return out


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


def _functions(tree: ast.AST):
    """(function, its node) for every def, innermost last; module scope as None."""
    stack: list = []

    def visit(n, fn):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            fn = n
        for c in ast.iter_child_nodes(n):
            stack.append((c, fn))
            visit(c, fn)
    visit(tree, None)
    return stack


def ini_adapter(sources: dict[str, str], example_inis: dict[str, str]) -> dict:
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
        recv = _receivers(tree)
        wrapper_defs = {name for (f, name) in WRAPPERS if f == file}
        consumer_defs = {name: p for (f, name), p in CONSUMERS.items() if f == file}
        for n, fn in _functions(tree):
            in_wrapper = fn is not None and fn.name in wrapper_defs
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ("find", "findall", "get"):
                v = n.func.value
                is_ini = (isinstance(v, ast.Name) and v.id in recv) or (
                    isinstance(v, ast.Call) and ast.unparse(v.func) == "linuxcnc.ini")
                if not is_ini or (n.func.attr == "get" and not (isinstance(v, ast.Name) and v.id in recv)):
                    continue
                if in_wrapper:
                    continue   # a wrapper's body: its reads are its call sites'
                if len(n.args) < 2:
                    unresolved.append(site(file, f"<ini>.{n.func.attr}", ast.unparse(n)))
                    continue
                if fn is not None and all(isinstance(x, ast.Name) and x.id in {p.arg for p in fn.args.args} for x in n.args[:2]):
                    continue   # reads its parameters: a wrapper — reported once, below
                read(file, _string(n.args[0], fn), _string(n.args[1], fn), f"<ini>.{n.func.attr}(S, N)", ast.unparse(n),
                     many=n.func.attr == "findall")
            elif isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and (file, n.func.id) in WRAPPERS:
                si, ki = WRAPPERS[(file, n.func.id)]
                args = n.args
                if len(args) <= max(si, ki):
                    unresolved.append(site(file, f"{n.func.id}(…)", ast.unparse(n)))
                    continue
                read(file, _string(args[si], fn), _string(args[ki], fn), f"{n.func.id}(S, N)", ast.unparse(n))
            elif isinstance(n, ast.Call) and fn is not None and fn.name in consumer_defs \
                    and isinstance(n.func, ast.Name) and n.func.id == consumer_defs[fn.name]:
                read(file, _string(n.args[0], fn) if n.args else None, _string(n.args[1], fn) if len(n.args) > 1 else None,
                     f"{fn.name}'s {n.func.id}(S, N)", ast.unparse(n))
            # a read function handed on: only to a registered consumer
            if isinstance(n, ast.Call):
                for a in n.args:
                    if isinstance(a, ast.Attribute) and a.attr in ("find", "findall") and isinstance(a.value, ast.Name) and a.value.id in recv:
                        callee = ast.unparse(n.func).split(".")[-1]
                        if not any(name == callee for (_, name) in CONSUMERS):
                            unresolved.append(site(file, "read function handed on", ast.unparse(n)))
            # a receiver used any other way (attribute, argument, return)
            if isinstance(n, ast.Name) and n.id in recv and isinstance(n.ctx, ast.Load):
                pass
        # an unregistered function that reads a receiver with a non-literal
        # section or key: a new wrapper
        for n, fn in _functions(tree):
            if fn is None or fn.name in wrapper_defs or fn.name in consumer_defs:
                continue
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ("find", "findall") \
                    and isinstance(n.func.value, ast.Name) and n.func.value.id in recv and len(n.args) >= 2 \
                    and all(isinstance(a, ast.Name) and a.id in {x.arg for x in fn.args.args} for a in n.args[:2]):
                unresolved.append(site(file, "an unregistered wrapper", f"{fn.name}: {ast.unparse(n)}"))
    return adapter("lcnc-gateway/*.py — every INI read", [
        "<ini>.find|findall(S, N) on a name bound from linuxcnc.ini(…) / configparser.ConfigParser(…)",
        "linuxcnc.ini(…).find(S, N)",
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
