import os, subprocess, json
from pathlib import Path
cwd='/tmp/r446/tree/lcnc-webui'
rows=[]
for name, cmd in [
 ('build',['npx','--no-install','vite','build']),
 ('browser',['npx','--no-install','playwright','test','e2e/collisions.viewer.spec.ts','--grep','P2b-1|P2b-2|R446 a fresh','--workers=1','--retries=0','--reporter=list,json'])]:
 print('START',name,flush=True)
 with open('/tmp/r446/'+name+'.txt','w') as f:
  p=subprocess.run(cmd,cwd=cwd,stdout=f,stderr=subprocess.STDOUT,env={**os.environ,'CI':'1','PLAYWRIGHT_JSON_OUTPUT_NAME':'/tmp/r446/browser-report.json','LCNC_E2E_RUN':'codex-r446-browser','LCNC_E2E_EVENTS':'/tmp/r446/browser-events.jsonl'})
 rows.append(dict(name=name,command=cmd,exit=p.returncode));print('END',name,p.returncode,flush=True)
 if name=='build' and p.returncode: break
Path('/tmp/r446/browser-results.json').write_text(json.dumps(rows,indent=2))
