import json, os, subprocess
from pathlib import Path
root=Path('/tmp/r471/tree')
env=dict(os.environ, LCNC_LOG_DIR='/tmp/r471/logs', PYTHONDONTWRITEBYTECODE='1', npm_config_cache='/tmp/r471/npm-cache', LCNC_E2E_WORKERS='1', LCNC_E2E_RUN='codex-r471-existing', LCNC_E2E_EVENTS='/tmp/r471/events.jsonl', LCNC_E2E_REPLAY_DIR='/tmp/r471/replay', LCNC_E2E_HTTP_DIR='/tmp/r471/http', LCNC_E2E_SELECTION='/tmp/r471/selection.json')
steps=[('backend',root/'lcnc-gateway',['/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python','-B','-m','unittest','-v','test_tool_proof','test_tool_proof_gateway','test_tool_store','test_tool_table','test_tool_edit_contract','test_tool_refresh','test_tool_table_watch','test_button_gates_b_commit','test_codex_r468']),('unit',root/'lcnc-webui',['npm','run','test','--','src/toolTableRead.test.ts']),('build',root/'lcnc-webui',['npm','run','build']),('browser',root/'lcnc-webui',['npx','--no-install','playwright','test','-c','playwright.select.config.ts','--reporter=list'])]
for name,cwd,cmd in steps:
 with open('/tmp/r471/'+name+'.txt','w') as f:
  r=subprocess.run(cmd,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT)
 print(json.dumps({'step':name,'exit':r.returncode}),flush=True)
 if r.returncode: raise SystemExit(r.returncode)
