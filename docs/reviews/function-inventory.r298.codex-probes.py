# R298 independent probes, adapted from the preserved R297 evidence. Synthetic frames / clock / transport only.
# Helpers derived from the R296 probe, with a custom course argument.
# Assertions document observed behavior; findings name the required result.
"""R298 recheck of the R297 endpoint rest at 5f68e2a1; the former counterexample must now be incomplete.
python3 -B this.py /tmp/archive-of-5f68e2a1
Synthetic envelopes through the real SimulatorClient.take; no sockets,
LinuxCNC/HAL imports or machine commands. Assertions describe reviewed behavior;
`required` states the corrected outcome for a counterexample.
"""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch
from websockets.exceptions import ConnectionClosedError

sys.path.insert(0, str(Path(sys.argv[1]).resolve() / 'scripts'))
import native_run as nr
from test_support import native_cases as nc, tool_change as tc
from test_support.live_session import SimulatorClient, Refused, NoReply, TransportLost


out = {'positive': {}, 'corrected': {}, 'boundary_matrix': {}}

def st(line=0, pos=(10, 10, 0), *, mode=2, vel=50., idle=False, **kw):
    return dict(task_mode=mode, call_level=0, motion_line=line, joint_pos=list(pos),
                current_vel=vel, interp_state=1 if idle else 2, inpos=vel == 0,
                tool_change_requested=False, tool_change_seq=None, tool_number=1,
                tool_table_z=50., tool_offset=[0, 0, 50.], spindle_direction=1,
                spindle_speed=1000., feed_override_enabled=True) | kw

def course():
    hist = [(0., {'phase': 'safe_z', 'ok': True}), (1., {'phase': 'positioning', 'ok': True}),
            (2., {'phase': 'starting', 'ok': True}), (2.1, {'phase': 'running', 'ok': True})]
    frames = [(.05, st(pos=(10, 10, -80), mode=3)), (.95, st(pos=(10, 10, 0), mode=3, vel=0)),
              (1.5, st(pos=(60, 60, 0), mode=3)), (1.99, st(pos=(100, 100, 0), mode=3, vel=0)),
              (2., st(pos=(100, 100, 0), mode=3, vel=0)),
              (2.2, st(7, (101, 100, -.5))), (3.2, st(7, (150, 100, -25))),
              (4.2, st(8, (200, 101, -50))), (5.2, st(9, (200, 200, -40))),
              (6., st(11, (200, 200, 0), vel=0, idle=True))]
    return hist, frames

class Clock:
    def __init__(self): self.t = 0.
    def monotonic(self): return self.t
    def sleep(self, dt): self.t += dt

