"""R105 unchanged dispatch under repository fake_linuxcnc, temporary program.
Timer only for restricted-sandbox asyncio self-pipe wakeups, as run_backend.py.
"""
import sys,asyncio,json,os
from pathlib import Path
sys.path.insert(0,str(Path.cwd()))
os.environ['LCNC_LOG_DIR']=str(Path(__file__).resolve().parent/'logs')
_run=asyncio.run
async def ticked(coro):
 loop=asyncio.get_running_loop()
 def tick():loop.call_later(.01,tick)
 loop.call_later(.01,tick)
 return await coro
asyncio.run=lambda c,**kw:_run(ticked(c),**kw)
from test_command_dispatch import TestHandlerExecution
import gateway
from gateway_util import TOOLSETTER_BASIS_KEYS,toolsetter_basis_view
c=TestHandlerExecution();c.setUp();c._with_program();cmd=c._rcs()
try:
 Path(c.prog).write_text('G21 G90\nG0 X1 Y1 Z0\n#3009=4\nG0 X2\nM2\n')
 gateway._bulk.last_file=c.prog
 gateway._bulk.published_toolsetter={'routine':False,'writes':[3009]}
 for name in ('mdi','auto'):
  def named(*a,_orig=getattr(cmd,name),**kw):return _orig(*a,**kw)
  named.__name__=name
  setattr(cmd,name,named)
 observations=[]
 for kind in ('auto_run','cycle_start','auto_step'):
  cmd.calls.clear()
  gateway._ts_book({k:3.0 for k in TOOLSETTER_BASIS_KEYS},'read')
  result=c._auto_run(line=2)[0] if kind=='auto_run' else c._send({'cmd':kind})
  observations.append({'kind':kind,'reply':result,'origin_3009':gateway._ts_basis[3009]['origin'],'calls':list(cmd.calls)})
 (Path(__file__).resolve().parent/'startpaths.json').write_text(json.dumps(observations,indent=2)+'\n')
finally:c.doCleanups()
