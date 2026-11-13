#!/usr/bin/env python3
"""The REAL LinuxCNC modules against their stubs — a NAME and VALUE check
(package 2, Codex R352/R353 VM352-01, Q352-4; R354 VM-I02).

What a stub claims is read from the stub ITSELF (AST): every public module
name (class, function, constant), every public member of a public class, every
constant's value (`NAME: Final = n`). Each claim must hold on the installed
module: the name exists, the member exists on the real class (for a pure-Python
class also as a `self.<name> =` assignment in its source — an instance
attribute is no class attribute), the value is equal. Imported helper types
and private `_` names are the stub's own helpers, never claims. A real module
may have MORE than its stub claims; a stub may not claim more than the module
has. Names and values only — shapes and types are the stubs', from the
binding's source.

The checked modules: linuxcnc, hal, gcode, rs274.interpret (typings/). The
embedded `interpreter` module exists only inside a parse (gcode_canon) and is
not checkable here — named in typings/BOUNDARY.md.

Imports the modules and inspects their classes: no channel is created, nothing
is polled, nothing binds to a running LinuxCNC or HAL. Run in a process
WITHOUT the tests' fake (test_lcnc_iface.py starts it as a child; the install
probe runs it with the installed venv). Exit 0 and "ok", or 1 and one problem
per line; a missing or broken module or stub is a problem, never a skip.

    python3 -I lcnc-gateway/lcnc_iface_check.py
"""
from __future__ import annotations

import ast
import builtins
import importlib
import inspect
import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(os.path.abspath(__file__)).parent
sys.path.insert(0, str(HERE))

from lcnc_iface import COMMAND_METHODS, STAT_FIELDS  # noqa: E402

TYPINGS = HERE.parent / "typings"
#: module name → its stub, relative to typings/
STUBS: dict[str, str] = {
    "linuxcnc": "linuxcnc.pyi",
    "hal": "hal.pyi",
    "gcode": "gcode.pyi",
    "rs274": "rs274/__init__.pyi",
    "rs274.interpret": "rs274/interpret.pyi",
}
#: the stubs this check cannot reach, each with its reason — every other .pyi
#: under typings/ must be in STUBS (test_lcnc_iface.py holds the two lists to
#: the directory: a new stub is never silently unchecked)
UNCHECKABLE: dict[str, str] = {
    "interpreter.pyi": "the embedded interpreter exists only inside a parse (gcode_canon)",
}


@dataclass
class Claims:
    """What one stub says the real module has — and every declaration the
    reader did not take (`unsupported`, "line: what"): a form outside the
    enforced set is a PROBLEM, never silently no claim (R355 VM-I02)."""
    names: set[str] = field(default_factory=set)
    members: dict[str, set[str]] = field(default_factory=dict)
    values: dict[str, object] = field(default_factory=dict)
    bases: dict[str, list[str]] = field(default_factory=dict)
    unsupported: list[str] = field(default_factory=list)


def _public(name: str) -> bool:
    return not name.startswith("_")


def _dunder(name: str) -> bool:
    return len(name) > 4 and name.startswith("__") and name.endswith("__")


def _literal(node: ast.expr | None) -> tuple[bool, object]:
    """(True, value) for a literal constant (`3`, `-1`, `"x"`, `True`)."""
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float, str, bool)):
        return True, node.value
    if (isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub)
            and isinstance(node.operand, ast.Constant) and isinstance(node.operand.value, (int, float))
            and not isinstance(node.operand.value, bool)):
        return True, -node.operand.value
    return False, None


def _is_docstring_or_ellipsis(node: ast.stmt) -> bool:
    return (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
            and (isinstance(node.value.value, str) or node.value.value is Ellipsis))


#: where a name the reader TRUSTS must come from: a builtin is unbound in the
#: stub (no import, no definition of that name), `overload` from typing
_TRUSTED_FROM = {"property": None, "overload": "typing"}


def _bindings(tree: ast.Module) -> dict[str, str]:
    """Every module-level name the stub binds itself: an import's name → the
    module it comes from, a class / function / assignment → "<local>"."""
    out: dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, ast.ImportFrom):
            for a in node.names:
                out[a.asname or a.name] = node.module or ""
        elif isinstance(node, ast.Import):
            for a in node.names:
                out[(a.asname or a.name).split(".")[0]] = a.name
        elif isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            out[node.name] = "<local>"
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            out[node.target.id] = "<local>"
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    out[target.id] = "<local>"
    return out


