from pathlib import Path
import json, subprocess

out=Path('/tmp/r501')
web=out/'tree/lcnc-webui'
records=[]
for name in ['shard','structure']:
    p=subprocess.run(['node',str(out/f'{name}-probe.mjs')],cwd=web,capture_output=True,text=True)
    (out/f'{name}-probe.json').write_text(p.stdout)
    records.append({'probe':name,'rc':p.returncode,'stderr':p.stderr})
    assert p.returncode==0,p.stderr
for name,expected,at in [('control',0,None),('zero',1,'the hand-over'),('whole',1,'the hand-over'),('publisher_zero',1,"the publisher's held generation")]:
    p=subprocess.run(['node','node_modules/vitest/vitest.mjs','run','--config','r501.coverage.config.ts',f'src/viewer/r501Coverage_{name}.test.ts'],cwd=web,capture_output=True,text=True,timeout=180)
    log=p.stdout+p.stderr
    (out/f'coverage-{name}.txt').write_text(log)
    records.append({'probe':f'coverage-{name}','rc':p.returncode,'expected_rc':expected,'expected_assertion':at,'assertion_seen':None if at is None else at in log})
    print(json.dumps(records[-1]),flush=True)
    assert p.returncode==expected,log
    if at is not None: assert at in log,log
(out/'probes.json').write_text(json.dumps(records,indent=2)+'\n')
