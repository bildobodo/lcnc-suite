import json
import os
import subprocess
from pathlib import Path

root = Path('/tmp/r469/tree')
env = dict(os.environ, LCNC_LOG_DIR='/tmp/r469/logs', PYTHONDONTWRITEBYTECODE='1',
           npm_config_cache='/tmp/r469/npm-cache', LCNC_E2E_WORKERS='1',
           LCNC_E2E_RUN='codex-r469-existing', LCNC_E2E_EVENTS='/tmp/r469/events.jsonl',
           LCNC_E2E_REPLAY_DIR='/tmp/r469/replay', LCNC_E2E_HTTP_DIR='/tmp/r469/http',
           LCNC_E2E_SELECTION='/tmp/r469/selection.json')
Path('/tmp/r469/selection.json').write_text(json.dumps(['collisions.viewer', 'program-header.viewer']))
steps = [
 ('backend', root/'lcnc-gateway', ['/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python','-B','-m','unittest','-v','test_command_dispatch','test_button_gates_r208']),
 ('unit', root/'lcnc-webui', ['npm','run','test','--','src/viewer/checkBasis.test.ts','src/viewer/scrubBarWords.test.ts','src/ws/statusStore.test.ts']),
 ('build', root/'lcnc-webui', ['npm','run','build']),
 ('browser', root/'lcnc-webui', ['npx','--no-install','playwright','test','-c','playwright.select.config.ts','--grep','P6-d0','--reporter=list']),
]
for name, cwd, cmd in steps:
    if name == 'backend' and os.environ.get('R469_BACKEND_DONE'):
        continue
    with open(f'/tmp/r469/{name}.txt','w') as f:
        r=subprocess.run(cmd,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT)
    print(json.dumps({'step':name,'exit':r.returncode}),flush=True)
    if r.returncode: raise SystemExit(r.returncode)
