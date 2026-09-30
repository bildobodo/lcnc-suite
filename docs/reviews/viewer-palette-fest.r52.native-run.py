import json,subprocess,os
from pathlib import Path
root=Path(__file__).resolve().parent.parent
rows=[];failures=[]
env=dict(os.environ);env.pop('PYTHONPATH',None)
for case in ['inherit','g43','param','partial','additive','g49','g53','limit_near']:
 for offset in ([10,10.005] if case=='limit_near' else [10,20]):
  p=subprocess.run(['nice','-n','19','/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python','-B','r52_native_case.py',case,str(offset)],cwd=root/'lcnc-gateway',env=env,text=True,capture_output=True,timeout=30)
  if p.returncode:
   failures.append({'case':case,'seed_z':offset,'returncode':p.returncode,'stdout':p.stdout,'stderr':p.stderr});continue
  data=json.loads([s for s in p.stdout.splitlines() if s.startswith('{')][-1]);rows.append(data)
result={'commit':'650b6b625d2379a2ee180b823638efb42a741cb0','experiment':'proposed G43.1 init injection; actual worker and native interpreter','fresh_process_per_case':True,'cases':rows,'failures':failures}
(root/'evidence/viewer-palette-fest.r52.native-probe.json').write_text(json.dumps(result,indent=2)+'\n')
for row in rows: print(json.dumps(row))
print('failures',json.dumps(failures))
