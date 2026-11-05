"""R306: offline counterprobes for partial rows and retry ownership.
Run: gateway Python -B this_file.py /path/to/archive-8b248869
No network, LinuxCNC, HAL or real restore operations; only FakeHost.
"""
import json, sys, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(sys.argv[1]).resolve()/'scripts'))
import native_run as nr
import test_native_stage as f
from test_support import live_session as ls, servo_cases as sc
results=[]
def result(name, expected, actual, detail):
 results.append(dict(name=name,expected=expected,actual=actual,conforms=expected==actual,detail=detail))

# The first section proves that Y moved while jogging X. Before case 2
# can start, an ordinary known refusal occurs. The completed FAIL must stay.
class JogClient:
 error=None
 status={'joint_pos':list(nr.JOG_START)}
 def __init__(self): self.mdis=0
 def request(self,cmd,**kw):
  if cmd=='mdi':
   self.mdis+=1
   if self.mdis==2: raise ls.Refused('mdi refused: Not armed — press Arm')
  return {'ok':True}
bad={'samples':f._samples([(300.,300.,-50.,0.,0.,0.),(300.,301.,-50.,0.,0.,0.)]),'problems':[]}
direct=sc.eval_jog_servo('jog-x+.servo',0,1,bad,100.)
result('known_other_axis_violation_control','FAIL',direct['status'],direct)
with tempfile.TemporaryDirectory(prefix='codex-r306-jog-') as td:
 c=JogClient()
 def setup(ctx): ctx.update(client=c,frames=[],servo=f.FakeMeasurement([bad]))
 with patch.object(nr,'_servo_prep',lambda c:None), patch.object(nr,'_wait',lambda *a:None), patch.object(nr.time,'sleep',lambda s:None):
  out=nr.run(f.FakeHost(),[('setup',setup),nr.jog_cases(3)],Path(td)/'run')
 result('completed_servo_FAIL_survives_next_case_refusal',True,any(r['case']=='jog-x+.servo' and r['status']=='FAIL' for r in out['rows']),
        {'rows':out['rows'],'error':out.get('error'),'sections':[{'case':s['case'],'samples':s['samples']} for s in out.get('servo_sections',[])]})

# A short block: only idle frames while it was REFUSED for 2.2 seconds;
# after acceptance there is one BUSY frame and no completion. The real
# ToolChanges/RoutineEnd must not end the new command from pre-send frames.
class Clock:
 t=100.
 def monotonic(self): return self.t
 def sleep(self,s): self.t+=s
class RetriedClient:
 error=None
 def __init__(self, clock, refusals=22, finish=False):
  self.clock=clock; self.refusals=refusals; self.finish=finish; self.n=0; self.frames=[]; self.errors=[]; self.sent_at=None
  self.status={'tool_change_requested':False,'tool_change_seq':None,'interp_state':1,'inpos':True}
 def request(self,cmd,**kw):
  self.n+=1
  if self.n<=self.refusals:
   self.frames.append((self.clock.t,dict(self.status)))
   raise ls.Refused(f'{cmd} refused: A program or macro is starting or running — wait')
  self.sent_at=self.clock.t
  self.status={**self.status,'interp_state':2,'inpos':False}
  self.frames.append((self.clock.t,dict(self.status)))
  if self.finish:
   self.clock.t+=.2
   self.status={**self.status,'interp_state':1,'inpos':True}
   self.frames.append((self.clock.t,dict(self.status)))
  return {'ok':True}
for name,refusals,finish,expected in [('retry_pre_send_idle_cannot_complete',22,False,False),('accepted_busy_not_done_control',0,False,False),('fresh_completion_control',0,True,True)]:
 clock=Clock(); c=RetriedClient(clock,refusals,finish); detail={}
 with patch.object(nr.time,'monotonic',clock.monotonic),patch.object(nr.time,'sleep',clock.sleep):
  try:
   out=nr._routine(c,'G49',require_busy=False,deadline=.2)
   completed=True; detail={'t0':out['t0'],'t_done':out['t_done']}
  except Exception as e:
   completed=False; detail={'exception':type(e).__name__,'message':str(e)}
 result(name,expected,completed,dict(detail,accepted_at=c.sent_at,attempts=c.n,final_status=c.status))

# Request only admits a known Refused; unknown delivery is not retryable.
# Show actual behaviour without claiming this message occurred live.
for cls in (ls.Refused,ls.TransportLost,ls.NoReply):
 class C:
  n=0
  def request(self,cmd,**kw):
   self.n+=1
   if self.n==1: raise cls('A program or macro is starting or running — wait')
   return {'ok':True}
 c=C()
 with patch.object(nr.time,'sleep',lambda s:None):
  try: nr._when_free(c,'mdi',text='G49')
  except Exception: pass
 result('retry_type_'+cls.__name__,2 if cls is ls.Refused else 1,c.n,{'exception':cls.__name__})
print(json.dumps({'head':'8b248869','tests':results,'conforming':sum(r['conforms'] for r in results),'contrary':sum(not r['conforms'] for r in results)},indent=2,ensure_ascii=False))
sys.exit(int(any(not r['conforms'] for r in results)))
