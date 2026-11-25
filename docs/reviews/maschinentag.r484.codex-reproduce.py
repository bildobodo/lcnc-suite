"""Reproduce R484 observations in a fresh /tmp archive. Never calls LinuxCNC.
Usage: python3 this-file [--repo REPO] [--deps NODE_MODULES]
The common heavy lock is acquired around each synthetic Node run.
"""
from pathlib import Path
import argparse, json, platform, shutil, subprocess, sys, tempfile
p=argparse.ArgumentParser()
p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[2])
p.add_argument('--deps',type=Path,default=Path('/home/cnc/lcnc-suite-sm/lcnc-webui/node_modules'))
a=p.parse_args()
evidence=Path(__file__).resolve().parent
work=Path(tempfile.mkdtemp(prefix='r484-repro-',dir='/tmp')); tree=work/'tree'; probe=work/'probe'
tree.mkdir(); probe.mkdir()
with (work/'base.tar').open('wb') as out:
 subprocess.run(['git','-C',str(a.repo),'archive','24f3bd3a7969e0d8bb0d8969285f08866f96a6d7'],stdout=out,check=True)
subprocess.run(['tar','-xf',str(work/'base.tar'),'-C',str(tree)],check=True)
shutil.copyfile(tree/'lcnc-webui/src/viewer/collision.ts',probe/'coll_v.ts')
subprocess.run(['patch','--batch','--fuzz=0','-p1','-i',str(evidence/'maschinentag.r484.codex-variant.patch')],cwd=probe,check=True)
for src,dst in [('probe.ts','codex.ts'),('pin.ts','pin.ts'),('owncut.ts','owncut.ts'),('lib.ts','lib.ts')]:
 shutil.copyfile(evidence/('maschinentag.r484.codex-'+src),probe/dst)
shutil.copyfile(evidence/'maschinentag.r484.codex-check.py',work/'check.py')
arch='arm64' if platform.machine()=='aarch64' else 'x64'
exe=a.deps/f'@esbuild/linux-{arch}/bin/esbuild'
for name,output in [('codex','probes.jsonl'),('pin','pin.txt')]:
 subprocess.run([str(exe),str(probe/f'{name}.ts'),'--bundle','--platform=node','--format=esm','--target=es2022',f'--outfile={probe/name}.mjs',f'--alias:@coll={probe}/coll_v.ts',f'--alias:@src={tree}/lcnc-webui/src/viewer',f'--alias:three={a.deps}/three/build/three.module.js',f'--alias:three-mesh-bvh={a.deps}/three-mesh-bvh',f'--alias:@msgpack/msgpack={a.deps}/@msgpack/msgpack',f'--alias:vue={a.deps}/vue','--log-level=warning','--tsconfig-raw={}'],check=True)
 with (work/output).open('w') as out, (work/f'{name}.stderr').open('w') as err:
  subprocess.run([sys.executable,'-I',str(tree/'scripts/test_support/heavy_lock.py'),'--who','codex-r484-reproduce','--wait','50','--','node',str(probe/f'{name}.mjs')],stdout=out,stderr=err,check=True)
subprocess.run([sys.executable,str(work/'check.py')],check=True)
print(work)
