#!/usr/bin/env python3
"""R309 plan review: read saved reports, inspect a pure existing classifier,
and exhibit two plan countermodels. No live access or product execution.
Usage: python3 -B r309-audit.py ARCHIVE LIVE_TIER_PARENT
"""
import ast
import hashlib
import json
from pathlib import Path
import sys

archive, parent = map(Path, sys.argv[1:3])
run = parent / '20261105T212704'
samples = [json.loads(s) for s in (run / 'servo-rfl.jsonl').read_text().splitlines()]
report = json.loads((run / 'report.json').read_text())
out = {'archive': str(archive), 'report_run': run.name, 'sha256': {}, 'rfl_lines': {}, 'phases': {}}
for path in [run / 'servo-rfl.jsonl', run / 'report.json']:
    out['sha256'][str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
sec = next(s for s in report['servo_sections'] if s['case'] == 'rfl')
assert len(samples) == sec['samples'] == 50356
assert all(b[1] == a[1] + 1 for a, b in zip(samples, samples[1:]))
assert sec['problems'] == []
out['section'] = {k: sec[k] for k in ('samples', 'first_n', 'end_n', 'start_mark', 'end_mark', 'problems')}
for line in (7, 8, 9):
    own = [s for s in samples if s[2][6] == line]
    out['rfl_lines'][line] = {'first': own[0], 'last': own[-1], 'samples': len(own),
                             'position_min_max': [(min(s[2][j] for s in own), max(s[2][j] for s in own))
                                                  for j in range(3)]}
for t, p in report['rfl_history']:
    i = next((i for i, s in enumerate(samples) if s[0] >= t), None)
    out['phases'][p['phase']] = {'receipt': t, 'before': samples[i-1] if i else None,
                                'after': samples[i] if i is not None else None}
first7 = out['rfl_lines'][7]['first']
out['running_receipt_after_first_line7_sample_ms'] = 1000 * (out['phases']['running']['receipt'] - first7[0])
assert out['running_receipt_after_first_line7_sample_ms'] > 80
pos_before = out['phases']['positioning']['before']
assert pos_before[2][3] > 0 and pos_before[2][0] > 0

# The existing production classifier explicitly accepts confirmed reads.
util = archive / 'lcnc-gateway/gateway_util.py'
tree = ast.parse(util.read_text())
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'toolsetter_basis_view']
keys = (3004, 3005, 3006, 3007, 3009, 3010, 3013, 3014, *range(3100, 3116))
ns = {'TOOLSETTER_BASIS_KEYS': keys}
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(util), 'exec'), ns)
out['basis_states'] = {}
for origin in ('applied', 'read', 'assumed', 'unknown'):
    basis = {k: {'value': 1.0 if origin != 'unknown' else None, 'origin': origin, 't': 1} for k in keys}
    out['basis_states'][origin] = ns['toolsetter_basis_view'](basis)
assert out['basis_states']['read']['state'] == 'confirmed'
assert out['basis_states']['assumed']['state'] == 'assumed'
partial = {k: {'value': 1.0, 'origin': 'applied', 't': 1} for k in keys}
partial[3004] = {'value': None, 'origin': 'unknown', 't': 1}
out['basis_states']['one_unknown'] = ns['toolsetter_basis_view'](partial)
assert out['basis_states']['one_unknown']['state'] == 'unknown'

# Countermodel of inferring capture phase from receipt order. Source truth
# is supplied ONLY to the model, not claimed for the saved run.
stream = [{'n': n, 'z': -20 if 50 <= n < 80 else 0, 'receipt': n / 1000} for n in range(40, 130)]
phase_source_n = 40
phase_receipt = .1
by_source = [s for s in stream if s['n'] >= phase_source_n and s['z'] < -.01]
by_receipt = [s for s in stream if s['receipt'] >= phase_receipt and s['z'] < -.01]
assert by_source and not by_receipt
out['phase_countermodel'] = {
    'kind': 'synthetic plan countermodel, no proposed evaluator executed',
    'source_boundary_n': phase_source_n, 'phase_receipt_s': phase_receipt,
    'wrong_z_samples_by_source': len(by_source), 'wrong_z_samples_after_receipt_cut': len(by_receipt),
    'explanation': 'A delayed phase message removes the already received post-measurement descent.'}

# Countermodel of choosing the last quiet interval: an already reached
# entry, an excursion, then the same entry again before line L.
trajectory = []
for n in range(50):
    if n < 10:
        x, v = 99 + .1*n, 1
    elif n < 20:
        x, v = 100, 0
    elif n < 30:
        x, v = 100 + .002*(n-19), 2
    elif n < 40:
        x, v = 100 + .002*(39-n), -2
    else:
        x, v = 100, 0
    trajectory.append({'n': n, 'x': x, 'v': v})
quiet = [i for i in range(len(trajectory)-9)
         if all(s['v'] == 0 and abs(s['x'] - 100) <= .001 for s in trajectory[i:i+10])]
first, last = quiet[0], quiet[-1]
bad_first = [s for s in trajectory[first:] if s['v'] != 0 or abs(s['x']-100) > .001]
bad_last = [s for s in trajectory[last:] if s['v'] != 0 or abs(s['x']-100) > .001]
assert first == 10 and last == 40 and bad_first and not bad_last
out['rest_countermodel'] = {'kind': 'synthetic plan countermodel, no proposed evaluator executed',
    'samples': trajectory, 'first_confirmed_rest_n': first, 'last_confirmed_rest_n': last,
    'violations_after_first': len(bad_first), 'violations_after_last': len(bad_last),
    'first_L_position': [100,100,0]}

# Read-only check of the native P2 experiment, no execution of its script.
p2 = parent / 'p2-20261105T213813'
red = json.loads((p2/'report.json').read_text())
rows = {r['case']: r for r in red['rows']}
assert rows['save-while-off']['reply']['ok'] is True
assert rows['interp-3102-after']['interp'] == red['setup']['interp']['3102'] == -180
measured = rows['program-m600']
assert measured['errors'] == []
old_target = red['setup']['t1_table']
new_target = old_target - 1
assert abs(measured['length']-old_target) < .01 and abs(measured['length']-new_target) > .9
out['p2_red'] = {'commit': red['commit'], 'old_target': old_target, 'new_target': new_target,
    'measured': measured['length'], 'residual_old': measured['length']-old_target,
    'residual_new': measured['length']-new_target, 'slow_feed': red['setup']['interp']['3005'],
    'sha256': hashlib.sha256((p2/'report.json').read_bytes()).hexdigest()}
for f in ('restore.json','restore-post.json'):
    restore = json.loads((p2/f).read_text())
    assert restore['outcome'] == 'complete' and restore['isolation'] == []
    out['p2_red'][f] = {k: restore.get(k) for k in ('outcome','isolation','cleanup','repeat_of')}
out['status'] = 'PASS (read-only audit and model assertions, not an implementation gate)'
print(json.dumps(out, indent=2, ensure_ascii=False))
