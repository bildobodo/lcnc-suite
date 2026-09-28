"""R25: real G30 dispatcher, fake_linuxcnc, temporary parameter files only.
Run from repository root:
  lcnc-gateway/.venv/bin/python docs/reviews/operator-punkte.r25.gateway-probe.py
This probe makes no connection to LinuxCNC or the live gateway.
"""
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lcnc-gateway"))
from test_g30 import _G30Case, gateway, linuxcnc
from test_command_dispatch import _payload

results = []
for moving in (False, True):
    case = _G30Case()
    case.setUp()
    try:
        gateway.STAT.task_mode = linuxcnc.MODE_MANUAL
        gateway.STAT.inpos = not moving
        gateway.STAT.current_vel = 12.0 if moving else 0.0
        gateway._shared_status = _payload(
            task_mode=linuxcnc.MODE_MANUAL, inpos=not moving,
            current_vel=gateway.STAT.current_vel,
        )
        reply = asyncio.run(gateway.handle_command({"cmd": "capture_g30"}, True))
        results.append({
            "case": "capture_while_jogging" if moving else "stationary_control",
            "input": {"task_mode": "MANUAL", "interp_state": "IDLE", "inpos": not moving,
                      "current_vel": gateway.STAT.current_vel},
            "reply": reply, "calls": case.task.calls,
            "expected_ok": not moving,
            "matches_contract": reply.get("ok") is (not moving),
        })
    finally:
        case.doCleanups()

out = {"head": "5212c83", "isolation": "fake_linuxcnc; temporary files; no network", "cases": results}
path = Path(__file__).with_suffix(".json")
path.write_text(json.dumps(out, indent=2) + "\n")
print(json.dumps(out, indent=2))
