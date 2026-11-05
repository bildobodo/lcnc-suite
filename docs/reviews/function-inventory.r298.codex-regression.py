"""R297 regression of R296 at 56d65b29, adapted to typed client failures.
python3 -B this.py /tmp/archive-of-56d65b29
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

out = {'positive': {}, 'findings': {}}

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

def full_step(scenario='valid'):
    clock = Clock()
    c = SimulatorClient('unused', auto_confirm=False, keep=nr.FRAME_KEYS)
    sent = []
    hist, frames = course()
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

for scenario in ('valid', 'positioning_phase_still_moving_then_wrong_endpoint', 'confirmation_refused',
                 'auto_refused', 'auto_timeout', 'auto_transport', 'measure_failed', 'error_without_phase'):
    r = full_step(scenario)
    by = {x['case']: x for x in r['rows']}
    assert len(by) == 4 and 'rfl_history' in r['report'] and 'rfl_errors' in r['report']
    if scenario == 'valid':
        assert [x['status'] for x in r['rows']] == ['PASS', 'PASS', 'PASS', 'incomplete']
    elif scenario == 'positioning_phase_still_moving_then_wrong_endpoint':
        assert by['rfl-start-point']['status'] == 'FAIL'
    else:
        assert r['exception'] == 'StepFailed'
        expected = 'incomplete' if scenario in ('auto_timeout', 'auto_transport') else 'FAIL'
        assert by['rfl-line']['status'] == expected and by['rfl-line.counter-line+1']['status'] == 'incomplete'
        assert r['elapsed_s'] < 1
    out['positive'][scenario] = r

for scenario in ('coalesced_running', 'running_first_seen_at_final_rest'):
    r = full_step(scenario)
    by = {x['case']: x for x in r['rows']}
    assert by['rfl-start-point']['status'] == 'incomplete'
    if scenario == 'coalesced_running': assert by['rfl-line']['status'] == 'PASS'
    r['required'] = 'start-point incomplete: a running-program frame does not belong to the positioning path'
    out['findings'][scenario] = r

for scenario in ('confirmation_timeout', 'confirmation_transport'):
    r = full_step(scenario)
    assert r['exception'] == 'StepFailed'
    assert r['rows'][0]['status'] == 'incomplete' and r['rows'][0]['cause'] == 'unobserved'
    assert sum(cmd == 'confirm_tool_change' for cmd, _ in r['sent']) == 1
    r['required'] = 'incomplete / unobserved: no received refusal; end and preserve evidence without retry'
    out['findings'][scenario] = r

r = full_step('flag_clear_failed')
assert r['exception'] == 'StepFailed' and r['rows'][0]['status'] == 'FAIL'
assert r['elapsed_s'] < 1 and r['history'][-1][1]['ok'] is False
r['required'] = 'FAIL naming flag_clear_failed; the known gateway failure plus idle ends the attempt promptly'
out['findings']['terminal_phase_missing_from_catalogue'] = r

for scenario in ('auto_send_closed', 'confirmation_send_closed'):
    r = full_step(scenario)
    assert r['exception'] == 'StepFailed' and len(r['rows']) == 4
    assert r['rows'][0]['status'] == 'incomplete' and r['rows'][0]['cause'] == 'unobserved'
    assert 'rfl_history' in r['report'] and 'rfl_errors' in r['report']
    r['required'] = 'transport loss -> incomplete / unobserved, rows and evidence preserved; no retry'
    out['findings'][scenario] = r

out['corrected_r296_cases'] = out.pop('findings')
print(json.dumps(out, indent=2))
