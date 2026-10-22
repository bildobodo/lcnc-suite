"""WS endpoint smoke test — the status fan-out must actually deliver.

Regression guard for the M4 sweep bug: a NameError in status_loop's pre-init
killed every client's fan-out task before its first send. Nothing else caught
it — unit tests never execute the nested loop, and the perf matrix (then)
asserted only on lag windows and safety events, so the gate PASSED while no
client could receive a single status frame.

This test opens a real WebSocket session against the app (TestClient portal)
and pumps heartbeats — each pump yields a pong from the RECEIVE path, so the
drain never blocks even when the fan-out is dead — until a status-family
frame arrives. status_error counts: it proves the loop survived its pre-init
and reached a send, which is exactly the property the regression broke.
"""
import sys
import time
import unittest

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`

import msgspec  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import gateway  # noqa: E402

STATUS_FAMILY = {"status", "status_delta", "status_error"}


def _decode(message) -> dict:
    # TestClient.receive() yields the raw ASGI message dict.
    if message.get("bytes") is not None:
        return msgspec.msgpack.decode(message["bytes"])
    import json
    return json.loads(message["text"])


class TestStatusFanoutDelivers(unittest.TestCase):
    def test_status_family_frame_arrives(self):
        seen = []
        deadline = time.monotonic() + 15.0
        with TestClient(gateway.app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"cmd": "hello", "session": "smoke", "resume_armed": False})
                for _ in range(120):
                    self.assertLess(
                        time.monotonic(), deadline,
                        f"no status-family frame within budget; saw {sorted(set(seen))}")
                    # Pump: the pong reply guarantees the next receive returns
                    # even if the fan-out task is dead.
                    ws.send_json({"cmd": "heartbeat"})
                    msg = _decode(ws.receive())
                    t = msg.get("type", "?")
                    seen.append(t)
                    if t in STATUS_FAMILY:
                        return  # fan-out is alive — the loop survived pre-init
                    time.sleep(0.05)
        self.fail(f"no status-family frame in 120 frames; saw {sorted(set(seen))}")


class TestHeartbeatTimingNamesItsHeartbeat(unittest.TestCase):
    """Codex R183 VP182-02: the status that carries a heartbeat's timing names
    that heartbeat by the client's own `seq`, so a late answer can never be
    paired with a later heartbeat; a heartbeat without one gets none."""

    def _timings(self, beats):
        out = []
        deadline = time.monotonic() + 15.0
        with TestClient(gateway.app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"cmd": "hello", "session": "seq", "resume_armed": False})
                for beat in beats:
                    ws.send_json(beat)
                    while time.monotonic() < deadline:
                        msg = _decode(ws.receive())
                        if msg.get("type") in ("status", "status_delta") and msg.get("timing"):
                            out.append(msg["timing"])
                            break
        return out

    def test_the_timing_echoes_the_heartbeat_number(self):
        t = self._timings([{"cmd": "heartbeat", "seq": 7}, {"cmd": "heartbeat"}, {"cmd": "heartbeat", "seq": True},
                           {"cmd": "heartbeat", "seq": 9}])
        if not t:
            self.skipTest("no full status under the fake binding (status_error path)")
        self.assertEqual([x.get("hb_seq") for x in t], [7, None, None, 9])
        self.assertTrue(all("server_ms" in x for x in t))


if __name__ == "__main__":
    unittest.main()
