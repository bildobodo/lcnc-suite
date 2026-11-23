import os, subprocess, json
from pathlib import Path
rows=[]
for name,cwd,cmd in [
 ('backend-final-probes','/tmp/r446/tree/lcnc-gateway',['/home/cnc/lcnc-suite-p2b/lcnc-gateway/.venv/bin/python','-B','-m','pytest','-p','no:cacheprovider','test_r446_codex.py','--junitxml=/tmp/r446/backend-final-probes.xml']),
 ('frontend-final-probes','/tmp/r446/tree/lcnc-webui',['npx','--no-install','vitest','run','src/viewer/r446.codex.test.ts','--maxWorkers=1'])]:
 print('START',name,flush=True)
 with open('/tmp/r446/'+name+'.txt','w') as f:
  p=subprocess.run(cmd,cwd=cwd,stdout=f,stderr=subprocess.STDOUT,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
 rows.append(dict(name=name,command=cmd,cwd=cwd,exit=p.returncode));print('END',name,p.returncode,flush=True)
Path('/tmp/r446/final-probes-results.json').write_text(json.dumps(rows,indent=2))
