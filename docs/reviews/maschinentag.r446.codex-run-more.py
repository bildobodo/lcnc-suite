import json, os, subprocess
from pathlib import Path
root=Path('/tmp/r446/tree')
commands=[
 ('backend-more',root/'lcnc-gateway',['/home/cnc/lcnc-suite-p2b/lcnc-gateway/.venv/bin/python','-B','-m','pytest','-q','-p','no:cacheprovider','test_r446_codex.py']),
 ('collision-variants',root/'lcnc-webui',['npx','--no-install','vitest','run','src/viewer/collision.test.ts','--testNamePattern','base tool|initialization checkpoints|TWP-07','--maxWorkers=1'])
]
r=[]
for n,cwd,cmd in commands:
 print('START',n,flush=True)
 with open('/tmp/r446/'+n+'.txt','w') as f:
  p=subprocess.run(cmd,cwd=cwd,stdout=f,stderr=subprocess.STDOUT,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
 r.append(dict(name=n,command=cmd,cwd=str(cwd),exit=p.returncode));print('END',n,p.returncode,flush=True)
Path('/tmp/r446/more-results.json').write_text(json.dumps(r,indent=2))
