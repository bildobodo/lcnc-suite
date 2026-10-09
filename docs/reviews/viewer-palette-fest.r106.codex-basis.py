"""R105: unchanged gateway helper and basis bookkeeping; no live binding.
Run from archive/lcnc-gateway (PYTHONPATH=.). Uses repository fake LinuxCNC.
"""
import sys,json,os,asyncio
from pathlib import Path
sys.path.insert(0, str(Path.cwd()))
os.environ['LCNC_LOG_DIR']=str(Path(__file__).resolve().parent/'logs')
from test_toolsetter_basis import _BasisCase, FILE, _run
import gateway
from gateway_util import toolsetter_assigned_keys, toolsetter_basis_view
c=_BasisCase();c.setUp()
try:
 results=[]
 for text in ['#3009=4','#1=3009\n##1=4','#3 0 0 9=4','#+3009=4','#3009.0=4','#[3000+9]=4']:
  gateway._ts_book({**FILE,3009:3.0},'read')
  keys=toolsetter_assigned_keys(text)
  gateway._ts_mark_assumed(keys)
  results.append({'text':text,'assigned_keys':None if keys is None else sorted(keys),'basis_state':toolsetter_basis_view(gateway._ts_basis)['state'],'3009':gateway._ts_basis[3009]})
 (Path(__file__).resolve().parent/'basis.json').write_text(json.dumps(results,indent=2)+'\n')
 print('Six basis observations written')
finally:c.doCleanups()
