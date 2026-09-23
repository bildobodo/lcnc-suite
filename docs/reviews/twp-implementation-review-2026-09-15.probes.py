"""Offline follow-up observations at feat/twp 584083b.

Run with the gateway venv, passing an isolated checkout as argv[1]. The
existing dispatch-test helper installs fake_linuxcnc before importing the
gateway; every CMD call is recorded, never sent to LinuxCNC.
"""
import json
from pathlib import Path
import re
import sys
from unittest.mock import AsyncMock, patch

sys.dont_write_bytecode = True
root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root / "lcnc-gateway"))
from test_command_dispatch import TestGoToZeroAndJogStopDispatch, gateway

report = {}
case = TestGoToZeroAndJogStopDispatch()
case.setUp()
try:
    gateway._kins_is_switchable = lambda: True
    gateway._twp_capable = lambda: False
    with patch.object(gateway, "_identity_first", return_value=True):
        results = []
        for desired in (0, 1):
            response = case._send({"cmd": "set_kins_mode", "mode": desired},
                                  kins_type=1 - desired, g5x_index=1)
            line = response.get("line", "")
            remap = root / "examples/sim_config/remap_subs" / (line[1:] + "remap.ngc")
            raw = re.search(r"#<kinstype>\s*=\s*(\d+)", remap.read_text()).group(1)
            results.append({"requested": desired, "response": response,
                            "shipped_trt_raw_result": int(raw)})
        report["trt_mode_selection"] = results
finally:
    case.tearDown()

case = TestGoToZeroAndJogStopDispatch()
case.setUp()
try:
    gateway._kins_is_switchable = lambda: True
    gateway._twp_capable = lambda: True
    # Controller STAT has reached G55; the last published snapshot and the
    # keypad still describe G54. The handler polls STAT again before writing.
    gateway.STAT.g5x_index = 2
    with patch.object(gateway, "_stamp_wcs_provenance", new=AsyncMock(return_value={})):
        response = case._send(
            {"cmd": "touchoff", "axes": {"X": 1.5},
             "expect": {"kins_type": 0, "g5x_index": 1}},
            kins_type=0, g5x_index=1)
    report["touchoff_stale_snapshot"] = {
        "expected_fixture": 1, "controller_fixture": 2,
        "ok": response.get("ok"), "reported_fixture": response.get("index"),
        "recorded_mdi": case._mdi_lines(),
    }
finally:
    case.tearDown()

print(json.dumps(report, indent=2))
