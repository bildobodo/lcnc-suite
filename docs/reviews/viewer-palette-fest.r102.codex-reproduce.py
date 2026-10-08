"""R102 probes in an ALREADY CREATED git archive of e4a9f075 under /tmp.
Usage: python3 .../viewer-palette-fest.r102.codex-reproduce.py /tmp/.../archive
Dependencies and cache isolation: codex-checks.md. No live ports or commands.
"""
from pathlib import Path
import sys,subprocess,json
arc=Path(sys.argv[1]).resolve();assert arc.is_relative_to('/tmp') and not (arc/'.git').exists()
ui=arc/'lcnc-webui';src=ui/'src/viewer';ev=arc/'evidence';ev.mkdir(exist_ok=True)
proof=Path(__file__).resolve().parent;pre='viewer-palette-fest.r102.codex-'
original=(src/'collision.ts').read_bytes();created=[]
changes={
 'noCert':('const inCert = inClear[pi]! > 0 && s - inQ[pi]! < inClear[pi]! / Math.max(pairV[pi]!, 1e-9);','const inCert = false; // R102 control: query surfaces and rays.'),
 'speedBound':('trans += jointSpeedBound(dJ, jointBulge[pd.dof.joint] ?? 0);','trans += dJ + 4 * (jointBulge[pd.dof.joint] ?? 0); // R102: same formula inline'),
}
try:
 for name,(before,after) in changes.items():
  text=original.decode();assert text.count(before)==1
  path=src/f'r102.{name}.ts';assert not path.exists();path.write_text(text.replace(before,after));created.append(path)
 for name in ['refine','contracts','certificate','bulge','retention']:
  path=src/f'r102.{name}.test.ts';assert not path.exists();path.write_bytes((proof/(pre+name+'.test.ts')).read_bytes());created.append(path)
 config=ui/'r102.reproduce.config.ts';assert not config.exists();created.append(config)
 config.write_text('import {defineConfig} from "vitest/config";export default defineConfig({cacheDir:"../r102-reproduce-cache",test:{environment:"node",maxWorkers:1,testTimeout:240000,include:["src/**/*.test.ts"]}});\n')
 with (ev/(pre+'rerun.txt')).open('w') as out:
  result=subprocess.run(['nice','-n','19','node','node_modules/vitest/vitest.mjs','run','--config',config.name,*[f'src/viewer/r102.{name}.test.ts' for name in ['refine','contracts','certificate','bulge','retention']]],cwd=ui,stdout=out,stderr=subprocess.STDOUT)
 assert result.returncode==0,'See '+str(ev/(pre+'rerun.txt'))
 print('Vitest: 14 pass')
 gw=arc/'lcnc-gateway';native=gw/'r102.reproduce.native.py';assert not native.exists();created.append(native)
 s=(gw/'native_start_probe.py').read_text();needle='program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]'
 assert s.count(needle)==1;cases=json.loads((proof/(pre+'native-cases.json')).read_text())
 native.write_text(s.replace(needle,'CASES.update('+repr(cases)+')\n\n'+needle));outputs={}
 py='/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python'
 for name in cases:
  r=subprocess.run(['nice','-n','19',py,str(native),name],cwd=gw,capture_output=True,text=True,timeout=30)
  assert r.returncode==0,(name,r.stderr);o=json.loads(r.stdout);assert not o['parse_error']
  if name.startswith('g38'):
   assert o['feed'][-1][2]==-50
   assert o['rapid'][-1][0:2]==[0,-50] # #5070, #5063
  else:assert o['tlo_events'][-1][3]==10 # G43, no measurement
  outputs[name]=o
 (ev/(pre+'native-rerun.json')).write_text(json.dumps(outputs,indent=2)+'\n')
 print('Native synthetic inputs: 4 pass; command() prohibited')
finally:
 assert (src/'collision.ts').read_bytes()==original
 for path in created:path.unlink()
