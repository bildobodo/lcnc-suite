import os, json, subprocess
from pathlib import Path
root=Path('/tmp/r474/tree/lcnc-webui')
env=dict(os.environ,npm_config_cache='/tmp/r474/npm-cache',LCNC_E2E_WORKERS='1',LCNC_E2E_RUN='codex-r474-existing',LCNC_E2E_EVENTS='/tmp/r474/events.jsonl',LCNC_E2E_REPLAY_DIR='/tmp/r474/replay',LCNC_E2E_HTTP_DIR='/tmp/r474/http',LCNC_E2E_SELECTION='/tmp/r474/selection.json')
Path('/tmp/r474/selection.json').write_text(json.dumps(['tool-table-read','tool-import','codex-r472']))
for name,cmd in [('build',['npm','run','build']),('browser',['npx','--no-install','playwright','test','-c','playwright.select.config.ts','--reporter=list'])]:
    probes=list((root/'e2e').glob('codex-r47*.spec.ts')) if name=='build' else []
    for probe in probes: probe.rename(probe.with_suffix('.txt'))
    try:
        with open('/tmp/r474/'+name+'.txt','w') as f:
            r=subprocess.run(cmd,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
    finally:
        for probe in probes: probe.with_suffix('.txt').rename(probe)
    print(json.dumps({'step':name,'exit':r.returncode}),flush=True)
    if r.returncode: raise SystemExit(r.returncode)
