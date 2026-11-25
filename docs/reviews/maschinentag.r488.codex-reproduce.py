"""Run under scripts/test_support/heavy_lock.py, with an isolated base and node_modules copy.
Example: python3 this.py --base-tree /tmp/r487/base --node-modules /tmp/r487/tree/lcnc-webui/node_modules --out /tmp/r488-repeat
Base product: 24f3bd3a. No live or NML access; no writes to the source tree.
"""
import argparse,json,os,subprocess,shutil
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('--base-tree',type=Path,required=True);ap.add_argument('--node-modules',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args()
evidence=Path(__file__).resolve().parent;prefix='maschinentag.r488.codex-'
a.out.mkdir(parents=True,exist_ok=False);probe=a.out/'probe';probe.mkdir()
base=a.base_tree.resolve();node=a.node_modules.resolve();out=a.out.resolve();probe=probe.resolve()
shutil.copyfile(base/'lcnc-webui/src/viewer/collision.ts',probe/'collision.ts')
subprocess.run(['patch','-s','-p1','-i',str(evidence/(prefix+'variant.patch'))],cwd=probe,check=True)
(probe/'collision.ts').rename(probe/'coll_v.ts')
for name in ['fedpath2.ts','owncut.ts','lib.ts','q16.ts','q19.ts','probe.ts','pairs.ts']:
    target='codex.ts' if name=='probe.ts' else name
    shutil.copyfile(evidence/(prefix+name),probe/target)
for path in probe.glob('*.ts'):
    s=path.read_text().replace('/tmp/r488/probe/',str(probe)+'/').replace('/tmp/r487/base/',str(base)+'/')
    path.write_text(s)
env=dict(os.environ,CAP='1024',NODE_PATH=str(node))
es=node/'@esbuild/linux-arm64/bin/esbuild'
for name in ['codex','q16','q19','pairs']:
    subprocess.run([str(es),str(probe/(name+'.ts')),'--bundle','--platform=node','--format=esm','--log-level=warning','--alias:@coll='+str(probe/'coll_v.ts'),'--alias:@src='+str(base/'lcnc-webui/src/viewer'),'--outfile='+str(out/(name+'.mjs'))],env=env,check=True)
    with (out/(name+'.txt')).open('w') as f:
        subprocess.run(['node',str(out/(name+'.mjs'))],env=env,stdout=f,stderr=subprocess.STDOUT,check=True)
shutil.copyfile(evidence/(prefix+'check.py'),out/'check.py')
with (out/'check.txt').open('w') as f:subprocess.run(['python3',str(out/'check.py')],stdout=f,check=True)
print((out/'check.txt').read_text())
