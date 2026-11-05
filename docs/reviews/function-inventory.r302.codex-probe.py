"""Codex R302: offline counterexamples at dbff671d, no HAL/network calls.
Run with the gateway venv's Python and the archived tree as argument.
The expected results are the accepted R299–R301 contracts, not the current code.
Some integration fixtures come from test_native_stage, but all mutations below
are new. The real section/Measurement/evaluators/native steps are exercised.
"""
import json
import math
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(ROOT / 'scripts'))
import native_run as nr
import test_native_stage as fixture
from test_support import servo as sv, servo_cases as sc, live_session as ls

results = []
def record(name, expected, actual, detail=None):
    results.append(dict(name=name, expected=expected, actual=actual, conforms=actual == expected, detail=detail))

def integrity(**changes):
    return dict(enable_start=True, enable_end=True, overruns_start=0, overruns_end=0,
                depth_end=0, depth=sv.DEPTH, period_ns=1000000, ini_period_ns=1000000,
                reader_overrun=False, **changes)

def seal(samples, **changes):
    t,n,v = samples[-1]
    end = (t+.001, n+1, (*v[:-1], 4))
    return sv.section([*samples,end], 3,4, integrity(**changes))

def jog():
    # Stand -> 15 mm at 50 mm/s -> braking at 750 mm/s² -> 1 s rest.
    rows=[]
    p=300.0
    for i in range(100):
        rows.append((p,300.,-50.,0.,0.,0.))
    for i in range(300):
        p+=.05
        rows.append((p,300.,-50.,50.,0.,0.))
    v=50.
    while v>0:
        v=max(0.,v-.75)
        p+=v*.001
        rows.append((p,300.,-50.,v,0.,0.))
    rows += [(p,300.,-50.,0.,0.,0.)]*1000
    return [(i*.001+.002, 1000+i, (*row,0,1,3)) for i,row in enumerate(rows)], .4025

raw, reply = jog()
r = sc.eval_jog_servo('jog-x+.servo',0,1,seal(raw, reader_alive=True),reply)
record('jog_base', 'PASS',r['status'],r)
sec=seal(raw, reader_alive=False)
r=sc.eval_jog_servo('jog-x+.servo',0,1,sec,reply)
record('reader_ended_after_end_mark', 'incomplete',r['status'],dict(row=r,integrity=sec['integrity']))

# A known restart in the stopped tail, all channel values finite and numbers consecutive.
# With mark 3 it FAILs, with one unexpected interior mark it vanishes without any integrity flaw.
bad=list(raw)
t,n,v=bad[600]
bad[600]=(t,n,(*v[:3],1.,*v[4:]))
r=sc.eval_jog_servo('jog-x+.servo',0,1,seal(bad,reader_alive=True),reply)
record('restart_control', 'FAIL',r['status'],r)
bad[600]=(t,n,(*bad[600][2][:-1],99))
sec=seal(bad, reader_alive=True)
r=sc.eval_jog_servo('jog-x+.servo',0,1,sec,reply)
record('foreign_mark_inside_section', 'incomplete',r['status'],dict(row=r,problems=sec['problems'],dropped_n=n))

# New paths are interpolated at 1ms, with a fixed standstill before/after.
START=(200.,200.,-60.)
TOP=(200.,200.,0.)
ZERO=(100.,100.,0.)
def path(points):
    rows=[(*points[0],0.,0.,0.)]*10
    for a,b in zip(points,points[1:]):
        steps=max(10, math.ceil(max(abs(y-x) for x,y in zip(a,b))/.1))
        vel=tuple((y-x)/(steps*.001) for x,y in zip(a,b))
        rows.extend((*tuple(x+(y-x)*i/steps for x,y in zip(a,b)),*vel) for i in range(1,steps+1))
    rows.extend([(*points[-1],0.,0.,0.)]*500)
    return [(i*.001,1000+i,(*row,0,1,3)) for i,row in enumerate(rows)]

for name, points, target, expected in [
    ('retract_base',[START,TOP,ZERO],ZERO,'PASS'),
    ('zero_descends_after_xy',[START,TOP,ZERO,(100,100,-5),ZERO],ZERO,'FAIL'),
    ('xy_leaves_target_below_top',[START,TOP,ZERO,(100,100,-5),(110,100,-5),(100,100,-5),ZERO],ZERO,'FAIL'),
    ('g30_descent_base',[START,TOP,(0,0,0),(0,0,-20)],(0,0,-20),'PASS'),
    ('g30_xy_leaves_during_descent',[START,TOP,(0,0,0),(0,0,-10),(10,0,-10),(0,0,-20)],(0,0,-20),'FAIL'),
]:
    r=sc.eval_retract_path(name,seal(path(points),reader_alive=True), START,target)
    record(name,expected,r['status'],r)

