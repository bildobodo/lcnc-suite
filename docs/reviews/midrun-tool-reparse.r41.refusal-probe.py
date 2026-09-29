#!/usr/bin/env python3
"""R41: refused pinned parse must remain stale in client-facing status.
Actual BulkPipeline + drift helpers; worker stub returns its documented exit 4.
No gateway import and no LinuxCNC connection. Run with archive root argument.
"""
import asyncio,json,os,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
root=Path(sys.argv[1]);sys.path.insert(0,str(root/'lcnc-gateway'))
work=Path(tempfile.mkdtemp(prefix='r41-refusal-'))
os.environ['LCNC_LOG_DIR']=str(work/'logs')
from bulk_pipeline import BulkPipeline
from gateway_util import evaluate_tlo_drift,midrun_table_gate_open,PIN_UNSUPPORTED_EXIT
ini=work/'machine.ini';ini.write_text('[EMCIO]\nRANDOM_TOOLCHANGER=1\n')
ngc=work/'program.ngc';ngc.write_text('G0 X0\nG1 X10 F100\nM2\n')
stat=SimpleNamespace(ini_filename=str(ini),g5x_index=1,axis_mask=7,actual_position=[0]*9)
b=BulkPipeline(get_stat=lambda:stat,get_machine_units=lambda:'mm',build_wcs_rotation_patches=lambda:{})
meta={'table_mtime':1000,'tlos':[[1,0,0,10,6],[2,0,0,80,6]],'applied_tlo':[0,0,10],'loaded_tool':1}
base_logs=('__SCHEMA__\t9\n__TLO__\t'+json.dumps(meta)+'\n__PARAMS__\t'+json.dumps({'text':'5220 1\n','g92':[0]*9})+'\n').encode()
b._run_gcode_worker_blocking=lambda data,timeout:(0,b'old-preview',base_logs)
async def run():
 await b.refresh_gcode_preview(str(ngc))
 version=b.preview_version
 drift=evaluate_tlo_drift(b.published_tlo,2000,None,None,table_rows=[(1,10),(2,90)],table_only=True)
 sent=[]
 def refuse(data,timeout):
  sent.append(b.preview_refresh_status())
  return PIN_UNSUPPORTED_EXIT,b'',b'__PIN_UNSUPPORTED__\trandom toolchanger\n'
 b._run_gcode_worker_blocking=refuse
 tasks=[]
 def spawn(c):
  t=asyncio.create_task(c);tasks.append(t);return t
 b.schedule_refresh(str(ngc),'midrun:'+drift,spawn,pinned=True)
 await tasks[-1]
 pinnable=bool(b.published_ctx) and b.published_ctx.get('file')==str(ngc) and not b.pin_unsupported
 print(json.dumps({'commit':'e4921e7','changed_tool':2,'loaded_tool':1,'loaded_tool_length':10,
  'parse_tlos':meta['tlos'],'drift':drift,'during_refresh':sent[0],
  'after_refresh':b.preview_refresh_status(),'pin_unsupported':b.pin_unsupported,
  'version_unchanged':b.preview_version==version,'old_payload_kept':b.preview_bytes==b'old-preview',
  'next_midrun_gate':midrun_table_gate_open(str(ngc),b.refresh_running,b.preview_available(),pinnable,True,False,3.0)},indent=2))
asyncio.run(run())
