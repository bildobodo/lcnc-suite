"""R384 integration proof: no later step after lost admission, safe teardown.
Only FakeHost and a local socket; no real LinuxCNC, services, or network.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent / 'scripts'))
import native_run as nr
import test_native_stage as guards
from test_support.live_session import SimulatorClient


@pytest.mark.parametrize('case,body', [('probe_cases', '_probe_steps'), ('surface_cases', '_surface_steps')])
@pytest.mark.parametrize('wrapped', [False, True])
@pytest.mark.parametrize('hazard', ['trip', 'disconnect', None])
def test_case_admission_ends_run_and_always_returns_environment(monkeypatch, tmp_path, case, body, wrapped, hazard):
    monkeypatch.setattr(nr.heavy, 'LOCK', tmp_path / 'own-heavy.lock')
    c = SimulatorClient('unused', auto_confirm=False, keep=nr.FRAME_KEYS)
    wire, events = [], []

    class Socket:
        def send(self, raw):
            command = json.loads(raw)
            wire.append(command)
            c.replies.put({'cmd': command['cmd'], 'ok': True})

        def close(self):
            events.append('socket-close')

    c.ws = Socket()

    def setup(ctx):
        ctx['client'] = c
        ctx['cleanup'] = lambda: nr._stop_copy(ctx)

    def stub_body(ctx):
        ctx['client'].request('mdi', text='G4 P0')
        ctx['rows'].append({'case': 'already-observed', 'status': 'PASS'})
        if hazard == 'trip':
            c.take({'type': 'status', 'data': {'interp_state': 1, 'inpos': True},
                    'safety_trip': {'id': 'r384.synthetic-trip'}})
        elif hazard == 'disconnect':
            c.error = 'synthetic connection lost'
        try:
            ctx['client'].request('mdi', text='G0 X1')
        except nr.NotAdmitted as exc:
            if wrapped:
                raise nr.StepFailed(ctx['rows'], str(exc)) from exc
            raise
        return ctx['rows']

    monkeypatch.setattr(nr, body, stub_body)

    def later(ctx):
        events.append('later-step')
        return [{'case': 'later', 'status': 'PASS'}]

    host = guards.FakeHost()
    report = nr.run(host, [('setup', setup), getattr(nr, case)(), ('later', later)], tmp_path / 'run')
    assert report['restore']['outcome'] == 'complete', report
    assert host.started == ['lcnc-sim-gates', 'bg-keepalive']
    assert events[-1] == 'socket-close' and 'request' not in vars(c)
    assert report['rows'][0] == {'case': 'already-observed', 'status': 'PASS'}
    assert json.loads((tmp_path / 'run/report.json').read_text()) == report
    if hazard:
        assert 'later-step' not in events and report['steps'][-1] in ('probe', 'surface')
        assert nr.verdict(report) == 'FAIL' and 'NotAdmitted' in report['error'] if not wrapped else (
            nr.verdict(report) == 'FAIL' and 'StepFailed' in report['error'])
        assert not [m for m in wire if m.get('text') == 'G0 X1']
    else:
        assert 'later-step' in events and nr.verdict(report) == 'PASS', report
    assert not any(m['cmd'] in ('safety_trip_ack', 'estop_reset', 'machine_on') for m in wire)
    if hazard == 'disconnect':
        assert 'cleanup_error' in report
        assert [m['cmd'] for m in wire] == ['mdi']
    else:
        assert wire[-2:] == [{'cmd': 'abort'}, {'cmd': 'arm', 'armed': False}]
