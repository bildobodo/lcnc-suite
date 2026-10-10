"""R118's AUTO read race, with the fixed expectation. Offline task double."""
import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import patch
from backend_runner import PollingPolicy
asyncio.set_event_loop_policy(PollingPolicy())
from test_g30 import TestSynchInAuto, gateway, linuxcnc

c = TestSynchInAuto()
c.setUp()
try:
    before = {'mode': gateway.STAT.task_mode, 'interp': gateway.STAT.interp_state}
    mode = c.task.mode
    def mode_with_interleaving(m):
        gateway.STAT.interp_state = linuxcnc.INTERP_READING
        return mode(m)
    with patch.object(c.task, 'mode', mode_with_interleaving):
        reply = c.send({'cmd': 'read_g30'})
    out = {'scenario': 'R118 AUTO IDLE at poll; start would become READING before mode is consumed',
           'before': before, 'reply': reply, 'task_calls': c.task.calls,
           'after': {'mode': gateway.STAT.task_mode, 'interp': gateway.STAT.interp_state}}
    assert c.task.calls == [], out
    assert not reply['ok'] and not reply['confirmed'], out
finally:
    c.doCleanups()
Path(sys.argv[1]).write_text(json.dumps(out, indent=2) + '\n')
print('PASS: original R118 interleaving sends no command and confirms nothing.')
