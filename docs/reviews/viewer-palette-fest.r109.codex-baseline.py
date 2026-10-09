"""Identical native cases before R109; git archive only, no live execution."""
from pathlib import Path
import subprocess,sys,tarfile,io,json
E=Path(__file__).resolve().parent;base=E.parent/'baseline';base.mkdir()
rev='acd2f754';repo=Path(sys.argv[1])
with tarfile.open(fileobj=io.BytesIO(subprocess.check_output(['git','archive',rev],cwd=repo))) as t:t.extractall(base,filter='data')
results={}
for name in ['explicit_same_block','python_explicit_same_block','python_line4_explicit_same_block','python_line4_remap_only','m98_explicit']:
 p=subprocess.run([sys.executable,str(E/'native.py'),name,str(E/(name+'.baseline.msgpack'))],cwd=base/'lcnc-gateway',capture_output=True,text=True,timeout=120)
 ls=[l for l in p.stdout.splitlines() if l.startswith('{')];data=json.loads(ls[-1]) if ls else None
 results[name]={'returncode':p.returncode,'data':data,'stdout':p.stdout,'stderr':p.stderr}
 assert p.returncode==0 and data is not None and data.get('parse_error') is None and data.get('mmap_unchanged')
 print(name,data['stale_offset_lines'],data['rapid_ustart'],data['rapid_tcum'])
(E/'baseline.json').write_text(json.dumps({'commit':rev,'results':results},indent=2)+'\n')
