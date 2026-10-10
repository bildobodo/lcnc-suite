"""R118 deterministic AUTO read race and tool row zero. Offline only.
The task double's mode callback changes to READING at command consumption,
after the last fresh status poll. It models an already-sent/external start.
Uses the actual repository dispatch and the repository's task semantics.
"""
import asyncio,json,sys
from pathlib import Path
from unittest.mock import patch
from backend_runner import PollingPolicy
asyncio.set_event_loop_policy(PollingPolicy())
from test_g30 import TestSynchInAuto, gateway, linuxcnc
c=TestSynchInAuto();c.setUp()
try:
    before={'mode':gateway.STAT.task_mode,'interp':gateway.STAT.interp_state}
    actual_mode=c.task.mode
    def mode_with_interleaving(m):
        gateway.STAT.interp_state=linuxcnc.INTERP_READING
        return actual_mode(m)
    with patch.object(c.task,'mode',mode_with_interleaving):
        result=c.send({'cmd':'read_g30'})
    out={'scenario':'AUTO IDLE at last poll; a start becomes READING before task consumes SET_MODE AUTO',
         'before':before,'reply':result,'task_calls':c.task.calls,
         'after':{'mode':gateway.STAT.task_mode,'interp':gateway.STAT.interp_state}}
    assert ('aborted',) in c.task.calls
    assert result['ok'] and result['confirmed']
finally:c.doCleanups()
Path(sys.argv[1]).write_text(json.dumps(out,indent=2)+'\n')
print('REPRODUCED: read_g30 confirms values after the AUTO re-entry aborts the interleaved run.')
