#!/usr/bin/env python3
"""The backend gate's type check (package 2, plan vor-maschine R352/R353):
the pyright PINNED in lcnc-webui/package.json (npm, with its lockfile) as
`npm ci` installed it — never fetched at gate time — with the root
pyrightconfig.json and the RUNNING Python's import paths (--pythonpath: the
gate's venv locally, CI's interpreter there). A missing pyright is a FAIL
with its reason (exit 2), never a skip. Extra arguments go to pyright (a
test checks one file through exactly this path).

    python3 scripts/run_pyright.py [pyright args…]
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYRIGHT = ROOT / "lcnc-webui" / "node_modules" / ".bin" / "pyright"
CONFIG = ROOT / "pyrightconfig.json"


def main(argv: list[str], pyright: Path = PYRIGHT) -> int:
    if not pyright.exists():
        print(f"pyright is not installed ({pyright}): it is pinned in lcnc-webui/package.json — "
              "run `npm ci` there", file=sys.stderr)
        return 2
    return subprocess.call([str(pyright), "-p", str(CONFIG), "--pythonpath", sys.executable, *argv], cwd=ROOT)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
