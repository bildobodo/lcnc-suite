"""R185 design-only arithmetic: no product code, sockets, processes or machine.
Numbers are milliseconds on an explicit synthetic real-time/page axis.
The proposed offset proof is valid only under its constant-offset premise;
its input intervals must also come from the work itself.
"""
from pathlib import Path
import json, random
ROOT=Path(__file__).resolve().parent

def overlap(a,b):
    return max(0,min(a[1],b[1])-max(a[0],b[0]))
def certain_parse(interval,theta):
    p=(interval[0]+theta[1],interval[1]+theta[0])
    return p if p[0]<p[1] else None

def ordered_witness(p, beats):
    # All g values and p use the same VM monotonic clock instance.
    # Each tuple is (page send, VM source stamp, page receive), matched by id.
    inside=[h for h in beats if p[0]<h[1]<p[1]]
    candidates=[(a[2],b[0]) for a in inside for b in inside if a[1]<b[1] and a[2]<b[0]]
    return max(candidates,key=lambda ab:ab[1]-ab[0],default=None)

out={}
parent=(10000,30000);actual=(20000,25000);sw=(12000,15000);certain=certain_parse(parent,(-1,1))
out['parent_start_before_worker']={'parent':parent,'actual_parse':actual,'actual_sweep':sw,'certain_from_parent':certain,'claimed_overlap_ms':overlap(certain,sw),'actual_overlap_ms':overlap(actual,sw)}
assert overlap(certain,sw)>2 and overlap(actual,sw)==0
actual=(10000,12000);sw=(20000,25000);certain=certain_parse(parent,(-1,1))
out['parent_completion_after_worker']={'parent':parent,'actual_parse':actual,'actual_sweep':sw,'certain_from_parent':certain,'claimed_overlap_ms':overlap(certain,sw),'actual_overlap_ms':overlap(actual,sw)}
assert overlap(certain,sw)>2 and overlap(actual,sw)==0

# A nearby (within 10 seconds) calibration sample is not a bound on a
# subsequently adjusted wall clock. The proposal specifies no rejection of
# this relation and no bounded drift term.
actual=(1500,1550);wall=(1600,1650);sw=(1605,1645);theta=(-1,1)
out['local_wall_step']={'calibration':{'hs':999,'t_gw':1000,'hr':1001},'wall_step_at_page_ms':1400,'wall_step_ms':100,'actual_parse':actual,'parse_wall':wall,'sweep':sw,'mapped_with_old_theta':certain_parse(wall,theta),'actual_overlap_ms':overlap(actual,sw)}
assert overlap(certain_parse(wall,theta),sw)>2 and overlap(actual,sw)==0

# A rate-changing but monotonic VM clock: no fixed offset assumption.
g=lambda t:0.3*t+(5000 if t>15000 else 0)+123456
p_real=(20000,25000);p=(g(p_real[0]),g(p_real[1]))
beats=[(20050,g(20100),20150),(24850,g(24900),24950)]
w=ordered_witness(p,beats)
out['causal_positive']={'parse_real':p_real,'parse_vm':p,'beats':beats,'certain_page_interval':w,'sweep':(21000,22000),'overlap_ms':overlap(w,(21000,22000))}
assert w==(20150,24850)
# The delayed source results from R184 cannot move this interval.
assert ordered_witness((g(10000),g(12000)),beats) is None
assert overlap(w,(10000,12000))==0
assert overlap(w,(26000,30000))==0
out['causal_negative_controls']={'parse_already_ended':'no in-parse witnesses','sweep_before_parse':0,'sweep_after_parse':0,'single_heartbeat':ordered_witness(p,beats[:1]),'delayed_replies_cross':ordered_witness(p,[(20050,g(20100),26000),(24850,g(24900),27000)])}
assert out['causal_negative_controls']['single_heartbeat'] is None
assert out['causal_negative_controls']['delayed_replies_cross'] is None

# G-gap coalescing proves some activity, not that the full hull is work.
active=[(0,1),(3,4),(6,7)];safe=(1.2,5.8)
out['g_gap_semantics']={'active_slices':active,'safe_parse':safe,'merged_hull_overlap_ms':overlap((0,7),safe),'actual_active_overlap_ms':sum(overlap(x,safe) for x in active),'meaning':'hull overlap >2ms witnesses some activity, not >2ms of active work'}
assert out['g_gap_semantics']['merged_hull_overlap_ms']>2
assert out['g_gap_semantics']['actual_active_overlap_ms']==1

rng=random.Random(185);proved=0
for _ in range(10000):
    lo=rng.uniform(1000,25000);hi=lo+rng.uniform(1,5000)
    bs=[]
    for __ in range(8):
        s=rng.uniform(0,35000);at=s+rng.uniform(0,2500);r=at+rng.uniform(0,2500)
        bs.append((s,g(at),r))
    w=ordered_witness((g(lo),g(hi)),bs)
    if w:
        assert lo < w[0] < w[1] < hi
        proved+=1
out['causal_property_check']={'seed':185,'cases':10000,'witnesses_found':proved,'false_witnesses':0,'claim':'every emitted page interval lies within the actual parse interval under arbitrary transport delays and the stated nonuniform monotonic VM clock'}
(ROOT/'proof.json').write_text(json.dumps(out,indent=2))
print(json.dumps({'arithmetic_checks':'PASS','property_check':out['causal_property_check']},indent=2))
