#!/usr/bin/env python3
"""Codex R58 offline native probe, exact product snapshot 724a3d5.
Usage: PYTHONPATH=<archive>/lcnc-gateway <venv>/python -B this.py CASE OUT.mpk
Cases: percent_line1, percent_line2, percent_rotary_line1, percent_rotary_line2.
Synthetic STAT and temporary INI/parameter/tool/subprogram files only;
linuxcnc.command raises. Trace wrappers only observe and delegate unchanged.
Based on the implementation's native_start_probe.py; no live suite access.
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

CASES = {'percent_line1': {'program': '%\nG21 G90\nG0 X0 Y0 Z0\no<r58_child> call\nG0 X10 Z0\nM2\n%\n', 'subfiles': {'r58_child.ngc': 'o<r58_child> sub\nG43.1 Z20\nG0 X5 Y0 Z0\no<r58_child> endsub\n'}}, 'percent_line2': {'program': '\n%\nG21 G90\nG0 X0 Y0 Z0\no<r58_child> call\nG0 X10 Z0\nM2\n%\n', 'subfiles': {'r58_child.ngc': 'o<r58_child> sub\nG43.1 Z20\nG0 X5 Y0 Z0\no<r58_child> endsub\n'}}, 'percent_rotary_line1': {'program': '%\nG21 G90\nG53 G0 Z0\nG0 X1\nM2\n%\n', 'extra': {'rotary': True}}, 'percent_rotary_line2': {'program': '\n%\nG21 G90\nG53 G0 Z0\nG0 X1\nM2\n%\n', 'extra': {'rotary': True}}}
conf = CASES[sys.argv[1]]
program, units, z_off, gcodes_live, extra = conf["program"], conf.get("units", "mm"), conf.get("seed", 10), conf.get("gcodes", [430]), conf.get("extra", {})
inch = units == "in"
ini = work / "machine.ini"
ini.write_text(f"""[EMC]
MACHINE = START_PROBE
[TRAJ]
COORDINATES = {"XYZA" if extra.get("rotary") else "XYZ"}
LINEAR_UNITS = {"inch" if inch else "mm"}
ANGULAR_UNITS = degree
[RS274NGC]
PARAMETER_FILE = machine.var
SUBROUTINE_PATH = {work}
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
for name, text in conf.get("subfiles", {}).items():
    assert Path(name).name == name
    (work/name).write_text(text)
sys.argv[2] = str(Path(sys.argv[2]).resolve())
os.chdir(work)

Tool = namedtuple("Tool", "id xoffset yoffset zoffset aoffset boffset coffset "
                          "uoffset voffset woffset diameter frontangle backangle orientation")


def tool(n, z):
    return Tool(n, 0, 0, z, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0)


s = SimpleNamespace(poll=lambda: None, axis_mask=(15 if extra.get("rotary") else 7), angular_units=1.0,
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


# Observe canonical calls without changing their return values or behavior.
canonical_trace=[]
original_tool_offset=worker.PreviewCanon.tool_offset
def traced_tool_offset(self, *xyzabcuvw):
    canonical_trace.append({"kind":"tool_offset", "line":self.lineno, "seq":self.seq,
                            "program":self._program_line(), "xyz_mm":[v*25.4 for v in xyzabcuvw[:3]]})
    return original_tool_offset(self, *xyzabcuvw)
worker.PreviewCanon.tool_offset=traced_tool_offset
original_traverse=worker.PreviewCanon.straight_traverse
def traced_traverse(self, *xyzabcuvw):
    canonical_trace.append({"kind":"traverse", "line":self.lineno, "seq":self.seq,
                            "program":self._program_line(), "tip_mm":[v*25.4 for v in xyzabcuvw[:3]],
                            "tlo_mm":[v*25.4 for v in (self.xo,self.yo,self.zo)]})
    return original_traverse(self, *xyzabcuvw)
worker.PreviewCanon.straight_traverse=traced_traverse

ctx = {"file": str(ngc), "ini_path": str(ini), "units": units, "g5x_index": 1,
       "var_patches": {str(b + j): "0" for b in range(5220, 5381, 20) for j in range(1, 11)},
       "kins_type": 0, "kins_frame": None, **extra.get("ctx", {})}
err = io.StringIO()
with contextlib.redirect_stderr(err):
    out = worker.parse(ctx)
Path(str(sys.argv[2])+".json").write_text(json.dumps(out, default=lambda b: {"bytes_b64": __import__("base64").b64encode(b).decode()}, indent=2)+"\n")
meta = {}
for ln in err.getvalue().splitlines():
    if ln.startswith("__TLO__"):
        meta = json.loads(ln.split("\t", 1)[1])


def pts(key):
    b = out.get(key)
    return np.frombuffer(b, dtype=np.float32).reshape(-1, 3).tolist() if isinstance(b, bytes) else b


comparable = {k: v for k, v in out.items() if k not in ("file", "tlo_start")}
if len(sys.argv) > 2:
    # the encoded payload, as the gateway would publish it
    out["file"] = "/program.ngc"
    with open(sys.argv[2], "wb") as f:
        f.write(__import__("msgspec").msgpack.encode(out))
print(json.dumps({
    "trace": canonical_trace, "parse_error": out.get("parse_error"), "feed": pts("feed"), "rapid": pts("rapid"),
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
