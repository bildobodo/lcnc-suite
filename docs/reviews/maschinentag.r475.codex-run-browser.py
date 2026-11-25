import json, os, subprocess
from pathlib import Path
root=Path('/tmp/r475/tree/lcnc-webui')
env=dict(os.environ,npm_config_cache='/tmp/r475/npm-cache',LCNC_E2E_WORKERS='1',LCNC_E2E_RUN='codex-r475-repeat',LCNC_E2E_EVENTS='/tmp/r475/events-repeat.jsonl',LCNC_E2E_REPLAY_DIR='/tmp/r475/replay-repeat',LCNC_E2E_HTTP_DIR='/tmp/r475/http-repeat',LCNC_E2E_SELECTION='/tmp/r475/selection.json')
cmd=['npx','--no-install','playwright','test','-c','playwright.select.config.ts','--reporter=list']
with open('/tmp/r475/browser.txt','w') as f:
 r=subprocess.run(cmd,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
print(json.dumps({'step':'browser-repeat','exit':r.returncode}),flush=True)
raise SystemExit(r.returncode)
