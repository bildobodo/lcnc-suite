import os,subprocess,json,sys
from pathlib import Path
p=Path(__file__).resolve().parent.parent
out=[]
for name in ['r118_g53_g91','r118_g30_no_words','r118_g30_z','r118_g30_z_waypoint','r118_random_repeat']:
 env=dict(os.environ);env['PYTHONPYCACHEPREFIX']=str(p/'pycache');env.pop('PYTHONPATH',None)
 r=subprocess.run(['nice','-n','19',sys.executable,str(p/'evidence/native-probe.py'),name],cwd=p/'lcnc-gateway',env=env,capture_output=True,text=True,timeout=20)
 (p/f'evidence/native-{name}.txt').write_text(r.stdout+r.stderr)
 rows=[json.loads(ln) for ln in r.stdout.splitlines() if ln.startswith('{')]
 out.append({'case':name,'exit':r.returncode,'data':rows[-1] if rows else None,'stderr':r.stderr})
 assert r.returncode==0 and rows and 'skip' not in rows[-1],out[-1]
(p/'evidence/native-results.json').write_text(json.dumps(out,indent=2)+'\n')
for r in out:
 d=r['data'];print(json.dumps({'case':r['case'],'exit':r['exit'],'error':d.get('parse_error'),'rapid':d.get('rapid'),'tools':d.get('tool_change_lines'),'tlo':d.get('tlo_events')}))
assert out[0]['data']['parse_error']=='Cannot use g53 incremental'
assert out[-1]['data']['tool_change_lines']==[[3,0]],'random pocket zero is reported as T0'
