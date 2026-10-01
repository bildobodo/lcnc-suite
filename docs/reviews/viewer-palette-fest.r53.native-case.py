#!/usr/bin/env python3
"""R53 plan experiment: dependency after G49, one fresh process per case.
Copy beside gcode_parse_worker.py; invoked by r53.native-run.py.
Synthetic STAT and temporary INI/var/table; commands prohibited.
Proposed G43.1 init (except unknown), literal Fassung 2 dependency rule,
and unmodified native worker results. No product implementation.
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



# R53: inspect whether a first G49 permanently ends start dependency.
case=sys.argv[1];offset=float(sys.argv[2]);s.tool_offset=[0,0,offset]+[0]*6
programs={
 'relative_after_g49':'G21 G90\nG0 X0 Y0 Z39.990\nG49\nG91\nG1 Z0.009 F100\nM2\n',
 'g49':'G21 G90\nG49\nG0 X0 Y0 Z0\nG1 X10 Z45 F100\nM2\n',
 'restore':'G21 G90\nM70\nG49\nG0 X0 Y0 Z0\nM72\nG1 X10 Z45 F100\nM2\n',
 'g53_then_incremental':'G21 G90\nG53 G0 Z0\nG49\nG91\nG1 Z5 F100\nM2\n',
 'unknown':'G21 G90\nG0 X0 Y0 Z40\nG1 X10 Z45 F100\nM2\n',
 'g49_motion':'G21 G90\nG49 G0 X0 Y0 Z40\nG1 X10 Z45 F100\nM2\n',
}
LOG=[];tagged=[];dependent=True
orig_next=worker.PreviewCanon.next_line
last_seq=0;previous_line=0
def next_line(self,state):
 global dependent,last_seq,previous_line
 g8=getattr(state,'tool_length_offset',None)
 if g8==490:dependent=False
 seq=getattr(self,'seq',0)
 for i in range(last_seq+1,seq+1):tagged.append({'seq':i,'line':previous_line,'dep_fassung2':dependent,'post_tlo_mode':g8,'g53':530 in state.gcodes})
 LOG.append({'next_line':state.sequence_number,'previous_line':previous_line,'post_tlo_mode':g8,'seq':seq,'dep_fassung2':dependent})
 last_seq=seq;previous_line=state.sequence_number
 return orig_next(self,state)
worker.PreviewCanon.next_line=next_line
real_parse=worker.gcode.parse
def seeded(filename,canon,initcodes,*args):
 codes=list(initcodes)
 if case!='unknown':codes.insert(2,f'G43.1 X0 Y0 Z{offset:.9f}')
 return real_parse(filename,canon,codes,*args)
worker.gcode.parse=seeded
var();ngc.write_text(programs[case]);err=io.StringIO()
with contextlib.redirect_stderr(err):out=worker.parse(dict(BASE))
def points(key):
 b=out[key]
 return np.frombuffer(b,dtype=np.float32).reshape(-1,3).tolist() if isinstance(b,bytes) else b
print(json.dumps({'case':case,'seed_z':offset,'program':programs[case],'parse_error':out.get('parse_error'),'next_line':LOG,'segments':tagged,
 'feed':points('feed'),'rapid':points('rapid'),'tlo_events':out.get('tlo_events'),'violations':out['violations'],'violations_total':out['violations_total'],
 'feed_outside':list(out.get('feed_outside',[])),'rapid_outside':list(out.get('rapid_outside',[]))}))
