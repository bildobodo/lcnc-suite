"""R108: interpreter-origin and foreign-entry boundaries, native offline only."""
from pathlib import Path
import json,subprocess,sys
E=Path(__file__).resolve().parent
cases=json.loads((E/'native-cases.json').read_text());more={}
extra={'emcio':'TOOL_CHANGE_POSITION = 0 20 30','rs274ngc':'REMAP=M200 modalgroup=10 ngc=writer','subs':{'writer.ngc':'o<writer> sub\nG92 Z10\no<writer> endsub\n'}}
for name,block in [('explicit_same_block','G10 L2 P1 X0 M200'),('explicit_separate_blocks','G10 L2 P1 X0\nM200'),('remap_only','M200')]:
 more[name]={'tuple':['G21 G90\nG0 X0 Y0 Z40\nM6\n'+block+'\nG0 X10 Y5 Z15\nG0 X20\nM2\n','mm',0.,[490],extra]}
more['numbered_main']={'m600':{'prog':'N100 G21 G90\nN200 G0 X50 Y50 Z-100\nN300 T2 M600\nN400 G0 X60\nN500 M2\n'}}
more['nested_main_file_sub']={'m600':{'prog':'o<local> sub\nT2 M600\no<local> endsub\nG21 G90\nG0 X50 Y50 Z-100\no<local> call\nG0 X60\nM2\n'}}
foreign={'rs274ngc':'REMAP=M600 modalgroup=6 ngc=other','subs':{'other.ngc':'o<other> sub\nG53 G0 Z0\no<other> endsub\n'}}
for name,prog in [('foreign_first','T2 M600\nG0 X1 Y1 Z1\nM2\n'),('foreign_pct_first','%\nT2 M600\nG0 X1 Y1 Z1\nM2\n%\n'),('foreign_before_move','G21 G90\nT2 M600\nG0 X1 Y1 Z1\nM2\n')]:
 more[name]={'tuple':[prog,'mm',0.,[490],foreign]}
cases.update(more);(E/'native-cases.json').write_text(json.dumps(cases,indent=2)+'\n')
results={}
for name in more:
 r=subprocess.run([sys.executable,str(E/'native.py'),name,str(E/(name+'.msgpack'))],capture_output=True,text=True,timeout=120)
 rows=[l for l in r.stdout.splitlines() if l.startswith('{')];d=json.loads(rows[-1]) if rows else None
 results[name]={'returncode':r.returncode,'data':d,'stdout':r.stdout,'stderr':r.stderr}
 print(name,None if d is None else {k:d.get(k) for k in ['parse_error','stale_offset_lines','rapid_ustart','tool_change_lines','probe_unpredicted','rapid_tcum']},flush=True)
(E/'new-cases.json').write_text(json.dumps(results,indent=2)+'\n')
