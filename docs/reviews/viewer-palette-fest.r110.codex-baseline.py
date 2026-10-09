"""Identical new native cases before R110; git archive, no live execution."""
from pathlib import Path
import subprocess,sys,tarfile,io,json
E=Path(__file__).resolve().parent;base=E.parent/'baseline';base.mkdir()
rev='5516a941';repo=Path(sys.argv[1])
with tarfile.open(fileobj=io.BytesIO(subprocess.check_output(['git','archive',rev],cwd=repo))) as t:t.extractall(base,filter='data')
results={}
for name in ['g43_first','tc_g92_first','g43_percent_first','tc_g92_percent_first','python_m6_g30_zero','python_m6_quill_zero','python_m6_both_zero','inline_python','python_line4_explicit_same_block']:
 p=subprocess.run([sys.executable,str(E/'native.py'),name,str(E/(name+'.baseline.msgpack'))],cwd=base/'lcnc-gateway',capture_output=True,text=True,timeout=120)
 ls=[l for l in p.stdout.splitlines() if l.startswith('{')];data=json.loads(ls[-1]) if ls else None
 results[name]={'returncode':p.returncode,'data':data,'stdout':p.stdout,'stderr':p.stderr}
 print(name,p.returncode,{k:data.get(k) for k in ['parse_error','stale_offset_lines','rapid_ustart','rapid_tcum','tlo_events']} if data else p.stderr[-300:],flush=True)
(E/'baseline.json').write_text(json.dumps({'commit':rev,'results':results},indent=2)+'\n')
