#!/usr/bin/env python3
"""R352: actual _cmd_blocking body with an isolated, deterministic queue seam.
No gateway import, LinuxCNC, network, real executor thread, or machine command.
This models a slot replacement at executor dispatch; it is not a live race proof.
"""
import ast
import asyncio
from pathlib import Path
import threading
import time
from typing import Optional, Callable
import types
import hashlib
import json

source = Path('/tmp/codex-r352/lcnc-gateway/gateway.py').read_text()
parsed = ast.parse(source)
fn = next(n for n in parsed.body if isinstance(n, ast.AsyncFunctionDef) and n.name=='_cmd_blocking')
events=[]
class Channel:
    def __init__(self,name,serial): self.name=name; self.serial=serial
    def mdi(self,text):
        self.serial += 1
        events.append(['write',self.name,text,self.serial])
    def wait_complete(self,seconds):
        events.append(['wait',self.name,self.serial])
        return 1
class Stat:
    def __init__(self,name):self.name=name
    def poll(self): events.append(['admit_poll',self.name])
old,new=Channel('old',40),Channel('new',80)
ns={'Optional':Optional,'Callable':Callable,'threading':threading,'time':time,
    '_CMD_WAIT_TIMEOUT':1,'_CMD_WAIT_SLICE':0.05,'_RC_WAIT_CANCELLED':-2,
    '_start_kind':lambda *a:None, 'CMD':old,'STAT':Stat('old')}
async def thread_to_end(inner, on_cancel=None): return await inner
async def dispatch(work):
    ns['CMD']=new
    ns['STAT']=Stat('new')
    events.append(['replace_slot_before_thread'])
    return work()
ns['_thread_to_end']=thread_to_end
ns['asyncio']=types.SimpleNamespace(ensure_future=asyncio.ensure_future,to_thread=dispatch)
exec(compile(ast.Module(body=[fn],type_ignores=[]),'<actual _cmd_blocking>', 'exec'),ns)
async def probe():
    claim=types.SimpleNamespace(serial=None,state='pending')
    def admit(): ns['STAT'].poll(); return None
    async with asyncio.Lock():
        rc=await ns['_cmd_blocking'](old.mdi,'G4 P0',claim=claim,admit=admit)
    return {'events':events,'claimed_serial':claim.serial,'actual_written_serial':old.serial,'rc':rc}
result=asyncio.run(probe())
result.update({'source':'faa33958:lcnc-gateway/gateway.py','function_sha256':hashlib.sha256(ast.get_source_segment(source,fn).encode()).hexdigest(),
               'isolation':__doc__, 'mixed_owner_observed':result['claimed_serial']!=result['actual_written_serial']})
print(json.dumps(result,indent=2))
assert result['mixed_owner_observed']
