"""Offline witnesses for the unimplemented R376 plan.

Usage: python3 r376-plan-probes.py OUT_JSON
No repository import, network access, HAL access or signals.
"""
import json
import math
from pathlib import Path
import sys

def finite_number(x):
    return type(x) in (float, int) and math.isfinite(x)

def listed_frame_conditions(f, epoch, previous_seq):
    """The conditions listed in R376, VM375-03 step 1, applied literally.
    The list does not yet require a Boolean latched field.
    """
    return (f['epoch'] == epoch
            and all(finite_number(f[k]) for k in ('read0', 'read1', 'arrival', 't_pub', 'received'))
            and f['read0'] <= f['read1'] <= f['arrival'] <= f['t_pub'] <= f['received']
            and type(f['gen']) is int and type(f['reader_seq']) is int
            and f['reader_seq'] >= previous_seq and f['stale'] is False)

baseline = {'epoch': 'e', 'read0': 9.0, 'read1': 9.8, 'arrival': 9.81,
            't_pub': 9.9, 'received': 10.0, 'gen': 1, 'reader_seq': 1,
            'stale': False, 'latched': False, 'safety_trip': None}
assert listed_frame_conditions(baseline, 'e', 0)
baseline_age = {'frame': baseline, 'actual_read_in_witness': 9.01, 'limit': 0.5,
                'age_lower': round(baseline['received'] - baseline['read1'], 6),
                'age_upper': round(baseline['received'] - baseline['read0'], 6),
                'actual_age_in_witness': round(baseline['received'] - 9.01, 6)}
baseline_age['R376_baseline_admitted'] = baseline_age['age_lower'] <= 0.5
baseline_age['baseline_age_proven'] = baseline_age['age_upper'] <= 0.5
assert baseline_age['R376_baseline_admitted'] and not baseline_age['baseline_age_proven']
assert baseline_age['actual_age_in_witness'] > 0.5

# A valid clean baseline can precede this frame. Its timing qualifies as new,
# but the latch read supplied no value. The listed conditions still accept it.
no_latch = {'epoch': 'e', 'read0': 10.2, 'read1': 10.21, 'arrival': 10.22,
            't_pub': 10.23, 'received': 10.24, 'gen': 2, 'reader_seq': 2,
            'stale': False, 'latched': None, 'safety_trip': {'id': 'e-1'}}
cont0, cont1 = 10.1, 10.11
missing_value = {'frame': no_latch, 'listed_validity': listed_frame_conditions(no_latch, 'e', 1),
                 'new_by_read_interval': no_latch['read0'] > cont1,
                 'deadline_upper': round(no_latch['received'] - cont0, 6),
                 'typed_latch_value_available': type(no_latch['latched']) is bool}
assert missing_value['listed_validity'] and missing_value['new_by_read_interval']
assert missing_value['deadline_upper'] <= 1.0 and not missing_value['typed_latch_value_available']

def deadline(cont0, cont1, pub, received):
    lower, upper = round(pub - cont1, 6), round(received - cont0, 6)
    verdict = 'PASS' if upper <= 1.0 else 'FAIL' if lower > 1.0 else 'incomplete'
    return {'cont': [cont0, cont1], 't_pub': pub, 'received': received,
            'lower': lower, 'upper': upper, 'verdict': verdict}

controls = {
    'timely': deadline(10.0, 10.01, 10.2, 10.3),
    'publication_late_no_prior_gap': deadline(10.0, 10.01, 11.2, 11.4),
    'receiver_delay_only': deadline(10.0, 10.01, 10.2, 12.0),
    'corrected_R376_example': deadline(10.0, 10.4, 10.6, 11.2),
}
assert [controls[k]['verdict'] for k in controls] == ['PASS', 'FAIL', 'incomplete', 'incomplete']
# The corrected example can be genuinely new AND pass the timestamp order.
assert 10.4 < 10.41 <= 10.42 <= 10.43 <= controls['corrected_R376_example']['t_pub']

answer = {'plan_revision': '1c6d05c1', 'kind': 'plan counterexamples, not implementation tests',
          'baseline_age': baseline_age, 'missing_latch_value': missing_value,
          'publication_bound_controls': controls, 'all_assertions_passed': True}
Path(sys.argv[1]).write_text(json.dumps(answer, indent=2) + '\n')
print(json.dumps(answer, indent=2))
