#!/usr/bin/env python3
"""Write the preview payloads of the limit-origin cases (Codex R177 VP-I130).

Each payload is the REAL parse worker's output under LinuxCNC's native
offline interpreter (lcnc-gateway/native_start_probe.py, one process per
case, synthetic STAT, X max 500 — no running LinuxCNC, no machine command),
encoded as the gateway publishes it. lcnc-webui/src/viewer/limitOriginPayloads.test.ts
decodes them through the client's own path and places their limit records:
a subroutine's L5 against the main program's L5, both, an unmarked
subroutine, two call sites, one site run twice, an arc, a collinear loop.

    lcnc-gateway/.venv/bin/python scripts/gen_limit_origin_payloads.py
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATEWAY = ROOT / "lcnc-gateway"
OUT = ROOT / "scripts/test_fixtures/limit_origin_payloads"
CASES = ("lim_sub", "lim_main", "lim_both", "lim_unmarked", "lim_two_sites", "lim_loop_site", "lim_arc", "lim_collinear")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    for case in CASES:
        dest = OUT / f"{case}.msgpack"
        p = subprocess.run([sys.executable, str(GATEWAY / "native_start_probe.py"), case, str(dest)],
                           capture_output=True, text=True, cwd=GATEWAY, env=env, timeout=120)
        if p.returncode != 0 or not dest.exists() or '"skip"' in p.stdout:
            sys.exit(f"{case}: rc={p.returncode} {p.stdout[-300:]} {p.stderr[-600:]}")
        print(f"{case}: {dest.stat().st_size} bytes")


if __name__ == "__main__":
    main()
