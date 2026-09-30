#!/usr/bin/env python3
"""StatusRuntime with the repository's fake_linuxcnc and scripted STAT.
No LinuxCNC connection. Run from archive root: python3 -B evidence/...py
"""
import json,os,sys
from pathlib import Path
from types import SimpleNamespace
root=Path(__file__).resolve().parent.parent
os.environ['LCNC_LOG_DIR']=str(root/'evidence/logs')
sys.path.insert(0,str(root/'lcnc-gateway'))
import fake_linuxcnc
fake_linuxcnc.install()
from test_status_runtime import TestPollStatus, _runtime
fixture=TestPollStatus()
rows=[]
for name,z in [('positive',65),('negative',-65),('no_table',None),('zero',0)]:
 st=fixture._stat(tool_in_spindle=13,tool_table=() if z is None else (SimpleNamespace(id=13,diameter=6,zoffset=z),),
  tool_offset=(0,0,-65 if z is None else z),joint_actual_position=(150,0,-235),
  g5x_offset=(0,0,0),g92_offset=(0,0,0))
 payload,wire=_runtime(stat=st).poll_and_serialize()
 assert wire["tool_table_z"]==payload.tool_table_z
 rows.append({'case':name,'table_zoffset':z,'tool_length':payload.tool_length,'tool_table_z':payload.tool_table_z,
  'tool_offset':payload.tool_offset,'work_pos':payload.work_pos})
print(json.dumps({'commit':'95aaf08','cases':rows},indent=2))
