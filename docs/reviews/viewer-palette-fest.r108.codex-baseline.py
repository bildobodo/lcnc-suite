"""Repeat three new native cases on the pre-R108 archive. Run with repo path.
Create the baseline archive in a fresh evidence parent, never a live checkout.
"""
from pathlib import Path
import subprocess,tarfile,io,json,sys
r=Path(__file__).resolve().parent.parent;e=r/'evidence';b=r/'baseline';repo=Path(sys.argv[1]);b.mkdir()
tarfile.open(fileobj=io.BytesIO(subprocess.check_output(['git','archive','b1761b51'],cwd=repo))).extractall(b,filter='data')
results={}
for n in ['explicit_same_block','explicit_separate_blocks','remap_only']:
 p=subprocess.run(['nice','-n','19','/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python',str(e/'native.py'),n,str(e/(n+'.baseline.msgpack'))],cwd=b/'lcnc-gateway',capture_output=True,text=True,timeout=90)
 ls=[l for l in p.stdout.splitlines() if l.startswith('{')];d=json.loads(ls[-1]) if ls else None;results[n]={'returncode':p.returncode,'data':d,'stdout':p.stdout,'stderr':p.stderr}
 print(n,{k:d.get(k) for k in ['parse_error','stale_offset_lines','rapid_ustart','rapid_tcum']} if d else 'no output')
(e/'baseline.json').write_text(json.dumps(results,indent=2)+'\n')
