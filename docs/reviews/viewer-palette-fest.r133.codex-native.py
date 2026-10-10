#!/usr/bin/env python3
"""R133 native payload probes. The repository's offline harness supplies
private INI/vars/tool table/mmap and rejects machine commands. Source is only
read, and the added cases are injected in memory. One process per case.
Usage: <venv-python> native.py ARCHIVE [case]
"""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(sys.argv[1]).resolve()
OUT=ROOT.parent/'payloads'
CASES={
 'first_g1_xyz': ('G21 G90\nG1 X0 Y0 Z0 F100\nG1 X10\nM2\n',{}),
 'first_g1_x_control': ('G21 G90\nG1 X0 F100\nG1 Y0 Z0\nG1 X10\nM2\n',{}),
 'g43_before_first': ('G21 G90\nG43.1 Z10\nG0 X10\nG0 Y0 Z0\nM2\n',{}),
 'g43_after_first_control': ('G21 G90\nG0 X10\nG43.1 Z10\nG0 Y0 Z0\nM2\n',{}),
 'm6_before_first': ('G21 G90\nM6\nG91 G0 X10\nG0 Y10\nM2\n',{'emcio':'TOOL_CHANGE_POSITION = 50 50 50'}),
 'world_before_first': ('G21 G90\nG0 X10\nG0 Y10\nM2\n',{'ctx':{'kins_type':1}}),
 'g93_no_limits': ('G21 G90 G93\nG1 X10 F2\nG1 Y10 F2\nM2\n',{}),
 'untracked_writes': ('G21 G90\nG0 Z0\no100 sub\nG30.1\no100 endsub\no100 call\nG0 X10 Y0 Z0\nG0 X20\nM2\n',{}),
 'all_dep': ('G21 G90\nG91 G0 X10\nG0 Y10\nM2\n',{}),
 'store_before_first_absolute': ('G21 G90\no100 sub\nG30.1\no100 endsub\no100 call\nG0 X0 Y0 Z0\nG30\nM2\n',{}),
 'store_after_known_control': ('G21 G90\no100 sub\nG30.1\no100 endsub\nG0 X0 Y0 Z0\no100 call\nG30\nM2\n',{}),
}
if len(sys.argv)==2:
 OUT.mkdir(exist_ok=True)
 results={}
 for name in CASES:
  p=subprocess.run([sys.executable,__file__,str(ROOT),name],capture_output=True,text=True,timeout=60)
  results[name]=json.loads(p.stdout) if p.returncode==0 else {'rc':p.returncode,'stdout':p.stdout,'stderr':p.stderr}
 print(json.dumps(results,indent=2))
 sys.exit(0)
name=sys.argv[2]
program,extra=CASES[name]
harness=ROOT/'lcnc-gateway/native_start_probe.py'
source=harness.read_text()
anchor='program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]'
assert source.count(anchor)==1
source=source.replace(anchor,'CASES[sys.argv[1]] = '+repr((program,'mm',0.0,(490,),extra))+'\n'+anchor)
sys.argv=[str(harness),name,str(OUT/(name+'.msgpack'))]
stdout=io.StringIO()
with contextlib.redirect_stdout(stdout):
 exec(compile(source,str(harness),'exec'),{'__file__':str(harness),'__name__':'__main__'})
data=json.loads(stdout.getvalue().splitlines()[-1])
data.update(program=program,extra=extra)
print(json.dumps(data))
