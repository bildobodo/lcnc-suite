"""F-TRIP.S1c (Codex R323): the gateway records a safety trip and its
acknowledgement along the actual path — a real WebSocket session against the
app (its lifespan runs _status_poller): the HAL latch level in the reader
snapshot goes FALSE → TRUE after a known-good baseline, the poller traces
`safety.tripped` once, starts the forensic bundle once and puts the trip on
every status frame; the client's safety_trip_ack is answered, traced as
`safety.trip_acknowledged` with its client id, and the frames carry the trip
no more while the latch level stays TRUE (no second trip from the level).

Nothing touches a live helper: the reader loop does not start (the snapshot
is set here), the bundle is a recorder. Whether the message center records a
trip is the operator's question (Q323-1), not this test."""
import time
import unittest
from unittest.mock import patch

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`
from fastapi.testclient import TestClient  # noqa: E402

import gateway  # noqa: E402
from test_ws_smoke import STATUS_FAMILY, _decode  # noqa: E402

FAR = 3600.0      # the snapshot stays fresh for the whole session


class TestTheTripAndItsAcknowledgementAreTraced(unittest.TestCase):

    def setUp(self):
        if not getattr(gateway.linuxcnc, "__lcnc_fake__", False):
            self.skipTest("needs the fake binding (run under pytest)")
        self.addCleanup(setattr, gateway, "_get_lcnc_pid", gateway._get_lcnc_pid)
        self.addCleanup(setattr, gateway, "_nml_connectable", gateway._nml_connectable)
        gateway._get_lcnc_pid = lambda: 424242
        gateway._nml_connectable = lambda: True
        self.assertTrue(gateway.try_connect_lcnc(), "fake linuxcnc must connect")
        for name in ("_unacked_trip", "_last_fault_latched", "_trip_baseline_seen"):
            self.addCleanup(setattr, gateway, name, getattr(gateway, name))
        gateway._unacked_trip, gateway._last_fault_latched, gateway._trip_baseline_seen = None, None, False
        bridge = gateway._hal_bridge
        self.addCleanup(setattr, bridge, "_reader_state", bridge._reader_state)
        self.events, self.bundles = [], []
        real_emit = gateway._trace.emit

        def emit(ev, **kw):
            if ev.startswith("safety."):
                self.events.append((ev, kw))
            return real_emit(ev, **kw)
        for p in (patch.object(gateway._trace, "emit", emit),
                  patch.object(gateway, "_start_reader_recv_loop", lambda: None),
                  patch.object(gateway, "_snapshot_trip", lambda ts: self.bundles.append(ts))):
            p.start()
            self.addCleanup(p.stop)

    def latch(self, level: bool):
        gateway._hal_bridge._reader_state = ({"trip_latched": level}, time.monotonic() + FAR)

    def test_trip_and_ack_along_the_poller_and_the_reader(self):
        self.latch(False)
        with TestClient(gateway.app) as client, client.websocket_connect("/ws") as ws:
            last_beat = [0.0]

            def frames(until, what, limit=10.0):
                end = time.monotonic() + limit
                while time.monotonic() < end:
                    msg = _decode(ws.receive())
                    if time.monotonic() - last_beat[0] > 0.1:
                        ws.send_json({"cmd": "heartbeat"})
                        last_beat[0] = time.monotonic()
                    if until(msg):
                        return msg
                self.fail(f"no {what} within {limit} s — events {self.events}")

            def statuses(n):
                return [frames(lambda m: m.get("type") in STATUS_FAMILY, "a status") for _ in range(n)]

            ws.send_json({"cmd": "hello", "session": "trip-trace", "resume_armed": False})
            ws.send_json({"cmd": "heartbeat"})
            # the baseline: a few statuses with the latch clear, no trip
            seen = statuses(5)
            self.assertFalse(any("safety_trip" in m and m["safety_trip"] for m in seen), seen[-1])
            self.assertEqual(self.events, [])

            self.latch(True)
            tripped = frames(lambda m: m.get("type") in STATUS_FAMILY and m.get("safety_trip"), "the trip")
            self.assertEqual(tripped["safety_trip"], {"reason": "hal_heartbeat_timeout"})
            for m in statuses(5):
                self.assertEqual(m.get("safety_trip"), {"reason": "hal_heartbeat_timeout"}, "sticky")
            self.assertEqual([e for e, _ in self.events], ["safety.tripped"], "traced once")
            self.assertEqual(len(self.bundles), 1, "one forensic bundle")

            ws.send_json({"cmd": "safety_trip_ack"})
            reply = frames(lambda m: m.get("type") == "reply" and "cmd" not in m, "the ack's reply")
            self.assertTrue(reply.get("ok"), reply)
            acked = [kw for e, kw in self.events if e == "safety.trip_acknowledged"]
            self.assertEqual(len(acked), 1, self.events)
            self.assertIsInstance(acked[0].get("client_id"), int)
            # the level stays TRUE (HAL keeps it until E-Stop Reset): no trip
            # on the frames, no second trip traced
            frames(lambda m: m.get("type") in STATUS_FAMILY and not m.get("safety_trip"), "a status without the trip")
            for m in statuses(10):
                self.assertFalse(m.get("safety_trip"), m.get("safety_trip"))
            self.assertEqual([e for e, _ in self.events], ["safety.tripped", "safety.trip_acknowledged"])
            self.assertEqual(len(self.bundles), 1)


if __name__ == "__main__":
    unittest.main()
