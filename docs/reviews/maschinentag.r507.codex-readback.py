#!/usr/bin/env python3
"""Read-only re-evaluation of Claude's R507 native reports; no controller I/O.

Run from /tmp. This is not a native test and does not replay its input scripts.
The modeled detector below covers ONLY the proposed G5x equality term: the
reports retain gcodes_5x, not the full gcodes/TLO vector for the G49 term.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path('/home/cnc/claude-work/start/step0/runs')
NAMES = ['20261126T112706-step0c', '20261126T114857-p1p3', '20261126T115523-p2']
G5X = {540: 1, 550: 2, 560: 3, 570: 4, 580: 5, 590: 6, 591: 7, 592: 8, 593: 9}


def contradiction(stat):
    codes = stat.get('gcodes_5x', [])
    if len(codes) != 1 or codes[0] not in G5X:
        return None
    return G5X[codes[0]] != stat.get('g5x_index')


reports = {}
out = {'kind': 'offline report audit, no new native run', 'runs': []}
for name in NAMES:
    p = ROOT / name / 'report.json'
    raw = p.read_bytes()
    d = json.loads(raw)
    reports[name] = d
    seq = d.get('p1p3', {}).get('seq', [])
    out['runs'].append({
        'path': str(p), 'sha256': hashlib.sha256(raw).hexdigest(),
        'commit': d.get('commit'), 'error': d.get('error'),
        'restore': d.get('restore'), 'crashes': d.get('crashes'),
        'states_with_g5x_contradiction': [
            {'seq': i, 'label': r['label']} for i, r in enumerate(seq)
            if 'stat' in r and contradiction(r['stat']) is True],
        'waits_without_publication': [
            {'seq': i, 'record': r} for i, r in enumerate(seq)
            if 'NO new publication' in r['label']],
    })

p2 = reports[NAMES[2]]['p1p3']['seq']
p13 = reports[NAMES[1]]['p1p3']['seq']
out['false_verified'] = {'before': p2[8], 'run': p2[9]}
assert p2[9]['run_basis']['verified'] is True
assert p2[9]['run_basis']['version'] == p2[8]['pub']['version'] == 1795690547
assert contradiction(p2[8]['stat']) is True
assert p2[8]['interp']['p5220'] == 1
assert p2[9]['sample']['machine_pos'][:2] == [10.0, 10.0]

out['touch_off'] = {'before': p13[24], 'write': p13[25], 'after': p13[26]}
assert p13[25]['reply']['index'] == 2
assert p13[24]['interp']['p5241'] == 50
assert p13[26]['interp']['p5241'] == 2.861907
assert p13[26]['stat']['row_g55'][0] == 50

out['equal_codes_do_not_restore_the_table'] = {
    'record': p13[28], 'modeled_g5x_contradiction': contradiction(p13[28]['stat']),
    'status_G55_X': p13[28]['stat']['row_g55'][0],
    'interpreter_G55_X': p13[28]['interp']['p5241'],
    'limit': 'No subsequent run selecting G55 was measured here; this proves a stale input, not that additional native run.',
}
assert contradiction(p13[28]['stat']) is False
assert p13[28]['stat']['tool_offset_z'] == 0
assert p13[28]['stat']['row_g55'][0] != p13[28]['interp']['p5241']
out['modal_after_abort'] = p13[38]
out['unfinished_home_control'] = p13[51:53]
out['observation_boundary'] = (
    'state() first records status, then sends an MDI DEBUG command to read the interpreter, '
    'then records status again. Those commands can cause a mode transition/synch; '
    'this is not simultaneous or passive interpreter sampling. The contradictory '
    'G5x values persist in stat_after_read; the discriminatory motion is separately recorded.'
)
print(json.dumps(out, ensure_ascii=False, indent=2))
