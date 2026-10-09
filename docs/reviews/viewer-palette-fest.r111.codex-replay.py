"""R111: unchanged R110 native cases in the current archive."""
from pathlib import Path
import subprocess,sys,json
E=Path(__file__).resolve().parent;cases=json.loads((E/'native-cases.json').read_text());results={}
for name in ['explicit_same_block', 'explicit_separate_blocks', 'remap_only', 'listed_same_block', 'explicit_alone', 'python_explicit_same_block', 'python_explicit_separate_blocks', 'python_remap_only', 'python_listed_same_block', 'python_explicit_alone', 'python_line4_explicit_same_block', 'python_line4_explicit_separate_blocks', 'python_line4_remap_only', 'python_line4_listed_same_block', 'inline_explicit', 'inline_g92', 'm98_explicit', 'm98_g92', 'g43_first', 'tc_g92_first', 'g43_g21_first', 'tc_g92_g21_first', 'g43_percent_first', 'tc_g92_percent_first', 'g43_percent_g21_first', 'tc_g92_percent_g21_first', 'inline_python', 'inline_python_line4', 'foreign_python', 'm98_python', 'python_m6_g30_zero', 'python_m6_g30_line4', 'python_m6_quill_zero', 'python_m6_quill_line4', 'python_m6_both_zero', 'python_m6_both_line4', 'g43_first_line4', 'g43_percent_first_line4', 'tc_g92_first_line4', 'tc_g92_percent_first_line4', 'g43_first_after_move', 'tc_g92_first_after_move']:
 p=subprocess.run([sys.executable,str(E/'native.py'),name,str(E/(name+'.msgpack'))],text=True,capture_output=True,timeout=120)
 ls=[l for l in p.stdout.splitlines() if l.startswith('{')];data=json.loads(ls[-1]) if ls else None
 results[name]={'returncode':p.returncode,'data':data,'stdout':p.stdout,'stderr':p.stderr}
 assert p.returncode==0 and data and data.get('parse_error') is None and data.get('mmap_unchanged'),(name,p.stdout,p.stderr)
 print(name,data['stale_offset_lines'],data['rapid_ustart'],data['rapid_tcum'],flush=True)
(E/'replay.json').write_text(json.dumps(results,indent=2)+'\n')
