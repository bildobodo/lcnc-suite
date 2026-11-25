import json, os, shutil, subprocess
from pathlib import Path
root=Path('/tmp/r475/tree/lcnc-webui')
env=dict(os.environ,npm_config_cache='/tmp/r475/npm-cache',LCNC_E2E_WORKERS='1',LCNC_E2E_RUN='codex-r475',LCNC_E2E_EVENTS='/tmp/r475/events.jsonl',LCNC_E2E_REPLAY_DIR='/tmp/r475/replay',LCNC_E2E_HTTP_DIR='/tmp/r475/http',LCNC_E2E_SELECTION='/tmp/r475/selection.json')
Path('/tmp/r475/selection.json').write_text(json.dumps(['tool-table-read','tool-import','codex-r472','codex-r474']))
for name,cmd in [('unit',['npm','run','test','--','src/toolTableRead.test.ts']),('build',['npm','run','build']),('browser',['npx','--no-install','playwright','test','-c','playwright.select.config.ts','--reporter=list'])]:
 if name=='browser':
  for round in ['r472','r474']:
   shutil.copyfile('/tmp/r475/'+round+'.spec.ts',root/'e2e'/('codex-'+round+'.spec.ts'))
 with open('/tmp/r475/'+name+'.txt','w') as f:
  r=subprocess.run(cmd,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
 print(json.dumps({'step':name,'exit':r.returncode}),flush=True)
 if r.returncode:raise SystemExit(r.returncode)
