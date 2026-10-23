"""R193 offline tool tests. No driver main, sockets or machine commands.
Usage: VENV/python this.py DOCS_REVIEWS ARCHIVED_GATEWAY_SOURCE
The only provided-test adaptation redirects its gateway import to that source.
"""
from pathlib import Path
import json, os, shutil, subprocess, sys, tempfile
D=Path(sys.argv[1]).resolve(); gateway=Path(sys.argv[2]).resolve()
out=Path(tempfile.mkdtemp(prefix='codex-r193-tools-'))
for name, src in [
 ('bpc.py','viewer-palette-fest.r182.browser-pc-bpc.py'),
 ('drive.py','viewer-palette-fest.r182.browser-pc-drive.py'),
 ('tracetail.py','viewer-palette-fest.r183.browser-pc-tracetail.py'),
 ('bpc2.py','viewer-palette-fest.r193.browser-pc-report2.py'),
 ('drive2.py','viewer-palette-fest.r193.browser-pc-drive2.py'),
 ('sequence.py','viewer-palette-fest.r193.codex-sequence.py')]:
 shutil.copyfile(D/src,out/name)
s=(D/'viewer-palette-fest.r193.browser-pc-tools-test.py').read_text()
old='sys.path.insert(0, os.path.expanduser("~/lcnc-suite-c2/lcnc-gateway"))'
assert s.count(old)==1
(out/'test_bpc_tools.py').write_text(s.replace(old,'sys.path.insert(0, '+repr(str(gateway))+')'))
env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1')
for name,args in [('provided-tools.txt',['-m','unittest','test_bpc_tools','-v']),('sequence.json',['sequence.py'])]:
 with (out/name).open('w') as f:
  p=subprocess.run([sys.executable,*args],cwd=out,env=env,stdout=f,stderr=subprocess.STDOUT)
 assert p.returncode==0,str(out/name)
print(json.dumps({'provided_tests':29,'sequence_cases':4,'output':str(out)},indent=2))
