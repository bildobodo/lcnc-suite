"""Run only the R197 offline tool tests, never the driver main.
Usage: VENV/python tools-runner.py DOCS_REVIEWS ARCHIVED_GATEWAY_SOURCE OUTPUT_DIR
"""
from pathlib import Path
import os,shutil,subprocess,sys
D,gateway,out=[Path(x).resolve() for x in sys.argv[1:4]]
out.mkdir(exist_ok=True)
for name,src in [('bpc.py','r182.browser-pc-bpc.py'),('drive.py','r182.browser-pc-drive.py'),('tracetail.py','r183.browser-pc-tracetail.py'),('bpc2.py','r197.browser-pc-report2.py'),('drive2.py','r197.browser-pc-drive2.py')]:
 shutil.copyfile(D/('viewer-palette-fest.'+src),out/name)
s=(D/'viewer-palette-fest.r197.browser-pc-tools-test.py').read_text()
s=s.replace('os.path.expanduser("~/lcnc-suite-c2/lcnc-gateway")',repr(str(gateway)))
(out/'test_bpc_tools.py').write_text(s)
env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1')
raise SystemExit(subprocess.call([sys.executable,'-m','unittest','test_bpc_tools','-v'],cwd=out,env=env))
