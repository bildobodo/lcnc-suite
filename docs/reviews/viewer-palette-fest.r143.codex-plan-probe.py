"""R143 analytic plan-contract checks; no product code or machine execution.
Run with Python 3 (standard library only). Outputs JSON to stdout.
"""
import json
import math
import struct


def union(intervals):
    result = []
    for a, b in sorted(intervals):
        if result and a <= result[-1][1]:
            result[-1] = (result[-1][0], max(result[-1][1], b))
        else:
            result.append((a, b))
    return result


def cut_open(intervals, cuts):
    result = union(intervals)
    for x, y in cuts:
        following = []
        for a, b in result:
            if b <= x or a >= y:
                following.append((a, b))
            else:
                if a <= x:
                    following.append((a, x))
                if b >= y:
                    following.append((y, b))
        result = following
    return result


def includes(span, p):
    return span[0] <= p <= span[1]


def old_bisect(contact, clear, verdict):
    # Existing contact-side rule; 'undecidable' stays on that side.
    c, x = contact, clear
    for _ in range(24):
        if abs(c - x) <= 1e-3:
            break
        mid = (c + x) / 2
        if verdict(mid) != 'outside':
            c = mid
        else:
            x = mid
    return c


def f32_down(value):
    nearest = struct.unpack('!f', struct.pack('!f', value))[0]
    if nearest > value:
        bits = struct.unpack('!I', struct.pack('!f', nearest))[0]
        nearest = struct.unpack('!f', struct.pack('!I', bits - 1))[0]
    return nearest


def free_at(p, radius, section, q):
    return section[0] <= q <= section[1] and p - radius < q < p + radius


# R142: a conservative entry is not a witness. Same facts, new ID rule.
truth = [(0, .5), (2, 3)]
def verdict(p):
    if any(includes(span, p) for span in truth):
        return 'contact'
    if 1 <= p <= 1.9:
        return 'undecidable'
    return 'outside'

entry = old_bisect(2.5, .75, verdict)
witness = 2.5
assert verdict(entry) == 'undecidable' and verdict(witness) == 'contact'
shown = cut_open([(entry, 3)], [(.5, 1.25)])
old_rule_children = [span for span in shown if includes(span, entry)]
new_rule_children = [span for span in shown if includes(span, witness)]
assert old_rule_children == []  # red control for the removed assumption
assert len(new_rule_children) == 1 and new_rule_children[0] == (1.25, 3)
ids = [11 if includes(span, witness) else -1 for span in shown]
assert ids == [11]
assert verdict(entry) != 'contact'  # entry's decided bit must remain false

# Multiple cuts of one raw row: origin alone collides, left certificate doesn't.
origin = ('held-generation', 'program', 'A-B', 7, 0)
cuts = [('clear-row-21', (1.25, 1.75)), ('clear-row-22', (3.25, 3.75))]
pieces = cut_open([(0, 5)], [span for _, span in cuts])
left_keys = ['begin'] + [key for key, _ in cuts]
keys = [(origin, left) for left in left_keys]
assert len(set(keys)) == len(pieces) == 3
witness_multi = 4.5  # deliberately last child, not the first/refined onset
bindings = {}
next_id = 12

def identify():
    global next_id
    values = []
    for piece, key in zip(pieces, keys):
        if includes(piece, witness_multi):
            value = 11
        else:
            if key not in bindings:
                bindings[key] = next_id
                next_id += 1
            value = bindings[key]
        values.append(value)
    return values

first_ids, repeat_ids = identify(), identify()
assert first_ids == repeat_ids == [12, 13, 11]
assert first_ids.count(11) == 1 and len(set(first_ids)) == 3
assert pieces[first_ids.index(11)] == (3.75, 5)
assert list(reversed(list(reversed(first_ids)))) == first_ids

# Previous positive/negative evidence controls remain valid.
r140 = cut_open([(0, 1), (1.001, 2), (0, 2)], [(1, 1.001)])
assert len(r140) == 2 and not any(includes(s, 1.0005) for s in r140)
r141 = cut_open([(0, 1), (1.4, 1.6), (2, 3), (0, 1), (2, 3)],
                 [(1, 1.25), (1.35, 1.4), (1.6, 1.65), (1.75, 2)])
assert any(includes(s, 1.5) for s in r141)

# Strict radius edge and downward storage; no outward rounding permitted.
values = [.1, .5, 1e-8, 1e-4, .375, 12.3456789, 100.1]
rounded = [{'r': r, 'stored': f32_down(r)} for r in values]
assert all(0 <= row['stored'] <= row['r'] for row in rounded)
assert f32_down(.1) < .1  # default binary32 rounding would round .1 upward
assert not free_at(1.5, .5, (0, 3), 1.0)
assert not free_at(1.5, .5, (0, 3), 2.0)
assert free_at(1.5, .5, (0, 3), 1.5)
assert not free_at(1.5, 100, (1, 2), .9)
assert free_at(1.5, math.inf, (1, 2), 1.9)  # V=0: known section only
assert not free_at(1.5, math.inf, (1, 2), 2.1)

E, I, G, K = 65536, 262144, 16384, 8
T = E*46 + I*45 + G*21 + (E+I+G) + K*4096*(46+45+21+3)
index = 2*(E+I)*4*2*9//8 + 2*I*4*9//8 + 8192*16
assert T <= 19_300_000
assert 6*T*9//8 + index <= 139_000_000

print(json.dumps({
    'scope': 'Analytic plan-contract checks only; no product implementation executed.',
    'r142_witness_fix': {'conservative_entry': entry, 'entry_decided': False,
                         'witness': witness, 'witness_decided': True,
                         'shown': shown, 'old_rule_matching_children': len(old_rule_children),
                         'new_rule_matching_children': len(new_rule_children),
                         'selected_id': 11, 'ids': ids},
    'multiple_cuts': {'pieces': pieces, 'keys': keys, 'witness': witness_multi,
                      'ids': first_ids, 'unchanged_delta_ids': repeat_ids,
                      'forward_navigation': first_ids, 'backward_navigation': first_ids[::-1],
                      'selected_piece': pieces[first_ids.index(11)]},
    'r140_control': r140, 'r141_control': r141,
    'free_radius': {'inward_rounding': rounded, 'open_edges_retained': True,
                    'section_clipped': True, 'zero_speed_confined_to_section': True},
    'capacity': {'table_holder_bytes': T, 'derived_bytes': index,
                 'six_main_six_side_derived_bytes': 6*T*9//8+index},
    'all_assertions_passed': True,
}, indent=2))
