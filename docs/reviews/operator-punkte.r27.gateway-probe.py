"""R27 G30 follow-up: real dispatcher, fake_linuxcnc and tempfiles only.
No live gateway/INI changes; the simulated HAL reader is a Python lambda.
Run: lcnc-gateway/.venv/bin/python docs/reviews/operator-punkte.r27.gateway-probe.py
"""
import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lcnc-gateway"))
from test_g30 import _G30Case, gateway, linuxcnc
from test_command_dispatch import _payload

cases = []
for kind in ("stationary", "moving_before", "moving_during_synch", "frame_during_synch", "reader_missing_after_synch", "stat_poll_fails_after_synch", "fixed_kins_without_reader"):
    case = _G30Case()
    case.setUp()
    pin = {"kins_type": None if kind == "fixed_kins_without_reader" else 0}
    try:
        gateway._shared_status = _payload(inpos=True, current_vel=0.0, kins_type=0)
        if kind == "moving_before":
            gateway._shared_status.inpos = gateway.STAT.inpos = False
            gateway._shared_status.current_vel = gateway.STAT.current_vel = 12.0
        original_synch = case.task.task_plan_synch
        def synch():
            original_synch()
            if kind == "moving_during_synch":
                gateway.STAT.current_vel = 12.0
            if kind == "frame_during_synch":
                # The reader has the new frame; the 30 Hz status broadcast
                # still holds the previous frame. STAT.poll() does not
                # refresh that shared payload or read the kinematics pin.
                pin["kins_type"] = 1
            if kind == "reader_missing_after_synch":
                pin["kins_type"] = None
            if kind == "stat_poll_fails_after_synch":
                def unavailable_poll():
                    raise RuntimeError("R27 simulated STAT read failure")
                gateway.STAT.poll = unavailable_poll
        case.task.task_plan_synch = synch
        with patch.object(gateway, "_kins_is_switchable", lambda: kind != "fixed_kins_without_reader"), \
             patch.object(gateway, "_identity_first", lambda: True), \
             patch.object(gateway, "_twp_capable", lambda: False), \
             patch.object(gateway, "_reader_get", lambda name: pin.get(name)):
            reply = asyncio.run(gateway.handle_command({"cmd": "capture_g30"}, True))
            current_policy = gateway._live_policy_state(True)
            refreshed = gateway._controller_touchoff_state(current_policy)
            fresh_denial = gateway.check_command("capture_g30", refreshed)
        cases.append({"case": kind, "shared_frame": gateway._shared_status.kins_type,
                      "reader_frame": pin["kins_type"], "reply": reply,
                      "fresh_frame_denial": fresh_denial, "calls": case.task.calls,
                      "matches_contract": reply.get("ok") is (kind in ("stationary", "fixed_kins_without_reader"))})
    finally:
        case.doCleanups()

result = {"head": "603e384", "isolation": "fake_linuxcnc; temporary files; mocked HAL reader; no network", "cases": cases}
Path(__file__).with_suffix('.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
