#!/usr/bin/env python3
"""Write the preview payloads of the path-kinds cases (2026-11-25): programs
whose rapid vertices lie on a chord of the rapid stream although feeds run
between, each as the worker ships it and once with nothing thinned
(`<case>.full.msgpack`, START_PROBE_UNTHINNED).

Each payload is the REAL parse worker's output under LinuxCNC's native
offline interpreter (lcnc-gateway/native_start_probe.py, one process per
case, synthetic STAT — no running LinuxCNC, no machine command), encoded as
the gateway publishes it. lcnc-webui/src/viewer/pathKinds.test.ts takes both
through every layer of the client the path passes — the merged track, the
drawn sections, the display levels, the part-frame bake, the check's copy and
its sweep — and compares the runs of one kind, the place and line at the
un-thinned path's times and the contacts of the check; test_path_kinds_worker.py
compares the committed bytes with the worker under test.

    lcnc-gateway/.venv/bin/python scripts/gen_path_kinds_payloads.py
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATEWAY = ROOT / "lcnc-gateway"
OUT = ROOT / "scripts/test_fixtures/path_kinds_payloads"
CASES = ("pk_g83_99", "pk_g83_high_98", "pk_g89_98", "pk_hidden_rapid", "pk_ramp_levels", "pk_levels",
         "pk_helix", "pk_g43", "pk_rotary", "pk_kins", "pk_inch",
         # the course inside a run of one kind (Codex R487 H1)
         "pk_rev", "pk_rev_one", "pk_rev_two", "pk_rev_many", "pk_rev_feed", "pk_rev_sub", "pk_rev_inch", "pk_rev_rotary",
         "pk_rev_rotary_x", "pk_even", "pk_speeds", "pk_line_tail", "pk_line_subs")


def write_payload(case, dest, full=False):
    """One case's payload to `dest`; a failed run raises."""
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    env.pop("START_PROBE_UNTHINNED", None)
    if full:
        env["START_PROBE_UNTHINNED"] = "1"
    p = subprocess.run([sys.executable, str(GATEWAY / "native_start_probe.py"), case, str(dest)],
                       capture_output=True, text=True, cwd=GATEWAY, env=env, timeout=120)
    if '"skip"' in p.stdout:
        return False
    if p.returncode != 0 or not dest.exists():
        raise RuntimeError(f"{case}: rc={p.returncode} {p.stdout[-300:]} {p.stderr[-600:]}")
    return True


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for case in CASES:
        for full in (False, True):
            dest = OUT / f"{case}{'.full' if full else ''}.msgpack"
            if not write_payload(case, dest, full):
                sys.exit(f"{case}: no native LinuxCNC modules here")
            print(f"{dest.name}: {dest.stat().st_size} bytes")


if __name__ == "__main__":
    main()
