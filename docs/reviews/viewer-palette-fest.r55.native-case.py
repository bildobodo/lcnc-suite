#!/usr/bin/env python3
"""VP-I20 plan, Fassung 3: one native parse for the differential — the real
worker and LinuxCNC's offline interpreter, synthetic STAT, temporary INI or a
given one (read-only). Run in a FRESH process per parse (the interpreter
leaks/segfaults across parses). Copy beside gcode_parse_worker.py.

  python3 -B <this> <program> <ini|synthetic> <seed: none | x,y,z> <out.npz>

seed `none`: no init line (the interpreter's default, 490, offset 0).
seed x,y,z: `G43.1 X.. Y.. Z..` after unitcode and G90 (the proposed init).
Writes every canon point (feed and rapid, pre-decimation) in the MACHINE frame
the validator checks (translated point + that segment's TLO), with seq, line
and stream, plus timing. Machine commands prohibited. With a real INI a
read-only linuxcnc.stat() is polled once: LinuxCNC 2.9 resolves T/H through
the running instance's tool DB (without it a T or H lookup segfaults — the
synthetic-harness crash of R51-R53), and its tool table is used.
"""
import contextlib, io, json, os, sys, tempfile, time
from collections import namedtuple
from pathlib import Path
from types import SimpleNamespace
import gcode  # noqa: F401
import linuxcnc

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
work = Path(tempfile.mkdtemp(prefix="vp20diff-"))
os.environ["LCNC_LOG_DIR"] = str(work / "logs")
program, ini_arg, seed_arg, out_path = sys.argv[1:5]
assert ini_arg == "synthetic", "R55 review forbids live context"

Tool = namedtuple("Tool", "id xoffset yoffset zoffset aoffset boffset coffset "
                          "uoffset voffset woffset diameter frontangle backangle orientation")
def tool(n, z): return Tool(n, 0, 0, z, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0)

if ini_arg == "synthetic":
    ini = work / "machine.ini"
    ini.write_text("""[EMC]
MACHINE = VP20DIFF
[TRAJ]
COORDINATES = XYZ
LINEAR_UNITS = mm
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
MAX_LIMIT = 50
MAX_VELOCITY = 10
""")
    (work / "tool.tbl").write_text("T1 P1 Z10 D6\nT2 P2 Z80 D6\n")
    (work / "machine.var").write_text("5161 0\n5181 10\n5210 1\n5211 0\n5212 0\n5213 0\n5220 1\n5221 0\n5222 0\n5223 0\n")
    mask, table, var_patches = 7, [tool(1, 10), tool(1, 10), tool(2, 80)], {}
    var_patches = {str(b + j): "0" for b in range(5220, 5381, 20) for j in range(1, 11)}
else:
    ini = Path(ini_arg)
    # the XYZAC sim: X Y Z A C, T13 in the spindle (table 65.0512), G54 as live
    mask, table = 1 | 2 | 4 | 8 | 32, [tool(13, 65.0512), tool(13, 65.0512)]
    var_patches = {"5221": "-86.025", "5222": "0", "5223": "-109.725"}
os.environ["INI_FILE_NAME"] = str(ini)

seed = None if seed_arg == "none" else [float(v) for v in seed_arg.split(",")]
s = SimpleNamespace(poll=lambda: None, axis_mask=mask, angular_units=1.0, linear_units=1.0,
                    block_delete=False, actual_position=[0] * 9, g92_offset=[0] * 9,
                    tool_offset=(seed or [0, 0, 0]) + [0] * 6, tool_in_spindle=table[0].id,
                    tool_table=table, joint=None)
if ini_arg != "synthetic":
    # LinuxCNC 2.9 reads tool data through the running instance's shared
    # tool DB; a real (read-only) stat attaches it — without it a T/H lookup
    # segfaults in the interpreter (the known synthetic-harness crash).
    _real = linuxcnc.stat(); _real.poll()
    s.tool_table = _real.tool_table          # the live table, same indices as the DB
    s.tool_in_spindle = _real.tool_in_spindle
linuxcnc.stat = lambda: s
def no_command(*a, **kw): raise AssertionError("machine commands prohibited")
linuxcnc.command = no_command

import numpy as np  # noqa: E402
import gcode_parse_worker as worker  # noqa: E402

real_parse = worker.gcode.parse
cap = {}
def seeded(filename, canon, initcodes, *args):
    codes = list(initcodes)
    if seed is not None:
        codes.insert(2, "G43.1 X%.9f Y%.9f Z%.9f" % tuple(seed))
    cap["initcodes"] = codes
    t0 = time.perf_counter()
    r = real_parse(filename, canon, codes, *args)
    cap["interp_s"] = time.perf_counter() - t0
    cap["canon"] = canon
    return r
worker.gcode.parse = seeded

ctx = {"file": program, "ini_path": str(ini), "units": "mm", "g5x_index": 1,
       "var_patches": var_patches, "kins_type": 0, "kins_frame": None}
t0 = time.perf_counter()
with contextlib.redirect_stderr(io.StringIO()):
    out = worker.parse(ctx)
total = time.perf_counter() - t0
import base64
Path(out_path + ".payload.json").write_text(json.dumps(out, default=lambda b: {"bytes_b64": base64.b64encode(b).decode()}, indent=2)+"\n")
c = cap["canon"]
def rows(stream):
    lst = c.feed if stream == 0 else c.rapid
    n = len(lst)
    seq = np.empty(n, np.int64); line = np.empty(n, np.int64); m = np.empty((n, 6), np.float64)
    for i, r in enumerate(lst):
        l, tlo = r[2], r[-2]
        seq[i] = r[-1]; line[i] = r[0] or 0
        # the canon works in inches; machine units are mm on both INIs here
        m[i, 0] = (l[0] + tlo[0]) * 25.4; m[i, 1] = (l[1] + tlo[1]) * 25.4; m[i, 2] = (l[2] + tlo[2]) * 25.4
        m[i, 3] = l[3]; m[i, 4] = l[4]; m[i, 5] = l[5]
    return seq, line, m
fs, fl, fm = rows(0); rs, rl, rm = rows(1)
np.savez(out_path, feed_seq=fs, feed_line=fl, feed_m=fm, rapid_seq=rs, rapid_line=rl, rapid_m=rm,
         unknown=np.asarray(sorted(getattr(c, "unknown_start", [])), np.int64))
print(json.dumps({"program": program, "seed": seed, "initcodes": cap["initcodes"],
                  "parse_error": out.get("parse_error"), "feed": len(fs), "rapid": len(rs),
                  "tlo_events": (out.get("tlo_events") or [])[:6], "violations_total": out.get("violations_total"),
                  "violations": [v for v in (out.get("violations") or [])][:6],
                  "interp_s": round(cap["interp_s"], 2), "total_s": round(total, 2),
                  "maxrss_mb": round(__import__("resource").getrusage(0).ru_maxrss / 1024, 1)}))
