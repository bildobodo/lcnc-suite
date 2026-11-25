import ast,json,math,sys
from pathlib import Path
from typing import List
import numpy as np
root=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/r489/tree')
source=root/'lcnc-gateway/gcode_parse_worker.py'
tree=ast.parse(source.read_text());names={'_rdp_keep','_turning_points','_course_splits'}
selected=ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names],type_ignores=[])
ns={'np':np,'math':math,'List':List};exec(compile(selected,str(source),'exec'),ns)
keep=ns['_rdp_keep']
results=[]
for y in [0.,100.]:
    p=np.array([(x,y,0.) for x in [0.,1.,.99998,2.]])
    k=keep(p,[],.005**2);wire=p.astype(np.float32).astype(float)
    results.append({'case':'orthogonal_translation','y':y,'kept':k,'wire_x':wire[:,0].tolist(),'rounding_error_x':(wire-p)[:,0].tolist(),'true_back':float(wire[1,0]-wire[2,0])})
    assert wire[1,0]>wire[2,0]
assert results[0]['kept']==[0,1,2,3] and results[1]['kept']==[0,3]
# Even exactly represented values can be lost: two binary fractions and an unrelated y.
for y in [0.,1000.]:
    p=np.array([(x,y,0.) for x in [0.,1.,1.-2**-13,2.]])
    assert np.array_equal(p,p.astype(np.float32).astype(float))
    k=keep(p,[],.005**2)
    results.append({'case':'all_coordinates_exact_f32','y':y,'kept':k,'points':p.tolist(),'actual_back':2**-13,'rounding_error':0})
assert results[2]['kept']==[0,1,2,3] and results[3]['kept']==[0,3]
# A separate anchored stretch (unrelated to the chord) changes its decision, too.
p=np.array([(0.,0.,0.),(1.,0.,0.),(1.-2**-13,0.,0.),(2.,0.,0.),(1000.,0.,0.)])
k=keep(p,[3],.005**2)
results.append({'case':'unrelated_anchored_tail','kept':k,'points':p.tolist()});assert k==[0,3,4]
# Without a time axis the client measures distance. Genuine tiny reversals add distance.
z=[0.]
for i in range(1000):z.extend([i*2**-13+2**-12,(i+1)*2**-13])
p=np.array([(x,1000.,0.) for x in z]);assert np.array_equal(p,p.astype(np.float32).astype(float))
k=keep(p,[],.005**2)
full=float(np.linalg.norm(np.diff(p,axis=0),axis=1).sum());thin=float(np.linalg.norm(np.diff(p[k],axis=0),axis=1).sum())
results.append({'case':'distance_axis','points':len(p),'kept':len(k),'full_length':full,'thin_length':thin})
# Short nonzero chord: the branch checks distance to that chord instead of
# accumulated reversal or distance to its start, and can exceed its own back bound.
for y in [0.,1024.,8192.]:
    d=2**-12 if y<8192 else 2**-9
    p=np.array([(x,y,0.) for x in [0.,3*d,-d,d]])
    assert np.array_equal(p,p.astype(np.float32).astype(float))
    k=keep(p,[],.005**2)
    back=min(.005,4*float(np.spacing(np.float32(np.abs(p).max()))))
    results.append({'case':'short_nonzero_chord','y':y,'kept':k,'points':p.tolist(),'back_bound':back,'actual_back':4*d,'rounding_error':0})
    if y:assert k==[0,3] and 4*d>back
    else:assert k==[0,1,2,3]
print(json.dumps(results,indent=2))
