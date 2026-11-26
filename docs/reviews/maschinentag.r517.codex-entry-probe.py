"""Actual gateway start entry under the shipped fake controller fixture.
A failed entry poll leaves a matching old snapshot; the next poll exposes a
changed fixture. The comparator models the existing 'another fixture' term.
No real NML, sockets or machine commands.
"""
import asyncio, json, inspect
from unittest.mock import patch
import conftest
from test_start_ask_gateway import StartAskBase, gateway, current, linuxcnc
from test_command_dispatch import _payload

def one(fail_first):
 c=StartAskBase(); c.setUp()
 st=current().stat
 st.task_mode=linuxcnc.MODE_MANUAL
 polls=[]; failed=False
 def poll():
  nonlocal failed
  caller=inspect.currentframe().f_back.f_code.co_name
  polls.append(caller)
  if fail_first and caller=='_start_entry':
   failed=True
   raise RuntimeError('poll failed; cached values remain')
  if failed:
   st.g5x_index=2
   st.gcodes=tuple(550 if i==8 else v for i,v in enumerate(st.gcodes))
 def compare(*a,**k):
  return (True,None) if st.g5x_index==1 else (False,'another fixture')
 try:
  gateway._shared_status=_payload()
  with patch.object(st,'poll',poll),patch.object(gateway._bulk,'run_start_check',compare):
   r=asyncio.run(gateway.handle_command(c.start(check={'calc':'ended','result':'full-clear','version':10}),True,c.key))
  return {'polls':polls,'reply':r,'writes':c.cmd.calls,'run_basis':{k:gateway._run_basis.get(k) for k in ('state','verified','why')} if gateway._run_basis else None}
 finally: c.doCleanups()
control=one(False); failed=one(True)
print(json.dumps({'control':control,'failed_entry_poll':failed, 'expected':{'control':'ok and exactly one AUTO', 'failed_entry_poll':'ask at entry for unread status; no mode/MDI/AUTO before the question'}},indent=2,default=str))
assert control['reply']['ok'] and len([w for w in control['writes'] if w[0]=='auto'])==1
assert failed['reply']['ask']['at']=='entry' and failed['writes']==[], 'the entry did not withhold its unconfirmed start before preparation writes'
