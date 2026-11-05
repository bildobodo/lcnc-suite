"""R303 offline probes. No HAL execution, network, or machine commands.
Invoke with gateway Python -B and an archive of 06fbca56 as sole argument.
"""
import errno
import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch
ROOT=Path(sys.argv[1]).resolve()
sys.path.insert(0,str(ROOT/'scripts'))
import native_run as nr
import test_native_stage as fixture
from test_support import servo as sv, servo_cases as sc, live_session as ls

results=[]
def record(name,expected,actual,detail=None):
    results.append(dict(name=name,expected=expected,actual=actual,conforms=expected==actual,detail=detail))

def seal(raw):
    raw=[(t,n,(*v[:-1],3)) for t,n,v in raw]
    t,n,v=raw[-1]
    return sv.section(raw+[(t+.001,n+1,(*v[:-1],4))],3,4,fixture._ok())

def hide(raw,indices,axis):
    copy=list(raw)
    for i in indices:
        t,n,v=copy[i]
        v=list(v)
        v[axis]=float('nan')
        copy[i]=(t,n,tuple(v))
    return copy

START=(200.,200.,-60.)
TOP=(200.,200.,0.)
ZERO=(100.,100.,0.)
G30=(0.,0.,-20.)
for name,points,target,masked,axis,expected in [
    ('zero_base',[START,TOP,ZERO],ZERO,[],2,'PASS'),
    ('top_transition_z_missing',[START,TOP,ZERO],ZERO,[59,60],2,'incomplete'),
    ('g30_base',[START,TOP,(0,0,0),G30],G30,[],0,'PASS'),
    ('arrival_transition_x_missing',[START,TOP,(0,0,0),G30],G30,[109,110],0,'incomplete'),
]:
    raw=fixture._path(points)['samples']
    out=sc.eval_retract_path(name,seal(hide(raw,masked,axis)),START,target)
    record(name,expected,out['status'],dict(row=out,hidden_indices=masked,axis=axis))

# Actual Measurement and HalGate, with read-only fake HAL answers and a
# receipt stream populated by the fake halsampler when a mark is awaited.
class EchoReader:
    def __init__(self):
        self.samples=[]
        self.alive=True
        self.overrun=False
    def wait_for_mark(self,mark,deadline_s,since=0):
        self.samples.append((len(self.samples)*.001,len(self.samples),(0.,)*8+(mark,)))
        return len(self.samples)-1

def measurement(*,fail_end=False,periods=(1000000,1000000)):
    ended=False
    shown=[]
    def fake_hal(argv):
        nonlocal ended
        if argv[1:3]==['sets','natv-mark'] and argv[-1]=='4':
            ended=True
        if fail_end and ended and argv[1:]==['getp','sampler.0.overruns']:
            raise RuntimeError('injected: overruns unavailable at end')
        if argv[1:]==['show','thread','servo-thread']:
            period=periods[min(len(shown),len(periods)-1)]
            shown.append(period)
            return fixture.SHOW_THREAD.replace('1000000',str(period))
        return 'TRUE' if argv[1:]==['getp','sampler.0.enable'] else '0'
    m=sv.Measurement(sv.HalGate(run=fake_hal),EchoReader(),1000000,1000000)
    return m,shown

for periods in ((1000000,1000000),(1000000,2000000),(2000000,2000000)):
    m,shown=measurement(periods=periods)
    sec=m.end(m.begin())
    record('effective_period_'+str(periods),'flawed' if 2000000 in periods else 'clean',
           'flawed' if sec['problems'] else 'clean',dict(read_periods=shown,integrity=sec['integrity'],problems=sec['problems']))

# Healthy end vs failed end: the latter must retain a per-attempt record
# and already collected samples even though its integrity is incomplete.
for fail_end in (False,True):
    with tempfile.TemporaryDirectory(prefix='codex-r303-audit-') as td:
        m,_=measurement(fail_end=fail_end)
        ctx={'servo':m,'report':{},'run':Path(td)}
        with nr._section(ctx,'jog-x+.servo') as box:
            pass
        records=ctx['report'].get('servo_sections',[])
        record('section_audit_'+('failed_end' if fail_end else 'base'),True,bool(records),
               dict(error=box.get('error'),records=records,files=[p.name for p in Path(td).iterdir()],
                    samples_already_received=len(m.reader.samples),gate_open=m.gate.open_section))

