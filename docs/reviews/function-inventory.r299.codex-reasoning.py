"""R299: logical counterexamples to the written plan, not product tests.

Pure stdlib. No LinuxCNC, HAL, sockets, processes or machine commands.
Run: python3 -B function-inventory.r299.codex-reasoning.py
The simplified gate below implements ONLY the explicit new jog conditions;
it intentionally omits the old minimum-travel and 0.5 s requirements to
show why they must remain part of the planned .servo case contract.
"""
import json
import math

T = 0.001
BOUND = 50 ** 2 / (2 * 750) + 2 * 50 * 4 * T


def stated_jog_distance_conditions(trace):
    """Monotone path, <=1um spread for ten zero-velocity samples at end."""
    peak = trace[0][1]
    reverse = False
    for _, pos, _ in trace:
        reverse |= pos < peak - 0.001
        peak = max(peak, pos)
    tail = trace[-10:]
    stopped = all(v == 0 for _, _, v in tail) and max(p for _, p, _ in tail) - min(p for _, p, _ in tail) <= 0.001
    return {'brake_upper_mm': peak - trace[0][1], 'reverse': reverse,
            'ten_zero_samples': stopped, 'distance_conditions_pass':
            stopped and not reverse and peak - trace[0][1] <= BOUND}


# A normal jog has happened before the reply. Then deceleration from 50
# mm/s reaches a 0.01 mm/s creep; the creep persists to 1 s. Monotone and
# <2.067 mm, but not stopped within the agreed 0.5 s.
v0, a, creep, stop = 50.0, 750.0, 0.01, 1.0
decel_end = (v0 - creep) / a
def pose(t):
    if t <= decel_end:
        return 314.0 + v0*t - a*t*t/2, v0-a*t
    end = 314.0 + v0*decel_end - a*decel_end**2/2
    return end + creep*(min(t, stop)-decel_end), creep if t < stop else 0.0
slow = [(i*T, *pose(i*T)) for i in range(1011)]
late = stated_jog_distance_conditions(slow)
late.update(pre_reply_signed_travel_mm=14.0, first_zero_s=1.0,
            original_time_condition=False, required='not PASS: 0.5 s standstill requirement remains')
assert late['distance_conditions_pass'] and not late['original_time_condition']

# No jog at all: the new distance-only checks can all be satisfied.
idle = [(i*T, 300.0, 0.0) for i in range(21)]
none = stated_jog_distance_conditions(idle)
none.update(pre_reply_signed_travel_mm=0.0, original_minimum_travel_condition=False,
            required='not PASS: no observed movement of at least 5 mm in the commanded direction')
assert none['distance_conditions_pass']

# A complete first prefix says nothing about an unread suffix. Both streams
# have consecutive IDs, no overrun and a FIFO far below capacity. One suffix
# contains a restart, the other does not; the consumer's observations are
# identical until it drains to a known boundary of this attempt.
seen = [(n, 315.0, 0.0) for n in range(1001)]
good_tail = [(n, 315.0, 0.0) for n in range(1001, 1101)]
bad_tail = [(n, 315.0+(n-1000)*0.01, 10.0) for n in range(1001, 1101)]
assert all(b[0] == a[0]+1 for a,b in zip(seen,seen[1:]))
assert seen + good_tail != seen + bad_tail
backlog = {'observed_first':seen[0][0], 'observed_last':seen[-1][0],
           'consecutive_observed_ids':True, 'overruns':0,
           'unread_samples':len(bad_tail), 'fifo_capacity':65536,
           'full':False, 'hidden_restart_mm':bad_tail[-1][1]-seen[-1][1],
           'same_observations_for_good_and_bad_suffix':True,
           'required':'drain through a source-visible end marker of this attempt before any PASS'}

# This does not invalidate the proposed pre-reply anchor: for a monotone
# complete trace, any earlier position yields a conservative upper bound.
positions = [(0.0, 5.0, 6.0), (10.0, 10.1, 12.0), (-5.0, -3.0, -2.0)]
for anchor, reply, end in positions:
    assert end-anchor >= end-reply

print(json.dumps({'model_only': True, 'bound_xy_mm':BOUND,
                  'late_creep':late, 'no_jog':none, 'unread_suffix':backlog,
                  'monotone_anchor_controls':len(positions)}, indent=2))
