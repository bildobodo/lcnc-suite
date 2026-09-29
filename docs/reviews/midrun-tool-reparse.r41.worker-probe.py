#!/usr/bin/env python3
"""R41: actual preview worker and native offline interpreter; synthetic STAT only.
Usage: LCNC_LOG_DIR=/tmp/... python worker-probe.py /path/to/archive
Never instantiates linuxcnc.stat/command or imports gateway.
"""
import contextlib, io, json, os, sys, tempfile
from pathlib import Path
from collections import namedtuple
from types import SimpleNamespace
root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root/'lcnc-gateway'))
work = Path(tempfile.mkdtemp(prefix='r41-worker-'))
os.environ['LCNC_LOG_DIR'] = str(work/'logs')
ini = work/'machine.ini'
ini.write_text('''[EMC]
MACHINE = OFFLINE_REVIEW
[TRAJ]
COORDINATES = XYZ
LINEAR_UNITS = mm
ANGULAR_UNITS = degree
[RS274NGC]
PARAMETER_FILE = machine.var
[EMCIO]
TOOL_TABLE = tool.tbl
RANDOM_TOOLCHANGER = 0
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
''')
os.environ['INI_FILE_NAME'] = str(ini)
os.environ['LCNC_INI_FILE'] = str(ini)
(work/'tool.tbl').write_text('T1 P1 Z10 D6\nT2 P2 Z80 D6\n')
Tool = namedtuple('Tool', 'id xoffset yoffset zoffset aoffset boffset coffset uoffset voffset woffset diameter frontangle backangle orientation')
def tool(n,z): return Tool(n,0,0,z,0,0,0,0,0,0,6,0,0,0)
s = SimpleNamespace(poll=lambda: None, axis_mask=7, angular_units=1.0,
 linear_units=1.0, block_delete=False, actual_position=[0]*9,
 g92_offset=[0]*9, tool_offset=[0,0,10]+[0]*6,tool_in_spindle=1,
 tool_table=[tool(1,10),tool(1,10),tool(2,80)],joint=None)
import linuxcnc
linuxcnc.stat=lambda: s
def no_command(*a,**kw): raise AssertionError('Machine commands prohibited')
linuxcnc.command=no_command
import gcode_parse_worker as worker
import numpy as np
ngc=work/'program.ngc'
ctx={'file':str(ngc),'ini_path':str(ini),'units':'mm','g5x_index':1,
     'var_patches':{str(base+j):'0' for base in range(5220,5381,20) for j in range(1,11)},'kins_type':0,'kins_frame':None,
     'seed_tool':{'applied_tlo':[0,0,10],'loaded_tool':1},'nice':19}
def var(g92=0,param=10):
 (work/'machine.var').write_text(f'5161 0\n5181 {param}\n5210 1\n5211 {g92}\n5212 0\n5213 0\n5220 1\n5221 0\n5222 0\n5223 0\n')
def parse(label):
 err=io.StringIO()
 with contextlib.redirect_stderr(err): out=worker.parse(ctx)
 metas={}
 for ln in err.getvalue().splitlines():
  if ln.startswith(('__TLO__','__WCSOFF__','__PARAMS__')):
   k,v=ln.split('\t',1);metas[k]=json.loads(v)
 def points(key):
  b=out[key]
  return np.frombuffer(b, dtype=np.float32).reshape(-1,3).tolist() if isinstance(b,bytes) else b
 return {'label':label,'parse_error':out['parse_error'],'feed':points('feed'),
         'rapid':points('rapid'),'tlo_events':out.get('tlo_events'),
         'violations':out['violations'],'wcs_basis':out['wcs_basis'],
         'meta':metas,'log':err.getvalue()}
res=[]
var()
ngc.write_text('G21 G90\nG43\nG0 X0 Y0 Z0\nG1 X10 Z1 F100\nM2\n')
res.append(parse('pinned start: T1 Z10; live spindle T1'))
ctx['param_text']=res[-1]['meta']['__PARAMS__']['text']
ctx['g92_offset']=res[-1]['meta']['__PARAMS__']['g92']
s.tool_in_spindle=2;s.tool_offset=[0,0,80]+[0]*6;s.tool_table[0]=tool(2,80)
res.append(parse('same ctx/table rows, only live spindle changed to T2 Z80'))
s.tool_in_spindle=1;s.tool_offset=[0,0,10]+[0]*6;s.tool_table[0]=tool(1,10)
ngc.write_text('G21 G90\nG0 X0 Y0 Z0\nG1 X#5181 Z1 F100\nM2\n')
var(g92=0,param=10)
res.append(parse('pinned initial parameter file'))
var(g92=100,param=10);s.g92_offset=[100]+[0]*8
res.append(parse('same pinned ctx, only G92 changed in parameter file during run'))
var(g92=0,param=30);s.g92_offset=[0]*9
res.append(parse('same pinned ctx, only G30 X changed in parameter file during run'))
ngc.write_text('G21 G90\nG0 X0 Y0 Z0\n/G1 X123 F100\nG1 X50 F100\nM2\n')
var();s.g92_offset=[0]*9;s.block_delete=False
res.append(parse('pinned, block delete false'))
s.block_delete=True
res.append(parse('same ctx, block delete true'))
checks={
 'pinned_spindle_keeps_original_tlo_events':res[0]['tlo_events']==res[1]['tlo_events'],
 'pinned_spindle_keeps_original_limit_flags':res[0]['violations']==res[1]['violations'],
 'pinned_parameters_keep_g92':res[2]['wcs_basis']==res[3]['wcs_basis'],
 'pinned_parameters_keep_g30':res[2]['feed']==res[4]['feed'],
 'block_delete_is_another_live_input':res[5]['feed']!=res[6]['feed'],
 'all_parse_without_error':all(r['parse_error'] is None for r in res)}
print(json.dumps({'reviewed_commit':'e4921e7','checks':checks,'ctx':ctx,'results':res},indent=2))
