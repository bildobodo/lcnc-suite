"""R110: unchanged R109 native inputs against the current archive."""
from pathlib import Path
import subprocess,sys,json
E=Path(__file__).resolve().parent;cases=json.loads((E/'native-cases.json').read_text());results={}
for name in ['explicit_same_block', 'explicit_separate_blocks', 'remap_only', 'listed_same_block', 'explicit_alone', 'python_explicit_same_block', 'python_explicit_separate_blocks', 'python_remap_only', 'python_listed_same_block', 'python_explicit_alone', 'python_line4_explicit_same_block', 'python_line4_explicit_separate_blocks', 'python_line4_remap_only', 'python_line4_listed_same_block', 'inline_explicit', 'inline_g92', 'm98_explicit', 'm98_g92']:
 p=subprocess.run([sys.executable,str(E/'native.py'),name,str(E/(name+'.msgpack'))],text=True,capture_output=True,timeout=120)
 ls=[l for l in p.stdout.splitlines() if l.startswith('{')];data=json.loads(ls[-1]) if ls else None
 results[name]={'returncode':p.returncode,'data':data,'stdout':p.stdout,'stderr':p.stderr}
 assert p.returncode==0 and data and data.get('parse_error') is None and data.get('mmap_unchanged'),(name,p.stdout,p.stderr)
 print(name,data['stale_offset_lines'],data['rapid_ustart'],data['rapid_tcum'],flush=True)
(E/'replay.json').write_text(json.dumps(results,indent=2)+'\n')
