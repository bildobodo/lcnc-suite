"""Offline review probes; see twp-review-2026-09-14.md for invocation.

Prints observations from the reviewed implementation, not passing regression
assertions. Imports no LinuxCNC command, stat, HAL, or remap module. The rotary
solver function is extracted with AST to avoid remap's machine-side imports.
"""
import ast
import json
import logging
import math
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
sys.dont_write_bytecode = True
sys.path.insert(0, str(root / "lcnc-gateway"))
sys.path.insert(0, str(root / "examples/sim_config/twp/python"))
from command_policy import (
    MachineState, goto_zero_plan, touchoff_route, machine_frame_required,
)
from gateway_util import (
    evaluate_tlo_drift, rotary_letters_on_line, rotary_word_lines,
    first_rotary_commands, classify_motion_lines,
)
from twp_transform import calc_shortest_distance

tree = ast.parse((root / "examples/sim_config/twp/python/remap.py").read_text())
node = next((n for n in tree.body if isinstance(n, ast.FunctionDef)
             and n.name == "calc_rotary_move_with_joint_limits"), None)
namespace = {"degrees": math.degrees, "log": logging.getLogger("review"),
             "calc_shortest_distance": calc_shortest_distance}
if node is not None:
    exec(compile(ast.Module(body=[node], type_ignores=[]),
                 "<extracted reviewed function>", "exec"), namespace)
else:
    # TWP-03 (fix wave): the solver moved into the pure twp_transform module.
    from twp_transform import calc_rotary_move_with_joint_limits
    namespace["calc_rotary_move_with_joint_limits"] = calc_rotary_move_with_joint_limits

base = dict(armed=True, is_estop=False, is_enabled=True, is_homed=True,
            is_idle=True, is_running=False, is_paused=False,
            eoffset_enabled=False)
plane = MachineState(**base, kins_type=2, g5x_index=6, twp_active=True,
                     twp_capable=True,      # TWP-08 fix wave: the TWP stack declares itself
                     twp_defined=True, twp_aligned=True)  # TWP-04 fix wave: head aligned
plain = MachineState(**base, kins_switchable=False, g5x_index=6)
tcp_raw0 = MachineState(**base, kins_switchable=True, kins_type=0, g5x_index=1)
meta = {"table_mtime": 1, "tlos": [[1, 0, 0, 10], [2, 0, 0, 20]]}
rotary = {
    "helper": rotary_letters_on_line("G30"),
    "scanner": rotary_word_lines("G30"),
    "class": classify_motion_lines("G30"),
    "boundary": first_rotary_commands(
        [([10], [1], [[0, 0, 0]], [True])], {"A": 0},
        rotary_word_lines("G30")),
}
print(json.dumps({
    "plane_zero": goto_zero_plan(plane, 5, 25),
    "g59_three_axis_touch": touchoff_route(plain, ["X"]),
    "tcp_raw0_machine_gate": machine_frame_required(tcp_raw0),
    "rotary_limit": namespace["calc_rotary_move_with_joint_limits"](
        math.radians(0), math.radians(150), 100, -100, 0),
    "tlo_repeated": [evaluate_tlo_drift(meta, 1, 1, 20) for _ in range(3)],
    "bare_g30": rotary,
}, indent=2))