def _decorators(fn: ast.FunctionDef, allowed: frozenset[str], bound: dict[str, str]) -> str | None:
    """None when every decorator is an allowed bare name bound where the
    reader trusts it (_TRUSTED_FROM), else the first other."""
    for d in fn.decorator_list:
        if not (isinstance(d, ast.Name) and d.id in allowed and bound.get(d.id) == _TRUSTED_FROM[d.id]):
            return ast.unparse(d)
    return None


#: THE stub forms the reader takes — everything else is refused with its line:
#:   module: the docstring, a plain import (`import x`, `from x import a, b`
#:     — helpers, no claims; an `as` alias or `*` RE-EXPORTS in a stub and is
#:     refused), a class, a function (@overload only), `NAME: T` or
#:     `NAME: Final = <literal>` (a number, a negative number, a string, a bool);
#:   class:  the docstring or `...`, a method (@property / @overload only —
#:     `property` unbound in the stub, `overload` from typing), `name: T` (no
#:     value); a PUBLIC class's bases are builtin types only and BOUND to the
#:     builtin (no import or definition of that name in the stub — a claim,
#:     checked natively) — any other base could carry members the reader
#:     never sees;
#:   a dunder (`__init__`, `__getitem__` …) is a member like any other — a
#:     claim; __getattr__ / __getattribute__ (module or class, as a method or
#:     an annotation) make EVERY name check and are refused;
#:   a private `_` class at module level is a helper: its body is not read;
#:     any OTHER private name (a `_member` of a public class, a module-level
#:     `_function` or `_NAME`) is refused — never silently no claim.
_RESOLVERS = frozenset({"__getattr__", "__getattribute__"})


def stub_claims(text: str) -> Claims:
    """The public names, class members, constant values and builtin bases a
    stub declares — from a narrow, enforced set of forms."""
    out = Claims()
    tree = ast.parse(text)
    bound = _bindings(tree)

    def refuse(node: ast.stmt, what: str) -> None:
        out.unsupported.append(f"line {node.lineno}: {what} — not a stub form the check reads")

    for node in tree.body:
        if _is_docstring_or_ellipsis(node):
            continue
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                if alias.name == "*" or alias.asname is not None:
                    refuse(node, f"import {ast.unparse(node)!r} re-exports a name")
            continue
        if isinstance(node, ast.ClassDef):
            if node.decorator_list or node.keywords:
                refuse(node, f"class {node.name} with decorators or keywords")
                continue
            if not _public(node.name):
                continue
            out.names.add(node.name)
            bases: list[str] = []
            for b in node.bases:
                if (isinstance(b, ast.Name) and isinstance(getattr(builtins, b.id, None), type)
                        and b.id not in bound):
                    bases.append(b.id)
                elif isinstance(b, ast.Name) and b.id in bound:
                    refuse(node, f"class {node.name}: base {b.id} is bound in this stub "
                                 f"({bound[b.id]}), not the builtin — only a builtin base is read")
                else:
                    refuse(node, f"class {node.name}: base {ast.unparse(b)} — only a builtin base is read")
            out.bases[node.name] = bases
            members: set[str] = set()
            for item in node.body:
                if _is_docstring_or_ellipsis(item):
                    continue
                if isinstance(item, ast.FunctionDef):
                    other = _decorators(item, frozenset({"property", "overload"}), bound)
                    if item.name in _RESOLVERS:
                        refuse(item, f"{node.name}.{item.name} makes every member check")
                    elif other is not None:
                        refuse(item, f"{node.name}.{item.name}: decorator @{other}")
                    elif _public(item.name) or _dunder(item.name):
                        members.add(item.name)
                    else:
                        refuse(item, f"{node.name}.{item.name}: a private member of a public class")
                elif (isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name)
                      and item.value is None):
                    if item.target.id in _RESOLVERS:
                        refuse(item, f"{node.name}.{item.target.id} makes every member check")
                    elif _public(item.target.id) or _dunder(item.target.id):
                        members.add(item.target.id)
                    else:
                        refuse(item, f"{node.name}.{item.target.id}: a private member of a public class")
                else:
                    refuse(item, f"class {node.name}: {type(item).__name__} {ast.unparse(item)[:60]!r}")
            out.members[node.name] = members
        elif isinstance(node, ast.FunctionDef):
            other = _decorators(node, frozenset({"overload"}), bound)
            if node.name in _RESOLVERS:
                refuse(node, f"module {node.name} makes every name check")
            elif other is not None:
                refuse(node, f"{node.name}: decorator @{other}")
            elif _public(node.name) or _dunder(node.name):
                out.names.add(node.name)
            else:
                refuse(node, f"{node.name}: a private module-level function")
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            name = node.target.id
            if name in _RESOLVERS:
                refuse(node, f"module {name} makes every name check")
                continue
            if not (_public(name) or _dunder(name)):
                refuse(node, f"{name}: a private module-level name")
                continue
            if node.value is None:
                out.names.add(name)
                continue
            ok, value = _literal(node.value)
            if not ok:
                refuse(node, f"{name}: a computed value {ast.unparse(node.value)!r} — write the literal")
            else:
                out.names.add(name)
                out.values[name] = value
        else:
            refuse(node, f"{type(node).__name__} {ast.unparse(node)[:60]!r}")
    return out


