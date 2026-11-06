#!/usr/bin/env python3
"""R317 offline counterprobes. Run with pytest available, argv[1] archive.
Uses the repository's fakes; no real client, signal, HAL or subprocess start.
"""
import ast
import copy
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

ROOT=Path(sys.argv[1])
sys.path.insert(0,str(ROOT/'scripts'))
import pytest
import test_native_stage as t
from test_support import servo_cases as sc, servo_time as st, trip as tp
import native_run as nr

out={}

# The existing whole clients step is green even with an invalid clock reader.
clock_reads=[]
with tempfile.TemporaryDirectory(prefix='r317-clock-',dir='/tmp') as d, pytest.MonkeyPatch.context() as mp:
    def invalid_clock(*args,**kwargs):
        clock_reads.append(True)
        return st.clock_contract('0'*64,st.PACKAGE_VERSION)
    mp.setattr(st,'read_clock_contract',invalid_clock)
    t.test_the_whole_clients_step(Path(d),mp)
    out['unwired_clock']={'whole_step_existing_assertions':'PASS (clients-4 and clients-8)',
                          'clock_reader_calls':len(clock_reads),'injected_clock_ok':False}
    assert not clock_reads

# Recovering a trip requires the prior latch to be FALSE, not merely no banner.
for label, outage in [('clean',t._latch(after=200)),('latch_already_true',t._latch(after=200)),
                       ('early_latch_pulse',t._latch(after=200,early_at=10))]:
    if label=='latch_already_true':
        outage=copy.deepcopy(outage)
        outage['samples']=[(tm,n,tuple(v[:10])+(1,)+tuple(v[11:]))
                           for tm,n,v in outage['samples']]
    with tempfile.TemporaryDirectory(prefix='r317-trip-',dir='/tmp') as d, pytest.MonkeyPatch.context() as mp:
        c=t.LatchClient()
        ctx, stops=t._latch_step(Path(d),mp,c,[outage,t._recovery()])
        rows=nr.latch_cases()[1](ctx)
        cmds=[cmd for cmd,_ in c.sent]
        out['trip_'+label]={'rows':[{k:r[k] for k in ('case','status','detail')} for r in rows],
                           'commands':cmds,'ack_sent':'safety_trip_ack' in cmds}
        assert 'safety_trip_ack' in cmds
        if label!='clean': assert rows[0]['status']=='FAIL'

# A nonempty list of frames with unknown program state currently counts.
out['disconnect_frames']={}
for name, frames in [('known_running',t.RUNNING),('both_absent',[(1.0,{})]),
                     ('mode_absent',[(1.0,{'interp_state':2})]),
                     ('interpreter_absent',[(1.0,{'task_mode':2})])]:
    r=sc.eval_disconnect('disconnect-close',t._disc(),t.W_MARK,t.EVENT,frames,frozenset(range(1,9)))
    out['disconnect_frames'][name]=r
    assert r['status']=='PASS'

# Actual GET consumer ignores X-Preview-Version; v in the URL is advisory.
class Response:
    status=200
    headers={'X-Preview-Version':'8','Content-Type':'application/x-msgpack'}
    def read(self): return b'old preview body'
    def __enter__(self): return self
    def __exit__(self,*args): pass

with patch('urllib.request.urlopen',return_value=Response()):
    fetched=nr._fetch_preview('offline-not-a-token',9)
r=sc.eval_clients('clients-4',t._hbsec(t.EVERY_100),t.W1,t.W2,4,t.HELLOS,
                  [fetched.copy() for _ in range(4)],
                  {'ok':True,'file':'expected.ngc','source':'expected-source','version':9})
assert r['status']=='PASS'
out['wrong_preview_version']={'requested_version':9,'response_header_version':8,
                              'fetch_record':fetched,'row':r}

# Named contradictions survive missing *other* proof under the agreed rule.
bad_recovery=t._recovery(again_at=30); bad_recovery['problems']=['end integrity unread']
bad_sticky=t._latch(release_at=60); bad_sticky['problems']=['end integrity unread']
bad_idle=t._disc(); bad_idle['t0_ns']=None
out['failure_priority']={
    'trip_without_event':sc.eval_disconnect('disconnect-close',t._disc(trip_at=800),t.W_MARK,None,
                                          t.RUNNING,frozenset(range(1,9))),
    'idle_with_bad_time':sc.eval_disconnect('disconnect-close',bad_idle,t.W_MARK,t.EVENT,
                       [(1.0,{'interp_state':1,'task_mode':2})],frozenset(range(1,9))),
    'released_with_bad_end':sc.eval_latch_sticky('latch-sticky',bad_sticky,t.REFUSED,[{'ts':1}]),
    'relatched_with_bad_end':sc.eval_latch_recovered('latch-recovered',bad_recovery,[(None,False,True)]),
}
assert all(r['status']=='incomplete' for r in out['failure_priority'].values())

print(json.dumps(out,indent=2))
