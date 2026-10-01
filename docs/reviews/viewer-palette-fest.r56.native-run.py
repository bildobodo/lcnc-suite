"""R56 plan controls, offline only. Run with the gateway venv Python.
Usage: this.py /tmp/archive [evidence directory]. Fresh process per parse.
"""
import json, os, shutil, subprocess, sys
from pathlib import Path
import numpy as np
root = Path(sys.argv[1]).resolve()
assert root.is_relative_to('/tmp')
outdir = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else root / 'evidence'
outdir.mkdir(exist_ok=True)
helper = root / 'lcnc-gateway/_r56_native_case.py'
shutil.copyfile(Path(__file__).with_name('viewer-palette-fest.r56.native-case.py'), helper)
old = json.loads((root / 'docs/reviews/viewer-palette-fest.r55.native-probe.json').read_text())
original = next(c for c in old['cases'] if c['case'] == 'g53_same_machine')
programs = {
 'g49_then_restore_seed': ('G21 G90\nG49\nG43.1 Z10\nG0 X0 Y0 Z0\nG0 X10 Y0 Z0\nM2\n', [10,20]),
 'percent_g53': ('%\n'+original['program']+'%\n', [10,20]),
 'g49_first': ('G21 G90\nG49\nG0 X0 Y0 Z0\nG0 X10 Y0 Z0\nM2\n', [10,20]),
 'absolute_g43_seed': ('G21 G90\nG43.1 Z10\nG53 G0 X0 Y0 Z0\nG53 G0 X10 Y0 Z0\nM2\n', [10,20]),
 'absolute_g49_seed': ('G21 G90\nG49\nG0 X0 Y0 Z0\nG0 X10 Y0 Z0\nM2\n', [0,20]),
}
env = dict(os.environ); env.pop('PYTHONPATH', None)
env.update(OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1')
cases = [original]
for name, (program, seeds) in programs.items():
    prog = outdir / f'{name}.ngc'; prog.write_text(program)
    runs = []
    for z in seeds:
        arr = outdir / f'{name}.{z}.npz'
        p = subprocess.run(['nice', '-n', '19', sys.executable, '-B', str(helper), str(prog),
                            'synthetic', f'0,0,{z}', str(arr)], cwd=root/'lcnc-gateway',
                           env=env, text=True, capture_output=True, timeout=30)
        assert p.returncode == 0, (name, z, p.stdout, p.stderr)
        run = json.loads([l for l in p.stdout.splitlines() if l.startswith('{')][-1])
        assert not run['parse_error'], run
        with np.load(arr) as data: run['canon'] = {k: data[k].tolist() for k in data.files}
        run['payload'] = json.loads(Path(str(arr)+'.payload.json').read_text())
        runs.append(run)
    cases.append({'case': name, 'program': program, 'runs': runs})
    print(name, [r['tlo_events'] for r in runs])
result = {'commit': '89867aa0362c0fb039cd21eae572729986c81594',
          'method': '10 fresh native offline parses at nice 19; fake STAT/INI, commands forbidden. '
                    'Original G53 pair reused unchanged from R55 (product source unchanged). '
                    'Current worker plus proposed start seed; no product F5 implementation yet.', 'cases': cases}
(outdir/'viewer-palette-fest.r56.native-probe.json').write_text(json.dumps(result,indent=2)+'\n')
print('PASS: ten native control parses')
