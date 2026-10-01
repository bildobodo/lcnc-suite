"""F6 plan probe, not a product implementation.
Usage: gateway-venv-python -B this.py /tmp/archive [evidence-directory].
Four native offline parses, then test each proposed removal condition.
"""
import json, os, shutil, struct, subprocess, sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
assert root.is_relative_to('/tmp')
outdir = Path(sys.argv[2]).resolve() if len(sys.argv)>2 else root/'evidence'
outdir.mkdir(exist_ok=True)
helper = root/'lcnc-gateway/_r57_native_case.py'
shutil.copyfile(Path(__file__).with_name('viewer-palette-fest.r57.native-case.py'), helper)
def remove_carry(rows, origins, source, seed):
    """All five F6 conditions; unknown origin/seed means retain."""
    if not rows or not origins or seed is None:
        return list(rows)
    row = rows[0]
    line = origins[0]
    lines = source.splitlines()
    known_line = isinstance(line, int) and 1 <= line <= len(lines)
    if (row[0] == 0 and known_line and lines[line-1].strip() == '%'
            and struct.pack('<3d', *row[1:4]) == struct.pack('<3d', *seed)
            and row[4] == -1):
        return rows[1:]
    return list(rows)

src = json.loads((root/'docs/reviews/viewer-palette-fest.plan-vp-i20.f6.native.json').read_text())
programs = {k: (v['program'], '0,0,10') for k,v in src['cases'].items()}
programs['percent_without_seed'] = (src['cases']['percent_g53']['program'], 'none')
env = dict(os.environ); env.pop('PYTHONPATH', None)
env.update(OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1')
cases = []
for name, (program, seed) in programs.items():
    prog = outdir/f'{name}.ngc'; prog.write_text(program)
    arr = outdir/f'{name}.npz'
    p = subprocess.run(['nice','-n','19',sys.executable,'-B',str(helper),str(prog),
                        'synthetic',seed,str(arr)],cwd=root/'lcnc-gateway',env=env,
                       text=True,capture_output=True,timeout=30)
    assert p.returncode == 0,(name,p.stdout,p.stderr)
    run = json.loads([s for s in p.stdout.splitlines() if s.startswith('{')][-1])
    assert not run['parse_error'],run
    payload = json.loads(Path(str(arr)+'.payload.json').read_text())
    origins = [v['lineno'] for v in run['events'] if v.get('lineno',0)>=1]
    rows = payload.get('tlo_events',[])
    assert len(origins)==len(rows), (name,origins,rows)
    kept = remove_carry(rows, origins, program, run['seed'])
    expected_removed = 1 if name in ('percent_g53','percent_g431') else 0
    assert len(rows)-len(kept)==expected_removed
    if name=='codex_r56': assert kept==[[0,0.,0.,0.,-1],[0,0.,0.,10.,-1]]
    if name=='percent_g431': assert kept==[[0,0.,0.,10.,-1]]
    cases.append({'case':name,'program':program,'run':run,'origins':origins,
                  'kept_rows':kept,'payload':payload})
    print(name,'origins',origins,'removed',expected_removed,'kept',kept)

# Individually violate each condition; none may remove a row.
carry = [0,0.,0.,10.,-1]
checks = [
 ('valid', [carry], [1], ' \t% \n', [0.,0.,10.], []),
 ('not_first', [[0,0.,0.,5.,-1],carry], [2,1], '%\nG43.1 Z5\n', [0.,0.,10.], [[0,0.,0.,5.,-1],carry]),
 ('not_seq_zero', [[1,0.,0.,10.,-1]], [1], '%\n', [0.,0.,10.], [[1,0.,0.,10.,-1]]),
 ('real_command', [carry], [2], '%\nG43.1 Z10\n', [0.,0.,10.], [carry]),
 ('unknown_origin', [carry], [None], '%\n', [0.,0.,10.], [carry]),
 ('different_vector', [carry], [1], '%\n', [0.,0.,20.], [carry]),
 ('different_vector_bits', [[0,-0.,0.,10.,-1]], [1], '%\n', [0.,0.,10.], [[0,-0.,0.,10.,-1]]),
 ('own_tool', [[0,0.,0.,10.,2]], [1], '%\n', [0.,0.,10.], [[0,0.,0.,10.,2]]),
 ('at_most_one', [carry,carry], [1,1], '%\n', [0.,0.,10.], [carry]),
 ('no_seed', [carry], [1], '%\n', None, [carry]),
]
unit=[]
for name,rows,origins,source,seed,expected in checks:
    actual=remove_carry(rows,origins,source,seed)
    assert actual==expected,name
    unit.append({'name':name,'rows':rows,'origins':origins,'source':source,
                 'seed':seed,'kept_rows':actual,'pass':True})
result={'commit':'06a15ef05cb79064410b905442881cd3fe7ab75e',
        'method':'Four fresh native offline parses of unchanged worker with proposed seed and event-origin logging. '
                 'F6 removal rule modeled in this probe; no product implementation exists yet. '
                 'Fake STAT, synthetic INI, commands rejected, nice 19 and one BLAS/OMP thread.',
        'cases':cases,'condition_checks':unit}
(outdir/'viewer-palette-fest.r57.probe.json').write_text(json.dumps(result,indent=2)+'\n')
print('PASS: four native parses and ten rule checks')
