"""Offline invocation of the new live helper with a non-simulation INI.
No NML, sockets, HAL or OS signals: fake_linuxcnc plus a recording Gateway.
The retry helper sends once then returns false, ending before any motion.
"""
import asyncio,importlib.util,json,sys,tempfile
from pathlib import Path
import fake_linuxcnc
lcnc=fake_linuxcnc.install()
script=Path.cwd().parent/'scripts/toolsetter_readback_check.py'
spec=importlib.util.spec_from_file_location('r118_readback',script)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
seen=[]
class FakeGateway:
 def __init__(self,*args):pass
 async def __aenter__(self):seen.append({'entered_gateway':True});return self
 async def __aexit__(self,*args):pass
 async def cmd(self,obj,**kw):seen.append(obj);return {'ok':False}
async def once(gw,cmd,ok,timeout=20):
 await gw.cmd(cmd)
 return False
m.Gateway=FakeGateway;m.until=once
with tempfile.TemporaryDirectory(prefix='r118-target-') as td:
 p=Path(td);(p/'logs').mkdir();(p/'nc').mkdir();(p/'logs/trace.ndjson').write_text('')
 ini=p/'production-machine.ini'
 ini.write_text(f'[EMC]\nMACHINE = Production mill\n[DISPLAY]\nWEBUI_PORT = 8000\nPROGRAM_PREFIX = {p / "nc"}\nLOG_DIR = {p / "logs"}\n[RS274NGC]\nPARAMETER_FILE = machine.var\n[HAL]\nHALFILE = physical-drives.hal\n')
 m.s.ini_filename=str(ini)
 asyncio.run(m.main(str(ini),str(p/'report.txt'),True))
 result={'ini_kind':'non-simulation, HALFILE=physical-drives.hal','events':seen,'report':(p/'report.txt').read_text()}
 assert {'cmd':'estop_reset'} in seen
 Path(sys.argv[1]).write_text(json.dumps(result,indent=2)+'\n')
 print('REPRODUCED: non-simulation target accepted up to recording estop_reset; no real command sent.')
