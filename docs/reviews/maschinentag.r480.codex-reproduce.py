"""R480 offline reproduction; all execution in a new /tmp archive.

No live gateway, browser, NML or machine action. Node dependencies are read
only. All probes run under the common heavy lock. No timing claim is made.
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
work=Path(tempfile.mkdtemp(prefix='r480-repro-'));tree=work/'tree';tree.mkdir()
data=subprocess.check_output(['git','archive','24f3bd3a','lcnc-webui/src','lcnc-gateway',
    'examples/sim_config/xyz3/tool.seed.json','examples/sim_config/xyz3/tool.tbl',
    'scripts/test_support/heavy_lock.py'],cwd=repo)
with tarfile.open(fileobj=io.BytesIO(data)) as ar: ar.extractall(tree,filter='data')
p=work/'probe';p.mkdir()
for src in (ev/'maschinentag.r480.codex-scratch').glob('*.ts'):
    (p/src.name).write_text(src.read_text().replace('/tmp/r480/tree',str(tree)))
for name,target in [('geometry.ts','codex.ts'),('variants.ts','variants.ts')]:
    (p/target).write_text((ev/('maschinentag.r480.codex-'+name)).read_text().replace('/tmp/r480/tree',str(tree)))
(work/'contracts.py').write_text((ev/'maschinentag.r480.codex-contracts.py').read_text().replace('/tmp/r480',str(work)))
exe=next(nm.glob('@esbuild/*/bin/esbuild'))
for name in ['codex','variants']:
    subprocess.check_call([str(exe),str(p/(name+'.ts')),'--bundle','--platform=node',
        '--format=esm','--target=es2022',f'--outfile={p/(name+".mjs")}',
        f'--alias:three={nm/"three/build/three.module.js"}',
        f'--alias:three-mesh-bvh={nm/"three-mesh-bvh"}',f'--alias:vue={nm/"vue"}',
        f'--alias:@msgpack/msgpack={nm/"@msgpack/msgpack"}',
        '--log-level=warning','--tsconfig-raw={}'],cwd=work)
sys.path.insert(0,str(tree/'scripts/test_support'))
from heavy_lock import heavy_lock
results={}
with heavy_lock('codex-r480-reproduction',wait=50):
    for name,cmd,saved in [
        ('geometry',['node',str(p/'codex.mjs')],'geometry.json'),
        ('variants',['node',str(p/'variants.mjs')],'variants.json'),
        ('contracts',['python3','-B',str(work/'contracts.py')],'contracts.json')]:
        raw=subprocess.check_output(cmd,cwd=work,text=True)
        (work/(name+'.json')).write_text(raw)
        equal=json.loads(raw)==json.loads((ev/('maschinentag.r480.codex-'+saved)).read_text())
        assert equal,name
        results[name]='identical'
print(json.dumps({'work':str(work),'results':results},indent=2))
