"""R294 regression: R293 probes adapted only to the corrected verdicts. python3 -B this.py /tmp/archive-of-96c5e2eb
Synthetic clients/clocks only; no network, systemd, linuxcnc or hal.
Assertions check the observed reviewed state; findings are not accepted behavior.
"""
import json
from pathlib import Path
import sys
from unittest.mock import patch
sys.path.insert(0, str(Path(sys.argv[1]).resolve()/'scripts'))
import native_run as nr
from test_support import native_cases as nc, tool_change as tc
from test_support.live_session import SimulatorClient
out={'positive':{},'findings':{}}

def st(**kw):
    return dict(tool_change_requested=False, tool_change_seq=None, tool_number=1,
                interp_state=1, inpos=True, feed_override_enabled=True,
                tool_offset=[0,0,50], tool_table_z=50, current_vel=0) | kw
class Clock:
    def __init__(self): self.t=0.; self.advance=lambda:None
    def monotonic(self): return self.t
    def sleep(self,t): self.t += t; self.advance()

# Real receive reducer: every input carries its receipt time into the queue.
def run_hold(frozen=False, bad=False, as_step=False, hold_s=5.):
    clock=Clock(); events=[]; sent=[]
    c=SimulatorClient('unused',auto_confirm=False,keep=nr.FRAME_KEYS)
    def take(s): c.take({'type':'status','data':s})
    def advance():
        while events and events[0][0] <= clock.t+1e-9:
            _,s=events.pop(0);take(s)
    clock.advance=advance
    def request(cmd,**kw):
        sent.append((clock.t,cmd,kw))
        if cmd=='tool_change':
            for i in range(1,2 if frozen else 170):
                events.append((i/30,st(tool_change_requested=True,tool_change_seq=9,tool_change_tool=99,
                                      interp_state=1 if bad and i==70 else 4)))
        elif cmd=='confirm_tool_change':
            events.clear(); events.append((clock.t+.033,st(tool_number=99)))
        else: raise AssertionError(cmd)
        return {'ok':True}
    c.request=request
    with patch.object(tc,'time',clock),patch.object(nr,'time',clock),patch('test_support.live_session.time',clock):
        take(st()); cursor=len(c.frames)
        if as_step:
            try:
                rows=nr.m6_hold_case()[1]({'client':c})
                return {'rows':rows,'sent':sent,'received':len(c.frames)}
            except nr.StepFailed as e:
                return {'rows':e.rows,'sent':sent,'received':len(c.frames),'error':str(e)}
        changes=tc.ToolChanges([99],hold_s=hold_s)
        c.request('tool_change',tool_number=99)
        end=tc.RoutineEnd()
        try:
            served=tc.serve(c,changes,end,8.,cursor=cursor)
            row=nc.eval_m6_hold('hold',changes.holds,1,99,50,99,50,hold_s) if hold_s else None
            return {'served':served,'row':row,'seen_busy':end.seen_busy,'received':len(c.frames),'sent':sent}
        except tc.ToolChangeError as e:
            return {'error':str(e),'samples':changes.holds[-1]['samples'] if changes.holds else 0,
                    'confirmed':changes.confirmed,'received':len(c.frames),'sent':sent}
for name,args in [('held',{}),('immediate',{'hold_s':0}),('frozen',{'frozen':True}),('bad_between_reads',{'bad':True})]:
    r=run_hold(**args);out['positive'][name]=r
    if name in ('held','immediate'): assert r['served']==[{'tool':99,'seq':9}] and r['seen_busy']
    else: assert r['confirmed']==[]
assert out['positive']['held']['row']['status']=='PASS'
assert out['positive']['frozen']['samples']==1
assert 'idle' in out['positive']['bad_between_reads']['error']
r=run_hold(frozen=True,as_step=True)
assert r['rows'][0]['status']=='incomplete' and r['received']==2 and len(r['sent'])==1
out['findings']['hold_step_timeout_claims_fail']=r

def frame(t,enabled,velocity=0,idle=False):
    return (t,st(feed_override_enabled=enabled,current_vel=velocity,interp_state=1 if idle else 2,
                 inpos=velocity==0 if velocity is not None else None))
valid=[frame(.03,True),frame(.2,False,1),frame(1.,False,1),frame(1.033,True,idle=True)]
early=[frame(.03,True),frame(.2,False,1),frame(.4,True,1),frame(.8,True,1),frame(1.033,True,idle=True)]
before_release=valid[:-1]+[frame(1.033,False,idle=True)]
for name,frames,expected in [('override_valid',valid,'PASS'),('old_early_release',early,'FAIL'),
   ('waiting_release',before_release,'incomplete'),
   ('release_33ms_later',before_release+[frame(1.066,True,idle=True)],'PASS')]:
    r=nc.eval_override_lock(name,frames,0);assert r['status']==expected;out['positive'][name]=r
# Unknown velocity after the last known motion must not mean "axis stands".
unknown=[frame(.03,True),frame(.2,False,1),frame(.4,True,None),frame(.8,True,None),frame(1.033,True,idle=True)]
r=nc.eval_override_lock('unknown-motion',unknown,0);assert r['status']=='incomplete'
out['findings']['unknown_motion_is_treated_as_standstill']={'row':r,'frames':unknown}
# Arrival after the release deadline alone proves no coverage of its interior.
gap=before_release+[frame(3.1,False,idle=True)]
r=nc.eval_override_lock('release-window-gap',gap,0);assert r['status']=='incomplete'
out['findings']['release_window_with_no_frames_inside']={'row':r,'frames':gap}

