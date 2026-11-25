import json, os, subprocess
from pathlib import Path
root=Path('/tmp/r470/tree')
env=dict(os.environ, LCNC_LOG_DIR='/tmp/r470/logs', PYTHONDONTWRITEBYTECODE='1', npm_config_cache='/tmp/r470/npm-cache', LCNC_E2E_WORKERS='1', LCNC_E2E_RUN='codex-r470-existing', LCNC_E2E_EVENTS='/tmp/r470/events.jsonl', LCNC_E2E_REPLAY_DIR='/tmp/r470/replay', LCNC_E2E_HTTP_DIR='/tmp/r470/http', LCNC_E2E_SELECTION='/tmp/r470/selection.json')
Path('/tmp/r470/selection.json').write_text(json.dumps(['probe-calibration']))
steps=[('backend',root/'lcnc-gateway',['/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python','-B','-m','unittest','-v','test_cal_runs','test_cal_gateway','test_probe_book','test_settings_store','test_status_runtime','test_cal_routines']),('unit',root/'lcnc-webui',['npm','run','test','--','src/calibrationView.test.ts','src/fieldState.test.ts','src/probeMachine.test.ts','src/ws/statusStore.test.ts','src/probeVarFiles.test.ts']),('build',root/'lcnc-webui',['npm','run','build']),('browser',root/'lcnc-webui',['npx','--no-install','playwright','test','-c','playwright.select.config.ts','--reporter=list'])]
for name,cwd,cmd in steps:
 with open('/tmp/r470/'+name+'.txt','w') as f:
  r=subprocess.run(cmd,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT)
 print(json.dumps({'step':name,'exit':r.returncode}),flush=True)
 if r.returncode: raise SystemExit(r.returncode)
