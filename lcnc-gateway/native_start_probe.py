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
import atexit
import contextlib
import ctypes
import io
import json
import os
import shutil
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
atexit.register(shutil.rmtree, work, True)   # one per case: 10 000 were left in /tmp
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
    # Codex R93's VP-I51 rests: a G91 / G90 in the move's own block (the mode
    # a block runs in is known only at the next line) and a rotated G54 (an
    # X move changes machine X and Y; Y was never commanded).
    "r93_inline_g91_cycle": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG91 G81 X10 Y5 Z-5 R2 F100\nG80\nG0 X5\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    "r93_separate_g91_cycle": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG91\nG81 X10 Y5 Z-5 R2 F100\nG80\nG0 X5\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    "r93_inline_g91_g28": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG91 G28 X10 Y5 Z-5\nG0 X5\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    "r93_rotated_partial": ("G21 G90\nG10 L2 P1 R45\nG54\nG0 X0 Y0 Z40\nM6\nG0 X10 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 0"}),
    "r93_unrotated_partial": ("G21 G90\nG10 L2 P1 R0\nG54\nG0 X0 Y0 Z40\nM6\nG0 X10 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 0"}),
    "r93_rotated_complete": ("G21 G90\nG10 L2 P1 R45\nG54\nG0 X0 Y0 Z40\nM6\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 0"}),
    "r93_g90_same_block": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG91\nG0 X1 Y2 Z3\nG90 G0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    "r93_g90_separate_block": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG91\nG0 X1 Y2 Z3\nG90\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    # Codex R94's VP-I51 rests: a G98 cycle retracts to the height before it —
    # a stale one — G99 to R; a later rotation mixes a stale Y into X. The
    # position controls reach the tool change position by a visible move.
    "r94_g98_cycle": ("G21 G90 G98\nG0 X0 Y0 Z40\nM6\nG81 X10 Y5 Z-5 R2 F100\nG80\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r94_g99_cycle": ("G21 G90 G99\nG0 X0 Y0 Z40\nM6\nG81 X10 Y5 Z-5 R2 F100\nG80\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r94_rotated_after_partial": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG0 X10\nG10 L2 P1 R45\nG0 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 0"}),
    "r94_unrotated_after_partial": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG0 X10\nG10 L2 P1 R0\nG0 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 0"}),
    "r94_rotated_complete": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG0 X10\nG10 L2 P1 R45\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 0"}),
    "r94_g98_cycle_position_control": ("G21 G90 G98\nG0 X0 Y0 Z40\nG0 X0 Y20 Z30\nG81 X10 Y5 Z-5 R2 F100\nG80\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r94_rotated_after_partial_position_control": ("G21 G90\nG0 X0 Y0 Z40\nG0 X0 Y20 Z0\nG0 X10\nG10 L2 P1 R45\nG0 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 0"}),
    # Own: the believed height BELOW R — the preview retracts to R and its
    # block ends away from where it began, the machine retracts to its real
    # height; the same in the XZ plane (G18: Y is the cycle's axis — Z known
    # before it, so only the cycle's own axis can keep the next move unknown).
    "r94_g98_below_r": ("G21 G90 G98\nG0 X0 Y0 Z0\nM6\nG81 X10 Y5 Z-5 R2 F100\nG80\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r94_g99_below_r": ("G21 G90 G99\nG0 X0 Y0 Z0\nM6\nG81 X10 Y5 Z-5 R2 F100\nG80\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r94_g98_g18_below_r": ("G21 G90 G98 G18\nG0 X0 Y0 Z0\nM6\nG0 Z5\nG81 X10 Z5 Y-5 R2 F100\nG80\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 30 20"}),
    "r94_g99_g18_below_r": ("G21 G90 G99 G18\nG0 X0 Y0 Z0\nM6\nG0 Z5\nG81 X10 Z5 Y-5 R2 F100\nG80\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 30 20"}),
    # Codex R96 VP-I53 rest: any spelling of the number, an expression; VP-I54:
    # a branch that never runs writes nothing.
    "r96_g92_decimal": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG92.0 Z10\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r96_g92_expression": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG[90+2] Z10\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r96_g10_decimal": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG10.0 L20 P1 Z10\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r96_g92_standard": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG92 Z10\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r96_l2_decimal": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG10.0 L2 P1 Z30\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r96_store_decimal": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG28.10\nG0 X10 Y5 Z15\nG28\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r96_branch_not_run": ("G21 G90\nG0 X0 Y0 Z40\nM6\no100 if [0]\nG92 Z10\no100 endif\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r96_branch_run": ("G21 G90\nG0 X0 Y0 Z40\nM6\no100 if [1]\nG92 Z10\no100 endif\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r96_branch_inactive_l20": ("G21 G90\nG0 X0 Y0 Z40\nM6\no100 if [1]\nG10 L20 P2 Z10\no100 endif\nG0 X10 Y5 Z15\nG55\nG0 X20 Z25\nG0 X30\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    # Codex R97 VP-I53 rest: a sign on a number; a write the preview computes
    # equal to the old value inside a branch that runs (G92 Z40 at a believed
    # Z40) — the event is the evidence; G54 again inside a branch, no call.
    "r97_l_plus_active": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG10 L+20 P1 Z10\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r97_l_plain_active": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG10 L20 P1 Z10\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r97_g_plus_active": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG+92 Z10\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r97_l_plus_explicit": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG10 L+2 P1 Z30\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r97_l_plus_inactive": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG10 L+20 P2 Z10\nG0 X10 Y5 Z15\nG55\nG0 X20 Z25\nG0 X30\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r97_store_plus": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG+28.1\nG0 X10 Y5 Z15\nG28\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r97_branch_same_g92": ("G21 G90\nG0 X0 Y0 Z40\nM6\no100 if [1]\nG92 Z40\no100 endif\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r97_branch_same_l20": ("G21 G90\nG0 X0 Y0 Z40\nM6\no100 if [1]\nG10 L20 P1 Z40\no100 endif\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r97_branch_different_g92": ("G21 G90\nG0 X0 Y0 Z40\nM6\no100 if [1]\nG92 Z10\no100 endif\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r97_branch_reselect": ("G21 G90\nG0 X0 Y0 Z40\nM6\no100 if [1]\nG54\no100 endif\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r97_l_plus_active_position_control": ("G21 G90\nG0 X0 Y0 Z40\nG0 X0 Y20 Z30\nG10 L+20 P1 Z10\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r97_l_plus_inactive_position_control": ("G21 G90\nG0 X0 Y0 Z40\nG0 X0 Y20 Z30\nG10 L+20 P2 Z10\nG0 X10 Y5 Z15\nG55\nG0 X20 Z25\nG0 X30\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r97_store_plus_position_control": ("G21 G90\nG0 X0 Y0 Z40\nG0 X0 Y20 Z30\nG+28.1\nG0 X10 Y5 Z15\nG28\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r97_branch_same_g92_position_control": ("G21 G90\nG0 X0 Y0 Z40\nG0 X0 Y20 Z30\no100 if [1]\nG92 Z40\no100 endif\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r97_branch_same_l20_position_control": ("G21 G90\nG0 X0 Y0 Z40\nG0 X0 Y20 Z30\no100 if [1]\nG10 L20 P1 Z40\no100 endif\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    # Codex R97 VP-I55 rest: the same arc at F300 — the crossing is no stop
    "r97_arc_braking": ("G21 G90 G18\nG0 X0 Y0 Z40\nG2 X0 Z40 I0 K10 F300\nM2\n", "mm", 0.0, (490,), {}),
    # Codex R96 VP-I55: an arc whose ends lie inside the window (max Z 50)
    # crosses it in its middle — the run stops there, not at its start.
    "r96_arc_interior_limit": ("G21 G90 G18\nG0 X0 Y0 Z40\nG2 X0 Z40 I0 K10 F100\nM2\n", "mm", 0.0, (490,), {}),
    # Own: G76 returns X to its drive line — the start, a stale one — while
    # Z ends at its commanded depth: the end decides, not "moved in the block".
    "r94_g76_returns_x": ("G21 G90 G18\nG0 X0 Y0 Z40\nM6\nS500 M3\nG0 Y3\nG76 P1.5 Z-10 I-1 J0.2 K1\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 10 0 30"}),
    # Codex R95 VP-I53: an offset written from the unknown position after
    # the change (G92, G10 L20 on the active and on an inactive fixture)
    # stays wrong — an absolute move does not repair it; L2 is explicit, but
    # no canon call tells it from an L20 (kept unknown, conservatively); the
    # position controls reach the tool change position by a visible move.
    "r95_g92_from_stale": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG92 Z10\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_l20_from_stale": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG10 L20 P1 Z10\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_l20_inactive": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG10 L20 P2 Z10\nG0 X10 Y5 Z15\nG55\nG0 X20 Z25\nG0 X30\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_l2_constant": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG10 L2 P1 Z30\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_g92_from_stale_position_control": ("G21 G90\nG0 X0 Y0 Z40\nG0 X0 Y20 Z30\nG92 Z10\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_l20_from_stale_position_control": ("G21 G90\nG0 X0 Y0 Z40\nG0 X0 Y20 Z30\nG10 L20 P1 Z10\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_l20_inactive_position_control": ("G21 G90\nG0 X0 Y0 Z40\nG0 X0 Y20 Z30\nG10 L20 P2 Z10\nG0 X10 Y5 Z15\nG55\nG0 X20 Z25\nG0 X30\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    # Own: a comment line after the G10 (its code still reaches the next
    # line), the stored positions G28.1 / G30.1, an offset written BEFORE the
    # change (known), G92.1 (an explicit zero), a G90 after the write (it
    # hides the block's code from the state — the text still sees it), and
    # a main file with an o-word loop (text order lost: callbacks + the note).
    "r95_l20_inactive_comment": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG10 L20 P2 Z10\n(the setup sheet)\nG0 X10 Y5 Z15\nG55\nG0 X20 Z25\nG0 X30\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_g28_1_from_stale": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG28.1\nG0 X10 Y5 Z15\nG28\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_g30_1_from_stale": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG30.1\nG0 X10 Y5 Z15\nG30\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_g92_before_change": ("G21 G90\nG0 X0 Y0 Z40\nG92 Z10\nM6\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_g92_1_from_stale": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG92.1\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_l20_inactive_hidden": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG10 L20 P2 Z10\nG90\nG0 X10 Y5 Z15\nG55\nG0 X20 Z25\nG0 X30\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_g28_1_hidden": ("G21 G90\nG0 X0 Y0 Z40\nM6\nG28.1\nG90\nG0 X10 Y5 Z15\nG28\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_oword_g92": ("G21 G90\nG0 X0 Y0 Z40\no100 repeat [1]\nM6\no100 endrepeat\nG92 Z10\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_sub_g92": ("G21 G90\nG0 X0 Y0 Z40\nM6\no<setz> call\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,),
                    {"emcio": "TOOL_CHANGE_POSITION = 0 20 30", "subs": {"setz.ngc": "o<setz> sub\nG92 Z10\no<setz> endsub\nM2\n"}}),
    # Codex R98 VP-I53 rest / VP-I56: a call into another file spelled with
    # spaces (whitespace counts nowhere outside a comment) is a call; its
    # G92 is the sub file's line 2 — never the main file's explicit L2.
    "r98_foreign_plain": ("G21 G90\nG10 L2 P1 Z0\nG0 X0 Y0 Z40\nM6\no<touch> call\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,),
                          {"emcio": "TOOL_CHANGE_POSITION = 0 20 30", "subs": {"touch.ngc": "o<touch> sub\nG92 Z40\no<touch> endsub\n"}}),
    "r98_foreign_spaced": ("G21 G90\nG10 L2 P1 Z0\nG0 X0 Y0 Z40\nM6\no<touch> c a l l\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,),
                           {"emcio": "TOOL_CHANGE_POSITION = 0 20 30", "subs": {"touch.ngc": "o<touch> sub\nG92 Z40\no<touch> endsub\n"}}),
    "r98_foreign_spaced_position_control": ("G21 G90\nG10 L2 P1 Z0\nG0 X0 Y0 Z40\nG0 X0 Y20 Z30\no<touch> c a l l\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,),
                                            {"emcio": "TOOL_CHANGE_POSITION = 0 20 30", "subs": {"touch.ngc": "o<touch> sub\nG92 Z40\no<touch> endsub\n"}}),
    # Codex R99 VP-I53 rest: an o-word name that is no literal (a sign, a
    # function) — the same sub file `100.ngc` runs natively; and the R97
    # branch with `o+100` numbers (L5 never runs / runs).
    "r99_o_plus": ("G21 G90\nG10 L2 P1 Z0\nG0 X0 Y0 Z40\nM6\no+100 call\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,),
                   {"emcio": "TOOL_CHANGE_POSITION = 0 20 30", "subs": {"100.ngc": "o100 sub\nG92 Z40\no100 endsub\n"}}),
    "r99_o_function": ("G21 G90\nG10 L2 P1 Z0\nG0 X0 Y0 Z40\nM6\noABS[-100] call\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,),
                       {"emcio": "TOOL_CHANGE_POSITION = 0 20 30", "subs": {"100.ngc": "o100 sub\nG92 Z40\no100 endsub\n"}}),
    "r99_o_plus_position_control": ("G21 G90\nG10 L2 P1 Z0\nG0 X0 Y0 Z40\nG0 X0 Y20 Z30\no+100 call\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,),
                                    {"emcio": "TOOL_CHANGE_POSITION = 0 20 30", "subs": {"100.ngc": "o100 sub\nG92 Z40\no100 endsub\n"}}),
    "r99_plus_skip": ("G21 G90\nG0 X0 Y0 Z40\nM6\no+100 if [0]\nG92 Z40\no+100 endif\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r99_plus_run": ("G21 G90\nG0 X0 Y0 Z40\nM6\no+100 if [1]\nG92 Z40\no+100 endif\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    "r95_oword_no_write": ("G21 G90\nG0 X0 Y0 Z40\no100 repeat [1]\nM6\no100 endrepeat\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 30"}),
    # Own: a fixture switch to a ROTATED fixture is a rotation change too.
    "r94_fixture_rotated_after_partial": ("G21 G90\nG10 L2 P2 R45\nG0 X0 Y0 Z40\nM6\nG0 X10 Z15\nG55\nG0 Y5 Z20\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 0"}),
    "r94_fixture_rotated_complete": ("G21 G90\nG10 L2 P2 R45\nG0 X0 Y0 Z40\nM6\nG0 X10 Z15\nG55\nG0 X10 Y5 Z20\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 20 0"}),
    # Own: slot 0 of the state's G codes is the LINE NUMBER — the move at
    # line 910 is no G91 block, the one at line 810 under G98 no G81.
    "r94_line_910": ("G21 G90\nG0 X0 Y0 Z40\nM6\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
    "r94_line_810_g98": ("G21 G90 G98\nG0 X0 Y0 Z40\nM6\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nG0 X10 Y5 Z15\nG0 X20\nM2\n", "mm", 0.0, (490,), {"emcio": "TOOL_CHANGE_POSITION = 0 0 0"}),
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

# M600 in the preview (Codex R102–R104, plan docs/reviews/m600-preview.plan.md):
# the bundled tool_touch_off.ngc through the M600 remap, the toolsetter values
# in the parameter file (the 3-axis sim profile's: setter X10 Y10 at machine
# Z −180, G30 X10), T2 80 mm long in the table. The fast probe starts at
# −180 + 80 + 5 = −95; the trip point is −100.
_TS_VARS = {3004: 2000, 3005: 200, 3006: 3000, 3007: 60, 3009: 3, 3010: 150, 3013: 0, 3014: 0,
            3100: 10, 3101: 10, 3102: -180, 3103: 1, 3104: 5, 3105: 0, 3106: 1, 3107: 5, 3108: 0,
            3109: 0, 3110: 0, 3111: 0, 3112: 0, 3113: 0, 3114: 0, 3115: 0, 3116: 0}
_M600_SUBS = ("tool_length_probe/m600.ngc", "tool_length_probe/tool_touch_off.ngc")
_M600_PROG = "G21 G90\nG0 X50 Y50 Z-100\nT2 M600\nG0 X60 Y60\nM2\n"


def _m600(var=None, prog=_M600_PROG, **extra):
    # var={} (an empty dict): the parameter file holds no toolsetter key
    return (prog, "mm", 0.0, (490,), {"rs274ngc": "REMAP=M600 modalgroup=6 ngc=m600",
                                     "bundled": _M600_SUBS,
                                     "var": {} if var == {} else {**_TS_VARS, **(var or {})},
                                     **extra})


CASES.update({
    "m600_known": _m600(),
    "m600_length_unknown": _m600(tools=[(1, 10), (2, 0)]),
    "m600_setter_above": _m600({3102: 10}),
    # Codex R102: a 1 mm travel from −95 never reaches −100
    "m600_trip_outside": _m600({3007: 1}),
    # the Z limit clamps the travel: to 4 mm (ends at −99) / to 13 mm (−108)
    "m600_clamp_out": _m600(zmin=-101),
    "m600_clamp_in": _m600(zmin=-110),
    # the fast probe reaches −100.5; the slow one would end at −103, past −102.5
    "m600_slow_limit": _m600(zmin=-102.5),
    "m600_single": _m600({3005: 0}),
    "m600_retract_zero": _m600({3009: 0}),
    "m600_feed_zero": _m600({3004: 0}),
    # T2 is the edge finder: its own X/Y, the reference 5 mm higher
    "m600_finder": _m600({3014: 2, 3113: 30, 3114: 40, 3115: 5}),
    "m600_no_back": _m600({3106: 0}),
    "m600_no_prepos": _m600({3108: 1}),
    # T2 is 6 mm across: 50 % of it, towards X+
    "m600_diameter": _m600({3111: 5, 3112: 50, 3013: 1}),
    # M601: the same routine in manual mode (#2000 = 0) — no G30, no way back
    "m601_known": ("G21 G90\nG0 X50 Y50 Z-100\nT2 M601\nG0 X60 Y60\nM2\n", "mm", 0.0, (490,),
                   {"rs274ngc": "REMAP=M601 modalgroup=6 ngc=m601",
                    "bundled": ("tool_length_probe/m601.ngc", "tool_length_probe/tool_touch_off.ngc"),
                    "var": _TS_VARS}),
    # two M600 lines: no unique call site — the routine's M6 names no line
    # (the text scan finds both)
    "m600_twice": _m600(prog="G21 G90\nG0 X50 Y50 Z-100\nT2 M600\nG0 X60\nT1 M600\nG0 X70\nM2\n"),
    # the gateway's word that the toolsetter values are unknown: nothing from
    # the routine's start on
    "m600_basis_unknown": _m600(ctx={"toolsetter_unpredictable": "toolsetter_unknown"}),
    # the gateway's basis (plan section 2): confirmed values patched over a
    # parameter file whose own lines differ (the gateway wrote them, the
    # interpreter never took them) — the preview reads the booked ones
    "m600_basis_patched": _m600({3102: -150, 3007: 1}, ctx={"toolsetter": {
        "version": 3, "patches": {"3102": "-180.000000", "3007": "60.000000", "3116": "0.000000"},
        "unpredictable": None, "view": {"state": "confirmed", "unknown": [], "assumed": [], "origin": "applied", "t": 5.0}}}),
    # the file lacks every key and no basis says otherwise: never stored
    "m600_not_set_up": _m600(var={}, ctx={"toolsetter": {
        "version": 1, "patches": {"3116": "0.000000"}, "unpredictable": "toolsetter_not_set_up",
        "view": {"state": "not_set_up", "unknown": [], "assumed": []}}}),
    # an M600 remap that is NOT the suite's (M600 plan, section 4): the
    # preview cannot know what the call does — nothing from it on
    "m600_foreign": ("G21 G90\nG0 X50 Y50 Z-100\nG1 X55 F100\nT2 M600\nG0 X60 Y60\nM2\n", "mm", 0.0, (490,),
                     {"rs274ngc": "REMAP=M600 modalgroup=6 ngc=othertc",
                      "subs": {"othertc.ngc": "o<othertc> sub\nG53 G0 Z0\nM6\no<othertc> endsub\nM2\n"}}),
    # ...in a program with o-words: its lines need not run in text order —
    # from the program's start
    "m600_foreign_oword": ("G21 G90\nG0 X50 Y50 Z-100\no100 if [1]\nT2 M600\no100 endif\nG0 X60 Y60\nM2\n",
                           "mm", 0.0, (490,),
                           {"rs274ngc": "REMAP=M600 modalgroup=6 ngc=othertc",
                            "subs": {"othertc.ngc": "o<othertc> sub\nM6\no<othertc> endsub\nM2\n"}}),
    # a move past Z max (50) after the call: a violation where the measurement
    # is predicted, no verdict where it is not
    "m600_known_then_high": _m600(prog="G21 G90\nG0 X50 Y50 Z-100\nT2 M600\nG0 X60 Y60 Z200\nM2\n"),
    "m600_unknown_then_high": _m600(prog="G21 G90\nG0 X50 Y50 Z-100\nT2 M600\nG0 X60 Y60 Z200\nM2\n",
                                    tools=[(1, 10), (2, 0)]),
    # a G92 after the stop: every axis is unknown already, for the probe's
    # reason — no offset line of its own
    "m600_unknown_then_g92": _m600(prog="G21 G90\nG0 X50 Y50 Z-100\nT2 M600\nG92 Z5\nG0 X70\nM2\n",
                                   tools=[(1, 10), (2, 0)]),
    # the canon's pairing rule on a synthetic call: the marker pairs with the
    # FIRST G43 of the call only, and one left open dies with the call
    "toollen_pairing": ("G21 G90\nG0 X0 Y0 Z0\no<tl_pair> call\nG43 H2\nG0 X5\no<tl_open> call\nG43 H1\nG0 X6\nM2\n",
                        "mm", 0.0, (490,), {"subs": {
                            "tl_pair.ngc": "o<tl_pair> sub\n(WEBUI_SUB=tl_pair)\n(WEBUI_TOOLLEN_TABLE)\n"
                                           "T2 M6\nG43 H2\nG0 X1\nG43 H1\nG0 X2\n(WEBUI_SUB_END)\no<tl_pair> endsub\nM2\n",
                            "tl_open.ngc": "o<tl_open> sub\n(WEBUI_SUB=tl_open)\n(WEBUI_TOOLLEN_TABLE)\n"
                                           "G0 X3\n(WEBUI_SUB_END)\no<tl_open> endsub\nM2\n"}}),
    # a G43 after the call is no table-length claim of the routine's
    "m600_g43_after": _m600(prog="G21 G90\nG0 X50 Y50 Z-100\nT2 M600\nG43 H2\nG0 X60 Y60\nM2\n"),
    "m600_t0": _m600(prog="G21 G90\nG0 X50 Y50 Z-100\nT0 M600\nG0 X60 Y60\nM2\n"),
    # Codex VP103-01: the program reads the probe result after the call, in
    # G54 Z10 and G92 Z−5; earlier results must not count
    "m600_result": _m600(ctx={"var_patches": {**{str(b + j): "0" for b in range(5220, 5381, 20)
                                                  for j in range(1, 11)}, "5223": "10"}}, prog=(
        "G21 G90\n#5063 = -999\n#5070 = 0\nG0 X50 Y50 Z-100\nG92 Z-95\nT2 M600\n"
        "o100 if [#5070 EQ 1]\n  G0 X5\no100 else\n  G0 X7\no100 endif\n"
        "G0 Y[#5063]\nM2\n")),
})

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
{extra.get("rs274ngc", "")}
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
MIN_LIMIT = {extra.get("zmin", -500)}
MAX_LIMIT = {1.2 if inch else 50}
MAX_VELOCITY = 10
""")
os.environ["INI_FILE_NAME"] = str(ini)
# (tool, Z): the table file and STAT's — the preview reads tools through the
# canon (get_tool → STAT.tool_table), the mmap only keeps it from crashing
_tools = extra.get("tools", [(1, 10), (2, 80)])
(work / "tool.tbl").write_text("".join(f"T{n} P{n} Z{z} D6\n" for n, z in _tools))
_var = {5161: 0, 5181: 10, 5210: 1, 5211: 0, 5212: 0, 5213: 0, 5220: 1, 5221: 0, 5222: 0, 5223: 0,
        **extra.get("var", {})}
# LinuxCNC reads the parameter file in ascending order only
(work / "machine.var").write_text("".join(f"{k} {_var[k]}\n" for k in sorted(_var)))
# The suite's own subroutines, as shipped (a copy, the way the INI's
# SUBROUTINE_PATH reaches them)
for _rel in extra.get("bundled", ()):
    shutil.copy(HERE.parent / "subroutines" / _rel, work / Path(_rel).name)
# The interpreter reads tools from the tool data mmap a running LinuxCNC's
# iocontrol creates ($HOME/.tool.mmap); offline there is none and every tool
# lookup (Tn M6, G43 Hn, #5403) segfaults. Create one in THIS process under a
# private HOME (the work dir) - never the user's, where a live instance's
# lives - and load the same table, the way iocontrol does
# (tool_mmap_creator, tooldata_init, tooldata_load; libtooldata 2.9).
os.environ["HOME"] = str(work)
_td = ctypes.CDLL("libtooldata.so.0")
_tool_stat = ctypes.create_string_buffer(1 << 20)   # kept alive: the library keeps the pointer
_td["_Z17tool_mmap_creatorPK13EMC_TOOL_STATi"](_tool_stat, 0)
_td["_Z13tooldata_initb"].argtypes = [ctypes.c_bool]
_td["_Z13tooldata_initb"](False)
_load = _td["_Z13tooldata_loadPKcPPc"]
_load.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_char_p)]
# tooldata_load clears CANON_POCKETS_MAX (1001) comment strings before it
# reads: 1000 pointers let it write through whatever followed the array
_comments = [ctypes.create_string_buffer(256) for _ in range(1001)]
_ptrs = (ctypes.c_char_p * 1001)(*[ctypes.cast(b, ctypes.c_char_p) for b in _comments])
if _load(str(work / "tool.tbl").encode(), _ptrs) != 0:
    print(json.dumps({"error": "tool table not loaded"}))
    sys.exit(1)
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
                    tool_in_spindle=1, tool_table=[tool(*_tools[0])] + [tool(n, z) for n, z in _tools],
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
_mmap = (work / ".tool.mmap").read_bytes()
with contextlib.redirect_stderr(err):
    out = worker.parse(ctx)
# the preview never writes the tool data a live LinuxCNC shares (a G10 L1 / M6
# in it changes the interpreter's own copy only)
_mmap_unchanged = (work / ".tool.mmap").read_bytes() == _mmap
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
    "mmap_unchanged": _mmap_unchanged,
    "probe_unpredicted": out.get("probe_unpredicted"), "toollen_table": out.get("toollen_table"),
    "feed_sub": u("feed_sub", "<u1"), "rapid_sub": u("rapid_sub", "<u1"), "sub_names": out.get("sub_names"),
    "toolsetter_basis": out.get("toolsetter_basis"),
    "feed_lines": u("feed_lines", "<u4"), "tool_change_lines": out.get("tool_change_lines"),
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
    "stale_offset_lines": out.get("stale_offset_lines"),
    "stale_offset_untracked": out.get("stale_offset_untracked"),
    "feed_tcum": u("feed_tcum", "<f4"),
    "meta": {k: meta.get(k) for k in ("start_known", "tlo_start", "start_mode", "start_reason")},
    "digest_without_start": __import__("hashlib").sha256(
        __import__("msgspec").msgpack.encode(comparable)).hexdigest(),
}))
