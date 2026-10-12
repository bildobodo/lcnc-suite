"""R142 plan-contract probes, Python standard library only.

Analytic contract examples, NOT execution of the new contactView or a product
sweep. The bisection below follows collision.ts:2260-2267 at the reviewed HEAD;
source text is asserted to prevent the model silently diverging from it.
Run: python3 <this-file> [--source <collision.ts>]
"""
import argparse
import hashlib
import json
from pathlib import Path

EPS = 1e-4


def union(intervals):
    out = []
    for a, b in sorted(intervals):
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(b, out[-1][1]))
        else:
            out.append((a, b))
    return out


def cut_open(intervals, free):
    # A Lipschitz radius guarantees STRICT clearance inside, not at the edge.
    out = union(intervals)
    for x, y in free:
        nxt = []
        for a, b in out:
            if b <= x or a >= y:
                nxt.append((a, b))
            else:
                if a <= x:
                    nxt.append((a, x))
                if b >= y:
                    nxt.append((y, b))
        out = nxt
    return out


def covers(intervals, p):
    return any(a <= p <= b for a, b in intervals)


def distance_to_set(intervals, p):
    return min(max(a - p, 0, p - b) for a, b in intervals)


def free_certificate(truth, p, section=(0, 3)):
    # d=EPS+distance_to_contact_set is 1-Lipschitz; outside is decided.
    clearance = distance_to_set(truth, p)
    assert clearance > 0
    return (max(section[0], p - clearance), min(section[1], p + clearance))


def bisect_boundary(contact, clear, predicate):
    c, x = contact, clear
    visits = []
    for _ in range(24):
        if abs(x - c) <= 1e-3:
            break
        mid = (c + x) / 2
        state = predicate(mid)
        visits.append({'p': mid, 'state': state})
        if state != 'outside':
            c = mid
        else:
            x = mid
    return c, visits


parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path)
args = parser.parse_args()
source_verification = None
if args.source:
    source = args.source.read_text()
    expected = '''  const bisectBoundary = (contactCum: number, clearCum: number, pi: number): number => {
    let c = contactCum, x = clearCum;
    for (let it = 0; it < 24 && Math.abs(x - c) > 1e-3; it++) {
      const mid = (c + x) / 2;
      if (contactAtDist(mid, pi)) c = mid;
      else x = mid;
    }
    return c;
  };'''
    assert expected in source
    assert 'return v !== "outside";' in source
    source_verification = {'sha256': hashlib.sha256(source.encode()).hexdigest(), 'bisection_matches': True}

# The two existing regressions now pass together.
old_140 = [(0, 1), (1.001, 2)]
free_140 = [free_certificate(old_140, 1.0005, (0, 2))]
shown_140 = cut_open(old_140 + [(0, 2)], free_140)
assert len(shown_140) == 2 and not covers(shown_140, 1.0005)
assert covers(shown_140, 0.5) and covers(shown_140, 1.5)

old_141 = [(0, 1), (1.4, 1.6), (2, 3)]
points = [1.125, 1.375, 1.625, 1.875]
free_141 = [free_certificate(old_141, p) for p in points]
shown_141 = cut_open(old_141 + [(0, 1), (2, 3)], free_141)
assert covers(shown_141, 1.5)
assert all(not (a < 1.5 < b) for a, b in free_141)

# New certificate belongs to the ending interval, no next row required.
ending = {'entry': 0, 'exit': 1, 'free_after': 1.0005,
          'free_radius': (free_140[0][1] - free_140[0][0]) / 2}
partial = {'intervals': [ending], 'next_interval': None}
assert partial['intervals'][0]['free_after'] == 1.0005

# Ordinary split: distinct IDs, old ID only at its anchor, unchanged update stable.
pieces = cut_open([(0, 3)], [(1.4, 1.6)])
ids = [11 if a <= 0 <= b else 12 for a, b in pieces]
assert ids == [11, 12] and len(set(ids)) == len(pieces)
assert [11 if a <= 0 <= b else 12 for a, b in pieces] == ids

# Remaining anchor flaw. Same true geometry and same predicate in both runs.
# A true contact [0,.5] has ended, followed by another [2,3]. An inside
# query in [1,1.9] is undecidable despite positive surface clearance.
truth = [(0, 0.5), (2, 3)]

def predicate(p):
    if covers(truth, p):
        return 'contact'
    if 1 <= p <= 1.9:
        return 'undecidable'
    return 'outside'

anchor, visits = bisect_boundary(2.5, 0.75, predicate)
assert predicate(anchor) == 'undecidable'
assert not covers(truth, anchor)
# A legitimate first free sample after the earlier contact certifies this
# anchor as free. The guarantee comes from surfaces + the decided outside
# at .875; it does not require a successful inside ray at every other point.
p = 0.875
free = free_certificate(truth, p)
assert predicate(p) == 'outside'
assert free[0] < anchor < free[1]
assert min(anchor - free[0], free[1] - anchor) > 1e-3
held = [(0, 0.5), (anchor, 3)]
shown = cut_open(held, [free])
children = [span for span in shown if span[1] > 0.5]
old_id_children = [span for span in children if span[0] <= anchor <= span[1]]
assert len(old_id_children) == 0
assert covers(children, 2.5)  # the actual discovery witness survives

# A strict inequality is necessary at a certificate edge: d=EPS is touch.
boundary = {'p': 1.5, 'd': EPS + 0.5, 'V': 1, 'radius': 0.5,
            'q': 1, 'd_at_q': EPS, 'q_is_touch': True}

E, I, G, K = 65536, 262144, 16384, 8
T = E*46 + I*37 + G*21 + (E+I+G) + K*4096*(46+37+21+3)
index = 2*(E+I)*4*2*9//8 + 2*I*4*9//8 + 8192*16
out = {
    'scope': 'Plan rules and analytic examples only; no application/sweep build or live machine.',
    'source_verification': source_verification,
    'r140_control': {'certificates': free_140, 'shown': shown_140, 'separation_retained': True},
    'r141_control': {'certificates': free_141, 'shown': shown_141, 'confirmed_1_5_retained': True},
    'exit_delta_before_next_interval': partial,
    'ordinary_split_control': {'pieces': pieces, 'ids': ids, 'selected_id': 11, 'unchanged_update_stable': True},
    'anchor_counterexample': {
        'truth': truth, 'undecidable_range': [1, 1.9],
        'old_known_clear': 0.75, 'old_discovery_contact': 2.5,
        'refined_anchor': anchor, 'anchor_verdict': predicate(anchor),
        'actual_clearance_at_anchor': distance_to_set(truth, anchor),
        'refinement_probes': visits, 'new_first_free_after_earlier_contact': p,
        'new_certificate': free, 'shown_after_cut': shown,
        'children_containing_old_anchor': len(old_id_children),
        'confirmed_discovery_witness_retained': covers(children, 2.5),
        'conclusion': 'The refined contact-side bound is not necessarily confirmed; old-ID inheritance by its immutable presence has no child here.'
    },
    'strict_certificate_edge': boundary,
    'capacity_arithmetic': {'T_bytes_including_dirty_rounded_blocks': T, 'derived_bytes': index,
                            'six_main_six_side_plus_derived': T*6*9//8+index},
}
print(json.dumps(out, indent=2))
