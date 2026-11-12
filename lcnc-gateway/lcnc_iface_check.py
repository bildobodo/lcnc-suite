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
    "rs274.interpret": "rs274/interpret.pyi",
}


@dataclass
class Claims:
    """What one stub says the real module has."""
    names: set[str] = field(default_factory=set)
    members: dict[str, set[str]] = field(default_factory=dict)
    values: dict[str, object] = field(default_factory=dict)


def _public(name: str) -> bool:
    return not name.startswith("_")


def stub_claims(text: str) -> Claims:
    """The public names, class members and constant values a stub declares."""
    out = Claims()
    for node in ast.parse(text).body:
        if isinstance(node, ast.ClassDef) and _public(node.name):
            out.names.add(node.name)
            members: set[str] = set()
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and _public(item.name):
                    members.add(item.name)
                elif (isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name)
                      and _public(item.target.id)):
                    members.add(item.target.id)
            out.members[node.name] = members
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and _public(node.name):
            out.names.add(node.name)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and _public(node.target.id):
            out.names.add(node.target.id)
            if isinstance(node.value, ast.Constant):
                out.values[node.target.id] = node.value.value
            elif (isinstance(node.value, ast.UnaryOp) and isinstance(node.value.op, ast.USub)
                  and isinstance(node.value.operand, ast.Constant)):
                operand = node.value.operand.value
                if isinstance(operand, (int, float)):
                    out.values[node.target.id] = -operand
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and _public(target.id):
                    out.names.add(target.id)
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
    out: list[str] = []
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
