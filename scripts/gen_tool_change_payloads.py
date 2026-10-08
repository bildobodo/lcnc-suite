#!/usr/bin/env python3
"""Write the preview payloads of the tool-change / tool-offset cases.

Each payload is the REAL parse worker's output under LinuxCNC's native
offline interpreter (lcnc-gateway/native_start_probe.py, one process per
case, synthetic STAT — no running LinuxCNC, no machine command), encoded as
the gateway publishes it. lcnc-webui/src/viewer/toolChangePayloads.test.ts
decodes them through the client's own path and sweeps them: the payload →
track → collision layer the moves after a G43 / an M6 must hold in
(operator 2026-10-07, haus.ngc L18; Codex R92–R97 VP-I51 / VP-I53–I55).

    lcnc-gateway/.venv/bin/python scripts/gen_tool_change_payloads.py
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATEWAY = ROOT / "lcnc-gateway"
OUT = ROOT / "scripts/test_fixtures/tool_change_payloads"
CASES = ("g43_mid", "g43_g1_block", "r92_m6_feed", "r92_m6_feed_then_rapid", "r92_m6_arc",
         "r92_m6_g43_feed", "m6_tc_position", "m6_tc_partial", "m6_in_place", "r92_m6_quill_g30",
         "r93_inline_g91_cycle", "r93_rotated_partial", "r93_g90_same_block",
         "r94_g98_cycle", "r94_g98_below_r", "r94_rotated_after_partial", "r94_rotated_complete",
         "r94_g76_returns_x",
         "r95_g92_from_stale", "r95_l20_inactive_hidden", "r95_l2_constant", "r95_oword_g92", "r95_sub_g92",
         "r96_arc_interior_limit", "r96_g92_decimal", "r96_branch_not_run",
         "r97_l_plus_active", "r97_branch_same_g92", "r97_arc_braking")


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
