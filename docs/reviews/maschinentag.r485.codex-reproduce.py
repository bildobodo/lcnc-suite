"""R485: fresh archived base, read-only dependencies, synthetic Node only.
Usage: python3 this-file [node_modules]
Both executions acquire the common heavy lock. No timings are claimed.
"""
from pathlib import Path
import io,json,platform,subprocess,sys,tarfile,tempfile
out=Path(__file__).resolve().parent; repo=out.parent.parent
nm=Path(sys.argv[1] if len(sys.argv)>1 else '/home/cnc/lcnc-suite-p6c/lcnc-webui/node_modules').resolve()
work=Path(tempfile.mkdtemp(prefix='r485-repro-',dir='/tmp')); tree=work/'tree'; tree.mkdir(); probe=work/'probe'; probe.mkdir()
raw=subprocess.check_output(['git','archive','24f3bd3a','lcnc-webui/src','examples/sim_config/xyz3/tool.seed.json','examples/sim_config/xyz3/tool.tbl','scripts/test_support/heavy_lock.py'],cwd=repo)
with tarfile.open(fileobj=io.BytesIO(raw)) as t:t.extractall(tree,filter='data')
for p in (out/'maschinentag.r485.codex-scratch').glob('*.ts'):
 (probe/p.name).write_text(p.read_text().replace('/tmp/r485/tree',str(tree)))
(probe/'codex.ts').write_bytes((out/'maschinentag.r485.codex-probe.ts').read_bytes())
arch='arm64' if platform.machine()=='aarch64' else 'x64'
for name in ['lathe8','codex']:
 subprocess.run([str(nm/f'@esbuild/linux-{arch}/bin/esbuild'),str(probe/f'{name}.ts'),'--bundle','--platform=node','--format=esm','--target=es2022',f'--outfile={probe/name}.mjs',f'--alias:three={nm}/three/build/three.module.js',f'--alias:three-mesh-bvh={nm}/three-mesh-bvh',f'--alias:@msgpack/msgpack={nm}/@msgpack/msgpack',f'--alias:vue={nm}/vue','--log-level=warning','--tsconfig-raw={}'],check=True)
 with (work/f'{name}.jsonl').open('w') as f,(work/f'{name}.stderr').open('w') as e:
  subprocess.run([sys.executable,'-I',str(tree/'scripts/test_support/heavy_lock.py'),'--who','codex-r485-reproduce','--wait','50','--','node',str(probe/f'{name}.mjs')],stdout=f,stderr=e,check=True)
for actual,expected in [('lathe8.jsonl','author-probe.jsonl'),('codex.jsonl','probe.json')]:
 assert (work/actual).read_bytes()==(out/('maschinentag.r485.codex-'+expected)).read_bytes(),actual
print(json.dumps({'work':str(work),'author_probe':'identical','own_probe':'identical'}))
