"""R326 plan audit: pure numerical and evaluator checks; NO HAL/LinuxCNC I/O.
Run with system Python (numpy/scipy): script.py /tmp/archive output.json
"""
import json,sys,math
from pathlib import Path
import numpy as np
import scipy
from scipy.interpolate import griddata
root=Path(sys.argv[1]).resolve()
assert str(root).startswith('/tmp/')
sys.path.insert(0,str(root/'scripts'))
from test_support.native_cases import eval_override_lock

def dev(x,y):
    dx,dy=x-550.,y-550.
    return 6.+.05*dx-.03*dy-.0024*(dx*dx+dy*dy)
points=[]
for i,y in enumerate(range(518,583,16)):
    for x in (range(518,583,16) if i%2==0 else range(582,517,-16)):
        points.append((x,y,dev(x,y)))
points=np.array(points)
q=(538.,550.)
interp={m:float(griddata(points[:,:2],points[:,2],np.array([q]),method=m)[0]) for m in ('nearest','linear','cubic')}
quantized={m:math.trunc(z/.001)*.001 for m,z in interp.items()}
manual_linear=.75*dev(534,550)+.25*dev(550,550)
assert abs(interp['nearest']-dev(534,550))<1e-12
assert abs(interp['linear']-manual_linear)<1e-12
assert abs(interp['cubic']-interp['linear'])>=.05
assert abs(interp['cubic']-dev(*q))<abs(interp['linear']-dev(*q))
# Exact analytic paraboloid is NOT the specified cubic interpolator, but
# still passes both proposed inequalities. The scipy comparison distinguishes it.
wrong_cubic=dev(*q)
wrong_cubic_property_pass=(abs(wrong_cubic-interp['linear'])>=.05 and abs(wrong_cubic-dev(*q))<abs(interp['linear']-dev(*q)))
wrong_cubic_reference_pass=abs(wrong_cubic-quantized['cubic'])<=.002
# A faithful frame sequence following surface_scan.ngc's current tail:
# M50 P1 precedes the final G53 Z0/G0 XY return. This is NOT a live trace.
def frame(t,locked,vel,idle=False):
    return (t,dict(feed_override_enabled=not locked,current_vel=vel,interp_state=1 if idle else 2,
                   tool_change_seq=None,tool_change_requested=False))
frames=[frame(.01,False,0,True),frame(.1,True,0),frame(.2,True,1),frame(.5,True,0),
        frame(.6,False,10),frame(.8,False,10),frame(1.,False,0,True)]
judgement=eval_override_lock('surface-current-tail',frames,0.)
assert judgement['status']=='FAIL'
locked_tail=[(t,{**st,'feed_override_enabled':False}) if .6<=t<1 else (t,st) for t,st in frames]
corrected=eval_override_lock('surface-locked-return',locked_tail,0.)
assert corrected['status']=='PASS'
# Offset frozen during the XY move, updated only at its end:
# endpoint rule still passes, midpoint clearance is 2.5088 mm too high.
base_joint=-175.+50.+12.
follow=[]
for tag,x,y,offset in [('A',550.,550.,dev(550,550)),('middle',534.,566.,dev(550,550)),('B',518.,582.,dev(518,582))]:
    joint=base_joint+offset
    follow.append(dict(place=tag,x=x,y=y,joint_z=joint,eoffset=offset,clearance=joint-50.-(-175.+dev(x,y))))
assert abs(follow[0]['clearance']-follow[-1]['clearance'])<.01
assert abs(follow[1]['clearance']-12)>.01
# Bounds in the fixture/window and proposed joint moves.
peak=(550.+.05/.0048,550.-.03/.0048)
window_corners=[dev(x,y) for x in (510,590) for y in (510,590)]
result={'code_base':'89003ac0','numpy':np.__version__,'scipy':scipy.__version__,
        'scope':'pure, no machine/HAL access; synthetic frames and countertrajectory, not observed live',
        'nodes':points.tolist(),'q':list(q),'q_reference':interp,'q_counts_quantized':quantized,'q_analytic':dev(*q),
        'method_min_gap_mm':min(abs(a-b) for i,a in enumerate(interp.values()) for b in list(interp.values())[i+1:]),
        'cubic_counter':{'wrong_value':wrong_cubic,'passes_both_inequalities':wrong_cubic_property_pass,
                         'passes_scipy_equality_0_002':wrong_cubic_reference_pass},
        'override':{'frames':frames,'existing_evaluator':judgement,'locked_return_control':corrected},
        'follows_counter':{'samples':follow,'passes_endpoint_rule':True,'midpoint_error_mm':follow[1]['clearance']-12},
        'geometry':{'true_peak_xy':peak,'true_peak_deviation':dev(*peak),'grid_deviation_min':float(points[:,2].min()),
                    'grid_deviation_max':float(points[:,2].max()),'window_min_deviation':min(window_corners),
                    'search_target_joint_z':-175.+15.-25.+50.,'safe_joint_z':-175.+15.+50.,
                    'A_off_clearance':12-dev(550,550),'B_off_clearance':12-dev(518,582)}}
assert wrong_cubic_property_pass and not wrong_cubic_reference_pass
Path(sys.argv[2]).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='nodes'},indent=2))
