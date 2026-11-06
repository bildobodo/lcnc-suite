#!/usr/bin/env python3
"""R318 offline audit. argv[1]: exact archive. No sockets, signals or HAL.
Assertions describe observed outcomes; `rest` records are still defects.
"""
import copy
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

sys.path.insert(0,str(Path(sys.argv[1])/'scripts'))
import pytest
import test_native_stage as t
import native_run as nr
from test_support import servo as sv, servo_cases as sc, servo_time as st

out={}
def keep(name,row,status):
    assert row['status']==status,(name,row)
    out[name]=row

# Runtime wiring, including rejection of an unknown clock at the consumer.
with tempfile.TemporaryDirectory(dir='/tmp',prefix='r318-clock-') as d, pytest.MonkeyPatch.context() as mp:
    t.test_the_servo_step_reads_the_clock_and_every_section_carries_it(Path(d),mp)
out['closed_clock_wiring']='PASS: runtime read, report/context, section, consumer'
for label,clock in [('valid',t.CLOCK_OK),('missing',None),('wrong_hash',st.clock_contract('0'*64,st.PACKAGE_VERSION)),
                    ('wrong_version',st.clock_contract(st.RTAPI_SHA256,'different'))]:
    sec={**t._disc(),'clock':clock}
    keep('clock_'+label,sc.eval_disconnect('disconnect-close',sec,t.W_MARK,t.EVENT,t.RUNNING,
                                          frozenset(range(1,9))), 'PASS' if label=='valid' else 'incomplete')

def run_latch(name,sec,variant=None,refuses=False):
    with tempfile.TemporaryDirectory(dir='/tmp',prefix='r318-trip-') as d, pytest.MonkeyPatch.context() as mp:
        c=t.LatchClient(); ctx,_=t._latch_step(Path(d),mp,c,[sec,t._recovery()])
        error=None
        try:
            rows=nr.latch_cases(variant)[1](ctx)
        except nr.StepFailed as e:
            error=str(e); rows=ctx.get('rows',[])
        cmds=[cmd for cmd,_ in c.sent]
        assert ('safety_trip_ack' not in cmds)==refuses,(name,cmds)
        out[name]={'error':error,'section_problems':sec['problems'],
                   'rows':rows,'commands':cmds,'ack_sent':'safety_trip_ack' in cmds}

run_latch('closed_trip_clean',t._latch(after=200))
run_latch('closed_trip_delayed',t._latch(after=200,delay=1),'latch-delayed')
run_latch('closed_trip_preexisting',t._latch_set_before(t._latch(after=200)),refuses=True)
run_latch('closed_trip_early_pulse',t._latch(after=200,early_at=10),refuses=True)

# Build an ACTUAL flawed section with the production section builder. The
# lost/foreign row contained the early latch pulse that rules out ownership.
integrity={'enable_start':True,'enable_end':True,'overruns_start':0,'overruns_end':0,
           'depth_end':0,'depth':sv.DEPTH,'reader_overrun':False,'reader_alive':True,
           'thread_start':['motion-controller','oneshot.0','webui-hb-latch','sampler.0'],
           'thread_end':['motion-controller','oneshot.0','webui-hb-latch','sampler.0'],
           'period_ns':1000000,'ini_period_ns':1000000}
for kind in ['number_gap','foreign_mark']:
    raw=list(t._latch(after=200,early_at=10)['samples'])
    if kind=='number_gap': del raw[10]
    else:
        tm,n,v=raw[10]; v=list(v); v[sv.MARK_INDEX]=999; raw[10]=(tm,n,tuple(v))
    tm,n,v=raw[-1]; v=list(v); v[sv.MARK_INDEX]=4; raw.append((tm+.001,n+1,tuple(v)))
    sec=sv.section(raw,3,4,integrity)
    assert sec['problems']
    run_latch('rest_ownership_'+kind,sec)
    assert out['rest_ownership_'+kind]['rows'][0]['status']=='incomplete'

