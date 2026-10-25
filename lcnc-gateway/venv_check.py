#!/usr/bin/env python3
"""numpy in the gateway venv must be the system's (GitHub issues #12, #42).

The venv is created with --system-site-packages, so the LinuxCNC bindings
and the system numpy / scipy are visible in it. A pip install that puts
numpy INTO the venv — listed in requirements.txt (#12) or pulled as a
dependency (#42: opencv-python-headless 4.12+ declares numpy>=2) — shadows
the system copy for every process that runs with the venv active, and the
system's compiled numpy users (scipy) were built against the system copy.

install.sh and setup-venv.sh run this right after their pip step. Run it by
hand after a manual `pip install -r requirements.txt`:

    lcnc-gateway/.venv/bin/python3 lcnc-gateway/venv_check.py

Exit 0: numpy comes from outside the venv. Exit 1: numpy is shadowed, not
importable, or this is not a venv's python — the reason on stderr. It never
repairs: `pip uninstall numpy` leaves the package that pulled it without
the numpy it declares, and the next `pip install -r` installs it again.
"""
from __future__ import annotations

import os
import re
import sys
from typing import Iterable, List, Optional, Tuple

# A requirement naming numpy itself — "numpy>=2; python_version >= '3.9'",
# "numpy (>=1.2)" — never numpydoc or numpy-financial.
_NUMPY_REQ = re.compile(r"^\s*numpy\s*(?:$|[<>=!~;\[(@ ])", re.IGNORECASE)


def _inside(path: str, root: str) -> bool:
    path = os.path.realpath(path)
    root = os.path.realpath(root)
    return path == root or path.startswith(root.rstrip(os.sep) + os.sep)


def numpy_problem(numpy_file: Optional[str], prefix: str,
                  base_prefix: str) -> Optional[str]:
    """None when numpy is the system's; else what is wrong.

    `numpy_file` is numpy's `__file__` (None = not importable); `prefix` and
    `base_prefix` are the interpreter's `sys.prefix` / `sys.base_prefix`.
    """
    if os.path.realpath(prefix) == os.path.realpath(base_prefix):
        return (f"{prefix} is not a venv — run this with the venv's python3 "
                "(lcnc-gateway/.venv/bin/python3)")
    if numpy_file is None:
        return ("numpy is not importable — install the system package "
                "(apt install python3-numpy); never pip-install it into the venv")
    if _inside(numpy_file, prefix):
        return (f"numpy is installed IN the venv ({os.path.dirname(numpy_file)}) "
                "and shadows the system numpy")
    return None


def requires_numpy(requires: Optional[Iterable[str]]) -> bool:
    """True when a distribution's Requires-Dist lines name numpy."""
    return any(_NUMPY_REQ.match(r) for r in (requires or ()))


def venv_numpy_users(prefix: str) -> List[Tuple[str, str]]:
    """(name, version) of every distribution installed in the venv that
    declares numpy — the package that pulled it in."""
    from importlib import metadata
    users = []
    for dist in metadata.distributions():
        if not _inside(str(dist.locate_file("")), prefix):
            continue
        name = dist.metadata["Name"] or "?"
        if name.lower() != "numpy" and requires_numpy(dist.requires):
            users.append((name, dist.version))
    return sorted(users)


def main() -> int:
    try:
        import numpy
        numpy_file: Optional[str] = numpy.__file__
        version = numpy.__version__
    except ImportError:
        numpy_file, version = None, ""
    problem = numpy_problem(numpy_file, sys.prefix, sys.base_prefix)
    if problem is None:
        print(f"OK: numpy {version} from {os.path.dirname(numpy_file or '')}")
        return 0
    print(f"ERROR: {problem}", file=sys.stderr)
    if numpy_file is not None and _inside(numpy_file, sys.prefix):
        users = venv_numpy_users(sys.prefix)
        if users:
            print("  venv packages requiring numpy: "
                  + ", ".join(f"{n} {v}" for n, v in users), file=sys.stderr)
            print("  cap the one that pulled it in (lcnc-gateway/requirements.txt) "
                  "to a release the system numpy satisfies — see issue #42",
                  file=sys.stderr)
        print(f"  stopgap: {sys.prefix}/bin/pip uninstall -y numpy",
              file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
