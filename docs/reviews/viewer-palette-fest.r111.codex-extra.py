"""R111: first-command basis parity, first Python motion, foreign boundary."""
from pathlib import Path
import subprocess,sys,json,copy
E=Path(__file__).resolve().parent;cases=json.loads((E/'native-cases.json').read_text());base=cases['g43_first']['tuple'][4];added=[]
def add(name,prog,commands=None,rotary=False):
 extra=copy.deepcopy(base)
 extra.pop('emcio',None)
 if commands is None:extra.pop('rs274ngc');extra.pop('subs')
 else:extra['subs']['remap.py']='from interpreter import INTERP_OK\n\ndef writer(self, **words):\n'+''.join('    self.execute('+repr(c)+')\n' for c in commands)+'    return INTERP_OK\n'
 if rotary:extra['rotary']=True
 cases[name]={'tuple':[prog,'mm',10.,[430],extra]};added.append(name)
for nm,cmd in [('g92','G92 Z10'),('g10','G10 L2 P1 X20 Z30 R30'),('g43','G43.1 Z20')]:
 for frame in ['plain','percent']:
  tail='G0 X0 Y0 Z0\nG0 X10\nM2\n';wrap=lambda p: '%\n'+p+'%\n' if frame=='percent' else p
  for py in [False,True]:add('basis_'+nm+'_'+frame+('_python' if py else '_plain'),wrap(('M200' if py else cmd)+'\n'+tail),[cmd] if py else None,True)
for frame in ['plain','percent']:
 for first in ['G0 X1 Y2 Z3','G1 X1 Y2 Z3 F600']:
  nm='first_motion_'+('rapid' if first.startswith('G0') else 'feed')+'_'+frame
  prog='M200\nG0 X10 Y2 Z3\nM2\n'
  if frame=='percent':prog='%\n'+prog+'%\n'
  add(nm,prog,[first],True)
# A foreign M600 implemented directly in Python, first in program, must stop before recording its motion.
for frame in ['plain','percent']:
 c=copy.deepcopy(cases['first_motion_rapid_'+frame]);c['tuple'][0]=c['tuple'][0].replace('M200','M600');c['tuple'][4]['rs274ngc']=c['tuple'][4]['rs274ngc'].replace('M200 modalgroup=10','M600 modalgroup=6');name='foreign_first_'+frame;cases[name]=c;added.append(name)
(E/'native-cases.json').write_text(json.dumps(cases,indent=2)+'\n');results={}
for name in added:
 p=subprocess.run([sys.executable,str(E/'native.py'),name,str(E/(name+'.msgpack'))],capture_output=True,text=True,timeout=120)
 ls=[l for l in p.stdout.splitlines() if l.startswith('{')];data=json.loads(ls[-1]) if ls else None
 results[name]={'returncode':p.returncode,'data':data,'stdout':p.stdout,'stderr':p.stderr}
 assert p.returncode==0 and data and data.get('parse_error') is None and data.get('mmap_unchanged'),(name,p.stdout,p.stderr)
 print(name,{k:data.get(k) for k in ['digest_without_stats','rapid_lines','probe_unpredicted','tlo_events']},flush=True)
(E/'extra.json').write_text(json.dumps(results,indent=2)+'\n')
checks={}
for nm in ['g92','g10','g43']:
 for frame in ['plain','percent']:
  key='basis_'+nm+'_'+frame
  a=results[key+'_plain']['data'];b=results[key+'_python']['data']
  checks[key]={'plain_digest':a['digest_without_stats'],'python_digest':b['digest_without_stats'],'equal':a['digest_without_stats']==b['digest_without_stats'],'same_start':a['tlo_start']==b['tlo_start']}
(E/'basis-parity.json').write_text(json.dumps(checks,indent=2)+'\n')
print(checks)
