#!/usr/bin/env python3
"""R387: missing / borrowed browser witnesses must not certify other workers.

Read-only evaluation of the real runner and a saved, successful R387 run.
Usage: python3 this.py ARCHIVE saved-input.json > result.json
The input contains the original report/events of both the core and its guard.
No browser, port, gateway or machine command is used.
"""
import copy
import json
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root / 'scripts'))
from test_select import firefox, proof

data = json.loads(Path(sys.argv[2]).read_text())
answer = {'product': data['product'], 'source': data['source'], 'cases': []}
for phase in ('core', 'guard'):
    report, events, run = (data[phase][k] for k in ('report', 'events', 'run'))
    expected = sorted({r['workerIndex'] for r in proof.playwright_results(report).values()})
    first = expected[0]
    missing = expected[-1]
    cases = [
        ('baseline', copy.deepcopy(events)),
        ('one worker browser event missing', [e for e in events if not (e.get('event') == 'browser' and e.get('workerIndex') == missing)]),
        ('only first worker reports its browser', [e for e in events if e.get('event') != 'browser' or e.get('workerIndex') == first]),
        ('one browser event attributed to nonexistent worker 99', [dict(e, workerIndex=99) if e.get('event') == 'browser' else e for e in events if e.get('event') != 'browser' or e.get('workerIndex') == first]),
        ('no browser events (existing negative control)', [e for e in events if e.get('event') != 'browser']),
    ]
    if phase == 'guard':
        cases.append(('browser event from other run', [dict(e, run='not-this-guard') if e.get('event') == 'browser' else e for e in events]))
    for name, log in cases:
        browser_events = [e for e in log if e.get('event') == 'browser']
        # These are the real checks the core uses, and the actual guard graphics
        # selection in firefox.core (it derives its run ids FROM these events).
        # R388 adaptation (the only change): the checks now take the workers the report names
        problems = {'browser': firefox.check_browser(log, run, '160.0', set(expected)),
                    'graphics': firefox.check_graphics(log, run, set(expected)),
                    'workers': proof.check_workers(report, log, run)}
        if phase == 'guard':
            guard_runs = {e.get('run') for e in browser_events}
            problems['guard_judgment'] = firefox.judge_unload_guard(report, log, run)
            # R388 adaptation: what firefox.core now calls for the guard — its KNOWN run id and its report's workers
            _b, _g = firefox.browser_proofs([('guard', log, run, firefox.report_workers(report))], '160.0')
            problems['browser_as_core_calls_it_for_guard'] = _b
            problems['graphics_as_core_calls_it_for_guard'] = _g
        answer['cases'].append({'phase': phase, 'case': name, 'report_workers': expected,
                                'browser_witnesses': [{'worker': e.get('workerIndex'), 'run': e.get('run')} for e in browser_events],
                                'problems': problems})
print(json.dumps(answer, indent=2, ensure_ascii=False))
