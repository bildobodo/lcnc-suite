import json, os, subprocess
from pathlib import Path
root=Path('/tmp/r474/tree')
env=dict(os.environ,LCNC_LOG_DIR='/tmp/r474/probe-logs',PYTHONPATH=str(root/'lcnc-gateway'),PYTHONDONTWRITEBYTECODE='1',npm_config_cache='/tmp/r474/npm-cache',LCNC_E2E_WORKERS='1',LCNC_E2E_RUN='codex-r474-order',LCNC_E2E_EVENTS='/tmp/r474/probe-events.jsonl',LCNC_E2E_REPLAY_DIR='/tmp/r474/probe-replay',LCNC_E2E_HTTP_DIR='/tmp/r474/probe-http',LCNC_E2E_SELECTION='/tmp/r474/probe-selection.json')
Path('/tmp/r474/probe-selection.json').write_text(json.dumps(['codex-r474']))
for name,cwd,cmd in [('backend-probe',root/'lcnc-gateway',['/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python','-B','-m','pytest','-p','conftest','-o','addopts=','-q','-s','/tmp/r474/test_restart_order.py']),('browser-probe',root/'lcnc-webui',['npx','--no-install','playwright','test','-c','playwright.select.config.ts','--reporter=list'])]:
 with open('/tmp/r474/'+name+'.txt','w') as f:r=subprocess.run(cmd,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT)
 print(json.dumps({'step':name,'exit':r.returncode}),flush=True)
 if name=='backend-probe' and r.returncode:raise SystemExit(r.returncode)
