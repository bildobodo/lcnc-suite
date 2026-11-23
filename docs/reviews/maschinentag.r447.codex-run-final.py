import os, subprocess, json
from pathlib import Path
cwd='/tmp/r447/tree/lcnc-webui'
rows=[]
for name, cmd in [
 ('backend-final-probes',['/home/cnc/lcnc-suite-p2b/lcnc-gateway/.venv/bin/python','-B','-m','pytest','-p','no:cacheprovider','-o','addopts=','-q','../lcnc-gateway/test_r447_codex.py','../lcnc-gateway/test_r446_codex.py','--junitxml=/tmp/r447/backend-final-probes.xml']),
 ('native-oracles',['/home/cnc/lcnc-suite-p2b/lcnc-gateway/.venv/bin/python','-B','-m','pytest','-p','no:cacheprovider','-o','addopts=','-q','../scripts/test_native_stage.py','-k','unload_during_a_parse or read_back_half or measure_row_says','--junitxml=/tmp/r447/native-oracles.xml']),
 ('build',['npx','--no-install','vite','build']),
 ('browser',['npx','--no-install','playwright','test','e2e/collisions.viewer.spec.ts','--grep','P2b-1|P2b-2|Codex R446 MT-I26','--workers=1','--retries=0','--reporter=list,json'])]:
 print('START',name,flush=True)
 with open('/tmp/r447/'+name+'.txt','w') as f:
  p=subprocess.run(cmd,cwd=cwd,stdout=f,stderr=subprocess.STDOUT,env={**os.environ,'CI':'1','PLAYWRIGHT_JSON_OUTPUT_NAME':'/tmp/r447/browser-report.json','LCNC_E2E_RUN':'codex-r447-browser','LCNC_E2E_EVENTS':'/tmp/r447/browser-events.jsonl'})
 rows.append(dict(name=name,command=cmd,exit=p.returncode));print('END',name,p.returncode,flush=True)
 if name=='build' and p.returncode: break
Path('/tmp/r447/browser-results.json').write_text(json.dumps(rows,indent=2))
