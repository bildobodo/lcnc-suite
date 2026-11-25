import os, json, subprocess
from pathlib import Path
root=Path('/tmp/r472/tree')
env=dict(os.environ, LCNC_LOG_DIR='/tmp/r472/probe-logs', PYTHONDONTWRITEBYTECODE='1', PYTHONPATH=str(root/'lcnc-gateway'), npm_config_cache='/tmp/r472/npm-cache', LCNC_E2E_WORKERS='1',LCNC_E2E_RUN='codex-r472-probe',LCNC_E2E_EVENTS='/tmp/r472/probe-events.jsonl',LCNC_E2E_REPLAY_DIR='/tmp/r472/probe-replay',LCNC_E2E_HTTP_DIR='/tmp/r472/probe-http',LCNC_E2E_SELECTION='/tmp/r472/probe-selection.json')
for name,cwd,cmd in [('backend-probe',root/'lcnc-gateway',['/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python','-B','-m','pytest','-p','conftest','-o','addopts=','-s','--junitxml=/tmp/r472/probe.xml','/tmp/r472/test_r472.py']),('browser-probe',root/'lcnc-webui',['npx','--no-install','playwright','test','-c','playwright.select.config.ts','--reporter=list'])]:
    with open('/tmp/r472/'+name+'.txt','w') as f: r=subprocess.run(cmd,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT)
    print(json.dumps({'step':name,'exit':r.returncode}),flush=True)
