"""R105: a sent MDI parameter write cancelled before its handler books invalidation.
Repository fake interpreter; thread blocked after it applies #3009=4.
"""
import asyncio,sys,os,json,threading
from pathlib import Path
sys.path.insert(0,str(Path.cwd()));os.environ['LCNC_LOG_DIR']=str(Path(__file__).resolve().parent/'logs')
from test_toolsetter_basis import _BasisCase, FILE
from test_command_dispatch import _payload
import gateway
c=_BasisCase();c.setUp()
async def main():
 loop=asyncio.get_running_loop()
 def tick():loop.call_later(.01,tick)
 loop.call_later(.01,tick)
 gateway._ts_book({**FILE,3009:3.0},'read');c.task.params[3009]=3
 gateway._skip_flag_unknown=False
 gateway._shared_status=_payload(inpos=True,current_vel=0.)
 entered,release=threading.Event(),threading.Event()
 mdi=c.task.mdi
 def blocked(text):
  mdi(text);entered.set();release.wait(3)
 c.task.mdi=blocked
 t=asyncio.create_task(gateway.handle_command({'cmd':'mdi','text':'#3009=4'},True))
 while not entered.is_set():await asyncio.sleep(.01)
 t.cancel();release.set()
 try:reply=await t
 except asyncio.CancelledError:reply='CancelledError'
 return {'reply':reply,'interpreter_3009':c.task.params[3009],'booked_3009':gateway._ts_basis[3009],'calls':c.task.calls}
try:
 out=asyncio.run(main());(Path(__file__).resolve().parent/'cancel.json').write_text(json.dumps(out,indent=2)+'\n')
finally:c.doCleanups()
