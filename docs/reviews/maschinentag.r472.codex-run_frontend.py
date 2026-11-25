import os, json, subprocess
from pathlib import Path
root=Path('/tmp/r472/tree/lcnc-webui')
env=dict(os.environ,npm_config_cache='/tmp/r472/npm-cache',LCNC_E2E_WORKERS='1',LCNC_E2E_RUN='codex-r472-existing',LCNC_E2E_EVENTS='/tmp/r472/events.jsonl',LCNC_E2E_REPLAY_DIR='/tmp/r472/replay',LCNC_E2E_HTTP_DIR='/tmp/r472/http',LCNC_E2E_SELECTION='/tmp/r472/selection.json')
Path('/tmp/r472/selection.json').write_text(json.dumps(['tool-table-read','tool-import']))
for name,cmd in [('unit',['npm','run','test','--','src/toolTableRead.test.ts']),('build',['npm','run','build']),('browser',['npx','--no-install','playwright','test','-c','playwright.select.config.ts','--reporter=list'])]:
    with open('/tmp/r472/'+name+'.txt','w') as f:
        r=subprocess.run(cmd,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
    print(json.dumps({'step':name,'exit':r.returncode}),flush=True)
    if r.returncode: raise SystemExit(r.returncode)
