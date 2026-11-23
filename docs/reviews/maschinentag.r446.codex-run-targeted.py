import json, os, subprocess
from pathlib import Path
root = Path('/tmp/r446/tree')
out = Path('/tmp/r446')
py = '/home/cnc/lcnc-suite-p2b/lcnc-gateway/.venv/bin/python'
commands = [
 ('backend-existing', root/'lcnc-gateway', [py, '-B', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', 'test_calc_lifetime.py', 'test_calc_lifetime_gateway.py', 'test_calc_lifetime_wiring.py', 'test_controller_done.py', 'test_bulk_pipeline.py', 'test_preview_poll_chain.py', 'test_toolsetter_basis.py']),
 ('backend-counter', root/'lcnc-gateway', [py, '-B', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', 'test_r446_codex.py']),
 ('frontend-targeted', root/'lcnc-webui', ['npx', '--no-install', 'vitest', 'run', 'src/viewer/driftWait.test.ts', 'src/viewer/collisionModelKey.test.ts', 'src/viewer/collisionWorker.test.ts', 'src/viewer/r446.codex.test.ts', '--maxWorkers=1']),
]
results=[]
for name, cwd, cmd in commands:
 print('START', name, flush=True)
 with (out/(name+'.txt')).open('w') as f:
  p=subprocess.run(cmd, cwd=cwd, stdout=f, stderr=subprocess.STDOUT, env={**os.environ, 'PYTHONDONTWRITEBYTECODE':'1'})
 results.append(dict(name=name, command=cmd, cwd=str(cwd), exit=p.returncode))
 print('END', name, 'exit', p.returncode, flush=True)
(out/'targeted-results.json').write_text(json.dumps(results, indent=2))
