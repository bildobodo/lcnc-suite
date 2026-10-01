#!/usr/bin/env python3
"""The pinned re-parse against the REAL worker and LinuxCNC's native offline
interpreter, with a synthetic STAT only (after Codex R40's worker probe).
Run by test_pinned_worker.py in its own process — the pytest conftest
installs a fake `linuxcnc`, and this needs the real `gcode` module. Never
instantiates linuxcnc.stat/command against a machine. Prints one JSON line:
{"skip": reason} when the native modules are missing, else {"checks": {...}}.
"""
import contextlib
import io
import json
import os
import sys
import tempfile
from collections import namedtuple
from pathlib import Path
from types import SimpleNamespace

try:
    import gcode  # noqa: F401 — the native interpreter
    import linuxcnc
except ImportError as e:
    print(json.dumps({"skip": f"no native LinuxCNC modules: {e}"}))
    sys.exit(0)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
work = Path(tempfile.mkdtemp(prefix="pinned-probe-"))
os.environ["LCNC_LOG_DIR"] = str(work / "logs")


def write_ini(random_tc=0):
    ini = work / "machine.ini"
    ini.write_text(f"""[EMC]
MACHINE = PINNED_PROBE
[TRAJ]
COORDINATES = XYZ
LINEAR_UNITS = mm
ANGULAR_UNITS = degree
[RS274NGC]
PARAMETER_FILE = machine.var
[EMCIO]
TOOL_TABLE = tool.tbl
RANDOM_TOOLCHANGER = {random_tc}
[AXIS_X]
MIN_LIMIT = -500
MAX_LIMIT = 500
MAX_VELOCITY = 10
[AXIS_Y]
MIN_LIMIT = -500
MAX_LIMIT = 500
MAX_VELOCITY = 10
[AXIS_Z]
MIN_LIMIT = -500
MAX_LIMIT = 50
MAX_VELOCITY = 10
""")
    os.environ["INI_FILE_NAME"] = str(ini)
    return ini


Tool = namedtuple("Tool", "id xoffset yoffset zoffset aoffset boffset coffset "
                          "uoffset voffset woffset diameter frontangle backangle orientation")


def tool(n, z):
    return Tool(n, 0, 0, z, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0)


polls = []
s = SimpleNamespace(poll=lambda: [f() for f in polls], axis_mask=7, angular_units=1.0,
                    linear_units=1.0, block_delete=False, actual_position=[0] * 9,
                    g92_offset=[0] * 9, tool_offset=[0, 0, 10] + [0] * 6, tool_in_spindle=1,
                    tool_table=[tool(1, 10), tool(1, 10), tool(2, 80)], joint=None,
                    gcodes=(430,))
linuxcnc.stat = lambda: s


def no_command(*a, **kw):
    raise AssertionError("machine commands prohibited")


linuxcnc.command = no_command

import numpy as np  # noqa: E402
import gcode_parse_worker as worker  # noqa: E402

ini = write_ini()
(work / "tool.tbl").write_text("T1 P1 Z10 D6\nT2 P2 Z80 D6\n")
ngc = work / "program.ngc"
BASE = {"file": str(ngc), "ini_path": str(ini), "units": "mm", "g5x_index": 1,
        "var_patches": {str(b + j): "0" for b in range(5220, 5381, 20) for j in range(1, 11)},
        "kins_type": 0, "kins_frame": None}


def var(g92=0, g30x=10):
    (work / "machine.var").write_text(
        f"5161 0\n5181 {g30x}\n5210 1\n5211 {g92}\n5212 0\n5213 0\n5220 1\n5221 0\n5222 0\n5223 0\n")


def parse(ctx):
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        out = worker.parse(ctx)
    metas = {}
    for ln in err.getvalue().splitlines():
        if ln.startswith(("__TLO__", "__WCSOFF__", "__PARAMS__")):
            k, v = ln.split("\t", 1)
            metas[k] = json.loads(v)

    def points(key):
        b = out[key]
        return np.frombuffer(b, dtype=np.float32).reshape(-1, 3).tolist() if isinstance(b, bytes) else b
    return {"parse_error": out["parse_error"], "feed": points("feed"),
            "tlo_events": out.get("tlo_events"), "violations": out["violations"],
            "wcs_basis": out["wcs_basis"], "meta": metas}


