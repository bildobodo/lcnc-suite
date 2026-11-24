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

lcnc-gateway/test_start_dep_worker.py (TestTheBelievedStartPayloadsAreFresh)
writes the P6-a cases through `write_payload` from the worker under test and
compares them with the committed bytes (Codex R459): a change of the parse's
output fails there until the payloads are regenerated here.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATEWAY = ROOT / "lcnc-gateway"
OUT = ROOT / "scripts/test_fixtures/start_dep_payloads"
CASES = ("e_g53_rdp", "e_single", "e_g91", "e_g43_fixture", "e_time_a", "e_time_b", "e_first_g1",
         "e_g93", "e_g93_limits", "e_all_dep", "e_m600_return", "e_arc_dep", "e_read_dep", "e_g0x0",
         "e_base_first", "e_rotated", "r133_first_g1_xyz", "r133_g43_before_first", "r133_g55_before_first",
         "r133_m6_before_first", "r133_g93_no_limits", "r133_store_before_first_absolute",
         "r133_untracked_writes", "r133_range_after_k", "r134_m6_first_absolute", "r134_m6_only_absolute",
         # the believed start under fixtures that are not zero (P6-a, machine-day
         # F9): startDepPayloads.test.ts binds each at the believed physical
         # start and away from it, the mock page (start-believed.viewer.spec)
         # draws g55_first and mday_head
         "g55_first", "g55_first_rot", "mday_head", "m6_after_g55", "m6_after_g55_rot", "m6_first_g43_zero",
         "inch_g43_g55", "g20_g55", "g43_line_then_x", "g43h_g55_move", "py_motion_first_bound",
         "comp_first_g55", "comp_next_xyz_g55")


def write_payload(case, dest):
    """`case`'s payload as the worker of THIS tree writes it, into `dest`:
    native_start_probe.py in a fresh process (the interpreter keeps state
    between parses in one). Returns the probe's result line — {"skip": reason}
    without LinuxCNC's native modules; a failed run or no payload raises."""
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    p = subprocess.run([sys.executable, str(GATEWAY / "native_start_probe.py"), case, str(dest)],
                       capture_output=True, text=True, cwd=GATEWAY, env=env, timeout=120)
    lines = [ln for ln in p.stdout.splitlines() if ln.startswith("{")]
    if p.returncode != 0 or not lines:
        raise RuntimeError(f"{case}: rc={p.returncode} {p.stdout[-300:]} {p.stderr[-600:]}")
    result = json.loads(lines[-1])
    if "skip" not in result and not Path(dest).exists():
        raise RuntimeError(f"{case}: no payload written")
    return result


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for case in CASES:
        dest = OUT / f"{case}.msgpack"
        try:
            result = write_payload(case, dest)
        except RuntimeError as e:
            sys.exit(str(e))
        if "skip" in result:
            sys.exit(f"{case}: {result['skip']}")
        print(f"{case}: {dest.stat().st_size} bytes")


if __name__ == "__main__":
    main()
