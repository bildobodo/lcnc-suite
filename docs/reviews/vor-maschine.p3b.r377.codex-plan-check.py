"""Check the R377 plan's two amended rules and its corrected time example.

Usage: python3 r377-plan-check.py OUT_JSON
Pure arithmetic/type checks of a PLAN, not implementation tests.
"""
import json
from pathlib import Path
import sys

cases = []
for name, read0, read1, received, expected in [
    ('wide bracket', 9.0, 9.8, 10.0, False),
    ('short bracket', 9.79, 9.8, 10.0, True),
    ('age exactly 0.5', 9.5, 9.8, 10.0, True),
    ('age above 0.5', 9.49, 9.8, 10.0, False),
]:
    actual = received - read0 <= 0.5
    assert actual is expected
    cases.append({'name': name, 'age_interval': [round(received - read1, 6), round(received - read0, 6)],
                  'baseline_admitted': actual, 'expected': expected})

for name, frame, expected in [
    ('false', {'latched': False}, True),
    ('true', {'latched': True}, True),
    ('missing', {}, False),
    ('null', {'latched': None}, False),
    ('numeric zero', {'latched': 0}, False),
    ('numeric one', {'latched': 1}, False),
    ('string false', {'latched': 'false'}, False),
    ('array', {'latched': []}, False),
    ('object', {'latched': {}}, False),
]:
    actual = type(frame.get('latched')) is bool
    assert actual is expected
    cases.append({'name': 'latched ' + name, 'valid_latch_input': actual, 'expected': expected})

cont0, cont1 = 10.0, 10.4
read0, read1, arrival, pub, received = 10.41, 10.42, 10.43, 10.6, 11.2
assert read0 <= read1 <= arrival <= pub <= received
assert read0 > cont1
lower, upper = round(pub - cont1, 6), round(received - cont0, 6)
assert lower == 0.2 and upper == 1.2 and lower <= 1 < upper
cases.append({'name': 'corrected timing example', 'valid_time_order': True, 'class': 'new',
              'deadline_interval': [lower, upper], 'verdict': 'incomplete',
              'reason': 'deadline unproven, not an invalid timestamp order'})

result = {'plan_revision': '6491ff35', 'product_revision_unchanged': 'd7431f19',
          'scope': 'plan rules only; no product implementation exists in this round',
          'cases': cases, 'all_assertions_passed': True}
Path(sys.argv[1]).write_text(json.dumps(result, indent=2) + '\n')
print(f'{len(cases)} plan checks passed; no product, browser, network or HAL test executed')
