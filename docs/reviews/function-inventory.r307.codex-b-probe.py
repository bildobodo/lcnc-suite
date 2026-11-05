"""R307 B: offline checks of retry frame/error/M6 ownership and saved jog rows.
Usage: gateway Python -B this_file.py /path/to/archive-d54c1b2f
Fake clients and FakeHost only; no machine/transport/HAL access.
"""
import json,sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(sys.argv[1]).resolve()/'scripts'))
import native_run as nr
import test_native_stage as f
from test_support.live_session import Refused
results=[]
def check(name,want,got,detail):
 results.append(dict(name=name,expected=want,actual=got,conforms=want==got,detail=detail))
IDLE={'tool_change_requested':False,'tool_change_seq':None,'interp_state':1,'inpos':True,'tool_number':0}
class Client:
 error=None
 def __init__(self, clock, pending=False, fresh_m6=False):
  self.clock=clock; self.pending=pending; self.fresh_m6=fresh_m6
  self.status=dict(IDLE); self.frames=[]; self.errors=[]; self.attempts=0; self.confirmed=[]
 def add(self,st):
  self.clock.t+=.01; self.status=st; self.frames.append((self.clock.t,dict(st)))
 def request(self,cmd,**kw):
  if cmd=='confirm_tool_change':
   self.confirmed.append(kw['request']); self.add(dict(IDLE,tool_number=1)); return {'ok':True}
  self.attempts+=1
  if self.attempts==1:
   self.errors.append((self.clock.t,11,'old attempt error'))
   self.add(dict(IDLE,interp_state=2,inpos=False,tool_change_requested=True,tool_change_seq=999,tool_change_tool=2))
   if not self.pending: self.add(dict(IDLE))
   raise Refused('mdi refused: A program or macro is starting or running — wait')
  self.accepted=self.clock.t
  if self.fresh_m6:
   self.add(dict(IDLE,interp_state=2,inpos=False,tool_change_requested=True,tool_change_seq=123,tool_change_tool=1))
  else:
   self.add(dict(IDLE,interp_state=2,inpos=False)); self.add(dict(IDLE))
  self.errors.append((self.clock.t,3,'accepted attempt note'))
  return {'ok':True}
for name,pending,fresh in [('old_errors_and_completed_M6_excluded',False,False),('pending_M6_blocks_retry',True,False),('new_M6_during_accepted_request_kept',False,True)]:
 clock=f._Clock(); c=Client(clock,pending,fresh)
 with patch.object(nr.time,'monotonic',clock.monotonic),patch.object(nr.time,'sleep',clock.sleep):
  try:
   r=nr._routine(c,'T1 M6' if fresh else 'G49',declared=[1] if fresh else [],deadline=.3)
   detail={'errors':r['errors'],'t0':r['t0'],'t_done':r['t_done'],'accepted':c.accepted,'served':r['served'],'confirmed':c.confirmed,'attempts':c.attempts}
   good=not pending and r['errors']==[(3,'accepted attempt note')] and r['t0']==c.accepted and r['t_done']>=c.accepted and c.confirmed==([123] if fresh else [])
  except RuntimeError as e:
   detail={'exception':str(e),'attempts':c.attempts,'confirmed':c.confirmed}
   good=pending and c.attempts==1 and c.confirmed==[]
 check(name,True,good,detail)

# All six cases reach the normal return; real evaluator gives a row each.
# Synthetic rows do not prove real motion, they exercise persistence/count.
class JogClient:
 error=None
 status={'joint_pos':list(nr.JOG_START)}
 def request(self,*a,**kw):return {'ok':True}
sec={'samples':f._samples([(300.,300.,-50.,0.,0.,0.),(300.,300.,-50.,0.,0.,0.)]),'problems':[]}
with tempfile.TemporaryDirectory(prefix='codex-r307-jog-') as td:
 def setup(ctx):ctx.update(client=JogClient(),frames=[],servo=f.FakeMeasurement([sec]*6))
 with patch.object(nr,'_servo_prep',lambda c:None),patch.object(nr,'_wait',lambda *a:None),patch.object(nr.time,'sleep',lambda s:None):
  r=nr.run(f.FakeHost(),[('setup',setup),nr.jog_cases(3)],Path(td)/'run')
 names=[x['case'] for x in r['rows']]; audits=r.get('servo_sections',[])
 check('normal_return_has_each_row_once',True,len(names)==12 and len(set(names))==12 and 'error' not in r,{'names':names,'error':r.get('error')})
 check('every_jog_audit_has_reply_time',True,len(audits)==6 and all(isinstance(x.get('t_reply'),float) for x in audits),{'reply_times':[x.get('t_reply') for x in audits]})
print(json.dumps({'head':'d54c1b2f','checks':results,'conforming':sum(x['conforms'] for x in results),'contrary':sum(not x['conforms'] for x in results)},indent=2,ensure_ascii=False))
sys.exit(int(any(not x['conforms'] for x in results)))
