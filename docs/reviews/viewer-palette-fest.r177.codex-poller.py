"""R177: execute the real poller's file/doom/end chain over a synthetic status.
Only the following unrelated branches are removed. No import of gateway.py,
no LinuxCNC commands or processes: the pipeline cancels a fake worker handle.
"""
import ast,copy,json,os,time
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch
os.environ['LCNC_LOG_DIR']='/tmp/codex-r177-1dohjpbu/poller-logs'
import gateway_util as U
from bulk_pipeline import BulkPipeline
source=Path('gateway.py').read_text();tree=ast.parse(source)
root=next(n for n in ast.walk(tree) if isinstance(n,ast.If) and ast.unparse(n.test)=='_fe is not None')
node=copy.deepcopy(root); c=node
while c.orelse and isinstance(c.orelse[0],ast.If):
 if 'pinned_parse_outlived(' in ast.unparse(c.test):c.orelse=[];break
 c=c.orelse[0]
assert 'pinned_parse_outlived(' in ast.unparse(c.test)
code=compile(ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[])),'gateway.py:preview-poll-chain','exec')
class Worker:
 def __init__(self):self.terminations=0
 def terminate(self):self.terminations+=1
 def poll(self):return 0
class Trace:
 def emit(self,*a,**k):pass
rows=[]
for name,pinned,idle,running,edge in [('ended',True,True,True,None),('paused',True,False,True,None),('normal',False,True,True,None),('not_running',True,True,False,None),('new_file',True,True,True,'cancel:file'),('repeat_end',True,True,True,None)]:
 b=BulkPipeline(get_stat=lambda:None,get_machine_units=lambda:'mm',build_wcs_rotation_patches=lambda:{})
 b.refresh_running=running;b.inflight={'pinned':pinned,'t0':time.monotonic(),'file':'/test.ngc'};b.gcode_parse_proc=Worker()
 ns={'_fe':edge,'_bulk':b,'st':NS(active_file='/test.ngc',rotary_abc=[0,0,0],interp_state=1 if idle else 3),
     'linuxcnc':NS(INTERP_IDLE=1),'inflight_doomed_reason':U.inflight_doomed_reason,'pinned_parse_outlived':U.pinned_parse_outlived,'_trace':Trace()}
 with patch('threading.Timer'):
  exec(code,ns)
  if name=='repeat_end':exec(code,ns)
 row={'name':name,'terminations':b.gcode_parse_proc.terminations,'reason':b.cancel_reason,'reparse_pending':b.reparse_pending};rows.append(row)
 expected='run_ended' if name in ('ended','repeat_end') else 'file' if name=='new_file' else None
 assert b.cancel_reason==expected,row
 assert b.gcode_parse_proc.terminations==int(expected is not None),row
 assert not b.reparse_pending,row
Path('/tmp/codex-r177-1dohjpbu/poller.json').write_text(json.dumps({'cases':rows,'passed':len(rows),'scope':'actual file/doom/end branches + real BulkPipeline.cancel_inflight; fake worker/timer; no subsequent idle reparse scheduling'},indent=2)+'\n')
print(f'{len(rows)}/{len(rows)} PASS')
