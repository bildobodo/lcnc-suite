import json, os, subprocess, time
from pathlib import Path
root=Path('/tmp/r466')
web=root/'tree/lcnc-webui'
env=os.environ.copy()
env.update(CI='1', LCNC_E2E_WORKERS='1', LCNC_E2E_RUN='codex-r466-'+str(time.time_ns()),
  LCNC_E2E_EVENTS=str(root/'events.jsonl'),LCNC_E2E_REPLAY_DIR=str(root/'replay'),LCNC_E2E_HTTP_DIR=str(root/'http'),
  PATH=str(web/'node_modules/.bin')+':'+env['PATH'])
results=[]
def run(name, args, cwd):
  print('START',name,flush=True)
  t=time.monotonic()
  with (root/(name+'.txt')).open('w') as f:
    r=subprocess.run(args,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT)
  item=dict(name=name,returncode=r.returncode,seconds=round(time.monotonic()-t,2))
  results.append(item)
  (root/'results.json').write_text(json.dumps(results,indent=2))
  print(json.dumps(item),flush=True)
  print((root/(name+'.txt')).read_text()[-5000:],flush=True)
  return r.returncode
run('native',['python3',str(root/'native.py')],root)
run('unit',['node','node_modules/vitest/vitest.mjs','run','src/viewer/programToolHeader.test.ts','src/viewer/checkContext.test.ts','src/viewer/r466.codex.test.ts','--maxWorkers=1'],web)
if run('build',['npm','run','build'],web)==0:
  run('browser',['node','node_modules/@playwright/test/cli.js','test','-c','playwright.gate.config.ts','program-header.viewer.spec.ts','--workers=1','--reporter=list'],web)
