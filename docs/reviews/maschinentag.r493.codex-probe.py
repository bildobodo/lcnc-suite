"""R493: independent exact checks on the isolated product's pure functions.
No worker/gateway/interpreter import; no NML, program execution or timing claim.
"""
import ast
from fractions import Fraction as F
import hashlib
import json
import math
from pathlib import Path
import random
from typing import List
import numpy as np

HERE = Path(__file__).resolve().parent
src = HERE / 'tree/lcnc-gateway/gcode_parse_worker.py'
parsed = ast.parse(src.read_text())
names = {'_turning_points', '_course_splits', '_rdp_keep'}
module = ast.Module(body=[n for n in parsed.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])
ns = {'np': np, 'math': math, 'List': List}
exec(compile(module, str(src), 'exec'), ns)
results = []

def check(name, ok, evidence):
    results.append({'name': name, 'verdict': 'PASS' if ok else 'FAIL', 'evidence': evidence})

def exact_one_way(q, weights):
    p = [[F(float(x)) for x in r] for r in q]
    w = [F(float(x)) ** 2 for x in weights]
    steps = [[b-a for a,b in zip(p0,p1)] for p0,p1 in zip(p,p[1:])]
    moving = [s for s in steps if any(s)]
    chord = [b-a for a,b in zip(p[0],p[-1])]
    dot = lambda a,b: sum(x*y*z for x,y,z in zip(a,b,w))
    return ((any(chord) or not moving)
            and all(dot(s,chord) >= 0 for s in moving)
            and all(dot(a,b) >= 0 for a,b in zip(moving,moving[1:])))

# A straight monotone course retains two endpoints even around f32 ties;
# repeated identical samples do not hide the turn of the next moving step.
for label, values, want in [
    ('plateau at maximum', [0,1,1,1,0,2], [0,1,4,5]),
    ('constant course', [1]*8, [0,7]),
    ('small closed course', [0,2**-20,0], [0,1,2]),
]:
    q=np.array([(x,1000,0) for x in values],dtype=float)
    k=ns['_rdp_keep'](q,(),.005**2)
    check(label,k==want,{'kept':k,'expected':want})

# The normal f64 sum is zero. Exact arithmetic must retain a negative term,
# not confuse it with the corresponding positive/zero controls.
for dx in (-2.0**-23, 0.0, 2.0**-23):
    x=2.0**-10
    q=np.array([(x,0,0),(x,1,1),(x+dx,1.5,.5),(x+dx,101.5,100.5),(x+2.0**-24,512,512)])
    k=ns['_turning_points'](q,np.ones(3))
    want=[1,2] if dx<0 else []
    check('cancelling terms '+str(dx),k==want,{'turns':k,'expected':want})

# A rational oracle over each RETAINED interval. It does not reproduce the
# worker's float error bound, sign helper or choice of split indices.
bad=[]; intervals=0; removed=0; ncases=800
for seed in range(ncases):
    rng=random.Random(seed+493000)
    dim=3 if seed%2 else 6
    n=rng.randint(3,14)
    scale=2.0**rng.choice([-25,-18,-13,-10,-8,-3,0,10])
    origin=[rng.choice([0.0,1000.0,-100000.0]) for _ in range(dim)]
    pos=[0]*dim; pts=[]
    for _ in range(n):
        if rng.random()>.2:pos=[a+rng.choice([-2,-1,0,0,1,2]) for a in pos]
        pts.append([a+b*scale for a,b in zip(origin,pos)])
    wire=np.asarray(pts,dtype=np.float32)
    weights=np.ones(dim)
    if dim==6 and seed%4==0: weights[3:]=1/25.4
    # The original doubles define side error; quantized values define order.
    pose=np.asarray(pts)*weights
    times=np.cumsum(np.arange(1,n+1,dtype=float)) if seed%3 else None
    anchors=(n//2,) if seed%5==0 else ()
    k=ns['_rdp_keep'](pose,anchors,.005**2,times,wire,weights)
    removed+=n-len(k)
    for a,b in zip(k,k[1:]):
        intervals+=1
        if not exact_one_way(wire[a:b+1],weights):bad.append({'seed':seed,'a':a,'b':b,'wire':wire.tolist(),'kept':k})
        for i in range(a+1,b):
            d=pose[b]-pose[a]; rel=pose[i]-pose[a]; length=float(d@d)
            u=min(1.,max(0.,float(rel@d)/length)) if length else 0.
            if np.linalg.norm(rel-u*d)>.005+1e-10:bad.append({'seed':seed,'side':i})
            if times is not None and times[b]>times[a]:
                u=(times[i]-times[a])/(times[b]-times[a])
                if np.linalg.norm(rel-u*d)>.005+1e-10:bad.append({'seed':seed,'time':i})
check('rational interval oracle plus side and time bounds',not bad,{'cases':ncases,'intervals':intervals,'removed':removed,'failures':bad[:4]})

# Actual shipped values (rather than f64 input) can change a step's sign.
q=np.array([(0,0,0),(1000,0,0),(1000-1e-6,0,0),(2000,0,0)])
check('sub-wire change disappears',ns['_rdp_keep'](q,(),.005**2)==[0,3],{'kept':ns['_rdp_keep'](q,(),.005**2)})
print(json.dumps({'head':'55851502','source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'results':results},indent=2))
raise SystemExit(any(r['verdict']=='FAIL' for r in results))
