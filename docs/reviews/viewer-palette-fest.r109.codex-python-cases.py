"""R109: the same Python body with an explicit callback line; ordinary inline/M98 controls."""
from pathlib import Path
import json,subprocess,sys,copy
E=Path(__file__).resolve().parent
cases=json.loads((E/'native-cases.json').read_text());added=[]
for n in ['explicit_same_block','explicit_separate_blocks','remap_only','listed_same_block']:
 c=copy.deepcopy(cases['python_'+n]);c['tuple'][4]['subs']['remap.py']=c['tuple'][4]['subs']['remap.py'].replace("self.execute('G92 Z10')", "self.execute('G92 Z10', 4)")
 key='python_line4_'+n;cases[key]=c;added.append(key)
# Writes actually in main-file subroutine text are still explicit and safe.
for key,body in {
 'inline_explicit':'o<safe> sub\nG10 L2 P1 X0\no<safe> endsub\nG21 G90\nG0 X0 Y0 Z40\nM6\no<safe> call\nG0 X10 Y5 Z15\nG0 X20\nM2\n',
 'inline_g92':'o<unsafe> sub\nG92 Z10\no<unsafe> endsub\nG21 G90\nG0 X0 Y0 Z40\nM6\no<unsafe> call\nG0 X10 Y5 Z15\nG0 X20\nM2\n',
 'm98_explicit':'G21 G90\nG0 X0 Y0 Z40\nM6\nM98 P100\nG0 X10 Y5 Z15\nG0 X20\nM2\no100\nG10 L2 P1 X0\nM99\n',
 'm98_g92':'G21 G90\nG0 X0 Y0 Z40\nM6\nM98 P100\nG0 X10 Y5 Z15\nG0 X20\nM2\no100\nG92 Z10\nM99\n',
}.items():
 c=copy.deepcopy(cases['explicit_alone']);c['tuple'][0]=body;cases[key]=c;added.append(key)
(E/'native-cases.json').write_text(json.dumps(cases,indent=2)+'\n')
results={}
for name in added:
 p=subprocess.run([sys.executable,str(E/'native.py'),name,str(E/(name+'.msgpack'))],capture_output=True,text=True,timeout=120)
 ls=[ln for ln in p.stdout.splitlines() if ln.startswith('{')];data=json.loads(ls[-1]) if ls else None
 results[name]={'returncode':p.returncode,'data':data,'stdout':p.stdout,'stderr':p.stderr}
 print(name,p.returncode,{k:data.get(k) for k in ['parse_error','stale_offset_lines','rapid_ustart','rapid_tcum']} if data else p.stderr[-300:],flush=True)
(E/'python-cases.json').write_text(json.dumps(results,indent=2)+'\n')
