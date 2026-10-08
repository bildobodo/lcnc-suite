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
    # a rotary machine: the initcodes carry the rotary sync move, run on the
    # `%` line — it used to be recorded as a phantom point at program 0,0,0
    "percent_rotary": ("%\nG21 G90\nG53 G0 Z0\nG0 X1\nM2\n%\n", "mm", 10.0, (430,), {"rotary": True}),
    # Codex R58 VP-I22: a subroutine's own G43.1 on its line 2 after the
    # init phase, with `%` on text line 1 and after a blank line (the `%`
    # line is sequence 1 either way); a blank line before `%` on a rotary
    # machine (the phantom point must not come back)
    "percent_sub": ("%\nG21 G90\nG0 X0 Y0 Z0\no<r58_child> call\nG0 X10 Z0\nM2\n%\n", "mm", 10.0, (430,),
                    {"subs": {"r58_child.ngc": "o<r58_child> sub\nG43.1 Z20\nG0 X5 Y0 Z0\no<r58_child> endsub\n"}}),
    "percent_sub_blank": ("\n%\nG21 G90\nG0 X0 Y0 Z0\no<r58_child> call\nG0 X10 Z0\nM2\n%\n", "mm", 10.0, (430,),
                          {"subs": {"r58_child.ngc": "o<r58_child> sub\nG43.1 Z20\nG0 X5 Y0 Z0\no<r58_child> endsub\n"}}),
    "percent_rotary_blank": ("\n%\nG21 G90\nG53 G0 Z0\nG0 X1\nM2\n%\n", "mm", 10.0, (430,), {"rotary": True}),
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
    # The move after a G43 / an M6 (operator 2026-10-07, haus.ngc L18
    # `G43 Z15. H13`: 0 s, swept at its end only). Started under G49. The
    # offset change is a G43.1 — the same tool_offset callback as a G43 H —
    # because this harness has no tool database: an H or a T other than the
    # seeded spindle tool is a lookup the native interpreter crashes on. The
    # move after it starts where the machine stands — tip Z40 under no
    # offset is Z30 under Z10 — and runs to Z15.
    "g43_mid": ("G21 G90\nG0 X0 Y0 Z40\nG0 X10\nG43.1 Z10\nG0 Z15\nG1 Z5 F100\nM2\n", "mm", 0.0, (490,), {}),
    # An M6 the controller moves nothing at (no TOOL_CHANGE_POSITION): the
    # next move starts where the machine stands. (A bare M6: the spindle
    # tool, no lookup — see above.)
    "m6_in_place": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG0 X10 Y5\nM2\n", "mm", 0.0, (490,), {}),
    # ...and one it moves the machine at: the next move's start is unknown.
    "m6_tc_position": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG0 X10 Y5\nM2\n", "mm", 0.0, (490,),
                       {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    # Codex R91 on R92: the G43 in the block of the move (G43 without H takes
    # the spindle tool, T1 Z10 — no lookup), with a feed, before an arc, and
    # alone at the end.
    "g43_g0_block": ("G21 G90\nG0 X0 Y0 Z40\nG0 X10\nG43 G0 Z15\nM2\n", "mm", 0.0, (490,), {}),
    "g43_g1_block": ("G21 G90\nG0 X0 Y0 Z40\nG0 X10\nG43 G1 Z5 F100\nM2\n", "mm", 0.0, (490,), {}),
    "g43_arc": ("G21 G90\nG0 X0 Y0 Z40\nG43\nG2 X10 Y0 I5 J0 F100\nM2\n", "mm", 0.0, (490,), {}),
    "g43_alone": ("G21 G90\nG0 X0 Y0 Z40\nG43\nM2\n", "mm", 0.0, (490,), {}),
    # An unknown start does not become known through a G43 after it.
    "m6_tc_then_g43": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG43\nG0 X10 Z15\nM2\n", "mm", 0.0, (490,),
                       {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    # Codex R92 VP-I51: after an M6 at a tool change position every motion
    # kind stays an unknown start while an axis is stale (feed, arc, G43 then
    # feed, and a rapid after the feed); an absolute move re-establishes the
    # axes it moves, G91 none — also when the G91 is in the block itself.
    "r92_m6_feed": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG1 X10 Y5 Z15 F100\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    "r92_m6_feed_then_rapid": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG1 X10 Y5 Z15 F100\nG0 Z20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    "r92_m6_arc": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG2 X10 Y0 I5 J0 F100\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    "r92_m6_g43_feed": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG43\nG1 X10 Y5 Z15 F100\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    "m6_tc_partial": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG0 X10 Y5\nG0 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    "m6_tc_g91": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG91\nG0 X10 Y5 Z-5\nG90\nG0 X20 Y5 Z15\nG0 X30\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    "m6_tc_g91_block": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG91 G0 X10 Y5 Z-5\nG0 X5\nG90 G0 X20 Y5 Z15\nG0 X30\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    # A G91 block with several motions (a drilling cycle): no axis may come
    # back INSIDE it — the correction at the next line comes too late there.
    "m6_tc_g91_cycle": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG91\nG81 X10 Y5 Z-5 R2 F100\nG80\nG90\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    # Codex R92's green controls: the interpreter's own tool-change moves
    "r92_m6_quill": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG0 X10 Y5\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_QUILL_UP = 1"}),
    "r92_m6_g30_twice": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG0 Z20\nM6\nG0 X10 Y5\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_AT_G30 = 1"}),
    "r92_m6_quill_g30": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG0 X10 Y5\nM2\n", "mm", 0.0, (490,),
                         {"emcio": "TOOL_CHANGE_QUILL_UP = 1\nTOOL_CHANGE_AT_G30 = 1"}),
    # The interpreter's own G30 move at an M6 (TOOL_CHANGE_AT_G30) is a canon
    # traverse: recorded, and the move after the change starts there.
    "m6_at_g30": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG0 X10 Y5\nM2\n", "mm", 0.0, (490,),
                  {"emcio": "TOOL_CHANGE_AT_G30 = 1"}),
}

