"""R443: arithmetic models of plan v5 and a consistent next-counter contract.

No product functions, files, controller, or browser are exercised. The second
model is a review proposal, not an implementation or a product-gate result.
"""
import json

MAX = 9_999_999


def literal_v5(disk_next, memory_last):
    assert type(disk_next) is int and 1 <= disk_next <= MAX
    n = max(disk_next, memory_last) + 1
    stored = n + 1
    return {'read_next': disk_next, 'memory_last': memory_last,
            'allocated_N': n, 'written_next': stored,
            'N_in_wire_range': 1 <= n <= MAX,
            'next_accepted_by_v5_reader': 1 <= stored <= MAX}


def suggested(disk_next, memory_last):
    if type(disk_next) is not int or not 1 <= disk_next <= MAX + 1:
        return {'outcome': 'invalid', 'allocated_N': None, 'write': False}
    n = max(disk_next, memory_last + 1)
    if n > MAX:
        return {'outcome': 'exhausted', 'allocated_N': None, 'write': False}
    return {'outcome': 'reserved', 'allocated_N': n, 'written_next': n + 1, 'write': True}


rows = []
disk, memory = 1, 0
for _ in range(3):
    row = literal_v5(disk, memory)
    rows.append(row)
    disk, memory = row['written_next'], row['allocated_N']
assert [r['allocated_N'] for r in rows] == [2, 4, 6]

last = literal_v5(MAX - 1, 0)
assert last['allocated_N'] == MAX
assert not last['next_accepted_by_v5_reader']
past_last = literal_v5(MAX, 0)
assert not past_last['N_in_wire_range']

proposal = []
for label, disk, memory, outcome, token in [
    ('initial', 1, 0, 'reserved', 1),
    ('after_first_reservation', 2, 1, 'reserved', 2),
    ('restart_after_reserved_but_unsent_1', 2, 0, 'reserved', 2),
    ('memory_high_water', 2, 7, 'reserved', 8),
    ('last_usable_token', MAX, MAX - 1, 'reserved', MAX),
    ('restart_after_last', MAX + 1, 0, 'exhausted', None),
    ('memory_exhausted', 1, MAX, 'exhausted', None),
    ('fraction_refused', 1.2, 0, 'invalid', None),
    ('bool_refused', True, 0, 'invalid', None),
    ('negative_refused', -1, 0, 'invalid', None),
    ('string_refused', '1', 0, 'invalid', None),
]:
    result = suggested(disk, memory)
    assert result['outcome'] == outcome and result['allocated_N'] == token, label
    proposal.append({'case': label, 'disk_next': disk, 'memory_last': memory, **result})

print(json.dumps({
    'round': 'R443', 'scope': 'Plan arithmetic only; no product/native execution',
    'plan_lines': 'maschinentag.r443.p5-plan-v5.md:71,73,75,76,95',
    'literal_v5_initial_sequence': rows,
    'literal_v5_at_last_allocation': last,
    'literal_v5_at_maximum_valid_next': past_last,
    'interpretation_limit': 'A separate N-range guard could refuse the out-of-range case, but cannot make the persisted MAX+1 readable under the stated v5 file range.',
    'suggested_next_contract': proposal,
}, indent=2))
