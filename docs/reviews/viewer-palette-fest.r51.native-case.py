#!/usr/bin/env python3
"""R51 independent native parse: one case per fresh process.
Copy beside gcode_parse_worker.py and run: python -B r51_native_case.py CASE OFFSET.
Synthetic STAT only; linuxcnc.command raises. Temporary INI, var and tool table.
Fixture adapted from native_pinned_probe.py at e5585e2; no priming parse.
Cases: inherit, g43 (bare), dynamic (G43.1/G49), mixed (G53/inherit/G43/G49).
Prints full-payload hash (excluding only the temporary filename) and limit data.
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
                    tool_table=[tool(1, 10), tool(1, 10), tool(2, 80)], joint=None)
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
                seed_tool={"applied_tlo": first["meta"]["__TLO__"]["applied_tlo"],
                           "loaded_tool": first["meta"]["__TLO__"]["loaded_tool"]}, **extra)



import hashlib,pickle
case=sys.argv[1]; offset=float(sys.argv[2]);s.tool_offset=[0,0,offset]+[0]*6
programs={
 'inherit': 'G21 G90\nG0 X0 Y0 Z40\nG1 X10 Z45 F100\nM2\n',
 'g43': 'G21 G90\nG43\nG0 X0 Y0 Z40\nG1 X10 Z45 F100\nM2\n',
 
 'dynamic':'G21 G90\nG43.1 Z12.5\nG0 X0 Y0 Z40\nG1 X10 Z45 F100\nG49\nG0 Z45\nM2\n',
 'mixed':'G21 G90\nG53 G0 Z0\nG0 X0 Y0 Z45\nG43\nG1 X10 Z40 F100\nG49\nG0 Z45\nM2\n',
}
var();ngc.write_text(programs[case])
err=io.StringIO()
with contextlib.redirect_stderr(err): out=worker.parse(dict(BASE))
# Each fresh process has its own temp path. It is not part of geometry.
normalized={k:v for k,v in out.items() if k!='file'}
digest=hashlib.sha256(pickle.dumps(normalized,protocol=4)).hexdigest()
def points(key):
 b=out[key]
 return np.frombuffer(b,dtype=np.float32).reshape(-1,3).tolist() if isinstance(b,bytes) else b
print(json.dumps({'case':case,'live_offset':offset,'sha256_except_file':digest,'parse_error':out['parse_error'],
 'feed':points('feed'),'rapid':points('rapid'),'tlo_events':out.get('tlo_events'),'violations':out['violations'],'violations_total':out['violations_total'],
 'feed_outside':list(out.get('feed_outside',[])),'rapid_outside':list(out.get('rapid_outside',[])),'payload_keys':sorted(out)}))
