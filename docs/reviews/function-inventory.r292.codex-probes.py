"""R292: offline counterexamples, no sockets, systemd, linuxcnc or hal.
Usage: python3 -B <this-file> <archive-of-e8e4184b>
These asserts preserve the OBSERVED defects, not the desired contract.
"""
import json
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
import sys
REPO = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(REPO / 'scripts'))
import native_run as nr
from test_support import tool_change as tc, native_cases as nc
from test_support.live_session import SimulatorClient

out = {}
class Clock:
    def __init__(self): self.now = 0.0
    def monotonic(self): return self.now
    def sleep(self, seconds): self.now += seconds

def state(**kw):
    return dict(tool_change_requested=False, tool_change_seq=None, tool_number=1,
                interp_state=1, inpos=True, **kw)

# The real receive reducer sees exactly ONE held frame during the five seconds.
clock = Clock()
receipts = []
c = SimulatorClient('unused', auto_confirm=False, on_status=lambda t, st: receipts.append((t, st)))
requests = []
def confirm(cmd, **kw):
    requests.append((clock.now, cmd, kw))
    c.take({'type':'status', 'data':state(tool_offset=[0, 0, 50], feed_override_enabled=True) | {'tool_number':99}})
    return {'ok':True}
c.request = confirm
with patch.object(tc, 'time', clock), patch('test_support.live_session.time', clock):
    c.take({'type':'status', 'data':state() | {'tool_change_requested':True, 'tool_change_seq':9,
            'tool_change_tool':99, 'interp_state':2}})
    changes = tc.ToolChanges([99], hold_s=5)
    end = tc.RoutineEnd()
    tc.serve(c, changes, lambda t, st: st.get('tool_number') == 99, deadline_s=8)
    row = nc.eval_m6_hold('m6-hold', changes.holds, 1, 99, 50, 99, 50, 5)
assert row['status'] == 'PASS' and len(receipts) == 2 and row['samples'] >= 100
out['hold_cache_recount'] = {'row':row, 'actual_status_receipts':[t for t, _ in receipts], 'requests':requests}

# A separate complete, valid M6: while pending the interpreter is busy,
# then the request closes and the interpreter is idle. `serve` never feeds
# that busy frame to RoutineEnd because it gates done() on changes.idle().
clock = Clock()
class EndClient:
    error = None
    def __init__(self):
        self.status = state() | {'tool_change_requested':True, 'tool_change_seq':10,
                                 'tool_change_tool':99, 'interp_state':2}
    def request(self, cmd, **kw):
        self.status = state() | {'tool_number':99}
        return {'ok':True}
end = tc.RoutineEnd()
with patch.object(tc, 'time', clock):
    changes = tc.ToolChanges([99])
    try:
        tc.serve(EndClient(), changes, end, deadline_s=.2)
        raise AssertionError('expected the reproduced timeout')
    except tc.ToolChangeError as e:
        out['completed_m6_not_seen_busy'] = {'error':str(e), 'served':changes.served, 'seen_busy':end.seen_busy}
assert changes.served == [{'tool':99,'seq':10}] and end.seen_busy is False

def lock_frame(t, enabled, idle=False, velocity=0):
    return (t, state(feed_override_enabled=enabled, current_vel=velocity) | {'interp_state':1 if idle else 2, 'inpos':velocity == 0})
frames = [lock_frame(.03, True), lock_frame(.2, False, velocity=1),
          lock_frame(.4, True, velocity=1), lock_frame(.8, True, velocity=1), lock_frame(1.033, True, idle=True)]
row = nc.eval_override_lock('early-release', frames, 0)
assert row['status'] == 'PASS'
out['override_released_while_still_moving'] = {'row':row, 'frames':frames}

# Valid completion, then the contractual fresh release 33 ms later.
frames = [lock_frame(.03, True), lock_frame(.2, False, velocity=1), lock_frame(1.033, False, idle=True)]
early = nc.eval_override_lock('completion', frames, 0)
complete = nc.eval_override_lock('completion', frames + [lock_frame(1.066, True, idle=True)], 0)
assert early['status'] == 'FAIL' and complete['status'] == 'PASS'
out['override_before_release_window_elapsed'] = {'at_completion':early, 'after_33ms':complete}

# Drive the REAL m600 step, stubbing only external operations. For the second
# T1 M600 a failed probe/abort leaves length unchanged and G43 cancelled.
# This is not the planted 1 mm measurement error, yet the whole step passes.
class MeasurementClient:
    def __init__(self):
        self.status = state(tool_offset=[0, 0, 50], tool_table_z=50)
        self.vars = {n:0 for n in nr.TOOLSETTER_VARS} | {3102:-180}
        self.table = 50
    def request(self, cmd, **kw):
        if cmd == 'get_tool_table': return {'tools':[{'T':1,'Z':self.table}]}
        if cmd == 'get_probe_vars': return {'vars':{str(k):self.vars[k] for k in kw['vars']}}
        if cmd == 'save_tool': self.table = kw['z_offset']; return {'ok':True}
        if cmd == 'set_probe_vars': self.vars.update({int(k):v for k,v in kw['vars'].items()}); return {'ok':True}
        raise AssertionError((cmd,kw))
c = MeasurementClient()
frames = []
ctx = {'client':c, 'frames':frames, 'plate':{'x':10,'y':10,'z':-180}}
call_no = 0
counter_errors = ['G38.2 move finished without making contact.']
def routine(client, text, vars=None, **kw):
    global call_no
    if text == 'T0 M600':
        client.status.update(tool_number=0, tool_offset=[0,0,0])
        return {'t0':0, 'served':[{'tool':0,'seq':1}], 'errors':[]}
    assert text == 'T1 M600'
    call_no += 1
    client.status.update(tool_number=1, tool_table_z=50, tool_offset=[0,0,50] if call_no == 1 else [0,0,0])
    if call_no == 1:
        frames.extend([lock_frame(.03, True), lock_frame(.2, False, velocity=1),lock_frame(1.033, True, idle=True)])
    return {'t0':0, 'served':[{'tool':1,'seq':2}], 'errors':[] if call_no == 1 else counter_errors}
def short(client, text):
    assert text == 'G43 H1'
    client.status['tool_offset'] = [0,0,50]
with patch.object(nr, '_routine', routine), patch.object(nr, '_short', short):
    rows = nr.m600_cases()[1](ctx)
assert all(r['status'] == 'PASS' for r in rows)
out['m600_counter_passes_for_other_failure'] = {'rows':rows, 'counter_errors_returned_by_routine':counter_errors}

# Unknowns must not erase a contradictory known value. The old jog cases
# explicitly preserve this rule; the new probe/M600 evaluators don't.
rows = [nc.eval_probe_miss('known-write-without-contact', 0, 0, -1, []),
        nc.eval_probe_miss('same-known-write-contact-unread', None, 0, -1, []),
        nc.eval_m600('known-bad-length-offset-unread', 50, 60, None)]
out['known_contradictions_with_unknown_partners'] = rows
assert rows[0]['status'] == 'FAIL' and rows[1]['status'] == rows[2]['status'] == 'incomplete'
print(json.dumps(out, indent=2))
