#!/usr/bin/env python3
"""R42: real BulkPipeline, drift decision and status envelope; synthetic worker.
Run with archive root. No gateway import or LinuxCNC connection.
"""
import asyncio,json,os,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
root=Path(sys.argv[1]);sys.path.insert(0,str(root/'lcnc-gateway'))
work=Path(tempfile.mkdtemp(prefix='r42-pipeline-'));os.environ['LCNC_LOG_DIR']=str(work/'logs')
from bulk_pipeline import BulkPipeline
from gateway_util import evaluate_tlo_drift,midrun_table_action,PIN_UNSUPPORTED_EXIT
from ws_fanout import build_status_envelope
ini=work/'machine.ini';ini.write_text('[EMCIO]\nRANDOM_TOOLCHANGER=1\n')
ngc=work/'program.ngc';ngc.write_text('G0 X0\nG1 X10 F100\nM2\n')
stat=SimpleNamespace(ini_filename=str(ini),g5x_index=1,axis_mask=7,actual_position=[0]*9)
b=BulkPipeline(get_stat=lambda:stat,get_machine_units=lambda:'mm',build_wcs_rotation_patches=lambda:{})
meta={'table_mtime':1000,'tlos':[[1,0,0,10,6],[2,0,0,80,6]],'applied_tlo':[0,0,10],'loaded_tool':1}
def logs(m):return ('__SCHEMA__\t9\n__TLO__\t'+json.dumps(m)+'\n__PARAMS__\t'+json.dumps({'text':'5220 1\n','g92':[0]*9})+'\n').encode()
def env():return build_status_envelope(status_data={},errors=[],clients_list=[],armed=True,preview_refresh=b.preview_refresh_status(),preview_table_stale=b.table_stale)
async def run():
 b._run_gcode_worker_blocking=lambda data,timeout:(0,b'old-preview',logs(meta))
 await b.refresh_gcode_preview(str(ngc));version=b.preview_version
 drift=evaluate_tlo_drift(b.published_tlo,2000,None,None,table_rows=[(1,10),(2,90)],table_only=True)
 during=[]
 def refuse(data,timeout):
  during.append(env());return PIN_UNSUPPORTED_EXIT,b'',b'__PIN_UNSUPPORTED__\trandom toolchanger\n'
 b._run_gcode_worker_blocking=refuse
 tasks=[]
 def spawn(c):
  t=asyncio.create_task(c);tasks.append(t);return t
 b.schedule_refresh(str(ngc),'midrun:'+drift,spawn,pinned=True);await tasks[-1]
 refused=env()
 assert b.preview_version==version and b.pin_unsupported
 assert refused['preview_table_stale']=={'reason':'table_mtime','why':'unsupported'}
 assert 'preview_refresh' not in refused
 action=midrun_table_action(drift,True,True,b.pin_unsupported)
 assert action==('stale','unsupported')
 # A failed idle attempt must not clear the warning.
 b._run_gcode_worker_blocking=lambda data,timeout:(3,b'',b'parse failed\n')
 await b.refresh_gcode_preview(str(ngc),reason='table_mtime');failed=env()
 assert failed['preview_table_stale']==refused['preview_table_stale']
 # A successful idle publication uses the current row and clears the mark.
 fresh=dict(meta,table_mtime=2000,tlos=[[1,0,0,10,6],[2,0,0,90,6]])
 b._run_gcode_worker_blocking=lambda data,timeout:(0,b'new-preview',logs(fresh))
 await b.refresh_gcode_preview(str(ngc),reason='table_mtime');published=env()
 assert b.preview_version==version+1 and 'preview_table_stale' not in published
 # Missing basis marks the preview instead of spawning; unload clears it.
 act,why=midrun_table_action('table_row',True,False,False)
 assert act=='stale' and why=='no-basis'
 b.mark_table_stale('table_row',why);no_basis=env()
 b.clear_preview();unloaded=env();assert 'preview_table_stale' not in unloaded
 print(json.dumps({'commit':'b6fd7c5','parse_tlos':meta['tlos'],'changed_tool':2,'loaded_tool':1,
  'during':during[0],'refused':refused,'next_action':action,'failed_idle':failed,
  'published_idle':published,'no_basis':no_basis,'unloaded':unloaded,'checks_passed':True},indent=2))
asyncio.run(run())
