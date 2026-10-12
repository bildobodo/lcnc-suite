"""R140: examples of what the proposed replacement / budget rules still allow.
No product code; no geometric collision claim. Run with Python 3.
"""
import json
from pathlib import Path

def in_any(ivs, x):
    return any(a <= x <= b for a, b in ivs)

def replace_first_overlapping(old, new):
    # Plan 3.5 read as one-to-one replacement, in parameter order.
    shown=list(old)
    used=set()
    for n in new:
        match=next((i for i,o in enumerate(old) if i not in used and max(o[0],n[0])<=min(o[1],n[1])),None)
        if match is None:
            shown.append(n)
        else:
            used.add(match)
            shown[match]=n
    return shown

old=[(0.0,1.0),(1.001,2.0)]
new=[(0.0,2.0)]
free=1.0005
shown=replace_first_overlapping(old,new)
assert not in_any(old,free)
assert len(shown)==2
assert in_any(shown,free)

# Two generations can both contain unmatched narrow events: the plan keeps
# both by design. This is a counting lower bound, not a measured heap.
I=262144; E=65536; G=16384
one_targets=E-1+I # one episode contains all intervals, the others are near
one_bands=I
one_bands_with_gaps=I+G
out={
 'one_to_one_replacement': {
  'old':old,'new':new,'known_free_sample':free,'shown':shown,
  'two_targets_retained':len(shown)==2,'known_free_sample_covered_after_replacement':in_any(shown,free),
  'interpretation':'One-to-one identity matching alone does not preserve interval geometry or a separation proof; package 2 is not implemented.'},
 'derived_tables': {
  'single_generation_target_index_bytes':one_targets*4,
  'two_disjoint_generations_target_index_bytes':one_targets*2*4,
  'single_generation_union_bytes':one_bands*16,
  'two_disjoint_generations_union_bytes':one_bands*2*16,
  'two_disjoint_generations_union_with_split_gaps_bytes':one_bands_with_gaps*2*16,
  'excludes':'side-run targets/bands, retained knowledge gaps, identity mapping, track-line span index, per-pair state, geometry and runtime overhead',
  'interpretation':'Exact lower-bound arithmetic from allowed row counts; not a measured heap. Alternatives may avoid these arrays but must state their own bound.'},
 'gap_split_example':{
  'contact_interval':[0,10], 'gap':[4,6], 'rendered_bands':[[0,4],[6,10]],
  'interpretation':'Even one semantic contact interval can need two band intervals when knowledge gaps are removed.'}
}
assert out['derived_tables']['two_disjoint_generations_union_bytes']>4_200_000
assert out['derived_tables']['two_disjoint_generations_target_index_bytes']>1_300_000
p=Path(__file__).with_suffix('.json')
p.write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
