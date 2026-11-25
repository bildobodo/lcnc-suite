"""Reproduce R482 in a fresh /tmp archive; dependency trees are read-only.

python3 -B docs/reviews/maschinentag.r482.codex-reproduce.py [node_modules]
Geometry and memory execute under the common heavy lock. No live NML/HAL.
"""
from pathlib import Path
import io
import json
import subprocess
import sys
import tarfile
import tempfile

ev=Path(__file__).resolve().parent
repo=ev.parent.parent
nm=Path(sys.argv[1] if len(sys.argv)>1 else '/home/cnc/lcnc-suite-p6c/lcnc-webui/node_modules').resolve()
work=Path(tempfile.mkdtemp(prefix='r482-repro-')); tree=work/'tree'; tree.mkdir()
raw=subprocess.check_output(['git','archive','24f3bd3a','lcnc-webui/src','lcnc-gateway',
 'examples/sim_config/xyz3/tool.seed.json','examples/sim_config/xyz3/tool.tbl',
 'scripts/test_support/heavy_lock.py'],cwd=repo)
with tarfile.open(fileobj=io.BytesIO(raw)) as ar: ar.extractall(tree,filter='data')
p=work/'probe';p.mkdir()
for f in (ev/'maschinentag.r482.codex-scratch').glob('*.ts'):
 (p/f.name).write_text(f.read_text().replace('/tmp/r482/tree',str(tree)))
for source,target in [('geometry.ts','codex.ts'),('drawing-memory.ts','drawing-memory.ts')]:
 (p/target).write_text((ev/('maschinentag.r482.codex-'+source)).read_text().replace('/tmp/r482/tree',str(tree)))
exe=next(nm.glob('@esbuild/*/bin/esbuild'))
for name in ['codex','drawing-memory']:
 subprocess.check_call([str(exe),str(p/(name+'.ts')),'--bundle','--platform=node','--format=esm',
  '--target=es2022',f'--outfile={p/(name+".mjs")}',f'--alias:three={nm/"three/build/three.module.js"}',
  f'--alias:three-mesh-bvh={nm/"three-mesh-bvh"}',f'--alias:vue={nm/"vue"}',
  f'--alias:@msgpack/msgpack={nm/"@msgpack/msgpack"}','--log-level=warning','--tsconfig-raw={}'],cwd=work)
sys.path.insert(0,str(tree/'scripts/test_support'))
from heavy_lock import heavy_lock
checks={}
with heavy_lock('codex-r482-reproduction',wait=50):
 for name,program in [('geometry','codex'),('drawing-memory','drawing-memory')]:
  raw=subprocess.check_output(['node',str(p/(program+'.mjs'))],cwd=work,text=True)
  (work/(name+'.json')).write_text(raw)
  assert json.loads(raw)==json.loads((ev/('maschinentag.r482.codex-'+name+'.json')).read_text()),name
  checks[name]='identical'
subprocess.check_call(['python3','-B',str(ev/'maschinentag.r482.codex-fields.py'),str(tree),str(work/'fields.json')],cwd=work)
assert json.loads((work/'fields.json').read_text())==json.loads((ev/'maschinentag.r482.codex-fields.json').read_text())
checks['fields']='identical'
print(json.dumps({'work':str(work),'checks':checks},indent=2))
