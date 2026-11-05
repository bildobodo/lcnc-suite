"""R297 earlier regression of R295 at 56d65b29; corrected outcomes and the real client refusal spelling.
python3 -B this.py /tmp/archive-of-56d65b29
No network or LinuxCNC/HAL imports. Assertions capture current behavior,
including defects; the `required` field states the expected corrected verdict.
"""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

sys.path.insert(0, str(Path(sys.argv[1]).resolve() / 'scripts'))
import native_run as nr
from test_support import native_cases as nc, tool_change as tc
from test_support.live_session import SimulatorClient, Refused

out = {'positive': {}, 'findings': {}}

def st(line=0, pos=(10, 10, 0), *, mode=2, vel=50., idle=False, **kw):
    return dict(task_mode=mode, call_level=0, motion_line=line, joint_pos=list(pos),
                current_vel=vel, interp_state=1 if idle else 2, inpos=vel == 0,
                tool_change_requested=False, tool_change_seq=None, tool_number=1,
                tool_table_z=50., tool_offset=[0, 0, 50.], spindle_direction=1,
                spindle_speed=1000., feed_override_enabled=True) | kw

def course():
    hist = [(0., {'phase': 'safe_z', 'ok': None}), (1., {'phase': 'positioning', 'ok': None}),
            (2., {'phase': 'starting', 'ok': None}), (2.1, {'phase': 'running', 'ok': True})]
    frames = [(.05, st(pos=(10, 10, -80), mode=3)), (.95, st(pos=(10, 10, 0), mode=3, vel=0)),
              (1.5, st(pos=(60, 60, 0), mode=3)), (1.99, st(pos=(100, 100, 0), mode=3, vel=0)),
              (2., st(pos=(100, 100, 0), mode=3, vel=0)),
              (2.2, st(7, (101, 100, -.5))), (3.2, st(7, (150, 100, -25))),
              (4.2, st(8, (200, 101, -50))), (5.2, st(9, (200, 200, -40))),
              (6., st(11, (200, 200, 0), vel=0, idle=True))]
    return hist, frames

def judge(hist, frames):
    return nc.eval_rfl_line('rfl-line', hist, frames, line=7, tool=1, l0=50., spindle_speed=1000.,
                            end_point=(200., None, -50.), final=(200., 200., 0.), line_holds={1: 100.})

def record(group, name, row, expected, **values):
    assert row['status'] == expected, (name, row)
    out[group][name] = {'row': row, **values}

h, f = course()
record('positive', 'line_and_ends', judge(h, f), 'PASS')
record('positive', 'entry_endpoint_seen', nc.eval_rfl_start_point('entry', h, f, (100, 100)), 'incomplete')
f[4][1]['joint_pos'][0] = 99.5
record('positive', 'actual_entry_standstill_wrong', nc.eval_rfl_start_point('entry', h, f, (100, 100)), 'FAIL')

# No status of the final standstill was received: the only observed zero
# speed is at the START of positioning, before its observed moving frames.
h, f = course()
f = [(t, s) for t, s in f if t not in (1.99, 2.)]
f.insert(2, (1., st(pos=(10, 10, 0), mode=3, vel=0)))
f.insert(4, (1.99, st(pos=(99.8, 99.8, 0), mode=3, vel=20)))
record('findings', 'positioning_initial_standstill_used_as_endpoint',
       nc.eval_rfl_start_point('entry', h, f, (100, 100)), 'incomplete', history=h, frames=f,
       required='incomplete: the last observed standstill precedes the positioning motion')

# Missing every moving program sample must not make the entry window extend
# through the program's final standstill.
h, f = course()
f = [(t, s) for t, s in f if not (s['task_mode'] == 2 and s['current_vel'] > 0)]
record('findings', 'missing_motion_extends_entry_window_through_program_end',
       nc.eval_rfl_start_point('entry', h, f, (100, 100)), 'incomplete', history=h, frames=f,
       required='incomplete: the program final standstill is not an entry endpoint')

# The step waits for inpos, but the evaluator takes an earlier interpreter
# idle frame during the final move and treats it as the program endpoint.
h, f = course(); f[-2][1]['interp_state'] = 1
record('findings', 'interpreter_idle_while_motion_still_runs', judge(h, f), 'PASS', history=h, frames=f,
       required='PASS for the line/end subcase: the later confirmed completion is at the correct position')

# Known safe-Z violations must not disappear when X was not read.
for name, unknown in [('safe_Z_drop_known_X', False), ('safe_Z_drop_unknown_X', True)]:
    h, f = course()
    f.insert(1, (.5, st(pos=(None if unknown else 10, 10, -81), mode=3)))
    record('findings' if unknown else 'positive', name,
           nc.eval_rfl_start_point('entry', h, f, (100, 100)), 'FAIL',
           history=h, frames=f, required='FAIL: known Z is 1 mm below its own -80 start')

class Clock:
    def __init__(self): self.t = 0.
    def monotonic(self): return self.t
    def sleep(self, dt): self.t += dt

