"""R55 offline native evidence. Usage: <gateway venv python> -B this.py /tmp/archive [out-dir].
Copy this and the sibling native-case.py into an evidence directory first.
No real INI/STAT or commands; one fresh, nice-19 interpreter per sample.
"""
import json, os, shutil, subprocess, sys
from pathlib import Path
import numpy as np

root = Path(sys.argv[1]).resolve()
assert root.is_relative_to('/tmp')
outdir = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else root / 'evidence'
outdir.mkdir(exist_ok=True)
helper = root / 'lcnc-gateway/_r55_native_case.py'
shutil.copyfile(Path(__file__).with_name('viewer-palette-fest.r55.native-case.py'), helper)
programs = {
 'g53_same_machine': 'G21 G90\nG53 G0 X0 Y0 Z0\nG53 G0 X10 Y0 Z0\nG49\nG0 Z-40\nG0 Z40\nM2\n',
 'nonlinear': 'G21 G90\nG0 X0 Y0 Z0\nG49\n#1=[#5422-10]\nG1 Z[49.999 + #1 * [1-#1]] F100\nM2\n',
 'branch_between_samples': 'G21 G90\nG0 X0 Y0 Z0\nG49\n#1=[#5422-10]\n#2=49.999\no100 if [[#1 GT 0.001] AND [#1 LT 0.009]]\n#2=50.009\no100 endif\nG1 Z#2 F100\nM2\n',
 'original_rest_b': 'G21 G90\nG0 X0 Y0 Z39.990\nG49\nG91\nG1 Z0.009 F100\nM2\n',
}
env = dict(os.environ)
env.pop('PYTHONPATH', None)
env.update(OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1')
cases = []
for name, program in programs.items():
    prog = outdir / f'{name}.ngc'; prog.write_text(program)
    runs = []
    for z in ([10, 20] if name == 'g53_same_machine' else [10, 10.001, 10.005]):
        arr = outdir / f'{name}.{z}.npz'
        p = subprocess.run(['nice', '-n', '19', sys.executable, '-B', str(helper),
                            str(prog), 'synthetic', f'0,0,{z}', str(arr)],
                           cwd=root / 'lcnc-gateway', env=env, text=True,
                           capture_output=True, timeout=30)
        assert p.returncode == 0, (name, z, p.stdout, p.stderr)
        run = json.loads([l for l in p.stdout.splitlines() if l.startswith('{')][-1])
        assert not run['parse_error'], run
        with np.load(arr) as data:
            run['canon'] = {k: data[k].tolist() for k in data.files}
        run['payload'] = json.loads(Path(str(arr) + '.payload.json').read_text())
        runs.append(run)
    row = {'case': name, 'program': program, 'runs': runs}
    if name == 'g53_same_machine':
        a, b = runs
        row['raw_payload_differing_fields'] = sorted(k for k in a['payload'].keys() | b['payload'].keys()
                                                     if a['payload'].get(k) != b['payload'].get(k))
        row['all_canon_machine_points_and_structure_identical'] = a['canon'] == b['canon']
        assert row['raw_payload_differing_fields'] == ['rapid']
        assert row['all_canon_machine_points_and_structure_identical']
    else:
        assert [r['violations_total'] for r in runs] == [0, 0, 1]
    cases.append(row)
    print(name, [r['violations_total'] for r in runs], row.get('raw_payload_differing_fields', ''))
result = {'commit': '628451862cc2a6c7dba4f5f9492255dd7925e29c',
          'method': '11 separate offline native parses, synthetic XYZ mm INI with Z_MAX=50; '
                    'current worker plus proposed G43.1 start seed. No product equality function exists yet. '
                    'All payload bytes embedded as base64, all small canon arrays inline.', 'cases': cases}
(outdir / 'viewer-palette-fest.r55.native-probe.json').write_text(json.dumps(result, indent=2)+'\n')
print('PASS: R54/R53 controls and machine-equal G53 payload pair (11 native parses)')
