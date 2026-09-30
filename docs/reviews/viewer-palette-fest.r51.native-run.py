import json,subprocess,os
from pathlib import Path
root=Path(__file__).resolve().parent.parent
rows=[]
env=dict(os.environ);env.pop('PYTHONPATH',None)
for case in ['inherit','g43','dynamic','mixed']:
 for offset in [10,10.005,0,80]:
  p=subprocess.run(['nice','-n','19','/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python','-B','r51_native_case.py',case,str(offset)],cwd=root/'lcnc-gateway',env=env,text=True,capture_output=True,timeout=30)
  if p.returncode:raise RuntimeError(f'{case}/{offset}: rc={p.returncode}, stdout={p.stdout!r}, stderr={p.stderr!r}')
  data=json.loads([s for s in p.stdout.splitlines() if s.startswith('{')][-1])
  if 'skip' in data:raise RuntimeError(data['skip'])
  rows.append(data)
checks={case:len({x['sha256_except_file'] for x in rows if x['case']==case})==1 for case in ['inherit','g43','dynamic','mixed']}
result={'commit':'e5585e235f91a2fce7767e3306f993ed8dca7228','fresh_process_per_case':True,'equal_payloads_except_file':checks,'cases':rows}
(root/'evidence/viewer-palette-fest.r51.native-probe.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'equal_payloads_except_file':checks,'parse_errors':[r['parse_error'] for r in rows if r['parse_error']],'cases':len(rows)},indent=2))
assert all(checks.values())
assert all(r['parse_error'] is None for r in rows)
