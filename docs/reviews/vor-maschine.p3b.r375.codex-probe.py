"""R375 offline plan witnesses. No gateway import, sockets, signals or HAL.

Usage: python3 r375-plan-probes.py ARCHIVE_ROOT OUT_JSON
The stale-cache witness executes the source's existing pure state machine
and its two reader accessors, extracted without importing HalBridge.
The timing examples are counterexamples to the proposed plan, not tests
of an implementation (R375 contains no implementation).
"""
import ast
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace

root, out = map(Path, sys.argv[1:])
gateway = root / 'lcnc-gateway'
sys.path.insert(0, str(gateway))
from gateway_util import evaluate_trip_latch

src = (gateway / 'hal_bridge.py').read_text()
tree = ast.parse(src)
cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'HalBridge')
names = {'reader_get', 'reader_is_stale'}
methods = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in names]
assert len(methods) == 2
ns = {'time': SimpleNamespace(monotonic=lambda: 3.0)}
exec(compile(ast.Module(body=methods, type_ignores=[]), str(gateway / 'hal_bridge.py'), 'exec'), ns)
state = SimpleNamespace(_reader_state=({'trip_latched': True}, 0.0), _stale_sec=2.0)
value = ns['reader_get'](state, 'trip_latched')
stale = ns['reader_is_stale'](state)
before = evaluate_trip_latch(False, None, False)
existing = evaluate_trip_latch(value, before['last_latched'], before['baseline_seen'])
planned_null = evaluate_trip_latch(None, before['last_latched'], before['baseline_seen'])
assert stale is True and value is True
assert existing['tripped'] is True and planned_null['tripped'] is False

def point_class(t, cont_before, cont_after):
    return 'old' if t < cont_before else 'new' if t > cont_after else 'unresolved'

def interval_class(start, end, cont_before, cont_after):
    return 'old' if end < cont_before else 'new' if start > cont_after else 'unresolved'

read_begin, read_actual, read_end = 10.0, 10.25, 10.26
cont_before, cont_after = 10.1, 10.11
timing = {
    'snapshot_begin': read_begin, 'actual_latch_read': read_actual, 'snapshot_end': read_end,
    'cont_before': cont_before, 'cont_after': cont_after,
    'R375_class_from_begin': point_class(read_begin, cont_before, cont_after),
    'actual_read_position': point_class(read_actual, cont_before, cont_after),
    'class_with_read_interval': interval_class(read_begin, read_end, cont_before, cont_after),
    'cause': 'reader descheduled between snapshot timestamp and latch read',
}
assert timing['R375_class_from_begin'] == 'old'
assert timing['actual_read_position'] == 'new'
assert timing['class_with_read_interval'] == 'unresolved'
controls = [
    {'read_start': 9.9, 'read_end': 10.0, 'expected': 'old'},
    {'read_start': 10.2, 'read_end': 10.21, 'expected': 'new'},
]
for c in controls:
    c['actual'] = interval_class(c['read_start'], c['read_end'], cont_before, cont_after)
    assert c['actual'] == c['expected']

bad_clock = {'reader_t': 1000.0, 'received_t': 10.4, 'latched': False, 'safety_trip': None,
             'classified_before_validation': point_class(1000.0, cont_before, cont_after),
             'B6_valid': 1000.0 <= 10.4,
             'R375_FAIL_rule_if_applied_first': 'new frame without safety_trip',
             'required_interpretation': 'no proven new frame: invalid measurement time'}
assert bad_clock['classified_before_validation'] == 'new' and not bad_clock['B6_valid']

deadline = {'cont_before': 10.0, 'actual_SIGCONT': 10.01, 'cont_after': 10.4,
            'first_new_read': 10.41, 'first_new_received': 11.2, 'limit_s': 1.0}
deadline['delay_lower'] = round(deadline['first_new_received'] - deadline['cont_after'], 6)
deadline['delay_upper'] = round(deadline['first_new_received'] - deadline['cont_before'], 6)
deadline['actual_delay_in_this_witness'] = round(deadline['first_new_received'] - deadline['actual_SIGCONT'], 6)
deadline['R375_delay_test'] = 'PASS' if deadline['delay_lower'] <= deadline['limit_s'] else 'FAIL'
deadline['interval_verdict'] = 'incomplete: bracket straddles deadline'
assert deadline['delay_lower'] < 1 < deadline['delay_upper']
assert deadline['actual_delay_in_this_witness'] > 1 and deadline['R375_delay_test'] == 'PASS'

result = {
    'source_revision': 'd7431f199a510c662e5363035ea8e15d3656d787',
    'source_sha256': {n: hashlib.sha256((gateway / n).read_bytes()).hexdigest()
                      for n in ['hal_bridge.py', 'gateway_util.py', 'hal_reader.py', 'gateway.py']},
    'stale_cache': {'age': 3.0, 'stale_limit': 2.0, 'stale': stale,
                    'actual_input': value, 'current_decision': existing, 'null_input_decision': planned_null},
    'read_interval_counterexample': timing, 'interval_controls': controls,
    'judgement_order_counterexample': bad_clock,
    'resume_deadline_counterexample': deadline,
    'all_assertions_passed': True,
}
out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