# Existing contradictions, now with unknown partner fields, must still fail.
for name,r in [
 ('probe_contact',nc.eval_probe_z('x',0,None,-180)),
 ('probe_position',nc.eval_probe_z('x',None,-175,-180)),
 ('miss_write',nc.eval_probe_miss('x',None,0,-1,[])),
 ('m600_length',nc.eval_m600('x',50,60,None)),
 ('unload_tool',nc.eval_unload('x',[],1,None)),
 ('unload_offset',nc.eval_unload('x',[],None,50))]:
    assert r['status']=='FAIL';out['positive'][name]=r
for name,errors,length,g43,expected in [
 ('good_counter',[],49.0005,49.0005,'PASS'),
 ('abort_counter',[(11,'G38.2 move finished without making contact.')],50,0,'FAIL'),
 ('fitting_values_but_error',[(11,'Slow Tool Length Offset Probe Failed!')],49,49,'FAIL')]:
    r=nc.eval_m600_counter(name,50,-180,-179,length,g43,1,1,errors=errors)
    assert r['status']==expected;out['positive'][name]=r

# The full driver: physical length follows the table as sim_toolsetter documents.
# Both measurements have their OWN -1.5 um error, within the 2 um contract.
MEASUREMENT_ERROR=.0015
clock=Clock()
class MeasurementClient:
    def __init__(self):
        self.status=st();self.table=50.;self.vars={n:0 for n in nr.TOOLSETTER_VARS}|{3102:-180}
        self.sent=[]
    def request(self,cmd,**kw):
        self.sent.append((cmd,kw))
        if cmd=='get_tool_table':return {'tools':[{'T':1,'Z':self.table}]}
        if cmd=='get_probe_vars':return {'vars':{str(k):self.vars[k] for k in kw['vars']}}
        if cmd=='save_tool':self.table=kw['z_offset'];return {'ok':True}
        if cmd=='set_probe_vars':self.vars.update({int(k):v for k,v in kw['vars'].items()});return {'ok':True}
        raise AssertionError(cmd)
c=MeasurementClient();frames=[];measurements=[]
def routine(client,text,vars=None,**kw):
    if text=='T0 M600':
        client.status.update(tool_number=0,tool_offset=[0,0,0])
        return {'t0':clock.t,'t_done':clock.t,'served':[{'tool':0,'seq':1}],'errors':[]}
    assert text=='T1 M600'
    base=client.table
    result=base+abs(vars[3102])-180-MEASUREMENT_ERROR
    measurements.append({'table_before':base,'reference':vars[3102],'result':result,'own_error_mm':-MEASUREMENT_ERROR})
    client.table=result;client.status.update(tool_number=1,tool_table_z=result,tool_offset=[0,0,result])
    t0=clock.t;clock.t+=1.033
    frames.extend([frame(t0+.03,True),frame(t0+.2,False,1),frame(clock.t,True,idle=True)])
    return {'t0':t0,'t_done':clock.t,'served':[{'tool':1,'seq':2}],'errors':[]}
def short(client,text):
    assert text=='G43 H1';client.status['tool_offset']=[0,0,client.table]
with patch.object(nr,'_routine',routine),patch.object(nr,'_short',short),patch.object(nr,'time',clock):
    rows=nr.m600_cases()[1]({'client':c,'frames':frames,'plate':{'x':10,'y':10,'z':-180}})
assert [r['status'] for r in rows]==['PASS','PASS','PASS','PASS']
assert measurements[1]['table_before']==measurements[0]['result']
out['findings']['counter_uses_original_not_own_basis']={'rows':rows,'measurements':measurements,'sent':c.sent}
# The complete driver waits for a release received after completion.
clock=Clock(); c=MeasurementClient(); frames=[]; measurements=[]; MEASUREMENT_ERROR=0.
original_routine=routine
release_at=[None]
def delayed_routine(client,text,vars=None,**kw):
    result=original_routine(client,text,vars,**kw)
    if text=='T1 M600' and len(measurements)==1:
        frames[-1]=(result['t_done'],st(feed_override_enabled=False))
        release_at[0]=result['t_done']+.033
    return result
def delayed_receive():
    if release_at[0] is not None and clock.t>=release_at[0]:
        frames.append(frame(clock.t,True,idle=True)); release_at[0]=None
clock.advance=delayed_receive
with patch.object(nr,'_routine',delayed_routine),patch.object(nr,'_short',short),patch.object(nr,'time',clock):
    rows=nr.m600_cases()[1]({'client':c,'frames':frames,'plate':{'x':10,'y':10,'z':-180}})
assert all(r['status']=='PASS' for r in rows)
assert rows[2]['free_s']>rows[2]['done_s']
out['positive']['driver_waits_for_received_release']={'rows':rows,'release_after_completion_s':rows[2]['free_s']-rows[2]['done_s']}
out['closed_r293_cases']=out.pop('findings')
print(json.dumps(out,indent=2))
