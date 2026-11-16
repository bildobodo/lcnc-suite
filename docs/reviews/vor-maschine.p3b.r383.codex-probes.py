"""R383 isolated counterexamples. Fake socket, no live access."""
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent / 'scripts'))
import native_run as nr
from test_support.live_session import SimulatorClient


@pytest.mark.parametrize('event', ['trip', 'no_trip'])
def test_restore_does_not_send_more_chunks_after_trip_in_first_chunk(monkeypatch, event):
    """The real _finish/_plant/_short/_routine/client, no live connection.
    A trip arrives before the first plant chunk has completed. A busy/idle
    pair completes the short call, but must not authorize its sibling writes.
    """
    c = SimulatorClient('unused', auto_confirm=False, keep=nr.FRAME_KEYS)
    idle = {'interp_state': 1, 'inpos': True, 'current_vel': 0.0,
            'tool_change_requested': False, 'tool_change_seq': None, 'tool_number': 99}
    trip = None
    sent = []
    values = {n: float(n - 3000) for n in range(3014, 3036)}

    def take(**extra):
        c.take({'type': 'status', 'data': {**idle, **extra}, 'safety_trip': trip})

    take()

    class Socket:
        def send(self, raw):
            nonlocal trip
            command = json.loads(raw)
            sent.append((command, bool(trip)))
            text = command.get('text', '')
            if text.startswith('#') and event == 'trip':
                trip = {'id': 'r383.synthetic-trip'}
            take(interp_state=2, inpos=False, current_vel=0.0)
            take()
            if text.startswith('(DEBUG,'):
                tag = re.search(r'NATIVE\d+', text).group()
                nums = [int(x) for x in re.findall(r'P(\d+)=', text)]
                c.errors.append((0.0, 0, tag + ' ' + ' '.join(f'P{n}={values[n]}' for n in nums)))
            c.replies.put({'cmd': command['cmd'], 'ok': True})

    c.ws = Socket()
    # Standstill itself is not under test here. All command operations and
    # their busy/idle consumption use the real implementation.
    monkeypatch.setattr(nr, '_standstill', lambda *a: True)
    out = nr._finish(c, [('values', lambda: nr._plant(c, values))])
    assert sent[0][0]['cmd'] == 'abort'
    assert len([x for x, _ in sent if x.get('text', '').startswith('#')]) >= 1
    if event == 'trip':
        print(json.dumps({'sent': sent, 'finish': out}, ensure_ascii=False, sort_keys=True))
        assert not [x for x, was_tripped in sent if was_tripped], (sent, out)
        assert out['stopped'] and 'values' not in out['done'], out
    else:
        assert not out['stopped'] and out['done'] == ['values'] and not out['errors'], out
