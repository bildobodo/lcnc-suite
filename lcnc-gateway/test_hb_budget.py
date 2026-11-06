"""F-ARM.S3b (Codex R321–R324): a client's heartbeat budget is 3 s — the
value, its boundary on monotonic time (exactly 3 s is not yet a stall), and
the status loop's disarm going THROUGH it, seen on a real WebSocket session
against the app at the REAL budget. A budget shrunk to 1 s for speed flaked
in a loaded test process (Codex R324: one status tick of ~0.8 s left a
beating client 1 s without a beat read); at 3 s a tick like that keeps a
margin of 2 s."""
import time
import unittest

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`
from fastapi.testclient import TestClient  # noqa: E402

import gateway  # noqa: E402
from test_ws_smoke import STATUS_FAMILY, _decode  # noqa: E402


class TestTheBudget(unittest.TestCase):

    def test_the_budget_is_three_seconds(self):
        self.assertEqual(gateway._HB_STALL_SEC, 3.0)

    def test_its_boundary_on_monotonic_time(self):
        last = 1000.0
        self.assertFalse(gateway._hb_stalled(last, last + 2.99))
        self.assertFalse(gateway._hb_stalled(last, last + 3.0), "exactly 3 s is not yet a stall")
        self.assertTrue(gateway._hb_stalled(last, last + 3.001))


class TestTheLoopDisarmsThroughIt(unittest.TestCase):
    """The pinned fake connection as in test_ws_smoke's timing tests."""

    def setUp(self):
        if not getattr(gateway.linuxcnc, "__lcnc_fake__", False):
            self.skipTest("needs the fake binding (run under pytest)")
        self.addCleanup(setattr, gateway, "_get_lcnc_pid", gateway._get_lcnc_pid)
        self.addCleanup(setattr, gateway, "_nml_connectable", gateway._nml_connectable)
        gateway._get_lcnc_pid = lambda: 424242
        gateway._nml_connectable = lambda: True
        self.assertTrue(gateway.try_connect_lcnc(), "fake linuxcnc must connect")
        self.calls = []
        real = gateway._hb_stalled
        self.addCleanup(setattr, gateway, "_hb_stalled", real)
        gateway._hb_stalled = lambda last, now: (self.calls.append(now - last), real(last, now))[1]

    def session(self, beat_every, observe):
        """Armed, then `beat_every` s between heartbeats (None: none) for
        `observe` s; the armed flag of every status received meanwhile."""
        armed, deadline = [], None
        with TestClient(gateway.app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"cmd": "hello", "session": "hb-budget", "resume_armed": False})
                ws.send_json({"cmd": "heartbeat"})
                ws.send_json({"cmd": "arm", "armed": True})
                last_beat = time.monotonic()
                while True:
                    try:
                        msg = _decode(ws.receive())
                    except AssertionError as e:
                        # a silent client is disarmed, then evicted as an unarmed one
                        if "Heartbeat timeout" in str(e):
                            return armed + ["closed"]
                        raise
                    now = time.monotonic()
                    # beats until the arm is confirmed, then as asked
                    if (deadline is None or beat_every is not None) and now - last_beat >= (beat_every or 0.1):
                        ws.send_json({"cmd": "heartbeat"})
                        last_beat = now
                    if msg.get("type") == "reply" and msg.get("cmd") == "arm":
                        self.assertTrue(msg.get("armed"), msg)
                        deadline = now + observe
                    if deadline is None:
                        continue
                    if msg.get("type") in STATUS_FAMILY and "armed" in msg:
                        armed.append(msg["armed"])
                    if now > deadline:
                        return armed

    def test_a_silent_armed_client_is_disarmed_by_the_loop(self):
        armed = self.session(beat_every=None, observe=6.0)
        self.assertIn(True, armed)
        seen = [a for a in armed if a != "closed"]
        self.assertEqual(seen[-1], False, "disarmed once its budget was spent")
        self.assertTrue(any(age > gateway._HB_STALL_SEC for age in self.calls), "the loop asked _hb_stalled")

    def test_a_beating_client_stays_armed(self):
        armed = self.session(beat_every=0.1, observe=4.0)     # past the 3 s budget
        self.assertTrue(armed and all(armed), armed)
        self.assertTrue(self.calls, "the loop asked _hb_stalled")


if __name__ == "__main__":
    unittest.main()