def full_step(scenario='valid', custom=None):
    clock = Clock()
    c = SimulatorClient('unused', auto_confirm=False, keep=nr.FRAME_KEYS)
    sent = []
    hist, frames = course() if custom is None else custom
    confirm_error = None
    auto_error = None
    if scenario == 'coalesced_running':
        # _rfl_phase only retains the latest phase. The next fanout after
        # positioning already says running and reports actual program motion.
        hist = hist[:2] + [(2.2, {'phase': 'running', 'ok': True})]
        frames = [(t, s) for t, s in frames if t != 2.]
    elif scenario == 'running_first_seen_at_final_rest':
        hist = hist[:2] + [(6., {'phase': 'running', 'ok': True})]
        frames = [(t, s) for t, s in frames if t < 2. or t == 6.]
    elif scenario == 'positioning_phase_still_moving_then_wrong_endpoint':
        frames[4][1]['joint_pos'][0] = 99.5
    elif scenario in ('confirmation_refused', 'confirmation_timeout', 'confirmation_transport', 'confirmation_send_closed'):
        hist = [(0., {'phase': 'measuring', 'ok': True})]
        frames = [(.1, st(pos=(10, 10, -80), mode=3, vel=0, tool_change_requested=True,
                          tool_change_seq=9, tool_change_tool=1))]
        confirm_error = {'confirmation_refused': 'confirm_tool_change refused: Tool change request changed',
                         'confirmation_timeout': 'No gateway reply to confirm_tool_change',
                         'confirmation_transport': 'connection closed without a close frame',
                         'confirmation_send_closed': 'actual send exception'}[scenario]
    elif scenario in ('auto_refused', 'auto_timeout', 'auto_transport'):
        auto_error = {'auto_refused': 'auto_run refused: Program changed',
                      'auto_timeout': 'No gateway reply to auto_run',
                      'auto_transport': 'connection closed without a close frame'}[scenario]
    elif scenario in ('flag_clear_failed', 'measure_failed'):
        hist = [(0., {'phase': 'measuring', 'ok': True}),
                (.2, {'phase': scenario, 'ok': False, 'error': 'known terminal failure of this attempt'})]
        frames = [(.1, st(mode=3)), (.2, st(mode=3, vel=0, idle=True))]
    elif scenario == 'error_without_phase':
        hist = [(0., {'phase': 'measuring', 'ok': True})]
        frames = [(.1, st(mode=3)), (.2, st(mode=3, vel=0, idle=True))]

    def receive(t, status, **envelope):
        clock.t = t
        c.take({'type': 'status', 'data': status, **envelope})

    class ClosedTransport:
        def send(self, data):
            raise ConnectionClosedError(None, None)
    c.ws = ClosedTransport()

    def request(cmd, **kw):
        sent.append((cmd, kw))
        if cmd == 'get_tool_table': return {'tools': [{'T': 1, 'Z': 50.}]}
        if cmd == 'get_probe_vars': return {'vars': {str(k): -180. if k == 3102 else 0. for k in kw['vars']}}
        if cmd == 'load_file':
            p = Path(kw['path'])
            origin = {'file': str(p), 'version': 12, 'source': hashlib.sha256(p.read_bytes()).hexdigest()}
            receive(0, st(pos=(10, 10, -80), mode=3, vel=0, idle=True), preview_origin=origin)
        elif cmd == 'auto_run':
            if scenario == 'auto_send_closed':
                # Exercise the actual request/send methods. No socket exists;
                # only the transport raises the library's real exception type.
                return SimulatorClient.request(c, cmd, **kw)
            if auto_error: raise {'auto_refused': Refused, 'auto_timeout': NoReply, 'auto_transport': TransportLost}[scenario](auto_error)
            events = {}
            for t, phase in hist: events.setdefault(t, {})['rfl_status'] = phase
            for t, state in frames: events.setdefault(t, {})['data'] = state
            if scenario == 'error_without_phase': events[.2]['errors'] = [[11, 'known error of this attempt']]
            for t, ev in sorted(events.items()):
                receive(t, ev.get('data', dict(c.status)), **{k: v for k, v in ev.items() if k != 'data'})
        elif cmd == 'confirm_tool_change':
            if scenario == 'confirmation_send_closed':
                return SimulatorClient.request(c, cmd, **kw)
            assert confirm_error
            raise {'confirmation_refused': Refused, 'confirmation_timeout': NoReply, 'confirmation_transport': TransportLost}[scenario](confirm_error)
        else: raise AssertionError(cmd)
        return {'ok': True}
    c.request = request
    with tempfile.TemporaryDirectory(prefix='codex-r296-rfl-') as folder:
        config = Path(folder); (config / nr.NC_FILES).mkdir()
        ctx = {'client': c, 'frames': c.frames, 'config': config, 'report': {}}
        with patch.object(tc, 'time', clock), patch.object(nr, 'time', clock), \
             patch('test_support.live_session.time', clock), patch.object(nr, '_short', lambda *_: None):
            receive(-.1, st(pos=(10, 10, -80), mode=3, vel=0, idle=True))
            try:
                result = {'rows': nr.rfl_cases()[1](ctx)}
            except Exception as exc:
                result = {'exception': type(exc).__name__, 'error': str(exc), 'rows': getattr(exc, 'rows', [])}
        result.update(report=ctx['report'], elapsed_s=clock.t, errors=c.errors,
                      history=c.rfl_history, frames=c.frames, sent=sent)
        return result

# Removing the boundary AUTO frame makes the last earlier MDI standstill
# become the endpoint again. No endpoint of positioning was observed here.
h, f = course()
h = h[:2] + [(2.2, {'phase': 'running', 'ok': True})]
f = [(t, s) for t, s in f if t < 1. or t >= 2.2]
f.insert(2, (1., st(pos=(10, 10, 0), mode=3, vel=0)))
r = full_step(custom=(h, f))
by = {x['case']: x for x in r['rows']}
assert by['rfl-line']['status'] == 'PASS'
assert by['rfl-start-point']['status'] == 'incomplete', by['rfl-start-point']
r['required'] = 'start-point incomplete: the AUTO boundary is not an entry proof, and the earlier stationary MDI start is not the endpoint'
out['corrected']['filtered_auto_boundary_reuses_initial_standstill'] = r

# Same gap with already-correct initial position is no contradiction.
h, f = course()
h = h[:2] + [(2.2, {'phase': 'running', 'ok': True})]
f = [(t, s) for t, s in f if t < 1. or t >= 2.2]
f.insert(2, (1., st(pos=(100, 100, 0), mode=3, vel=0)))
r = full_step(custom=(h, f))
assert r['rows'][-1]['status'] == 'incomplete'
out['positive']['already_at_entry_with_no_motion_needed'] = r

