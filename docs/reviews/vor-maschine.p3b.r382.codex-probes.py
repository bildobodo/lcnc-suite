"""R382 review counterexamples. Only fake clients/sockets; no live access.

Assertions are the agreed contract; failures at e743061a are findings.
"""
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).parent / 'scripts'))
import native_run as nr
import test_native_stage as guards
from test_support.live_session import SimulatorClient


def test_wait_failure_aborts_before_reading_interpreter(monkeypatch):
    original_job = guards.ProbeRunFake.job
    original_request = guards.ProbeRunFake.request

    def failed_wait(self, case, cmd, payload):
        result = original_job(self, case, cmd, payload)
        if case == 'probe-run':
            self.tick(interp_state=2, inpos=False, current_vel=5.0)
            result.update(error='injected wait deadline', t_done=None)
        return result

    def request(self, cmd, **kw):
        self.events.append('wire:' + cmd)
        return original_request(self, cmd, **kw)

    monkeypatch.setattr(guards.ProbeRunFake, 'job', failed_wait)
    monkeypatch.setattr(guards.ProbeRunFake, 'request', request)
    rows, client, _, error = guards._probe_run(monkeypatch)
    assert error and 'wait deadline' in error
    tail = client.events[client.events.index('job:probe-run') + 1:]
    assert tail[0] == 'wire:abort', tail


@pytest.mark.parametrize('hazard', ['trip', 'disconnect'])
def test_probe_restore_rechecks_after_wait(monkeypatch, hazard):
    calls = []
    client = SimpleNamespace(error=None, safety_trip=None,
                             status={'feed_override_enabled': True, 'g5x_index': 1,
                                     'g5x_offset': [0.0, 0.0, 0.0]})
    client.request = lambda cmd, **kw: calls.append(cmd) or {'ok': True}

    def standstill(c, timeout):
        if hazard == 'trip':
            c.safety_trip = {'id': 'test-trip'}
        else:
            c.error = 'connection lost during wait'
        return True

    monkeypatch.setattr(nr, '_standstill', standstill)
    monkeypatch.setattr(nr, '_switches', lambda ctx, c: {'probing': True})
    monkeypatch.setattr(nr, '_override_free', lambda c: calls.append('override'))
    monkeypatch.setattr(nr, '_save_features', lambda *a: calls.append('features'))
    monkeypatch.setattr(nr, '_short', lambda *a: calls.append('g54'))
    monkeypatch.setattr(nr, '_plant', lambda *a: calls.append('values'))
    row = nr._probe_run_restore({}, client, {'probing': True}, {3014: 99})
    assert calls == ['abort'], (hazard, calls, row)
    assert row['status'] != 'PASS', row


@pytest.mark.parametrize('hazard', ['trip', 'busy'])
def test_surface_failure_does_not_write_before_admission(monkeypatch, tmp_path, hazard):
    original_routine = guards.SurfaceSim.routine
    original_request = guards.SurfaceSim.request
    after_failure = []

    def routine(self, text, **kw):
        if text == 'O<surface_scan> CALL':
            self.failed_scan = True
            self.safety_trip = {'id': 'test-trip'} if hazard == 'trip' else None
            self.error = None
            self.tick(1, interp_state=2, inpos=False, current_vel=5.0)
            raise RuntimeError('scan wait failed: ' + hazard)
        return original_routine(self, text, **kw)

    def request(self, cmd, **kw):
        if getattr(self, 'failed_scan', False):
            after_failure.append((cmd, self.status['interp_state'], self.status['inpos']))
        return original_request(self, cmd, **kw)

    monkeypatch.setattr(guards.SurfaceSim, 'routine', routine)
    monkeypatch.setattr(guards.SurfaceSim, 'request', request)
    _, _, _, error = guards._surface_step(monkeypatch, tmp_path)
    assert error and 'scan wait failed' in error
    if hazard == 'trip':
        assert after_failure == [], after_failure
    else:
        assert after_failure and after_failure[0][0] == 'abort', after_failure


def test_only_a_lock_after_actual_send_is_a_start():
    c = SimulatorClient('unused', auto_confirm=False, keep=nr.FRAME_KEYS)
    idle = {'interp_state': 1, 'inpos': True, 'current_vel': 0.0,
            'tool_change_requested': False, 'tool_change_seq': None, 'tool_number': 99}

    def take(free, **extra):
        c.take({'type': 'status', 'data': {**idle, 'feed_override_enabled': free, **extra}})

    take(True)
    writes = []

    class Socket:
        def send(self, raw):
            command = json.loads(raw)
            writes.append((time.monotonic(), command))
            c.replies.put({'cmd': command['cmd'], 'ok': True, 'mdi_set': True,
                           'persisted': True, 'line': 'O<probe_z_minus_wco> CALL'})

    c.ws = Socket()
    real_request = c.request

    def request(cmd, **kw):
        # Frames arrive after bounds() but BEFORE SimulatorClient writes.
        # At the real send the latest baseline is free, but both old frames
        # already belong to the helper's post-cursor slice.
        take(False)
        take(True)
        reply = real_request(cmd, **kw)
        # The actual job has no lock transition at all.
        take(True, interp_state=2, inpos=False, current_vel=5.0)
        take(True)
        return reply

    c.request = request
    result = nr._probe_job(c, 'probe-run', 'probe_run', {'routine': 'probe_z_minus_wco', 'vars': {}}, deadline=.05)
    locks = [t for t, st in c.frames if st['feed_override_enabled'] is False]
    assert len(writes) == 1 and locks and max(locks) < writes[0][0]
    assert result['start']['status'] != 'PASS', {
        'start': result['start'], 'cursor': result['cursor'],
        'lock_times': locks, 'real_send': writes[0][0], 'error': result['error']}


def test_control_actual_post_send_lock_passes():
    client = guards._JobClient(True, [(True, 2, False), (False, 2, False), (True, 1, True)])
    result = nr._probe_job(client, 'probe-run', 'probe_run', {'routine': 'probe_z_minus_wco', 'vars': {}}, deadline=.1)
    assert result['start']['status'] == 'PASS' and result['error'] is None


def test_control_closed_baseline_sends_nothing():
    client = guards._JobClient(False, [])
    with pytest.raises(nr.Refused, match='no free override baseline'):
        nr._probe_job(client, 'probe-run', 'probe_run', {}, deadline=.1)
    assert client.sent == []
