"""R106 actual dispatch, fake interpreter for an M200 remap whose native body
is independently run by extra.py/remap_write. No live binding/commands.
"""
import asyncio,sys,os,json
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path.cwd()));os.environ['LCNC_LOG_DIR']=str(Path(__file__).resolve().parent/'logs')
from test_toolsetter_basis import _BasisCase, FILE
from test_command_dispatch import _payload
import gateway
from gateway_util import toolsetter_basis_view
c=_BasisCase();c.setUp()
async def main():
 loop=asyncio.get_running_loop()
 def tick():loop.call_later(.01,tick)
 loop.call_later(.01,tick)
 gateway._ts_book({**FILE,3009:3.0},'read');c.task.params[3009]=3
 gateway._skip_flag_unknown=False;gateway._shared_status=_payload(inpos=True,current_vel=0.)
 def mdi(text):
  assert text=='M200'
  c.task.calls.append(('mdi',text));c.task.params[3009]=4.;c.task._last=1
 c.task.mdi=mdi
 before=dict(gateway._ts_basis[3009])
 reply=await gateway.handle_command({'cmd':'mdi','text':'M200'},True)
 gateway._bulk.last_file='/tmp/r106-independent-program.ngc'
 gateway._bulk.published_toolsetter={'routine':True,'writes':[]}
 due=gateway._ts_read_back_due(SimpleNamespace(active_file=gateway._bulk.last_file,current_vel=0.))
 return {'before':before,'reply':reply,'interpreter_3009':c.task.params[3009],'booked_3009':gateway._ts_basis[3009],'basis_state':toolsetter_basis_view(gateway._ts_basis)['state'],'read_back_due':due,'calls':c.task.calls}
try:
 out=asyncio.run(main());(Path(__file__).resolve().parent/'remap-basis.json').write_text(json.dumps(out,indent=2)+'\n')
 assert out['interpreter_3009']==4 and out['booked_3009']['value']==3 and out['booked_3009']['origin']=='read' and not out['read_back_due'],out
 print('Reproduced: native-backed M200 task double changes 3009, dispatch keeps stale read basis')
finally:c.doCleanups()