for label,frames,expect in [
    ('known',t.RUNNING,'PASS'),('empty_fields',[(1,{})],'incomplete'),
    ('no_mode',[(1,{'interp_state':2})],'incomplete'),('no_interp',[(1,{'task_mode':2})],'incomplete'),
    ('unknown_interp',[(1,{'interp_state':999,'task_mode':2})],'incomplete'),
    ('paused',[(1,{'interp_state':3,'task_mode':2})],'FAIL'),
    ('mdi',[(1,{'interp_state':2,'task_mode':3})],'FAIL')]:
    keep('closed_B_'+label,sc.eval_disconnect('disconnect-close',t._disc(),t.W_MARK,t.EVENT,frames,
                                           frozenset(range(1,9))),expect)

class Response:
    status=200
    def __init__(self,version): self.headers={} if version is None else {'X-Preview-Version':str(version)}
    def read(self): return b'preview bytes'
    def __enter__(self): return self
    def __exit__(self,*args): pass
for label,versions,expect in [('correct',[9]*4,'PASS'),('all_old',[8]*4,'incomplete'),
                            ('one_other',[9,9,9,10],'incomplete'),('missing',[None]*4,'incomplete')]:
    fetched=[]
    for version in versions:
        with patch('urllib.request.urlopen',return_value=Response(version)):
            fetched.append(nr._fetch_preview('offline-not-a-token',9))
    keep('closed_fetch_'+label,sc.eval_clients('clients-4',t._hbsec(t.EVERY_100),t.W1,t.W2,4,
                                              t.HELLOS,fetched,t.PUB),expect)

keep('closed_failure_trip_no_event',sc.eval_disconnect('disconnect-close',t._disc(trip_at=800),t.W_MARK,None,
      t.RUNNING,frozenset(range(1,9))),'FAIL')
keep('closed_failure_idle_no_time',sc.eval_disconnect('disconnect-close',{**t._disc(),'t0_ns':None},t.W_MARK,
      t.EVENT,[(1,{'interp_state':1,'task_mode':2})],frozenset(range(1,9))),'FAIL')
bad_end=['end integrity unread']
keep('closed_failure_released',sc.eval_latch_sticky('latch-sticky',
      {**t._latch(release_at=60),'problems':bad_end},t.REFUSED,[True]),'FAIL')
keep('closed_failure_relatched',sc.eval_latch_recovered('latch-recovered',
      {**t._recovery(again_at=30),'problems':bad_end},[(None,False,True)]),'FAIL')

# Other known contradictions still disappear when unrelated proof is absent.
long_gap=t._hbsec(t.EVERY_100-set(range(2050,2310,100))|{2310})
keep('control_heartbeat_violation',sc.eval_clients('clients-4',long_gap,t.W1,t.W2,4,
      t.HELLOS,t.FETCHES,t.PUB),'FAIL')
keep('rest_failure_gap_wrong_preview',sc.eval_clients('clients-4',long_gap,t.W1,t.W2,4,
      t.HELLOS,[{**f,'version':8} for f in t.FETCHES],t.PUB),'incomplete')
keep('control_missing_trip_frame',sc.eval_latch_sticky('latch-sticky',t._latch(),t.REFUSED,[True,False]),'FAIL')
keep('rest_failure_missing_trip_frame',sc.eval_latch_sticky('latch-sticky',
      {**t._latch(),'problems':bad_end},t.REFUSED,[True,False]),'incomplete')
keep('control_recovery_bad_frame',sc.eval_latch_recovered('latch-recovered',t._recovery(),[(True,False,True)]),'FAIL')
keep('rest_failure_recovery_bad_frame',sc.eval_latch_recovered('latch-recovered',
      {**t._recovery(),'problems':bad_end},[(True,False,True)]),'incomplete')

# The converse: absence of a witnessed move is not a proved stop if X is unread.
bad=t._disc(); bad['problems']=['a non-finite channel value']
rows=[]
for i,(tm,n,v) in enumerate(bad['samples']):
    if i>=bad['phase_first'][t.W_MARK]: v=(float('nan'),*v[1:6],0,*v[7:])
    rows.append((tm,n,v))
bad['samples']=rows
keep('rest_failure_unknown_X_called_stopped',sc.eval_disconnect('disconnect-close',bad,t.W_MARK,t.EVENT,
      t.RUNNING,frozenset(range(1,9))),'FAIL')

t.test_the_same_observation_with_gaps_200_and_200_is_incomplete_too()
out['closed_R314_ambiguous_time']='incomplete (as required)'
print(json.dumps(out,indent=2,ensure_ascii=False))