def pinned_from(first, **extra):
    params = first["meta"].get("__PARAMS__") or {}
    return dict(BASE, param_text=params.get("text"), g92_offset=params.get("g92"),
                seed_tool={"applied_tlo": first["meta"]["__TLO__"]["tlo_start"],
                           "start_mode": first["meta"]["__TLO__"]["start_mode"],
                           "loaded_tool": first["meta"]["__TLO__"]["loaded_tool"]}, **extra)


checks = {}

# MR-I01 — `G43` without H reads the spindle pocket: a pinned parse keeps the
# tool the published parse started with, with its CURRENT table length.
var()
ngc.write_text("G21 G90\nG43\nG0 X0 Y0 Z0\nG1 X10 Z1 F100\nM2\n")
first = parse(dict(BASE))
s.tool_in_spindle, s.tool_offset, s.tool_table[0] = 2, [0, 0, 80] + [0] * 6, tool(2, 80)
pinned = parse(pinned_from(first))
unpinned = parse(dict(BASE))
checks["pinned_spindle_keeps_the_start_tool"] = pinned["tlo_events"] == first["tlo_events"]
checks["pinned_spindle_keeps_the_limit_findings"] = pinned["violations"] == first["violations"]
checks["an_idle_parse_takes_the_live_spindle"] = unpinned["tlo_events"] != first["tlo_events"]
checks["pinned_meta_reports_the_start_tool"] = pinned["meta"]["__TLO__"]["loaded_tool"] == 1
# the start tool measured anew: its NEW length, still the start tool
s.tool_table[1] = tool(1, 12)
remeasured = parse(pinned_from(first))
checks["pinned_spindle_takes_the_new_length"] = (
    [round(e[3], 6) for e in (remeasured["tlo_events"] or [])][:1] == [12.0])
s.tool_in_spindle, s.tool_offset = 1, [0, 0, 10] + [0] * 6
s.tool_table = [tool(1, 10), tool(1, 10), tool(2, 80)]

# MR-I02 — the parameter basis: G92 and G30 persisted by the running program
# never become the pinned parse's start; an idle parse takes them.
ngc.write_text("G21 G90\nG0 X0 Y0 Z0\nG1 X#5181 Z1 F100\nM2\n")
var(g92=0, g30x=10)
first = parse(dict(BASE))
var(g92=100, g30x=30)
s.g92_offset = [100] + [0] * 8
pinned = parse(pinned_from(first))
unpinned = parse(dict(BASE))
checks["pinned_keeps_g92"] = pinned["wcs_basis"] == first["wcs_basis"]
checks["pinned_keeps_g30"] = pinned["feed"] == first["feed"]
checks["pinned_wcsoff_reports_the_start_g92"] = pinned["meta"]["__WCSOFF__"] == first["meta"]["__WCSOFF__"]
checks["an_idle_parse_takes_the_new_parameters"] = unpinned["feed"] != first["feed"]
s.g92_offset = [0] * 9
var()

# The table's file time is read BEFORE the status: a table written between
# the two leaves the parse with the OLD time — the drift edge re-fires.
ngc.write_text("G21 G90\nG0 X0 Y0 Z0\nM2\n")
tbl = work / "tool.tbl"
os.utime(tbl, (1000.0, 1000.0))
polls.append(lambda: os.utime(tbl, (2000.0, 2000.0)))
raced = parse(dict(BASE))
polls.clear()
checks["table_time_read_before_the_status"] = raced["meta"]["__TLO__"]["table_mtime"] == 1000.0

# A random toolchanger cannot pin: the worker refuses with its own code.
write_ini(random_tc=1)
try:
    with contextlib.redirect_stderr(io.StringIO()):
        worker.parse(dict(BASE, seed_tool={"applied_tlo": [0, 0, 10], "loaded_tool": 1}))
    checks["random_toolchanger_refuses_the_pin"] = False
except SystemExit as e:
    checks["random_toolchanger_refuses_the_pin"] = e.code == getattr(worker, "PIN_UNSUPPORTED_EXIT", None)

print(json.dumps({"checks": checks}))
