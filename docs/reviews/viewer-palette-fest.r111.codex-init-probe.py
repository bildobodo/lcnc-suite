"""An otherwise transparent G0 remap: check whether worker initcodes enter it."""
from pathlib import Path
import json,subprocess,sys,copy
E=Path(__file__).resolve().parent;cases=json.loads((E/'native-cases.json').read_text());added=[]
for name,rotary,remapped in [('init_g0_rotary',True,True),('init_g0_control',True,False),('init_g0_xyz',False,True)]:
 extra={'rotary':rotary}
 if remapped:
  extra.update({'rs274ngc':'REMAP=G0 modalgroup=1 argspec=xyzabcuvw python=rapid\n[PYTHON]\nPATH_PREPEND={work}\nTOPLEVEL={work}/toplevel.py','subs':{'toplevel.py':'import remap\n','remap.py':"from interpreter import INTERP_OK\n\ndef rapid(self, **words):\n    print('RAPID',self.filename,self.sequence_number,self.remap_level,words)\n    self.execute('G0 '+ ' '.join(k+str(v) for k,v in words.items()))\n    return INTERP_OK\n"}})
 cases[name]={'tuple':['G21 G90\nG1 X1 Y0 Z40 F600\nG0 X10\nM2\n','mm',10.,[430],extra]};added.append(name)
(E/'native-cases.json').write_text(json.dumps(cases,indent=2)+'\n');results={}
for name in added:
 p=subprocess.run([sys.executable,str(E/'native.py'),name,str(E/(name+'.msgpack'))],capture_output=True,text=True,timeout=120)
 ls=[l for l in p.stdout.splitlines() if l.startswith('{')];data=json.loads(ls[-1]) if ls else None
 results[name]={'returncode':p.returncode,'data':data,'stdout':p.stdout,'stderr':p.stderr}
 print(name,p.returncode,data,p.stderr[-500:],flush=True)
(E/'init-probe.json').write_text(json.dumps(results,indent=2)+'\n')
