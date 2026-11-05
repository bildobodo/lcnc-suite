"""R295 regression of R294 probes at 5cc74eda; only verdict expectations adapted.

Usage: python3 -B this.py /tmp/archive-of-5cc74eda
Synthetic status/envelope traffic through SimulatorClient.take; no network,
no LinuxCNC/HAL imports or commands. Assertions record the reviewed behavior,
including defects; they are NOT acceptance assertions for that behavior.
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
from test_support.live_session import SimulatorClient

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

def judge(hist, frames, line=7):
    return nc.eval_rfl_line('rfl-line', hist, frames, line=line, tool=1, l0=50., spindle_speed=1000.,
                            end_point=(200., None, -50.), final=(200., 200., 0.), line_holds={1: 100.})

def record(group, name, row, expected, **values):
    assert row['status'] == expected, (name, row)
    out[group][name] = {'row': row, **values}

h, f = course()
base = judge(h, f)
record('positive', 'line_witness_and_ends', base, 'PASS')
record('positive', 'counter_bound_to_true_witness', nc.counter('counter', judge(h, f, 8), base), 'PASS')
record('positive', 'start_path_still_unproven', nc.eval_rfl_start_point('start', h, f, (100, 100)), 'incomplete')
for name, change in [('wrong_tool', {'tool_number': 2}), ('wrong_spindle', {'spindle_speed': 800}),
                     ('wrong_length', {'tool_table_z': 51., 'tool_offset': [0, 0, 51.]}),
                     ('held_axis_really_moved', {'joint_pos': [101, 102, -.5]})]:
    ff = copy.deepcopy(f); ff[5][1].update(change)
    record('positive', name, judge(h, ff), 'FAIL')
record('positive', 'known_failure_phase_evaluator', judge(h + [(6.1, {'phase': 'failed', 'error': 'fault'})], f), 'FAIL')
early = copy.deepcopy(f); early[5][1]['motion_line'] = 6
record('positive', 'earlier_line_is_a_contradiction', judge(h, early), 'FAIL')

# The last sample of a phase need not be its endpoint. The very next phase
# here actually reports the correct endpoint, after the preceding moving one.
h, f = course(); f[3] = (1.99, st(pos=(99.8, 99.8, 0), mode=3, vel=20))
record('findings', 'positioning_last_sample_is_still_moving',
       nc.eval_rfl_start_point('start', h, f, (100, 100)), 'incomplete', history=h, frames=f,
       required='incomplete pending servo proof; no observed failed endpoint')

# Losing the actual L witness proves neither a correct nor a wrong start.
h, f = course(); f = [(t, s) for t, s in f if s['motion_line'] != 7]
record('findings', 'first_observed_motion_is_later_than_L', judge(h, f), 'incomplete', history=h, frames=f,
       required='incomplete: line 7 was not observed; not proof of a start at line 8')

# The first observed line beyond L need not be L+1; line 9 is allowed to
# move Z, so its Z cannot be used as the unchanged endpoint witness of L.
h, f = course(); f = [(t, s) for t, s in f if s['motion_line'] != 8]
record('findings', 'first_past_L_is_already_the_Z_move', judge(h, f), 'incomplete', history=h, frames=f,
       required='incomplete: no compatible endpoint witness')

# The one axis explicitly required to hold is not read on any L sample.
h, f = course()
for t, s in f:
    if s['motion_line'] == 7:
        s['joint_pos'][1] = None
record('findings', 'held_axis_never_read', judge(h, f), 'incomplete', history=h, frames=f,
       required='incomplete: no known Y=100 on line 7')

# A known deviation must remain a contradiction if a different required
# coordinate could not be read; _off currently drops the entire comparison.
for name, frame_index, position in [('known_line_end_error_with_unknown_Z', 7, [199., 101., None]),
                                   ('known_final_Y_error_with_unknown_Z', -1, [200., 150., None])]:
    h, f = course(); f[frame_index][1]['joint_pos'] = position
    record('findings', name, judge(h, f), 'FAIL', history=h, frames=f,
           required='FAIL: the known axis already contradicts its required endpoint')

# A received frame with no value is not coverage of that value.
prefix = [(0.03, st(vel=0, feed_override_enabled=True)),
          (.2, st(feed_override_enabled=False)), (1., st(feed_override_enabled=False))]
for name, enabled, expected in [('known_locked_window', False, 'FAIL'),
                                 ('unread_lock_through_window', None, 'incomplete')]:
    frames = prefix + [(1.033 + .2 * k, st(vel=0, idle=True, feed_override_enabled=enabled)) for k in range(12)]
    group = 'positive' if enabled is False else 'findings'
    record(group, name, nc.eval_override_lock('override', frames, 0), expected, frames=frames,
           required='FAIL' if enabled is False else 'incomplete: the release value was unknown throughout')

class Clock:
    def __init__(self): self.t = 0.
    def monotonic(self): return self.t
    def sleep(self, dt): self.t += dt

def full_step(fault=None):
    clock = Clock()
    c = SimulatorClient('unused', auto_confirm=False, keep=nr.FRAME_KEYS)
    sent = []
    hist, frames = course()
    if fault == 'phase':
        hist = [(.05, {'phase': 'measuring', 'ok': None}),
                (.1, {'phase': 'measure_failed', 'ok': False, 'error': 'known probe failure'})]
        frames = [(.05, st(mode=3)), (.1, st(mode=3, vel=0, idle=True))]
    elif fault == 'error':
        # Stop at the same final coordinates, before M5/M2. The operator
        # error arrives on the real client's error channel at completion.
        frames[-1][1]['motion_line'] = 9

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
            events = {}
            for t, phase in hist: events.setdefault(t, {})['rfl_status'] = phase
            for t, state in frames: events.setdefault(t, {})['data'] = state
            if fault == 'error': events[6.]['errors'] = [[11, 'known AUTO program failure before M5/M2']]
            for t, ev in sorted(events.items()):
                receive(t, ev.get('data', dict(c.status)), **{k: v for k, v in ev.items() if k != 'data'})
        else: raise AssertionError(cmd)
        return {'ok': True}
    c.request = request
    with tempfile.TemporaryDirectory(prefix='codex-r294-rfl-') as folder:
        config = Path(folder); (config / nr.NC_FILES).mkdir()
        ctx = {'client': c, 'frames': c.frames, 'config': config, 'report': {}}
        with patch.object(tc, 'time', clock), patch.object(nr, 'time', clock), \
             patch('test_support.live_session.time', clock), patch.object(nr, '_short', lambda *_: None):
            receive(-.1, st(pos=(10, 10, -80), mode=3, vel=0, idle=True))
            try:
                rows = nr.rfl_cases()[1](ctx)
                result = {'rows': rows}
            except Exception as exc:
                result = {'exception': type(exc).__name__, 'cause': getattr(exc, 'cause', None),
                          'error': str(exc), 'rows': getattr(exc, 'rows', [])}
        result.update(report=ctx['report'], elapsed_s=clock.t, errors=c.errors,
                      history=c.rfl_history, frames=c.frames, sent=sent)
        return result

r = full_step()
assert [x['status'] for x in r['rows']] == ['PASS', 'PASS', 'PASS', 'incomplete']
auto = next(k for cmd, k in r['sent'] if cmd == 'auto_run')
assert auto['source'] == r['report']['rfl_origin']['source'] and auto['version'] == 12
assert auto['line'] == 7 and auto['pre_tool'] == 1 and auto['safe_z']
assert set(auto['probe_vars']) == {str(k) for k in nr.TOOLSETTER_VARS}
out['positive']['complete_step_and_request_identity'] = r

r = full_step('error')
assert r['errors'] and r['rows'][0]['status'] == 'FAIL' and r['exception'] == 'StepFailed'
r['required'] = 'FAIL: the received program error must reach the case verdict, scoped to this attempt'
out['findings']['step_ignores_received_program_error'] = r

r = full_step('phase')
assert r['exception'] == 'StepFailed' and r['elapsed_s'] < 1
assert r['rows'][0]['status'] == 'FAIL' and 'rfl_history' in r['report']
r['required'] = 'known failed phase -> promptly retained FAIL row and history, then teardown'
out['findings']['failed_phase_times_out_before_evaluator'] = r

out['corrected_r294_cases'] = out.pop('findings')
print(json.dumps(out, indent=2))
