import os,sys,subprocess,json
from pathlib import Path
out=Path('/tmp/r456')
rows=[]
for fix in [False,True]:
 for case in ['plain','g55_first','g55_with_move','g92_first','g20_first','g43_first','rotated','g55_zero','g55_rotary','g55_preamble']:
  stem=case+('-fix' if fix else '-old')
  env=dict(os.environ,F9_SPY='1')
  if fix: env['R456_FIX']='1'
  r=subprocess.run([sys.executable,str(out/'probe.py'),case,str(out/(stem+'.msgpack'))],cwd=out/'tree/lcnc-gateway',env=env,capture_output=True,text=True,timeout=60)
  (out/(stem+'.json')).write_text(r.stdout); (out/(stem+'.err')).write_text(r.stderr)
  try: d=json.loads(r.stdout.splitlines()[-1])
  except Exception: d={'invalid':r.stdout[-500:], 'stderr':r.stderr[-800:]}
  row={'case':case,'fix':fix,'rc':r.returncode,**{k:d.get(k) for k in ['skip','parse_error','rapid','rapid_dep','start_believed','start_unbound','f9spy','invalid','stderr']}}
  rows.append(row)
(out/'observations.json').write_text(json.dumps(rows,indent=2)+'\n')
print('finished',len(rows),'cases')
