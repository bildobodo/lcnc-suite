"""Offline audit of the preserved R413 observations, not a browser test."""
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent
prefix = 'leiste-achsen.r413.codex-'
def rows(name):
    return [json.loads(line) for line in (root/name).read_text().splitlines() if line]
supplied = [r for r in rows('leiste-achsen.r413.stage-b.jsonl') if r['variant'] == 'b2']
assert len(supplied) == 18
assert all(len(r['samples']) == 47 and not r['fail'] for r in supplied)
safety = [r for r in rows('leiste-achsen.r413.stage-b-safety.jsonl') if r['variant'] == 'b2']
assert len(safety) == 10
assert all(r['over'] == r['detailOver'] == 0 and r['stopInside'] and r['detailH'] == r['before']['h'] for r in safety)
tabs = rows(prefix+'tab.jsonl')
assert len(tabs) == 6 and sum(len(r['rows']) for r in tabs) == 404
assert all(not r['bad'] for r in tabs)
helpers = rows(prefix+'helper.jsonl')
assert len(helpers) == 12 and all(r['after']['keypad']['whole'] and r['snap']['reservedWhole'] for r in helpers)
control = rows(prefix+'select-control.jsonl')
assert len(control) == 2
off, on = sorted(control, key=lambda r: r['enabled'])
assert not off['enabled'] and off['delta'] == 0
assert on['enabled'] and on['delta'] == -83
assert on['held']['focusVisible'] and on['held']['active']
assert on['point']['x'] < on['held']['left']
occlusion = rows(prefix+'occlusion.jsonl')
assert {r['project'] for r in occlusion} == {'e2e', 'firefox-core'}
assert all(not r['hit']['isButtonOrChild'] and r['hit']['isAncestor'] and r['after']['stopOk'] and r['after']['estop'] for r in occlusion)
reports = {}
for name in ('chromium', 'firefox', 'mutation-chromium', 'mutation-firefox', 'initial-chromium'):
    reports[name] = json.loads((root/(prefix+name+'.json')).read_text())['stats']
assert [(reports[n]['expected'], reports[n]['unexpected']) for n in ('chromium', 'firefox', 'mutation-chromium', 'mutation-firefox')] == [(11,0),(10,1),(3,0),(1,2)]
print(json.dumps({
    'supplied': {'b2Cases': len(supplied), 'samplesPerCase': 47, 'safetyCases': len(safety),
                 'originalButtonHeights': sorted({r['safetyAfter'][0][3] for r in supplied}),
                 'fourthButtonHeights': sorted({r['stopH'] for r in safety})},
    'own': {'tabTraversals': len(tabs), 'focusedControls': 404, 'keypadEnvelopes': len(helpers),
            'predicateLimit': 'Tab/helper whole uses the supplied permissive ancestor rule; no independent occlusion proof',
            'selectListenerOffDelta': off['delta'], 'selectListenerOnDelta': on['delta'],
            'selectMovedOutsideHeldPress': True,
            'occludingAncestorStillAcceptedBy': [r['project'] for r in occlusion]},
    'reports': reports,
    'harnessErrors': 'Firefox select absent (1 presence failure + 2 timeouts); initial wrong Jog numeric owner interrupted. These are not product findings.',
    'audit': 'All recorded-counterexample assertions verified; no claim that the proposed contract passes.'
}, indent=2)+'\n')
