import json, os, subprocess
from pathlib import Path
root=Path('/tmp/r473/tree')
env=dict(os.environ, LCNC_LOG_DIR='/tmp/r473/logs', PYTHONDONTWRITEBYTECODE='1', PYTHONPATH=str(root/'lcnc-gateway'), npm_config_cache='/tmp/r473/npm-cache', LCNC_E2E_WORKERS='1', LCNC_E2E_RUN='codex-r473-existing', LCNC_E2E_EVENTS='/tmp/r473/events.jsonl', LCNC_E2E_REPLAY_DIR='/tmp/r473/replay', LCNC_E2E_HTTP_DIR='/tmp/r473/http', LCNC_E2E_SELECTION='/tmp/r473/selection.json')
Path('/tmp/r473/selection.json').write_text(json.dumps(['probe-calibration']))
steps=[('backend',root/'lcnc-gateway',['/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python','-B','-m','pytest','-p','conftest','-o','addopts=','-q','-s','--junitxml=/tmp/r473/backend.xml','test_cal_runs.py','test_cal_gateway.py','test_probe_book.py','test_settings_store.py','test_status_runtime.py','test_cal_routines.py','test_link_ownership.py','test_session_bind.py','/tmp/r473/test_r470.py']),('unit',root/'lcnc-webui',['npm','run','test','--','src/calibrationView.test.ts','src/fieldState.test.ts','src/probeMachine.test.ts','src/ws/statusStore.test.ts','src/probeVarFiles.test.ts']),('build',root/'lcnc-webui',['npm','run','build']),('browser',root/'lcnc-webui',['npx','--no-install','playwright','test','-c','playwright.select.config.ts','--reporter=list'])]
for name,cwd,cmd in steps:
 with open('/tmp/r473/'+name+'.txt','w') as f:
  r=subprocess.run(cmd,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT)
 print(json.dumps({'step':name,'exit':r.returncode}),flush=True)
 if r.returncode: raise SystemExit(r.returncode)