# Keeping an unknown boundary frame prevents the fallback correctly today.
h, f = course()
f[3][1]['joint_pos'] = [10, 10, 0]
f[4] = (2., st(pos=(10, 10, 0), mode=None, vel=0))
r = full_step(custom=(h, f))
assert r['rows'][-1]['status'] == 'incomplete'
out['positive']['unknown_boundary_is_not_an_entry_proof'] = r

# Client-boundary proofs use the actual request and send, with no sockets.
import queue
from test_support import live_session as ls

def client_case(kind):
    c = ls.SimulatorClient('unused', auto_confirm=False)
    clock = Clock(); sent = []
    class Transport:
        def send(self, data):
            sent.append(json.loads(data))
            if kind == 'closed': raise ConnectionClosedError(None, None)
            if kind == 'os_error': raise BrokenPipeError('synthetic broken pipe')
            if kind == 'programming_error': raise ValueError('synthetic programming error')
            if kind == 'reader_closes_during_wait': c.error = 'reader closed after sending'
    c.ws = Transport()
    if kind == 'reader_already_closed': c.error = 'reader was already closed'
    if kind in ('success', 'refused'):
        c.replies.put({'type': 'reply', 'cmd': 'auto_run', 'ok': kind == 'success', 'error': 'denied'})
    if kind == 'no_reply':
        class EmptyInbox:
            def get(self, timeout):
                clock.t += timeout
                raise queue.Empty
        c.replies = EmptyInbox()
    with patch.object(ls, 'time', clock):
        try:
            result = {'reply': c.request('auto_run', line=7)}
        except Exception as exc:
            result = {'exception': type(exc).__name__, 'detail': str(exc)}
    result.update(sent=sent, elapsed_s=clock.t)
    return result

for kind, expected in [('success', None), ('refused', 'Refused'), ('no_reply', 'NoReply'),
                       ('closed', 'TransportLost'), ('os_error', 'TransportLost'),
                       ('reader_already_closed', 'TransportLost'), ('reader_closes_during_wait', 'TransportLost'),
                       ('programming_error', 'ValueError')]:
    r = client_case(kind)
    assert r.get('exception') == expected, (kind, r)
    assert len(r['sent']) == (0 if kind == 'reader_already_closed' else 1)
    out['positive']['real_client_' + kind] = r

# The full step also rejects a negative phase unknown to its name catalogue.
h = [(0., {'phase': 'measuring', 'ok': True}),
     (.2, {'phase': 'new_terminal_failure', 'ok': False, 'error': 'negative verdict'})]
f = [(.1, st(mode=3)), (.2, st(mode=3, vel=0, idle=True))]
r = full_step(custom=(h, f))
assert r['exception'] == 'StepFailed' and r['rows'][0]['status'] == 'FAIL' and r['elapsed_s'] < 1
assert 'new_terminal_failure' in r['rows'][0]['detail']
out['positive']['unknown_negative_phase_at_whole_step'] = r

# Boundary eligibility: the true last frame is authoritative; neither a
# wrong older standstill nor unknown X may erase what this frame says.
for name, mode, vel, pos, expected in [
    ('mdi_wrong_endpoint', 3, 0., [10, 10, 0], 'FAIL'),
    ('mdi_correct_endpoint', 3, 0., [100, 100, 0], 'incomplete'),
    ('mdi_wrong_moving', 3, 20., [10, 10, 0], 'incomplete'),
    ('mdi_unknown_velocity', 3, None, [10, 10, 0], 'incomplete'),
    ('mdi_unread_x_known_wrong_y', 3, 0., [None, 99, 0], 'FAIL'),
    ('mdi_unread_xy', 3, 0., [None, None, 0], 'incomplete'),
    ('auto_wrong_still', 2, 0., [10, 10, 0], 'incomplete'),
    ('auto_program_below_safe', 2, 20., [101, 100, -0.5], 'incomplete'),
    ('manual_wrong_still', 1, 0., [10, 10, 0], 'incomplete'),
    ('unknown_mode_wrong_still', None, 0., [10, 10, 0], 'incomplete'),
]:
    h, f = course()
    f[3] = (1.99, st(pos=(10, 10, 0), mode=3, vel=0))
    frame = st(pos=(10, 10, 0), mode=mode, vel=0)
    frame.update(current_vel=vel, joint_pos=pos, motion_line=7 if mode == 2 else 0)
    f[4] = (2., frame)
    result = full_step(custom=(h, f))
    rows = {r['case']: r for r in result['rows']}
    assert rows['rfl-line']['status'] == 'PASS', (name, rows)
    assert rows['rfl-start-point']['status'] == expected, (name, rows)
    out['boundary_matrix'][name] = result

print(json.dumps(out, indent=2))
