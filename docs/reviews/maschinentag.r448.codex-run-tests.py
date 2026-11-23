import os, subprocess, json
from pathlib import Path
root=Path('/tmp/r448/tree'); out=Path('/tmp/r448')
py='/home/cnc/lcnc-suite-p2b/lcnc-gateway/.venv/bin/python'
commands=[
 ('backend',root/'lcnc-gateway',[py,'-B','-m','pytest','-q','-o','addopts=','-p','no:cacheprovider','test_calc_lifetime.py','test_calc_lifetime_gateway.py','test_calc_lifetime_wiring.py','test_controller_done.py','test_bulk_pipeline.py','test_preview_poll_chain.py','test_toolsetter_basis.py','--junitxml=/tmp/r448/backend.xml']),
 ('probes',root/'lcnc-gateway',[py,'-B','-m','pytest','-q','-o','addopts=','-p','no:cacheprovider','test_r446_codex.py','test_r447_codex.py','test_r448_codex.py','--junitxml=/tmp/r448/probes.xml']),
]
rows=[]
for name,cwd,cmd in commands:
 print('START',name,flush=True)
 with (out/(name+'.txt')).open('w') as log:
  r=subprocess.run(cmd,cwd=cwd,stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
 rows.append(dict(name=name,cwd=str(cwd),cmd=cmd,exit=r.returncode))
 print('END',name,r.returncode,flush=True)
(out/'results.json').write_text(json.dumps(rows,indent=2))
