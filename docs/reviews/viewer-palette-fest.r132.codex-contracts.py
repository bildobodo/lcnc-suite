#!/usr/bin/env python3
"""R132 expectations over audit.py's native output. Deliberately exits 1 at
the reviewed commit when a plan contract fails; no product changes involved.
Usage: python3 contracts.py audit.json
"""
import json
import sys

r = json.load(open(sys.argv[1]))
checks = []

def check(name, condition, observed):
    checks.append({'check': name, 'status': 'PASS' if condition else 'FAIL', 'observed': observed})

for name, data in r.items():
    check('harness/' + name, 'rc' not in data and data.get('parse_error') is None
          and data.get('mmap_unchanged') is True,
          {k: data.get(k) for k in ('rc', 'parse_error', 'mmap_unchanged')})

for name, line in [('initial_read', 1), ('initial_named_read', 1), ('initial_read_with_modal', 1),
                   ('initial_read_blank', 2), ('initial_read_percent', 2), ('read_after_modal', 2)]:
    check('VP-I78/' + name, line in (r[name].get('position_read_lines') or []),
          {k: r[name].get(k) for k in ('rapid', 'rapid_dep', 'rapid_ustart', 'position_read_lines')})

for name in ('early_m6', 'early_m6_first'):
    event = next(e for e in r[name]['review_events'] if e['method'] == 'change_tool')
    check('VP-I79/' + name, not set(event['after']['dep']) & set(event['after']['stale']), event)

p = r['no_interp']
check('VP-I80/no_interp', p.get('parse_error') is not None or
      bool(p.get('probe_unpredicted')) or p.get('rapid_ustart') == [1, 1],
      {k: p.get(k) for k in ('rapid_dep', 'rapid_ustart', 'probe_unpredicted', 'parse_error')})

p = r['unknown_switchkins']
check('VP-I81/unknown_switchkins', not any(p.get('rapid_dep') or []) and p.get('rapid_ustart') == [1, 1],
      {k: p.get(k) for k in ('rapid_dep', 'rapid_ustart')})

p = r['g28_feed_second']
e = [e for e in p['review_events'] if e['method'] == '_dep_step'][-1]
check('VP-I82/g28_feed_second', set(e['after']['stale']) == {0, 1, 2}, e)

check('control/no_moving_M6_keeps_dep', r['early_m6_none']['rapid_dep'] == [3, 3, 3]
      and r['early_m6_none']['rapid_ustart'] == [1, 0, 0], r['early_m6_none']['rapid_dep'])
check('control/M6_after_known_has_no_dep', r['late_m6_control']['rapid_dep'] is None,
      r['late_m6_control']['rapid_dep'])
check('control/available_interpreter', r['interp_control']['rapid_dep'] == [3, 2],
      r['interp_control']['rapid_dep'])
check('control/read_in_first_motion_is_named', r['read_on_first_move']['position_read_lines'] == [1],
      r['read_on_first_move']['position_read_lines'])
check('control/g28_two_rapids', r['g28_rapid_control']['rapid_dep'] == [7, 0]
      and r['g28_rapid_control']['rapid_ustart'] == [1, 0], r['g28_rapid_control']['rapid_dep'])

failed = sum(c['status'] == 'FAIL' for c in checks)
print(json.dumps({'passed': len(checks) - failed, 'failed': failed, 'checks': checks}, indent=2))
sys.exit(bool(failed))
