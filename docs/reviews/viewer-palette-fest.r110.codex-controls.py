from pathlib import Path
import subprocess,sys,json,copy
E=Path(__file__).resolve().parent;cases=json.loads((E/'native-cases.json').read_text());added=[]
for n in ['g43_first','g43_percent_first','tc_g92_first','tc_g92_percent_first']:
 c=copy.deepcopy(cases[n]);s=c['tuple'][4]['subs']['remap.py'];s=s.replace("self.execute('G43.1 Z10')","self.execute('G43.1 Z10', 4)").replace("self.execute('M6')","self.execute('M6', 4)").replace("self.execute('G92 Z10')","self.execute('G92 Z10', 4)");c['tuple'][4]['subs']['remap.py']=s
 key=n+'_line4';cases[key]=c;added.append(key)
for n in ['g43_first','tc_g92_first']:
 c=copy.deepcopy(cases[n]);c['tuple'][0]='G0 X0 Y0 Z0\n'+c['tuple'][0];key=n+'_after_move';cases[key]=c;added.append(key)
(E/'native-cases.json').write_text(json.dumps(cases,indent=2)+'\n');results={}
for name in added:
 p=subprocess.run([sys.executable,str(E/'native.py'),name,str(E/(name+'.msgpack'))],text=True,capture_output=True,timeout=120)
 ls=[l for l in p.stdout.splitlines() if l.startswith('{')];data=json.loads(ls[-1]) if ls else None
 results[name]={'returncode':p.returncode,'data':data,'stdout':p.stdout,'stderr':p.stderr}
 print(name,p.returncode,{k:data.get(k) for k in ['parse_error','stale_offset_lines','rapid_ustart','rapid_tcum','tlo_events']} if data else p.stderr[-300:],flush=True)
(E/'controls.json').write_text(json.dumps(results,indent=2)+'\n')
