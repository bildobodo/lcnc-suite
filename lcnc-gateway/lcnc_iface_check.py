#!/usr/bin/env python3
"""The REAL binding against lcnc_iface — a NAME check (package 2, Codex
R352/R353 VM352-01, Q352-4): every guaranteed status field and every command
the code calls exists on the installed `linuxcnc`, and the fake's constants
carry the binding's values. Names and constant values only — parameter
shapes and return types are the stub's, from the binding's source.

Imports `linuxcnc` and inspects its classes: no channel is created, nothing
is polled, nothing binds to a running LinuxCNC. Run in a process WITHOUT the
tests' fake (test_lcnc_iface.py starts it as a child; the install probe runs
it with the installed venv). Exit 0 and "ok", or 1 and one problem per line;
a missing or broken binding is a problem, never a skip.

    python3 -I lcnc-gateway/lcnc_iface_check.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lcnc_iface import COMMAND_METHODS, OPTIONAL_STAT_FIELDS, STAT_FIELDS  # noqa: E402


def problems() -> list[str]:
    try:
        import linuxcnc
    except Exception as e:  # noqa: BLE001 — the reason is the finding
        return [f"the linuxcnc binding does not import: {type(e).__name__}: {e}"]
    if getattr(linuxcnc, "__lcnc_fake__", False):
        return ["the tests' fake answered, not the binding — run without the fake"]
    import fake_linuxcnc
    out = []
    stat_names, cmd_names = set(dir(linuxcnc.stat)), set(dir(linuxcnc.command))
    out += [f"stat.{n} is missing (a guaranteed field)" for n in STAT_FIELDS if n not in stat_names]
    out += [f"command.{n} is missing" for n in COMMAND_METHODS if n not in cmd_names]
    out += [f"stat.{n} is optional AND present: make it guaranteed or say why not"
            for n in sorted(OPTIONAL_STAT_FIELDS) if n in stat_names]
    for name, value in fake_linuxcnc.CONSTANTS.items():
        real = getattr(linuxcnc, name, None)
        if real != value:
            out.append(f"linuxcnc.{name} is {real!r}, the fake says {value!r}")
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
