#!/usr/bin/env python3
"""The start tool state of a parse (VP-I20, Codex R51–R57) against the REAL
worker and LinuxCNC's native offline interpreter: ONE case per process — the
interpreter keeps state between parses in one process (M2 does not end a
G43), exactly what the seed is about.

    python3 native_start_probe.py <case>

Prints one JSON line: {"skip": reason} without the native modules, else the
payload fields the case is judged on. Synthetic STAT, a temporary INI / var
file / tool table; `linuxcnc.command` raises. Run by test_start_tlo_worker.py.
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
work = Path(tempfile.mkdtemp(prefix="start-probe-"))
os.environ["LCNC_LOG_DIR"] = str(work / "logs")

CASES = {
    # name: (program, units, STAT tool_offset Z, STAT gcodes, extra ctx)
    # Codex R51's VP-I20 case: Z max 50, no G43 of its own, started under G43 Z10.
    "inherit_g43": ("G21 G90\nG0 X0 Y0 Z40\nG1 X10 Z45 F100\nM2\n", "mm", 10.0, (430,), {}),
    "inherit_g49": ("G21 G90\nG0 X0 Y0 Z40\nG1 X10 Z45 F100\nM2\n", "mm", 0.0, (490,), {}),
    "unknown": ("G21 G90\nG0 X0 Y0 Z40\nG1 X10 Z45 F100\nM2\n", "mm", 10.0, None, {}),
    "a_w_component": ("G21 G90\nG0 X0 Y0 Z40\nM2\n", "mm", 10.0, (430,), {"a_offset": 0.5}),
    "g53_prefix": ("G21 G90\nG53 G0 Z0\nG0 X0 Y0 Z-60\nM2\n", "mm", 10.0, (430,), {}),
    "percent": ("%\nG21 G90\nG53 G0 Z0\nG0 X1\nM2\n%\n", "mm", 10.0, (430,), {}),
    "percent_then_g43_1": ("%\nG21 G90\nG43.1 Z10\nG0 X0 Y0 Z0\nM2\n%\n", "mm", 10.0, (430,), {}),
    "codex_r56": ("G21 G90\nG49\nG43.1 Z10\nG0 X0 Y0 Z0\nG0 X10 Y0 Z0\nM2\n", "mm", 10.0, (430,), {}),
    "pinned_seed": ("G21 G90\nG0 X0 Y0 Z40\nM2\n", "mm", 10.0, (430,),
                    {"ctx": {"seed_tool": {"applied_tlo": [0, 0, 20], "start_mode": 430, "loaded_tool": 1}}}),
    "pinned_legacy": ("G21 G90\nG0 X0 Y0 Z40\nM2\n", "mm", 10.0, (430,),
                      {"ctx": {"seed_tool": {"applied_tlo": [0, 0, 20], "loaded_tool": 1}}}),
    "gate_override": ("G21 G90\nG0 X0 Y0 Z40\nM2\n", "mm", 99.0, (430,),
                      {"ctx": {"applied_tlo": {"xyz": [0, 0, 30], "mode": 430}}}),
    "no_prefix_10": ("G21 G90\nG49\nG0 X0 Y0 Z40\nG1 X10 Z45 F100\nM2\n", "mm", 10.0, (430,), {}),
    "no_prefix_80": ("G21 G90\nG49\nG0 X0 Y0 Z40\nG1 X10 Z45 F100\nM2\n", "mm", 80.0, (430,), {}),
    # inch machine: Z max 1.2 in, start 0.5 in → Z1 runs at 1.5 in
    "inch": ("G20 G90\nG0 X0 Y0 Z0.5\nG1 Z1 F10\nM2\n", "in", 0.5, (430,), {}),
}

program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]
inch = units == "in"
ini = work / "machine.ini"
ini.write_text(f"""[EMC]
MACHINE = START_PROBE
[TRAJ]
COORDINATES = XYZ
LINEAR_UNITS = {"inch" if inch else "mm"}
ANGULAR_UNITS = degree
[RS274NGC]
PARAMETER_FILE = machine.var
[EMCIO]
TOOL_TABLE = tool.tbl
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
MAX_LIMIT = {1.2 if inch else 50}
MAX_VELOCITY = 10
""")
os.environ["INI_FILE_NAME"] = str(ini)
(work / "tool.tbl").write_text("T1 P1 Z10 D6\nT2 P2 Z80 D6\n")
(work / "machine.var").write_text(
    "5161 0\n5181 10\n5210 1\n5211 0\n5212 0\n5213 0\n5220 1\n5221 0\n5222 0\n5223 0\n")
ngc = work / "program.ngc"
ngc.write_text(program)

Tool = namedtuple("Tool", "id xoffset yoffset zoffset aoffset boffset coffset "
                          "uoffset voffset woffset diameter frontangle backangle orientation")


def tool(n, z):
    return Tool(n, 0, 0, z, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0)


s = SimpleNamespace(poll=lambda: None, axis_mask=7, angular_units=1.0,
                    linear_units=(1.0 / 25.4 if inch else 1.0), block_delete=False,
                    actual_position=[0] * 9, g92_offset=[0] * 9,
                    tool_offset=[0, 0, z_off, extra.get("a_offset", 0)] + [0] * 5,
                    tool_in_spindle=1, tool_table=[tool(1, 10), tool(1, 10), tool(2, 80)],
                    joint=None)
if gcodes_live is not None:
    s.gcodes = gcodes_live
linuxcnc.stat = lambda: s


def no_command(*a, **kw):
    raise AssertionError("machine commands prohibited")


linuxcnc.command = no_command

import numpy as np  # noqa: E402
import gcode_parse_worker as worker  # noqa: E402

ctx = {"file": str(ngc), "ini_path": str(ini), "units": units, "g5x_index": 1,
       "var_patches": {str(b + j): "0" for b in range(5220, 5381, 20) for j in range(1, 11)},
       "kins_type": 0, "kins_frame": None, **extra.get("ctx", {})}
err = io.StringIO()
with contextlib.redirect_stderr(err):
    out = worker.parse(ctx)
meta = {}
for ln in err.getvalue().splitlines():
    if ln.startswith("__TLO__"):
        meta = json.loads(ln.split("\t", 1)[1])


def pts(key):
    b = out.get(key)
    return np.frombuffer(b, dtype=np.float32).reshape(-1, 3).tolist() if isinstance(b, bytes) else b


comparable = {k: v for k, v in out.items() if k not in ("file", "tlo_start")}
print(json.dumps({
    "parse_error": out.get("parse_error"), "feed": pts("feed"), "rapid": pts("rapid"),
    "tlo_events": out.get("tlo_events"), "violations": out.get("violations"),
    "violations_total": out.get("violations_total"), "violations_reason": out.get("violations_reason"),
    "feed_outside": list(out.get("feed_outside") or b"") if "feed_outside" in out else None,
    "rapid_outside": list(out.get("rapid_outside") or b"") if "rapid_outside" in out else None,
    "start_known": out.get("start_known"), "tlo_start": out.get("tlo_start"),
    "start_reason": out.get("start_reason"),
    "meta": {k: meta.get(k) for k in ("start_known", "tlo_start", "start_mode", "start_reason")},
    "digest_without_start": __import__("hashlib").sha256(
        __import__("msgspec").msgpack.encode(comparable)).hexdigest(),
}))
