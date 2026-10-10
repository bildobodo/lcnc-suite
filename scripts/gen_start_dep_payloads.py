#!/usr/bin/env python3
"""Write the preview payloads of the start-dependent beginning cases.

Each payload is the REAL parse worker's output under LinuxCNC's native
offline interpreter (lcnc-gateway/native_start_probe.py, one process per
case, synthetic STAT — no running LinuxCNC, no machine command), encoded as
the gateway publishes it. lcnc-webui/src/viewer/startDepPayloads.test.ts
takes them through the client's decode, the base and the entry track, and
the sweep: the program's beginning bound to a start
(docs/reviews/parity-ef.plan.md E, E10 Nr. 15/16/18).

    lcnc-gateway/.venv/bin/python scripts/gen_start_dep_payloads.py
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATEWAY = ROOT / "lcnc-gateway"
OUT = ROOT / "scripts/test_fixtures/start_dep_payloads"
CASES = ("e_g53_rdp", "e_single", "e_g91", "e_g43_fixture", "e_time_a", "e_time_b", "e_first_g1",
         "e_g93", "e_g93_limits", "e_all_dep", "e_m600_return", "e_arc_dep", "e_read_dep", "e_g0x0")


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
