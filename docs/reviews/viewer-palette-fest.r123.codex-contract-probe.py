"""R123 plan probes. Run with repository root as argv[1].
No HAL, LinuxCNC instance, ports, or machine commands. Evaluates the shipped
component's C function in an isolated shared library, pure RDP functions,
and explicitly analytic examples (not measured motion).
"""
from pathlib import Path
import ast, ctypes, hashlib, json, math, subprocess, sys, tempfile
import numpy as np
root=Path(sys.argv[1]).resolve()

def function(rel, name):
    tree=ast.parse((root/rel).read_text())
    node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name)
    ns={'np':np}; exec(compile(ast.Module(body=[node],type_ignores=[]),rel,'exec'),ns)
    return ns[name]

rdp=function('lcnc-gateway/gcode_parse_worker.py','_rdp_keep')
anchors=function('lcnc-gateway/gateway_util.py','mode_boundary_indices')
pts=np.array([[0.,0.,0.],[0,0,0],[0,0,0],[10,0,0]])
dep=[3,2,0,0]; bound=anchors(dep)
old=rdp(pts,[],.005**2); new=rdp(pts,bound,.005**2)
assert old==[0,3] and new==[0,1,2,3]
corrected=pts.copy()
for i,mask in enumerate(dep):
    for a in range(3):
        if mask & (1<<a): corrected[i,a]+=[100,100,0][a]
assert corrected.tolist()==[[100,100,0],[0,100,0],[0,0,0],[10,0,0]]
long=np.array([[i*.5,0.,0.] for i in range(1001)])
k1=rdp(long,anchors([3]*len(long)),.005**2)
k2=rdp(long+np.array([100,100,0]),anchors([3]*len(long)),.005**2)
assert k1==k2==[0,1000]

# Compile the exact pure FUNCTION body, with its pins as local parameters.
rel='examples/sim_config/sim_toolsetter/sim_toolsetter.comp'
comp=(root/rel).read_text(); body=comp.split('FUNCTION(_) {',1)[1].rsplit('}',1)[0]
c='''#include <math.h>
int run(double x,double y,double z,double plate_x,double plate_y,double plate_z,
        double radius,double tool_length,int enable,int manual) {
    int contact=0,out=0;
'''+body+'\nreturn out;\n}\n'
with tempfile.TemporaryDirectory(prefix='r123-pure-component-') as tmp:
    tmp=Path(tmp); (tmp/'probe.c').write_text(c)
    cp=subprocess.run(['cc','-shared','-fPIC','-O0',str(tmp/'probe.c'),'-o',str(tmp/'probe.so'),'-lm'],text=True,capture_output=True)
    assert cp.returncode==0,cp.stderr
    dll=ctypes.CDLL(str(tmp/'probe.so')); dll.run.argtypes=[ctypes.c_double]*8+[ctypes.c_int]*2;dll.run.restype=ctypes.c_int
    # Identical output/position wiring and servo schedule in every case;
    # only values F4 does not verify are changed.
    def out(z,plate=-300,enable=1,manual=0): return dll.run(150,0,z,150,0,plate,25,60,enable,manual)
    v=2000/60;h=v*.002+v*v/400;P=-240
    cases={
        'nominal_at_P':out(P),
        'lowered_plate_at_P':out(P,plate=-310),
        'lowered_plate_at_band_bottom':out(P-h,plate=-310),
        'lowered_plate_at_its_trip':out(-250,plate=-310),
        'disabled_at_P':out(P,enable=0),
        'disabled_at_programmed_end':out(-390,enable=0),
        'manual_above_P':out(-200,manual=1),
    }
    assert cases=={'nominal_at_P':1,'lowered_plate_at_P':0,'lowered_plate_at_band_bottom':0,'lowered_plate_at_its_trip':1,'disabled_at_P':0,'disabled_at_programmed_end':0,'manual_above_P':1}

# An input delay is before latching #5063, not only before the stop.
# Simple allowed analytic case: constant slow feed 600 mm/min, 100 ms
# unbounded extra input delay, zero WCS/G92. No claim of a live measurement.
velocity=600/60;delay=.1;P_geom=-240.;P_latch=P_geom-velocity*delay
length_preview=300+P_geom; length_actual=300+P_latch
assert (length_preview,length_actual)==(60.,59.)
# After G53 Z0 both control points are 0; a later program Z-100 under G43
# commands different control points because G53 did not change either TLO.
late_move={'commanded_program_z':-100,'preview_control_point_z':-100+length_preview,
           'delayed_input_control_point_z':-100+length_actual,'difference_mm':1.}
# Relative retract stop uncertainty is kept by F2's added upper leg.
P=0.;h=2.844444444444445;r=3.;band=(P-h,P+r)
for stop in np.linspace(P-h,P,101):
    assert band[0]<=stop<=band[1] and band[0]<=stop+r<=band[1]
# E8 places first G94 feed in rapid, but defines its F only in feed_dep_f.
wire_example={'rapid_dep_basis':[2], 'feed_dep_basis':[], 'feed_dep_f':[]}
print(json.dumps({
 'rdp':{'before':old,'mask_anchors':sorted(bound),'after':new,'corrected':corrected.tolist(),'constant_mask_1001_points':k1,'translation_preserves_kept_indices':k1==k2},
 'pure_component':{'source':rel,'source_sha256':hashlib.sha256(comp.encode()).hexdigest(),'cases':cases,'planned_P':P_geom,'planned_band_bottom':P_geom-h,'lowered_plate_trip':-250},
 'analytic_only':{'input_delay':{'slow_feed_mm_min':600,'extra_delay_s':delay,'geometric_P':P_geom,'latched_P':P_latch,'preview_length':length_preview,'latched_length':length_actual,'later_move_after_G53_Z0':late_move},'bounded_retract':{'band':band,'stops_checked':101,'contained':True},'first_G1_wire_requires_F_in_rapid_or_common_stream':wire_example},
 'limits':'Pure component function, RDP and analytic plan examples only; no controller or trajectory planner executed.'
},indent=2))
