"""R141 plan-contract probes; no application code or live controller.
Run with Python 3. Output is an analytic example, not a measured sweep.
"""
import json
from pathlib import Path

def union(intervals):
    out=[]
    for a,b in sorted(intervals):
        if out and a<=out[-1][1]: out[-1]=(out[-1][0],max(b,out[-1][1]))
        else: out.append((a,b))
    return out

def cut(intervals,gaps):
    out=union(intervals)
    for ga,gb in gaps:
        nxt=[]
        for a,b in out:
            if b<=ga or a>=gb: nxt.append((a,b)); continue
            if a<ga: nxt.append((a,ga))
            if b>gb: nxt.append((gb,b))
        out=nxt
    return out

def covers(ivs,p): return any(a<=p<=b for a,b in ivs)

# R140's original A/B/C control is now handled.
a_b=[(0,1),(1.001,2)]
c=[(0,2)]
r140=cut(a_b+c,[(1,1.001)])
assert r140==a_b and not covers(r140,1.0005)

# A free sample is a point, not a certificate for its entire bracket.
# Actual contact set is old; the 0.25-phase new grid misses the 0.2 window.
old=[(0,1),(1.4,1.6),(2,3)]
new=[(0,1),(2,3)]
confirmed_old_touch=1.5
new_free_samples=[1.125,1.375,1.625,1.875]
assert covers(old,confirmed_old_touch)
assert all(not covers(old,p) for p in new_free_samples)
assert all(abs((b-a)-0.25)<1e-12 for a,b in zip(new_free_samples,new_free_samples[1:]))
shown=cut(old+new,[(1,1.4),(1.6,2),(1,2)])
assert not covers(shown,confirmed_old_touch)

# New true separation splits one old coarse event. Both pieces overlap it.
held=[{'id':11,'span':(0,3)}]
split=cut([(0,3),(0,1),(2,3)],[(1,2)])
ids=[next(h['id'] for h in held if max(p[0],h['span'][0])<=min(p[1],h['span'][1])) for p in split]
assert len(split)==2 and ids==[11,11]

# Pixel aggregation is necessarily coarser than the point predicate.
pixel=(1,1.01)
pixel_on=any(max(a,pixel[0])<min(b,pixel[1]) for a,b in a_b)
assert pixel_on and not covers(a_b,1.0005)

# Side has 1/8 of EACH generation's table budget. Count u32 arrays as named.
E,I=65536,262144
idx=2*(E+I)*4
side_idx=idx//8
identity=idx+side_idx
pair_idx=2*I*4
side_pair_idx=pair_idx//8
bands=8192*16
out={
 'r140_control':{'old':a_b,'new':c,'shown':r140,'free_point':1.0005,'free_point_covered':covers(r140,1.0005)},
 'positive_contact_erased':{'old':old,'new':new,'old_confirmed_touch':confirmed_old_touch,'new_free_samples':new_free_samples,'new_gap_bracket':[1,2],'shown':shown,'old_touch_covered_after_cut':covers(shown,confirmed_old_touch),'note':'All listed negative samples agree with the old positive contact. The entire gap bracket is not proved clear.'},
 'split_identity':{'held':held,'shown':split,'assigned_ids':ids,'unique_ids':len(set(ids))==len(ids)},
 'raster_limit':{'pixel_span':pixel,'pixel_on':pixel_on,'exact_free_point':1.0005,'point_contact':covers(a_b,1.0005)},
 'index_arithmetic':{'main_target_index':idx,'side_target_index':side_idx,'all_display_ids':identity,'main_pair_index':pair_idx,'side_pair_index':side_pair_idx,'band_buffer':bands,'total_bytes':idx+side_idx+identity+pair_idx+side_pair_idx+bands},
 'scope':'Literal plan rules and arithmetic only; no product implementation and no machine execution.'
}
Path(__file__).with_suffix('.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
