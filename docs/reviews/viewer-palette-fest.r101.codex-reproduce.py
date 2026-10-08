"""R101 probes in an ALREADY CREATED git archive of 71724fc4 under /tmp.
Usage: python3 .../viewer-palette-fest.r101.codex-reproduce.py /tmp/.../archive
The archive needs its dependencies; see codex-checks.md. No live access/ports.
"""
from pathlib import Path
import sys, subprocess
arc=Path(sys.argv[1]).resolve(); assert arc.is_relative_to('/tmp') and not (arc/'.git').exists()
ui=arc/'lcnc-webui'; src=ui/'src/viewer'; ev=arc/'evidence'; ev.mkdir(exist_ok=True)
proof=Path(__file__).resolve().parent; prefix='viewer-palette-fest.r101.codex-'
original=(src/'collision.ts').read_bytes()
changes={
 'noCert':('const inCert = inClear[pi]! > 0 && s - inQ[pi]! < inClear[pi]! / Math.max(pairV[pi]!, 1e-9);','const inCert = false; // R101 control: query the surfaces and rays every time.'),
 'speedBound':('trans += dJ + (jointBulge[pd.dof.joint] ?? 0);','trans += dJ + 4 * (jointBulge[pd.dof.joint] ?? 0); // R101 derivative-bound control'),
}
created=[]
try:
 for name,(before,after) in changes.items():
  text=original.decode(); assert text.count(before)==1
  path=src/f'r101.{name}.ts'; assert not path.exists();path.write_text(text.replace(before,after));created.append(path)
 for name in ['refine','contracts','certificate','bulge']:
  path=src/f'r101.{name}.test.ts'; assert not path.exists();path.write_bytes((proof/(prefix+name+'.test.ts')).read_bytes());created.append(path)
 config=ui/'r101.reproduce.config.ts';assert not config.exists();created.append(config)
 config.write_text('import {defineConfig} from "vitest/config"; export default defineConfig({cacheDir:"../r101-reproduce-cache",test:{environment:"node",maxWorkers:1,testTimeout:240000,include:["src/**/*.test.ts"]}});\n')
 with (ev/(prefix+'rerun.txt')).open('w') as out:
  result=subprocess.run(['nice','-n','19','node','node_modules/vitest/vitest.mjs','run','--config',config.name,*[f'src/viewer/r101.{name}.test.ts' for name in ['refine','contracts','certificate','bulge']]],cwd=ui,stdout=out,stderr=subprocess.STDOUT)
 print('Vitest exit',result.returncode,'(reviewed version: 10 pass / 3 fail)')
finally:
 assert (src/'collision.ts').read_bytes()==original
 for path in created:path.unlink()