# New file-writing code is OUTSIDE the catch for Measurement.end. Simulate
# ENOSPC only for the servo artifact; all other file operations remain real.
# A known controller refusal must survive both storage and HAL failures.
real_open=Path.open
for fail_write in (False,True):
    with tempfile.TemporaryDirectory(prefix='codex-r303-rfl-') as td, patch.object(nr,'SHORT_GRACE',.001):
        c=fixture.RflClient([],[],refuse={'auto_run':ls.Refused('known controller refusal')})
        ctx,step=fixture._rfl_step(Path(td),c)
        m,_=measurement()
        ctx.update(servo=m,run=Path(td))
        def fake_open(path,*args,**kwargs):
            if fail_write and path.name=='servo-rfl.jsonl':
                raise OSError(errno.ENOSPC,'injected full evidence filesystem')
            return real_open(path,*args,**kwargs)
        with patch.object(Path,'open',fake_open):
            try:
                rows=step(ctx)
                error=None
            except Exception as exc:
                rows=getattr(exc,'rows',[])
                error=f'{type(exc).__name__}: {exc}'
        record('rfl_refusal_'+('disk_full' if fail_write else 'write_ok'),'FAIL',
               next((r['status'] for r in rows if r['case']=='rfl-line'),'row missing'),
               dict(error=error,rows=rows,report=ctx['report']))

# A goto contains a proven XY-first violation. The end's read fails only
# after the samples were received. The step must not drop that known FAIL.
for fail_end in (False,True):
    with tempfile.TemporaryDirectory(prefix='codex-r303-goto-') as td, patch.object(nr,'SHORT_GRACE',.001):
        c=fixture.MotionClient()
        m,_=measurement(fail_end=fail_end)
        original_wait=m.reader.wait_for_mark
        def wait(mark,deadline_s,since=0):
            result=original_wait(mark,deadline_s,since)
            if mark%2==1:
                # At begin only the starting sample has arrived.
                m.reader.samples[-1]=(0.,0,(*START,0.,0.,0.,0,1,mark))
                return result
            # At the end all of the XY-first movement was already received.
            m.reader.samples= [(t,n,(*v[:-1],mark-1)) for t,n,v in fixture._path([START,(100,100,-60),ZERO])['samples']]
            t,n,v=m.reader.samples[-1]
            m.reader.samples.append((t+.001,n+1,(*v[:-1],mark)))
            return len(m.reader.samples)-1
        m.reader.wait_for_mark=wait
        ctx={'client':c,'servo':m,'run':Path(td),'report':{}}
        # Restrict the successful comparison to its first result by stopping
        # preparation of the second attempt; don't run any controller call.
        original_to=nr._to
        calls=[0]
        def to(client,*xyz):
            calls[0]+=1
            if calls[0]>1:
                raise RuntimeError('control: stop before second attempt')
            return original_to(client,*xyz)
        if not fail_end:
            # Direct evaluator is the positive proof that the collected path is a contradiction.
            sec=seal(fixture._path([START,(100,100,-60),ZERO])['samples'])
            row=sc.eval_retract_path('goto-zero',sec,START,ZERO)
            record('xy_first_before_end_error','FAIL',row['status'],row)
            continue
        with patch.object(nr,'_to',to):
            try:
                rows=nr.goto_cases()[1](ctx)
                error=None
            except Exception as exc:
                rows=getattr(exc,'rows',[])
                error=f'{type(exc).__name__}: {exc}'
        record('goto_known_violation_end_read_failed','FAIL',
               next((r['status'] for r in rows if r['case']=='goto-zero'),'row missing'),
               dict(error=error,rows=rows,report=ctx['report'],collected=len(m.reader.samples)))

out=dict(head='06fbca56',tests=results,conforming=sum(r['conforms'] for r in results),contrary=sum(not r['conforms'] for r in results))
print(json.dumps(out,indent=2,ensure_ascii=False,allow_nan=False))
sys.exit(1 if out['contrary'] else 0)
