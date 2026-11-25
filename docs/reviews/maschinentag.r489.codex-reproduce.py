"""Tiny arithmetic probes only. No gateway, browser or live system.
Use the gateway venv Python (numpy); --out must name a new directory under /tmp.
"""
from pathlib import Path
import argparse,os,subprocess
ap=argparse.ArgumentParser();ap.add_argument('--repo',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args()
a.out.mkdir(parents=True,exist_ok=False);out=a.out.resolve();tree=out/'tree';gw=tree/'lcnc-gateway';gw.mkdir(parents=True)
source=subprocess.check_output(['git','-C',str(a.repo),'show','fd1878e0:lcnc-gateway/gcode_parse_worker.py'])
(gw/'gcode_parse_worker.py').write_bytes(source)
evidence=Path(__file__).resolve().parent;py=str(a.repo/'lcnc-gateway/.venv/bin/python')
with (out/'probe.json').open('w') as f:subprocess.run([py,str(evidence/'maschinentag.r489.codex-probe.py'),str(tree)],stdout=f,check=True)
with (out/'test.txt').open('w') as f:
    r=subprocess.run([py,str(evidence/'maschinentag.r489.codex-test.py')],env={**os.environ,'R489_TREE':str(tree)},stdout=f,stderr=subprocess.STDOUT)
s=(out/'test.txt').read_text();assert r.returncode==1 and 'Ran 8 tests' in s and 'FAILED (failures=4)' in s,s
print('Reproduced: 4 failed guards, 4 passed controls; no heavy tests run.')
