"""Offline R430: the parse-basis window closes while a read-back is pending.
No server, controller, subprocess or native run. Only the real quiet helper
and evaluator, a simulated clock and explicit synthetic trace events.
"""
import json
import sys
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, "/tmp/r430/p2a/scripts")
import native_run as nr
from test_support import native_cases as nc

class Clock:
    def __init__(self):
        self.t = 0.0
    def monotonic(self):
        return self.t
    def sleep(self, seconds):
        self.t += seconds

# Two probes settled; the third has booked its routine's assumed basis.
# Its synch takes up to the actual 5 s command wait, then fails. The first
# subsequent idle tick starts the toolsetter parse. No parse is running yet.
clock = Clock()
c = SimpleNamespace(status={"preview_refresh": None})
with patch.object(nr, "time", clock):
    returned = nr._pb_quiet(c, "parse-basis")
keys = [3004,3005,3006,3007,3009,3010,3013,3014] + list(range(3100,3116))
events = [{"tag":"gcode.spawn_start", "reason":"tool_offset", "nice":19}]
for i in range(3):
    events.extend([
        {"tag":"toolsetter.basis","origin":"assumed","keys":[3014]},
        {"tag":"toolsetter.basis","origin":"applied","keys":[3014]},
        {"tag":"toolsetter.basis","origin":"assumed","keys":keys},
        {"tag":"gcode.reparse_toolsetter_held","why":"read_back"},
    ])
    if i < 2:
        events.extend([{"tag":"toolsetter.basis","origin":"read","keys":keys},
                       {"tag":"toolsetter.read_back"}])
short = {"framed":True,"events":events}
late = {"framed":True,"events":events + [
    {"tag":"toolsetter.read_back_failed","why":"not synched","rc":-1},
    {"tag":"gcode.reparse_toolsetter_hold_ended","why":"failed"},
    {"tag":"gcode.reparse_toolsetter"},
    {"tag":"gcode.spawn_start","reason":"toolsetter","nice":19},
]}
print(json.dumps({"kind":"synthetic offline boundary probe", "readback_end_at":5.0,
    "quiet_returned_at":clock.t, "quiet_s":returned,
    "nice_before_readback_end":nc.eval_parse_nice("pb.nice",short),
    "before_readback_end":nc.eval_parse_basis("pb",short,ops=3,quiet_s=returned),
    "including_late_parse":nc.eval_parse_basis("pb",late,ops=3,quiet_s=returned)}, indent=2))