def _source_attributes(cls: type) -> set[str]:
    """`self.<name> =` assignments in a pure-Python class's own source."""
    try:
        tree = ast.parse(inspect.getsource(cls))
    except (OSError, TypeError):
        return set()
    return {t.attr for n in ast.walk(tree) if isinstance(n, (ast.Assign, ast.AnnAssign, ast.AugAssign))
            for t in (n.targets if isinstance(n, ast.Assign) else [n.target])
            if isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == "self"}


def module_problems(modname: str, module: object, claims: Claims) -> list[str]:
    out: list[str] = [f"the stub of {modname}, {u}" for u in claims.unsupported]
    for name in sorted(claims.names):
        if not hasattr(module, name):
            out.append(f"{modname}.{name} is claimed by the stub and missing")
    for cls_name, members in sorted(claims.members.items()):
        real = getattr(module, cls_name, None)
        if real is None:
            continue
        have = set(dir(real)) | (_source_attributes(real) if isinstance(real, type) else set())
        out += [f"{modname}.{cls_name}.{m} is claimed by the stub and missing"
                for m in sorted(members) if m not in have]
        for base in claims.bases.get(cls_name, []):
            builtin = getattr(builtins, base, None)
            if isinstance(builtin, type) and not (isinstance(real, type) and issubclass(real, builtin)):
                out.append(f"{modname}.{cls_name} is claimed a {base} subclass and is not")
    for name, value in sorted(claims.values.items()):
        if hasattr(module, name) and getattr(module, name) != value:
            out.append(f"{modname}.{name} is {getattr(module, name)!r}, the stub says {value!r}")
    return out


def problems(modules: Mapping[str, object] | None = None,
             stubs: Mapping[str, str] | None = None) -> list[str]:
    """Every stub claim against its module. `modules` / `stubs` (name → module
    object / stub text) replace the installed modules and the typings/ files —
    the counter-cases' surrogates; by default both are the real ones."""
    out: list[str] = []
    for modname, rel in STUBS.items():
        if stubs is not None:
            text = stubs.get(modname)
            if text is None:
                out.append(f"no stub text for {modname}")
                continue
        else:
            try:
                text = (TYPINGS / rel).read_text()
            except OSError as e:
                out.append(f"the stub of {modname} does not read: {e}")
                continue
        if modules is not None:
            module = modules.get(modname)
            if module is None:
                out.append(f"no module {modname}")
                continue
        else:
            try:
                module = importlib.import_module(modname)
            except Exception as e:  # noqa: BLE001 — the reason is the finding
                out.append(f"{modname} does not import: {type(e).__name__}: {e}")
                continue
            if getattr(module, "__lcnc_fake__", False):
                out.append(f"the tests' fake answered for {modname}, not the binding — run without the fake")
                continue
        out += module_problems(modname, module, stub_claims(text))
        if modname == "linuxcnc":
            # the interface the code needs (lcnc_iface) — implied by stub ⊇
            # Protocol (pyright) and stub ⊆ module (above); named here so a
            # gap reads as the code's need
            stat, cmd = getattr(module, "stat", None), getattr(module, "command", None)
            stat_names, cmd_names = set(dir(stat)), set(dir(cmd))
            out += [f"stat.{n} is missing (a guaranteed field)" for n in STAT_FIELDS if n not in stat_names]
            out += [f"command.{n} is missing" for n in COMMAND_METHODS if n not in cmd_names]
    return out


def main() -> int:
    found = problems()
    for p in found:
        print(p)
    if not found:
        print("ok")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