# Verify pairs (plan Fassungen 4–6): the same program at two start offsets;
# test_start_tlo_worker compares the two encoded payloads.
_PAIRS = {
    # Codex R55: equal machine points, different tip — the normalisation
    "r55": "G21 G90\nG53 G0 X0 Y0 Z0\nG53 G0 X10 Y0 Z0\nG49\nG0 Z-40\nG0 Z40\nM2\n",
    # Codex R54: a quadratic dependence through #5422 after G49
    "r54_quadratic": "G21 G90\nG0 X0 Y0 Z0\nG49\n#1=[#5422-10]\nG1 Z[49.999 + #1 * [1-#1]] F100\nM2\n",
    # Codex R53 rest B: G91 after G49 from a start-dependent position
    "r53_rest_b": "G21 G90\nG0 X0 Y0 Z39.990\nG49\nG91\nG1 Z0.009 F100\nM2\n",
    # heavy_test's shape: `%`, a G53 retract, X/Y without Z, then the
    # program's own G43 (the table row) and absolute moves
    "heavy_like": "%\nG21 G90\nG53 G0 Z0\nG0 X5 Y5\nG43\nG0 Z15\nG1 Z-5 F100\nM2\n%\n",
}
for _name, _prog in _PAIRS.items():
    for _z in ("10", "10.005", "20"):
        CASES[f"{_name}@{_z}"] = (_prog, "mm", float(_z), (430,), {})

program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]
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
{extra.get("emcio", "")}
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
for _name, _text in extra.get("subs", {}).items():
    (work / _name).write_text(_text)

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


def u(key, dtype):
    b = out.get(key)
    return np.frombuffer(b, dtype=dtype).tolist() if isinstance(b, bytes) else b


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
    "parse_error": out.get("parse_error"), "feed": pts("feed"), "rapid": pts("rapid"),
    "tlo_events": out.get("tlo_events"), "violations": out.get("violations"),
    "violations_total": out.get("violations_total"), "violations_reason": out.get("violations_reason"),
    "feed_outside": list(out.get("feed_outside") or b"") if "feed_outside" in out else None,
    "rapid_outside": list(out.get("rapid_outside") or b"") if "rapid_outside" in out else None,
    "start_known": out.get("start_known"), "tlo_start": out.get("tlo_start"),
    "start_reason": out.get("start_reason"),
    "rapid_lines": u("rapid_lines", "<u4"), "rapid_seq": u("rapid_seq", "<u4"),
    "rapid_tcum": u("rapid_tcum", "<f4"), "rapid_brk": u("rapid_brk", "<u1"),
    "rapid_ustart": u("rapid_ustart", "<u1"), "feed_seq": u("feed_seq", "<u4"),
    "feed_tcum": u("feed_tcum", "<f4"),
    "meta": {k: meta.get(k) for k in ("start_known", "tlo_start", "start_mode", "start_reason")},
    "digest_without_start": __import__("hashlib").sha256(
        __import__("msgspec").msgpack.encode(comparable)).hexdigest(),
}))
