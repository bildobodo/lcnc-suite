import json,subprocess,os
from pathlib import Path
root=Path(__file__).resolve().parent.parent
rows=[];failures=[]
env=dict(os.environ);env.pop('PYTHONPATH',None)
for case in ['relative_after_g49','g49','restore','g53_then_incremental','unknown','g49_motion']:
 for offset in ([10,10.005] if case=='relative_after_g49' else [10,20]):
  p=subprocess.run(['nice','-n','19','/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python','-B','r53_native_case.py',case,str(offset)],cwd=root/'lcnc-gateway',env=env,text=True,capture_output=True,timeout=30)
  if p.returncode:
   failures.append({'case':case,'seed_z':offset,'returncode':p.returncode,'stdout':p.stdout,'stderr':p.stderr});continue
  data=json.loads([s for s in p.stdout.splitlines() if s.startswith('{')][-1]);rows.append(data)
result={'commit':'79771e678526a15564b90aee25884e6d6e710fe4','experiment':'Fassung 2 dependency, fresh native process with proposed G43.1 init','cases':rows,'failures':failures}
(root/'evidence/viewer-palette-fest.r53.native-probe.json').write_text(json.dumps(result,indent=2)+'\n')
for row in rows: print(json.dumps(row))
print('failures',json.dumps(failures))
