"""Python M6 remap and the interpreter's own negative-numbered positioning moves."""
from pathlib import Path
import subprocess,sys,json,copy
E=Path(__file__).resolve().parent;cases=json.loads((E/'native-cases.json').read_text());added=[]
for name,config in [('g30','TOOL_CHANGE_AT_G30=1'),('quill','TOOL_CHANGE_QUILL_UP=1'),('both','TOOL_CHANGE_AT_G30=1\nTOOL_CHANGE_QUILL_UP=1')]:
 for variant,body in [('zero',"self.execute('M6')"),('line4',"self.execute('M6', 4)")]:
  c=copy.deepcopy(cases['python_remap_only']);c['tuple'][0]='G21 G90\nG0 X0 Y0 Z40\nM200\nG0 X10 Y5 Z15\nG0 X20\nM2\n';extra=c['tuple'][4];extra['emcio']=config
  extra['subs']['remap.py']='from interpreter import INTERP_OK\n\ndef writer(self, **words):\n    '+body+'\n    return INTERP_OK\n'
  key='python_m6_'+name+'_'+variant;cases[key]=c;added.append(key)
(E/'native-cases.json').write_text(json.dumps(cases,indent=2)+'\n');results={}
for name in added:
 p=subprocess.run([sys.executable,str(E/'native.py'),name,str(E/(name+'.msgpack'))],text=True,capture_output=True,timeout=120)
 ls=[l for l in p.stdout.splitlines() if l.startswith('{')];data=json.loads(ls[-1]) if ls else None
 results[name]={'returncode':p.returncode,'data':data,'stdout':p.stdout,'stderr':p.stderr}
 print(name,p.returncode,data if not data or data.get('parse_error') else {k:data.get(k) for k in ['rapid','rapid_lines','rapid_ustart','rapid_tcum']},p.stderr[-300:],flush=True)
(E/'motion.json').write_text(json.dumps(results,indent=2)+'\n')
