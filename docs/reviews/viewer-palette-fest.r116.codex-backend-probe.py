"""R116: actual dispatch under the repository's fake_linuxcnc, no controller.
Run with the archive's lcnc-gateway on PYTHONPATH. Only temp test files written.
"""
import asyncio
import json
import sys
from unittest.mock import patch
from test_command_dispatch import TestHandlerExecution, gateway, linuxcnc

case = TestHandlerExecution()
case.setUp()
try:
    cmd, seen = case._run_basis_setup()
    case._idle_auto()
    for key, value in {"g5x_index": 1, "g5x_offset": [0.0]*9,
                       "g92_offset": [0.0]*9, "rotation_xy": 0.0,
                       "tool_offset": [0.0]*9, "tool_in_spindle": 0,
                       "tool_table": [], "axis_mask": 7,
                       "actual_position": [0.0]*9}.items():
        setattr(gateway.STAT, key, value)
    ctx = {"file": case.prog, "g5x_index": 1, "var_patches": {"5221": "0.0"}}
    with patch.object(gateway._bulk, "start_ctx", lambda f: dict(ctx)), \
            patch.object(gateway._bulk, "run_start_check", lambda *a, **k: (True, None)):
        assert case._send({"cmd": "cycle_start"})["ok"]
    old = gateway._run_basis
    assert old["state"] == "sent" and old["verified"]
    # The first run ended. A new start reaches the command path, but its
    # extra snapshot poll fails once. CMD itself remains healthy (fake spy).
    case._idle_auto()
    gateway._source_lock = None
    def bad_poll():
        raise RuntimeError("synthetic transient snapshot failure")
    with patch.object(gateway.STAT, "poll", bad_poll), \
            patch.object(gateway, "_ts_mark_assumed", lambda keys: None):
        asyncio.run(gateway._cmd_blocking(cmd.auto, linuxcnc.AUTO_RUN, 0, wait=None))
    selected = gateway._run_for_pin(case.prog)
    out = {
        "scope": "Real _cmd_blocking/_begin_run_basis/_run_for_pin under fake_linuxcnc. No live command. First run verification is a fixture; second-run poll failure is injected.",
        "command_spy": seen,
        "previous_run_id": old["run_id"],
        "after_new_start": gateway._run_basis_status(),
        "same_record_after_new_start": gateway._run_basis is old,
        "old_verified_context_selected_for_next_pin": selected is old,
    }
    assert len(seen) == 2
    assert gateway._run_basis is old and selected is old
    with open(sys.argv[1], "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print("REPRODUCED: new AUTO_RUN was sent after snapshot poll failed; previous verified run is still selected for pinned parsing.")
finally:
    case.doCleanups()
