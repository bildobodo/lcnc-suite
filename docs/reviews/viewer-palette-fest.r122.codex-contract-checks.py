"""R122 analytic contract checks, NOT measurements of the controller.
Run: python3 r122.contract-checks.py <native-results.json> <xyzac.ini>
Uses only Python stdlib, no HAL/NML or ports.
"""
import json, math, sys, configparser
from pathlib import Path
runs=json.loads(Path(sys.argv[1]).read_text())
for r in runs:
    assert r["returncode"] == 0
    assert r["decoded"][0]["parse_error"] is None
    assert r["decoded"][0]["mmap_unchanged"] is True
by={r["case"]:r["decoded"] for r in runs}
for name, expected in (("e_g30_forms",6),("e_g28_g91",4)):
    legs=[r for r in by[name][1] if r["g_modes"][0] in (280,300)]
    assert len(legs)==expected
    for line in set(r["line"] for r in legs):
        assert len([r for r in legs if r["line"]==line])==2
flags=by["e_g53_prefix"][1]
assert flags[1]["x_flag"] and flags[1]["args"]==flags[0]["args"]
assert by["e_sub"][1][-1]["call_level"]==1
# Start = (100, 100, 0); endpoints expected after E2 correction.
full=[[100,100,0],[0,100,0],[0,0,0],[10,0,0]]
corner=by["r122_rapid_corner"][0]
assert corner["rapid_lines"]==[2,5]
assert corner["rapid_seq"]==[1,4]
# Distance of the missing first corner to the replacement diagonal.
p,a,b=full[1],full[0],full[-1]
v=[b[i]-a[i] for i in range(3)];w=[p[i]-a[i] for i in range(3)]
t=max(0,min(1,sum(x*y for x,y in zip(v,w))/sum(x*x for x in v)))
distance=math.dist(p,[a[i]+t*v[i] for i in range(3)])
assert distance>74
A=by["r122_feed_mixed_a"][0]; B=by["r122_feed_mixed_b"][0]
assert A["digest_without_start"]==B["digest_without_start"]
assert A["feed_tcum"]==B["feed_tcum"]==[0,0]
times_A=[100/(100/60),100/(200/60)]
times_B=[100/(200/60),100/(100/60)]
# Under F2's own G61 premise: full acceleration vs half acceleration.
# Idealized kinematics with equal latency allowance on both sides;
# this is a contract counterexample, NOT a measured LinuxCNC stop.
brakes=[]
for feed,acc in [(2000,500),(3000,250)]:
    v=feed/60;lat=.002
    upper=v*lat+v*v/acc
    g61=v*lat+v*v/(2*acc)
    brakes.append(dict(feed_mm_min=feed,a_mm_s2=acc,t_lat_s=lat,
                       h_plan_mm=upper,h_full_acceleration_mm=g61,
                       excess_mm=upper-g61))
    assert upper-g61>.5
# At the same full acceleration, from rest only .1 mm to trigger,
# attainable trigger speed is far below the requested 50 mm/s.
v=50;acc=250;approach=.1;lat=.002
v_trip=min(v,math.sqrt(2*acc*approach))
short=dict(feed_mm_min=v*60,a_mm_s2=acc,approach_mm=approach,
           v_trip_mm_s=v_trip,h_plan_mm=v*lat+v*v/acc,
           h_at_trip_mm=v_trip*lat+v_trip*v_trip/(2*acc))
assert short['h_plan_mm']-short['h_at_trip_mm']>.5
# Effective planning limits from the reviewed XYZAC INI. This is the
# documented 2.9 OFFSET_AV_RATIO split, not a measured trajectory.
ini=configparser.ConfigParser(strict=False)
ini.read(sys.argv[2])
ratio=ini.getfloat("AXIS_Z","OFFSET_AV_RATIO",fallback=0)
raw_a=ini.getfloat("AXIS_Z","MAX_ACCELERATION")
raw_v=ini.getfloat("AXIS_Z","MAX_VELOCITY")
a_plan=(1-ratio)*raw_a;v_plan=(1-ratio)*raw_v
v_probe=min(2000/60,v_plan,ini.getfloat("TRAJ","MAX_LINEAR_VELOCITY"))
lat=2*ini.getfloat("EMCMOT","SERVO_PERIOD")/1e9
split=dict(offset_av_ratio=ratio,raw_axis_a=raw_a,planning_a=a_plan,
    raw_axis_v=raw_v,planning_v=v_plan,
    at_F2000_h_unsplit_mm=v_probe*lat+v_probe*v_probe/raw_a,
    at_F2000_h_split_mm=v_probe*lat+v_probe*v_probe/a_plan)
assert ratio==.2 and a_plan==400 and v_plan==80
assert split['at_F2000_h_split_mm']-split['at_F2000_h_unsplit_mm']>.5
# A stop interval propagates through a relative retract. The deepest
# endpoint's retract does not enclose all admissible retract segments.
P=0;h_max=2.3;h_actual=.2;r=3
retract=dict(P=P,deepest_Q=P-h_max,admissible_Q=P-h_actual,
             r=r,deepest_retract_end=P-h_max+r,
             admissible_retract_end=P-h_actual+r)
assert retract['admissible_retract_end']>retract['deepest_retract_end']
print(json.dumps(dict(native_cases=len(runs),all_native_parse_and_private_mmap_checks_pass=True,
    rapid_corner=dict(retained_lines=corner['rapid_lines'],expected_corrected_points=full,
       missing_corner_distance_to_diagonal_mm=distance),
    zero_length_time=dict(equal_payload_digest=A['digest_without_start'],
        published_feed_tcum=A['feed_tcum'],corrected_times_a_s=times_A,corrected_times_b_s=times_B),
    analytic_only=dict(axis_limit_split=split,g61=brakes,short_approach=short,retract_interval=retract,
       extra_20ms_latency_at_F2000_mm=(2000/60)*.02)),indent=2))
