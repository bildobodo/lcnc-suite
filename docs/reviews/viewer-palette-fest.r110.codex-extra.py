"""R110: program start and subroutine origin around the new remap rules."""
from pathlib import Path
import subprocess,sys,json,copy
E=Path(__file__).resolve().parent;cases=json.loads((E/'native-cases.json').read_text());added=[]
base=cases['python_explicit_same_block']['tuple'][4]
def add(name,prog,body="self.execute('G92 Z10')",other=None):
 extra=copy.deepcopy(base);extra['subs']['remap.py']='from interpreter import INTERP_OK\n\ndef writer(self, **words):\n'+''.join('    '+line+'\n' for line in body.splitlines())+'    return INTERP_OK\n'
 if other:extra['subs'].update(other)
 cases[name]={'tuple':[prog,'mm',0.,[490],extra]};added.append(name)
# First callback-bearing operation may be Python, including a percent-delimited file.
for n,prefix,suffix in [('first','',''),('g21_first','G21 G90\n',''),('percent_first','%\n','%\n'),('percent_g21_first','%\nG21 G90\n','%\n')]:
 add('g43_'+n,prefix+'M200\nG0 X0 Y0 Z40\nG0 X10\nM2\n'+suffix,"self.execute('G43.1 Z10')")
 add('tc_g92_'+n,prefix+'M200\nG0 X10 Y5 Z15\nG0 X20\nM2\n'+suffix,"self.execute('M6')\nself.execute('G92 Z10')")
# Python from inline/M98/foreign sub: same write, physically distinct calling lines.
add('inline_python','o<writer_wrap> sub\nM200\no<writer_wrap> endsub\nG21 G90\nG0 X0 Y0 Z40\nM6\no<writer_wrap> call\nG0 X10 Y5 Z15\nG0 X20\nM2\n')
add('inline_python_line4','o<writer_wrap> sub\nM200\no<writer_wrap> endsub\nG21 G90\nG0 X0 Y0 Z40\nM6\no<writer_wrap> call\nG0 X10 Y5 Z15\nG0 X20\nM2\n',"self.execute('G92 Z10', 4)")
add('foreign_python','G21 G90\nG0 X0 Y0 Z40\nM6\no<child> call\nG0 X10 Y5 Z15\nG0 X20\nM2\n',other={'child.ngc':'o<child> sub\nM200\no<child> endsub\n'})
add('m98_python','G21 G90\nG0 X0 Y0 Z40\nM6\nM98 P100\nG0 X10 Y5 Z15\nG0 X20\nM2\no100\nM200\nM99\n')
(E/'native-cases.json').write_text(json.dumps(cases,indent=2)+'\n');results={}
for name in added:
 p=subprocess.run([sys.executable,str(E/'native.py'),name,str(E/(name+'.msgpack'))],text=True,capture_output=True,timeout=120)
 ls=[l for l in p.stdout.splitlines() if l.startswith('{')];data=json.loads(ls[-1]) if ls else None
 results[name]={'returncode':p.returncode,'data':data,'stdout':p.stdout,'stderr':p.stderr}
 print(name,p.returncode,{k:data.get(k) for k in ['parse_error','stale_offset_lines','rapid_ustart','rapid_tcum','tlo_events','tool_change_lines']} if data else p.stderr[-300:],flush=True)
(E/'extra.json').write_text(json.dumps(results,indent=2)+'\n')
