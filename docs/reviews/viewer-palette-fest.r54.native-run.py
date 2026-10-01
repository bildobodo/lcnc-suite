"""R54: reproduce F3's dependency classifier using a third, actual offset.

Usage: <gateway venv python> -B <this> <archive root> [evidence dir]
Run only against a git archive of aec5f38, never the live checkout.
The sibling native-case and compare evidence files are copied/imported here.
All processes use synthetic INI/STAT; no live state or commands permitted.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
assert root.is_relative_to('/tmp'), 'Use an archive in /tmp'
evidence = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else root / 'evidence'
evidence.mkdir(exist_ok=True)
here = Path(__file__).resolve().parent
helper = root / 'lcnc-gateway/_r54_native_case.py'
shutil.copyfile(here / 'viewer-palette-fest.r54.native-case.py', helper)
spec = importlib.util.spec_from_file_location('r54_compare', here / 'viewer-palette-fest.r54.compare.py')
compare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compare)
programs = {
    'nonlinear': 'G21 G90\nG0 X0 Y0 Z0\nG49\n#1=[#5422-10]\nG1 Z[49.999 + #1 * [1-#1]] F100\nM2\n',
    'branch_between_samples': 'G21 G90\nG0 X0 Y0 Z0\nG49\n#1=[#5422-10]\n#2=49.999\no100 if [[#1 GT 0.001] AND [#1 LT 0.009]]\n#2=50.009\no100 endif\nG1 Z#2 F100\nM2\n',
    'original_rest_b': 'G21 G90\nG0 X0 Y0 Z39.990\nG49\nG91\nG1 Z0.009 F100\nM2\n',
    'known_zero': 'G21 G90\nG0 X0 Y0 Z40\nG1 Z45 F100\nM2\n',
}
env = dict(os.environ)
env.pop('PYTHONPATH', None)
env.update(OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1')
results = []
for name, program in programs.items():
    prog = evidence / (name + '.ngc')
    prog.write_text(program)
    base = 0.0 if name == 'known_zero' else 10.0
    samples = [('base', base), ('shadow', base + 1.0), ('actual', base + 0.005)]
    runs = {}
    paths = {}
    for role, seed in samples:
        out = evidence / f'{name}.{role}.npz'
        p = subprocess.run(['nice', '-n', '19', sys.executable, '-B', str(helper),
                            str(prog), 'synthetic', f'0,0,{seed}', str(out)],
                           cwd=root / 'lcnc-gateway', env=env, text=True,
                           capture_output=True, timeout=30)
        assert p.returncode == 0, (name, role, p.returncode, p.stdout, p.stderr)
        run = json.loads([line for line in p.stdout.splitlines() if line.startswith('{')][-1])
        assert not run['parse_error'], run
        # Embed the complete, tiny point arrays rather than requiring binary evidence.
        with compare.np.load(out) as a:
            run['canon'] = {k: a[k].tolist() for k in a.files}
        runs[role] = run
        paths[role] = str(out)
    limits = {'X': [-500, 500], 'Y': [-500, 500], 'Z': [-500, 50]}
    diff = compare.classify(paths['base'], paths['shadow'], [0, 0, 1], limits)
    delta = 0.005
    # Positive-delta subset of F3 section D, sufficient for these four cases.
    coupled = any(axis['coupled'] for axis in diff.get('axes', {}).values())
    z = diff.get('axes', {}).get('Z', {})
    crosses_hi = z.get('slack_hi') is not None and delta > z['slack_hi']
    crosses_lo = z.get('over_lo') is not None and delta >= z['over_lo']
    redraw = z.get('dep', 0) > 0 and delta > 0.01
    trigger = not diff['aligned'] or coupled or crosses_hi or crosses_lo or redraw
    row = {'case': name, 'program': program, 'runs': runs, 'f3_classification': diff,
           'delta_z': delta, 'draw_eps': 0.01, 'plan_reparse_trigger': trigger,
           'actual_new_violations': runs['actual']['violations_total'] > runs['base']['violations_total']}
    results.append(row)
    print(json.dumps({k: v for k, v in row.items() if k not in ('runs', 'program')}), flush=True)
result = {'commit': 'aec5f38b7c9dd9d8f8180c7089828dff9c3a4fae',
          'method': '12 separate native offline parses; synthetic INI Z_MAX=50, fake STAT, commands rejected. '
                    'F3 helper only changed to reject non-synthetic INI. F3 classifier unchanged. '
                    'Reparse trigger models the positive delta subset of plan D; no product implementation exists yet.',
          'cases': results}
(evidence / 'viewer-palette-fest.r54.native-probe.json').write_text(json.dumps(result, indent=2) + '\n')
assert results[0]['actual_new_violations'] and not results[0]['plan_reparse_trigger']
assert results[1]['actual_new_violations'] and not results[1]['plan_reparse_trigger']
assert results[2]['actual_new_violations'] and results[2]['plan_reparse_trigger']
assert results[3]['f3_classification']['axes']['Z']['dep'] == 2
print('PASS: two missed-limit counterexamples and two positive controls; 12 native parses.')
