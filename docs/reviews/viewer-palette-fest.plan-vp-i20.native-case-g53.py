#!/usr/bin/env python3
"""VP-I20 plan, Fassung 2: the G53 prefix case. As
viewer-palette-fest.plan-vp-i20.native-case.py, but logs gcode.linecode and
the canon Z at every straight_traverse (inches, the canon's unit) instead of
next_line. Run: `python3 -B <this> G53_prefix` in a fresh process. Feeds
`g53` of viewer-palette-fest.plan-vp-i20.native.json.
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

HERE = Path("/home/cnc/lcnc-suite-partb/lcnc-gateway")
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



import gcode_canon as _gc
case = sys.argv[1]
programs = {
    "G43.1_X2": "G21 G90\nG0 Z5\nG43.1 X2\nG0 Z6\nM2\n",
    "G43.2_Z2": "G21 G90\nG0 Z5\nG43.2 Z2\nG0 Z6\nM2\n",
    "G43_bare": "G21 G90\nG0 Z5\nG43\nG0 Z6\nM2\n",
    "G43_H2": "G21 G90\nG0 Z5\nG43 H2\nG0 Z6\nM2\n",
    "G49": "G21 G90\nG0 Z5\nG49\nG0 Z6\nM2\n",
    "M6_T2": "G21 G90\nG0 Z5\nT2 M6\nG0 Z6\nM2\n",
    "G53_prefix": "G21 G90\nG53 G0 Z0\nG0 Z5\nG43\nG0 Z6\nM2\n",
}
LOG = []
_orig_to = _gc.PreviewCanon.tool_offset
def _to(self, *o):
    st = getattr(self, "state", None)
    LOG.append({"line": self.lineno, "tool_length_offset": getattr(st, "tool_length_offset", None),
                "g8": [g for g in (getattr(st, "gcodes", ()) or ()) if g in (430, 431, 432, 490)],
                "zo": round(o[2], 4)})
    return _orig_to(self, *o)
_gc.PreviewCanon.tool_offset = _to
_orig_ct = _gc.PreviewCanon.change_tool
def _ct(self, idx):
    LOG.append({"line": self.lineno, "M6": idx}); return _orig_ct(self, idx)
_gc.PreviewCanon.change_tool = _ct
_orig_st = _gc.PreviewCanon.straight_traverse
def _stt(self, *a):
    st = getattr(self, "state", None)
    LOG.append({"line": self.lineno, "traverse_gcodes": [g for g in (getattr(st, "gcodes", ()) or ()) if g > 0][:6],
                "has530": 530 in (getattr(st, "gcodes", ()) or ()), "z": round(a[2], 4)})
    return _orig_st(self, *a)
_gc.PreviewCanon.straight_traverse = _stt
real = worker.gcode.parse
def with_seed(fn, canon, init, *a):
    return real(fn, canon, list(init)[:2] + ["G43.1 X0 Y0 Z10"] + list(init)[2:], *a)
worker.gcode.parse = with_seed
var(); ngc.write_text(programs[case])
with contextlib.redirect_stderr(io.StringIO()):
    out = worker.parse(dict(BASE))
print(json.dumps({"case": case, "err": out.get("parse_error"), "log": LOG, "tlo_events": out.get("tlo_events")}))
