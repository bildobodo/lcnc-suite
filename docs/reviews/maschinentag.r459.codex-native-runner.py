import ast, hashlib, json, os, pathlib, subprocess, sys
r = pathlib.Path('/tmp/r459')
gw = r/'tree/lcnc-gateway'
env = dict(os.environ)
env.pop('PYTHONPATH', None)
def run(argv, log, cwd=gw):
    p = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True)
    (r/log).write_text(p.stdout+p.stderr)
    print(log, 'rc', p.returncode, flush=True)
    assert p.returncode == 0, log
    return p
run([sys.executable, '-m', 'unittest', '-v',
     'test_start_dep_worker.TestTheReadBelongsToTheFirstPoint',
     'test_start_dep_worker.TestTheBelievedStartUnderFixtures'], 'native-tests.txt')
names = json.loads((r/'out/meta.json').read_text())
observations = {}
for name in names:
    p = run([sys.executable, str(gw/'codex_r459_native_probe.py'), name,
             str(r/'out'/f'{name}.head.msgpack')], f'out/{name}.txt')
    rows = [line for line in p.stdout.splitlines() if line.startswith('{')]
    obs = json.loads(rows[-1])
    assert not any(obs.get(k) for k in ('skip', 'error', 'parse_error')), (name, obs)
    assert obs['mmap_unchanged'], name
    observations[name] = obs
(r/'native-observations.json').write_text(json.dumps(observations, indent=2))
mod = ast.parse((r/'tree/scripts/gen_start_dep_payloads.py').read_text())
cases = next(ast.literal_eval(n.value) for n in mod.body if isinstance(n, ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CASES' for t in n.targets))
fresh=[]
for name in cases[-13:]:
    out=r/'out'/f'{name}.fresh.msgpack'
    p=run([sys.executable, str(gw/'native_start_probe.py'), name, str(out)], f'out/{name}.fresh.txt')
    obs=json.loads([line for line in p.stdout.splitlines() if line.startswith('{')][-1])
    assert not any(obs.get(k) for k in ('skip','error','parse_error')), name
    stored=r/'tree/scripts/test_fixtures/start_dep_payloads'/f'{name}.msgpack'
    rec={'case':name,'equal':out.read_bytes()==stored.read_bytes(),
         'fresh_sha256':hashlib.sha256(out.read_bytes()).hexdigest(),
         'stored_sha256':hashlib.sha256(stored.read_bytes()).hexdigest()}
    fresh.append(rec)
(r/'freshness.json').write_text(json.dumps(fresh,indent=2))
assert all(row['equal'] for row in fresh), fresh
print('All 21 independent native parses and 13 current fixture comparisons PASS',flush=True)
