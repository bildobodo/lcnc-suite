"""R304: known Z violation after a proven XY arrival must not need X/Y again.
Offline only: repository fixtures generate samples; real section and evaluator.
Run: gateway Python -B this_file.py /path/to/archive-dc52d9c5
"""
import json
import math
import sys
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1]).resolve()/'scripts'))
import test_native_stage as f
from test_support import servo as sv, servo_cases as sc

START=(200.,200.,-60.)
TOP=(200.,200.,0.)
ZERO=(100.,100.,0.)
G30=(0.,0.,-20.)
results=[]

def run_case(name, points, target, missing_axis=None, mask_below=None, expected='PASS'):
    raw=f._path(points)['samples']
    arrived_at=next(i for i,(_,_,v) in enumerate(raw)
                    if all(abs(v[j]-target[j]) <= sc.PATH_TOL for j in (0,1)) and v[2]>=sc.Z_TOP)
    hidden=[]
    for i in range(arrived_at+1,len(raw)):
        t,n,v=raw[i]
        if missing_axis is not None and (mask_below is None or v[2]<mask_below):
            v=list(v)
            v[missing_axis]=float('nan')
            raw[i]=(t,n,tuple(v))
            hidden.append(n)
    raw=[(t,n,(*v[:-1],3)) for t,n,v in raw]
    t,n,v=raw[-1]
    sec=sv.section(raw+[(t+.001,n+1,(*v[:-1],4))],3,4,f._ok())
    out=sc.eval_retract_path(name,sec,START,target)
    results.append(dict(name=name,expected=expected,actual=out['status'],conforms=out['status']==expected,
                        detail=out,proven_arrival_n=raw[arrived_at][1],hidden_axis=missing_axis,
                        hidden_samples=len(hidden),min_known_z_after_arrival=min(v[2] for _,_,v in raw[arrived_at+1:]
                                                                  if math.isfinite(v[2]))))

run_case('zero_base',[START,TOP,ZERO],ZERO)
run_case('zero_known_descent',[START,TOP,ZERO,(100,100,-1),ZERO],ZERO,expected='FAIL')
for axis in (0,1):
    run_case('zero_known_descent_missing_'+'XY'[axis],
             [START,TOP,ZERO,(100,100,-1),ZERO],ZERO,missing_axis=axis,mask_below=sc.Z_TOP,expected='FAIL')
run_case('zero_missing_x_no_violation',[START,TOP,ZERO],ZERO,missing_axis=0,expected='incomplete')
run_case('g30_base',[START,TOP,(0,0,0),G30],G30)
run_case('g30_known_undershoot_missing_x',[START,TOP,(0,0,0),G30,(0,0,-21),G30],G30,
         missing_axis=0,mask_below=-20.01,expected='FAIL')
out=dict(head='dc52d9c5',tests=results,conforming=sum(t['conforms'] for t in results),
         contrary=sum(not t['conforms'] for t in results))
print(json.dumps(out,indent=2,ensure_ascii=False,allow_nan=False))
sys.exit(1 if out['contrary'] else 0)
