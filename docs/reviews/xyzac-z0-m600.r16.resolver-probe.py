"""R16: pure LoadedProgram sequences; no LinuxCNC import/connection.
Run: python3 docs/reviews/xyzac-z0-m600.r16.resolver-probe.py
"""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'lcnc-gateway'))
from gateway_util import LoadedProgram

SUBDIRS = ('/review/subs', '/review/nc/shared')
PROGDIRS = ('/review/nc',)
MAIN, NC_SUB, EXT_SUB = '/review/nc/main.ngc', '/review/nc/shared/probe.ngc', '/review/subs/probe.ngc'
result = {'head': subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(), 'cases':[]}

def case(name, steps):
    p = LoadedProgram()
    out=[]
    for n, (action, value, idle) in enumerate(steps):
        if action == 'load':
            p.request_load(value, n / 10)
            events=[]
        else:
            events=p.update(value, idle, n / 10, SUBDIRS, PROGDIRS)
        out.append({'action':action, 'raw_or_request':value, 'idle':idle, 'loaded':p.loaded, 'seen':p.seen, 'events':events})
    result['cases'].append({'name':name, 'steps':out})

case('known_none_mdi_error_prefix', [('poll',None,True),('poll',NC_SUB,False),('poll',NC_SUB,True)])
case('known_main_mdi_error_prefix', [('poll',MAIN,True),('poll',NC_SUB,False),('poll',NC_SUB,True)])
case('explicit_shared_directory_load', [('poll',None,True),('load',NC_SUB,True),('poll',NC_SUB,True)])
case('restart_after_mdi_error_prefix', [('poll',NC_SUB,True),('poll',NC_SUB,True)])
case('restart_during_mdi_prefix_returns_main', [('poll',NC_SUB,False),('poll',MAIN,True)])
case('restart_during_mdi_external_returns_main', [('poll',EXT_SUB,False),('poll',MAIN,True)])
case('restart_after_mdi_error_external', [('poll',EXT_SUB,True),('poll',EXT_SUB,True)])

Path(__file__).with_suffix('.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
