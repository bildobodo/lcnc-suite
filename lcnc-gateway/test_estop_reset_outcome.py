"""E-Stop Reset: its outcome observed (P4-1, machine day 1.5, MT418-05,
Codex R433/R434). LinuxCNC answers the reset's NML write at once and ignores
it without a word when the safety chain stays open; the handler now watches
the controller after its write and replies confirmed / not confirmed /
unknown — never a guessed outcome.

Two layers: `_estop_reset_outcome` against fed poll records (the rules:
echo after the write, the deciding poll at the window's end, the Link, the
bounds), and the real handler through the WebSocket with the real status
poller over the fake binding (the reply shapes, and an E-Stop from another
client preempting the wait).
"""
import asyncio
import time
import unittest

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`

import gateway  # noqa: E402
from link_fixture import current  # noqa: E402
from test_ws_command_worker import _Harness, _arm, _drain, _is_reply  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

ESTOP, RESET = linuxcnc.STATE_ESTOP, linuxcnc.STATE_ESTOP_RESET


class _Feed:
    """The poller, played: a record every `every` s (number, began, Link,
    echo, task state) from `script(i, t_since_write)` → (link, echo, state)
    or None (no poll this tick)."""

    def __init__(self, script, every=0.03):
        self.script, self.every = script, every

    async def run(self, t_w):
        i = 0
        while True:
            await asyncio.sleep(self.every)
            out = self.script(i, time.monotonic() - t_w)
            i += 1
            if out is None:
                continue
            lk, echo, state, *began = out
            n = gateway._poll_record[0] + 1 if gateway._poll_record else 1
            gateway._poll_record = (n, t_w + began[0] if began else time.monotonic(), lk, echo, state)


def _outcome(script, serial=7, every=0.03, before=None):
    """Run the outcome against a fed poller; (reply, seconds waited)."""
    conn = object()

    async def main():
        gateway._poll_record = before(conn) if before else None
        t_w = time.monotonic()
        feed = asyncio.ensure_future(_Feed(lambda i, dt: script(conn, i, dt), every).run(t_w))
        try:
            return await gateway._estop_reset_outcome(conn, {"serial": serial, "t": t_w}), time.monotonic() - t_w
        finally:
            feed.cancel()
    return asyncio.run(main())


class TestTheOutcome(unittest.TestCase):
    def setUp(self):
        self._saved = gateway._poll_record

    def tearDown(self):
        gateway._poll_record = self._saved

    def test_the_task_left_estop_is_confirmed(self):
        r, dt = _outcome(lambda c, i, dt: (c, 7, ESTOP if dt < 0.1 else RESET))
        self.assertEqual(r, {"ok": True, "confirmed": True})
        self.assertGreaterEqual(dt, gateway.ESTOP_RESET_SETTLE_S, "decided before the window's end")

    def test_an_open_chain_is_not_confirmed(self):
        r, _dt = _outcome(lambda c, i, dt: (c, 7, ESTOP))
        self.assertEqual(r, {"ok": False, "confirmed": False, "error": gateway.ESTOP_RESET_NOT_CONFIRMED})

    def test_a_bounce_back_into_estop_inside_the_window_is_not_confirmed(self):
        # left for a moment, ESTOP again by the window's end: the END decides
        r, _dt = _outcome(lambda c, i, dt: (c, 7, RESET if 0.05 < dt < 0.15 else ESTOP))
        self.assertFalse(r["ok"])
        self.assertIs(r["confirmed"], False)

    def test_no_echo_is_unknown_never_a_refusal(self):
        r, dt = _outcome(lambda c, i, dt: (c, 6, ESTOP))      # the controller never took serial 7
        self.assertEqual(r, {"ok": False, "confirmed": None, "error": gateway.ESTOP_RESET_UNKNOWN})
        self.assertGreaterEqual(dt, gateway.ESTOP_RESET_ECHO_S)

    def test_another_link_is_unknown(self):
        other = object()
        r, _dt = _outcome(lambda c, i, dt: (c if i < 2 else other, 7, ESTOP))
        self.assertIsNone(r["confirmed"])

    def test_no_poll_after_the_window_is_unknown(self):
        # the echo, ESTOP — then the poller stalls: a timeout is no ESTOP proof
        r, _dt = _outcome(lambda c, i, dt: (c, 7, ESTOP) if dt < 0.1 else None)
        self.assertEqual(r["confirmed"], None, r)

    def test_a_poll_begun_before_the_write_proves_nothing(self):
        # the record present at the write (echo already high, state left) is
        # never read as this write's echo or outcome; afterwards no echo
        def before(conn):
            return (1, time.monotonic() - 1.0, conn, 99, RESET)
        r, _dt = _outcome(lambda c, i, dt: None, before=before)
        self.assertIsNone(r["confirmed"])

    def test_a_poll_in_flight_during_the_write_proves_nothing(self):
        # a poll that BEGAN before the write and was recorded after it (its
        # data may predate the write): never this write's echo or outcome
        # the in-flight poll shows the echo and the task out of ESTOP; every
        # poll after it shows an echo short of the write — no echo, unknown
        r, _dt = _outcome(lambda c, i, dt: (c, 99, RESET, -0.005) if i == 0 else (c, 6, RESET))
        self.assertIsNone(r["confirmed"], r)

    def test_an_unread_task_state_at_the_window_end_is_unknown(self):
        r, _dt = _outcome(lambda c, i, dt: (c, 7, ESTOP if dt < 0.1 else None))
        self.assertIsNone(r["confirmed"])

    def test_a_write_without_its_serial_is_unknown(self):
        async def main():
            return await gateway._estop_reset_outcome(object(), {})
        self.assertIsNone(asyncio.run(main())["confirmed"])


class TestTheHandler(unittest.TestCase):
    """The real handler through the WebSocket, the real poller on the fake
    binding: the controller's echo and state are the fake stat's."""

    def _reset(self, state, preempt=False):
        with _Harness() as h:
            stat = current().stat
            stat.task_state, stat.estop, stat.enabled = ESTOP, 1, False
            stat.echo_serial_number = 10 ** 6          # the controller took every write
            with TestClient(gateway.app) as client:
                with client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b:
                    _arm(a, "er-a")
                    _arm(b, "er-b")
                    # the gateway has read the machine (no "status not read yet")
                    deadline = time.monotonic() + 5
                    while gateway._shared_status is None and time.monotonic() < deadline:
                        _drain(a, 0.1, 0.5)
                    self.assertIsNotNone(gateway._shared_status, "no first status")
                    stat.task_state = state             # where the task stands after the write
                    a.send_json({"cmd": "estop_reset"})
                    t0 = time.monotonic()
                    early = []
                    if preempt:
                        # the reset IN FLIGHT (its handler waiting) before the E-Stop
                        deadline = time.monotonic() + 3
                        while not any(getattr(c, "cmd_inflight", None) == "estop_reset"
                                      for c in list(gateway._clients.values())):
                            early += [f for _t, f in _drain(a, 0.02, 0.5) if _is_reply(f, "estop_reset")]
                            if early or time.monotonic() > deadline:
                                raise AssertionError(f"the reset was never in flight: {early}")
                        b.send_json({"cmd": "estop"})
                    fa = _drain(a, 5.0, 0.5, stop=lambda f: _is_reply(f, "estop_reset"))
                    return fa[-1][1], time.monotonic() - t0, h

    def test_confirmed_through_the_socket(self):
        reply, _dt, h = self._reset(RESET)
        self.assertTrue(reply.get("ok") and reply.get("confirmed") is True, reply)
        said = h.tags("estop.reset_outcome")
        self.assertEqual([s.get("outcome") for s in said], ["confirmed"])
        self.assertIsNotNone(said[0].get("echo_ms"))

    def test_not_confirmed_through_the_socket(self):
        reply, _dt, _h = self._reset(ESTOP)
        self.assertEqual((reply.get("ok"), reply.get("confirmed"), reply.get("error")),
                         (False, False, gateway.ESTOP_RESET_NOT_CONFIRMED), reply)

    def test_an_estop_from_another_client_displaces_the_wait(self):
        reply, dt, h = self._reset(ESTOP, preempt=True)
        self.assertEqual(reply.get("error"), "Preempted by estop", reply)
        self.assertLess(dt, gateway.ESTOP_RESET_SETTLE_S + 0.5, "the wait held the E-Stop back")
        self.assertEqual(h.tags("estop.reset_outcome"), [], "a preempted reset says no outcome")

    def test_the_reset_is_preemptable_not_a_stop(self):
        self.assertNotIn("estop_reset", gateway._WS_NO_PREEMPT)


if __name__ == "__main__":
    unittest.main()
