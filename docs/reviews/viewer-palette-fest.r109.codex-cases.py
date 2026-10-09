"""R109 native cases: unchanged R108 counterexample, positive controls, Python remap."""
from pathlib import Path
import json, subprocess, sys, copy
E=Path(__file__).resolve().parent
cases={'explicit_same_block': {'tuple': ['G21 G90\nG0 X0 Y0 Z40\nM6\nG10 L2 P1 X0 M200\nG0 X10 Y5 Z15\nG0 X20\nM2\n', 'mm', 0.0, [490], {'emcio': 'TOOL_CHANGE_POSITION = 0 20 30', 'rs274ngc': 'REMAP=M200 modalgroup=10 ngc=writer', 'subs': {'writer.ngc': 'o<writer> sub\nG92 Z10\no<writer> endsub\n'}}]}, 'explicit_separate_blocks': {'tuple': ['G21 G90\nG0 X0 Y0 Z40\nM6\nG10 L2 P1 X0\nM200\nG0 X10 Y5 Z15\nG0 X20\nM2\n', 'mm', 0.0, [490], {'emcio': 'TOOL_CHANGE_POSITION = 0 20 30', 'rs274ngc': 'REMAP=M200 modalgroup=10 ngc=writer', 'subs': {'writer.ngc': 'o<writer> sub\nG92 Z10\no<writer> endsub\n'}}]}, 'remap_only': {'tuple': ['G21 G90\nG0 X0 Y0 Z40\nM6\nM200\nG0 X10 Y5 Z15\nG0 X20\nM2\n', 'mm', 0.0, [490], {'emcio': 'TOOL_CHANGE_POSITION = 0 20 30', 'rs274ngc': 'REMAP=M200 modalgroup=10 ngc=writer', 'subs': {'writer.ngc': 'o<writer> sub\nG92 Z10\no<writer> endsub\n'}}]}}
def case(prog,extra): return {'tuple':[prog,'mm',0.,[490],extra]}
base=cases['explicit_same_block']['tuple'][0];extra=cases['explicit_same_block']['tuple'][4]
cases['listed_same_block']=case(base.replace('L2 P1','L20 P2'),extra)
cases['explicit_alone']=case(base.replace(' M200',''),extra)
python_extra=copy.deepcopy(extra)
python_extra['rs274ngc']='REMAP=M200 modalgroup=10 python=writer\n[PYTHON]\nPATH_PREPEND={work}\nTOPLEVEL={work}/toplevel.py'
python_extra['subs']={'toplevel.py':'import remap\n', 'remap.py':'''from interpreter import INTERP_OK
import json
def writer(self, **words):
    def tell(phase):
        print('PYREMAP '+json.dumps({'phase':phase, 'filename':self.filename, 'line':self.sequence_number, 'call_level':self.call_level, 'remap_level':self.remap_level}))
    tell('before G92')
    self.execute('G92 Z10')
    tell('after G92')
    return INTERP_OK
'''}
for n in ['explicit_same_block','explicit_separate_blocks','remap_only','listed_same_block','explicit_alone']:
 cases['python_'+n]=case(cases[n]['tuple'][0],python_extra)
(E/'native-cases.json').write_text(json.dumps(cases,indent=2)+'\n')
results={}
for name in cases:
 p=subprocess.run([sys.executable,str(E/'native.py'),name,str(E/(name+'.msgpack'))],capture_output=True,text=True,timeout=120)
 ls=[ln for ln in p.stdout.splitlines() if ln.startswith('{')]
 data=json.loads(ls[-1]) if ls else None
 results[name]={'returncode':p.returncode,'data':data,'stdout':p.stdout,'stderr':p.stderr}
 print(name,p.returncode,{k:data.get(k) for k in ['parse_error','stale_offset_lines','rapid_ustart','rapid_tcum']} if data else p.stderr[-300:],flush=True)
(E/'native.json').write_text(json.dumps(results,indent=2)+'\n')