# One known violation while rising: X is 1 mm off its required value, Z is below top;
# Y is missing. A known wrong X must not need Y to be known too.
raw=path([START,TOP,ZERO])
t,n,v=raw[100]
raw[100]=(t,n,(201.,float('nan'),*v[2:]))
sec=seal(raw,reader_alive=True)
r=sc.eval_retract_path('goto-zero',sec,START,ZERO)
record('known_wrong_x_with_y_nan','FAIL',r['status'],r)

# Scripted client runs actual native_run steps, without machine calls.
with tempfile.TemporaryDirectory(prefix='codex-r302-report-') as td, patch.object(nr,'SHORT_GRACE',.001):
    c=fixture.MotionClient()
    ctx={'client':c,'servo':fixture.FakeMeasurement([seal([(t,n,(*v[:-1],3)) for t,n,v in fixture._plateau(speed)['samples']],reader_alive=True) for speed in (100.,50.)]),
         'servo_period_s':.001,'report':{},'run':Path(td)}
    rows=nr.plateau_cases()[1](ctx)
    record('plateau_step_base', ['PASS']*3,[r['status'] for r in rows])
    # The contract demands per-attempt integrity in the report. No report entry
    # at all is written, no evidence file; all that survives is these reduced rows.
    record('plateau_section_audit_persisted', True, bool(ctx['report'] or list(Path(td).iterdir())),
           dict(report=ctx['report'],files=[p.name for p in Path(td).iterdir()],rows=rows))

# The actual Measurement ends with a HAL read failure after successfully seeing
# the end mark. Does a previously observed auto_run refusal still reach its rows?
class EchoReader:
    def __init__(self):
        self.samples=[]
        self.alive=True
        self.overrun=False
    def wait_for_mark(self,mark,deadline_s,since=0):
        self.samples.append((0.,len(self.samples),(0.,)*8+(mark,)))
        return len(self.samples)-1

def measurement(fail_end):
    ended=False
    def run(argv):
        nonlocal ended
        if argv[1:3]==['sets','natv-mark'] and argv[-1]=='4':
            ended=True
        if ended and fail_end and argv[1:] == ['getp','sampler.0.overruns']:
            raise RuntimeError('injected: sampler disappeared at close')
        return 'TRUE' if argv[1:]==['getp','sampler.0.enable'] else '0'
    return sv.Measurement(sv.HalGate(run=run),EchoReader(),1000000,1000000)

for fail_end in (False,True):
    with tempfile.TemporaryDirectory(prefix='codex-r302-rfl-') as td, patch.object(nr,'SHORT_GRACE',.001):
        c=fixture.RflClient([],[],refuse={'auto_run':ls.Refused('injected controller refusal')})
        ctx,step=fixture._rfl_step(Path(td),c)
        ctx.update(run=Path(td),servo=measurement(fail_end))
        try:
            rows=step(ctx)
            error=None
        except Exception as exc:
            rows=getattr(exc,'rows',[])
            error=f'{type(exc).__name__}: {exc}'
        record('rfl_refusal_with_' + ('broken' if fail_end else 'clean') + '_section_end',
               'FAIL',next((r['status'] for r in rows if r['case']=='rfl-line'), 'row missing'),
               dict(error=error,rows=rows,report=ctx['report'],gate_open=ctx['servo'].gate.open_section))

# The old WS interval can stay undecidable even though the new servo proof
# passes. R299 explicitly leaves those old rows as information only.
from test_support import native_cases as nc
raw,reply=jog()
servo=sc.eval_jog_servo('jog-x+.servo',0,1,seal(raw,reader_alive=True),reply)
ws=nc.eval_jog('jog-x+',0,1,300.,(-.05,312.5),[(.10,316.64175,0.),(1.,316.64175,0.)])
restore={'outcome':'complete','isolation':[],'cleanup':None}
record('servo_only_verdict_control','PASS',nr.verdict({'rows':[servo],'restore':restore}))
record('informational_ws_row_still_decides','PASS',nr.verdict({'rows':[ws,servo],'restore':restore}),
       dict(ws_row=ws,servo_row=servo))

out=dict(head='dbff671d',tests=results,conforming=sum(r['conforms'] for r in results),
         contrary=sum(not r['conforms'] for r in results))
print(json.dumps(out,indent=2,ensure_ascii=False,allow_nan=False))
sys.exit(1 if out['contrary'] else 0)