def full_step(fault=None):
    clock = Clock()
    c = SimulatorClient('unused', auto_confirm=False, keep=nr.FRAME_KEYS)
    sent = []
    hist, frames = course()
    if fault in ('undeclared', 'unknown_tool', 'confirmation_refused'):
        hist = [(0., {'phase': 'measuring', 'ok': None})]
        tool = 2 if fault == 'undeclared' else None if fault == 'unknown_tool' else 1
        frames = [(.1, st(pos=(10, 10, -80), mode=3, vel=0, tool_change_requested=True,
                          tool_change_seq=9, tool_change_tool=tool))]
    elif fault == 'early_idle':
        frames[-2][1]['interp_state'] = 1
    elif fault == 'error_before_program':
        hist = [(0., {'phase': 'measuring', 'ok': None})]
        frames = [(.1, st(mode=3)), (.2, st(mode=3, vel=0, idle=True))]

    def receive(t, status, **envelope):
        clock.t = t
        c.take({'type': 'status', 'data': status, **envelope})

    def request(cmd, **kw):
        sent.append((cmd, kw))
        if cmd == 'get_tool_table': return {'tools': [{'T': 1, 'Z': 50.}]}
        if cmd == 'get_probe_vars': return {'vars': {str(k): -180. if k == 3102 else 0. for k in kw['vars']}}
        if cmd == 'load_file':
            p = Path(kw['path'])
            origin = {'file': str(p), 'version': 12, 'source': hashlib.sha256(p.read_bytes()).hexdigest()}
            receive(0, st(pos=(10, 10, -80), mode=3, vel=0, idle=True), preview_origin=origin)
        elif cmd == 'auto_run':
            if fault == 'auto_refused':
                raise Refused('auto_run refused: freshly checked admission refused')
            events = {}
            for t, phase in hist: events.setdefault(t, {})['rfl_status'] = phase
            for t, state in frames: events.setdefault(t, {})['data'] = state
            if fault == 'error_before_program': events[.2]['errors'] = [[11, 'known error of this attempt']]
            for t, ev in sorted(events.items()):
                receive(t, ev.get('data', dict(c.status)), **{k: v for k, v in ev.items() if k != 'data'})
        elif cmd == 'confirm_tool_change':
            assert fault == 'confirmation_refused'
            raise Refused('confirm_tool_change refused: the gateway refused this confirmation')
        else: raise AssertionError(cmd)
        return {'ok': True}
    c.request = request
    with tempfile.TemporaryDirectory(prefix='codex-r295-rfl-') as folder:
        config = Path(folder); (config / nr.NC_FILES).mkdir()
        ctx = {'client': c, 'frames': c.frames, 'config': config, 'report': {}}
        with patch.object(tc, 'time', clock), patch.object(nr, 'time', clock), \
             patch('test_support.live_session.time', clock), patch.object(nr, '_short', lambda *_: None):
            receive(-.1, st(pos=(10, 10, -80), mode=3, vel=0, idle=True))
            try:
                rows = nr.rfl_cases()[1](ctx)
                result = {'rows': rows}
            except Exception as exc:
                result = {'exception': type(exc).__name__, 'error': str(exc), 'rows': getattr(exc, 'rows', [])}
        result.update(report=ctx['report'], elapsed_s=clock.t, errors=c.errors,
                      history=c.rfl_history, frames=c.frames, sent=sent)
        return result

r = full_step()
assert [x['status'] for x in r['rows']] == ['PASS', 'PASS', 'PASS', 'incomplete']
out['positive']['complete_step'] = r
r = full_step('unknown_tool')
assert r['exception'] == 'StepFailed' and r['rows'][0]['status'] == 'incomplete'
out['positive']['unread_requested_tool_stays_incomplete'] = r

r = full_step('early_idle')
assert r['rows'][0]['status'] == 'PASS'
r['required'] = 'line/end PASS: final status has inpos true at the right endpoint; first idle is not completion'
out['findings']['whole_step_uses_earlier_idle_to_judge_end'] = r

for fault in ('undeclared', 'confirmation_refused'):
    r = full_step(fault)
    assert r['exception'] == 'StepFailed' and r['rows'][0]['status'] == 'FAIL'
    assert r['rows'][1]['status'] != 'PASS'
    r['required'] = 'FAIL row naming the known helper contradiction/refusal, with the incomplete counter'
    out['findings']['helper_' + fault + '_lost_in_row'] = r

r = full_step('auto_refused')
assert r['exception'] == 'StepFailed' and r['rows'][0]['status'] == 'FAIL' and 'rfl_history' in r['report']
r['required'] = 'attempt rejection retained in a failure row with the attempt evidence before teardown'
out['findings']['auto_run_rejection_bypasses_rows'] = r

r = full_step('error_before_program')
assert r['exception'] == 'StepFailed' and r['rows'][0]['status'] == 'FAIL' and r['elapsed_s'] < 1
r['required'] = 'the known error plus idle terminates promptly, without waiting for a never-started program'
out['findings']['error_without_terminal_phase_waits_deadline'] = r

out['corrected_r295_cases'] = out.pop('findings')
print(json.dumps(out, indent=2))
