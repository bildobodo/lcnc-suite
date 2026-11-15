"""R379: real SimulatorClient, fake socket and real threads; no network/HAL.
Run from the reviewed archive, or set R379_REPO to its root.
"""
import json
import os
import sys
import threading
import time
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(os.environ.get('R379_REPO', Path.cwd())) / 'scripts'))
from test_support.live_session import SimulatorClient, TransportLost


class ObservedLock:
    def __init__(self, watch):
        self.inner = threading.Lock()
        self.watch = watch
        self.attempt = threading.Event()
    def __enter__(self):
        if threading.current_thread().name == self.watch:
            self.attempt.set()
        self.inner.acquire()
        return self
    def __exit__(self, *args):
        self.inner.release()


def test_receive_cannot_stamp_between_mark_and_send():
    c = SimulatorClient('fake', auto_confirm=False)
    c.take({'type': 'status', 'data': {}, 'trip_basis': {'gen': 1}})
    c.record_lock = ObservedLock('R379-receive')
    done = threading.Event()
    observed = {}
    def receive():
        c.take({'type': 'status', 'data': {}, 'trip_basis': {'gen': 2}})
        done.set()
    rx = threading.Thread(target=receive, name='R379-receive', daemon=True)
    class Socket:
        def send(self, text):
            assert json.loads(text)['cmd'] == 'safety_trip_ack'
            rx.start()
            assert c.record_lock.attempt.wait(1), 'receiver did not reach its record lock'
            observed['completed_inside_send'] = done.wait(0.03)
            observed['length_inside_send'] = len(c.basis_history)
            c.replies.put({'ok': True})
    c.ws = Socket()
    try:
        c.request('safety_trip_ack', id='own-1', mark=lambda m: observed.setdefault('mark', m))
    finally:
        rx.join(1)
    assert not rx.is_alive()
    assert observed['completed_inside_send'] is False, observed
    assert observed['length_inside_send'] == observed['mark'][1] == 1, observed
    assert len(c.basis_history) == 2
    assert c.basis_history[1][0] >= observed['mark'][0]


def test_end_mark_waits_for_a_stamped_but_not_yet_appended_frame():
    c = SimulatorClient('fake', auto_confirm=False)
    c.record_lock = ObservedLock('R379-mark')
    append_entered, allow_append, marked = threading.Event(), threading.Event(), threading.Event()
    observed = {}
    class PausedHistory(list):
        def append(self, item):
            observed['receipt'] = item[0]
            append_entered.set()
            assert allow_append.wait(3), 'probe release not received'
            super().append(item)
    c.basis_history = PausedHistory()
    def receive():
        c.take({'type': 'status', 'data': {}, 'trip_basis': {'gen': 1}})
    def mark():
        observed['mark'] = c.mark()
        marked.set()
    rx = threading.Thread(target=receive, name='R379-receive', daemon=True)
    end = threading.Thread(target=mark, name='R379-mark', daemon=True)
    rx.start()
    try:
        assert append_entered.wait(1)
        end.start()
        deadline = time.monotonic() + 1
        while not (c.record_lock.attempt.is_set() or marked.is_set()):
            assert time.monotonic() < deadline, 'mark thread made no progress'
            time.sleep(0.001)
        observed['marked_while_append_pending'] = marked.wait(0.03)
    finally:
        allow_append.set()
        rx.join(1)
        if end.ident is not None:
            end.join(1)
    assert not rx.is_alive() and not end.is_alive()
    assert observed['marked_while_append_pending'] is False, observed
    assert observed['mark'][1] == 1
    assert observed['mark'][0] >= observed['receipt']


def test_tool_confirmation_and_callback_run_outside_record_lock():
    c = SimulatorClient('fake', auto_confirm=True)
    seen = []
    def assert_free(kind):
        free = c.record_lock.acquire(blocking=False)
        if free:
            c.record_lock.release()
        assert free, kind
        seen.append(kind)
    class Socket:
        def send(self, text):
            assert json.loads(text)['cmd'] == 'confirm_tool_change'
            assert_free('send')
    c.ws = Socket()
    c.on_status = lambda *_: assert_free('callback')
    result = c.take({'type': 'status', 'data': {'tool_change_requested': True, 'tool_change_seq': 7}})
    assert result == 7 and seen == ['callback', 'send']


@pytest.mark.parametrize('before_send', [False, True])
def test_transport_failure_keeps_only_a_mark_of_an_attempt(before_send):
    c = SimulatorClient('fake', auto_confirm=False)
    seen = []
    class Socket:
        def send(self, text):
            raise OSError('injected socket loss')
    c.ws = Socket()
    if before_send:
        c.error = 'already disconnected'
    with pytest.raises(TransportLost):
        c.request('safety_trip_ack', id='own-1', mark=seen.append)
    assert len(seen) == (0 if before_send else 1)
    assert c.record_lock.acquire(blocking=False), 'lock leaked on failure'
    c.record_lock.release()
