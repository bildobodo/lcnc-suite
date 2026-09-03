"""Per-client command worker (2026-09-03): liveness never queues behind work.

Regression guards for the touchoff/capture false-disarm class: the WS reader
used to await every command handler inline, so a handler that waited inside
_cmd_lock (plane touch-off: 30 s MDI wait + 3 s datum settle; Capture chains
four such waits) parked the reader, the client's own heartbeats sat unread in
the socket, and status_loop disarmed it 3 s later — six operator-visible
`safety.hb_stall_disarmed` events, each 0.2 s after `touchoff.plane` /
`twp.capture`. Now every command is queued to ONE per-client worker (in
order) and the reader stays at ws.receive().

Harness: TestClient portal, fake linuxcnc binding pinned connected (as in
test_ws_lifecycle.py) so the real 30 Hz status path runs; `handle_command`
is a module global the worker resolves at call time, so tests stand in
slow / blocking / raising handlers; `lcnc_trace.emit` is wrapped to record
events.
"""
import asyncio
import threading
import time
import unittest

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`

import msgspec  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import lcnc_trace  # noqa: E402
import gateway  # noqa: E402

STATUS_FAMILY = {"status", "status_delta", "status_error"}


def _decode(message) -> dict:
    if message.get("bytes") is not None:
        return msgspec.msgpack.decode(message["bytes"])
    import json
    return json.loads(message["text"])


class _Harness:
    """Pin the fake binding connected, record trace events, restore on exit."""

    def __enter__(self):
        self.events = []
        self._orig = (gateway._get_lcnc_pid, gateway._nml_connectable,
                      gateway.handle_command, lcnc_trace.emit, gateway._HB_STALL_SEC)
        if getattr(gateway.linuxcnc, "__lcnc_fake__", False):
            gateway._get_lcnc_pid = lambda: 424242
            gateway._nml_connectable = lambda: True
            assert gateway.try_connect_lcnc(), "fake linuxcnc must connect"
        events, real = self.events, lcnc_trace.emit

        def rec(tag, level="info", msg="", **fields):
            events.append((tag, dict(fields)))
            return real(tag, level, msg, **fields)
        lcnc_trace.emit = rec
        return self

    def __exit__(self, *_a):
        (gateway._get_lcnc_pid, gateway._nml_connectable,
         gateway.handle_command, lcnc_trace.emit, gateway._HB_STALL_SEC) = self._orig
        return False

    def tags(self, tag):
        return [f for t, f in self.events if t == tag]

    def wait_tag(self, tag, seconds=3.0):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            hits = self.tags(tag)
            if hits:
                return hits
            time.sleep(0.05)
        return self.tags(tag)


def _drain(ws, seconds, hb_every=0.5, stop=None):
    """Pump heartbeats every `hb_every` s (0 = none) and receive frames for
    `seconds`, or until stop(frame) is true. Returns [(t_mono, frame)]."""
    out = []
    t0 = time.monotonic()
    last_hb = 0.0
    while time.monotonic() - t0 < seconds:
        now = time.monotonic()
        if hb_every and now - last_hb >= hb_every:
            ws.send_json({"cmd": "heartbeat"})
            last_hb = now
        fr = _decode(ws.receive())
        out.append((time.monotonic(), fr))
        if stop is not None and stop(fr):
            break
    return out


def _is_reply(fr, cmd=None):
    return fr.get("type") == "reply" and (cmd is None or fr.get("cmd") == cmd)


def _arm(ws, session="cmdworker"):
    ws.send_json({"cmd": "hello", "session": session, "resume_armed": False})
    ws.send_json({"cmd": "arm", "armed": True})
    frames = _drain(ws, 8.0, 0.5, stop=lambda f: _is_reply(f) and f.get("armed") is True)
    assert frames and frames[-1][1].get("armed") is True, "arm reply never arrived"


class TestSlowHandlerKeepsHeartbeats(unittest.TestCase):
    def test_slow_handler_does_not_starve_heartbeats(self):
        """The live failure, reproduced: a 4 s handler (> the 3 s budget)
        must not cost the client its armed state — pongs keep flowing from
        the reader while the worker waits, and the reply still arrives."""
        with _Harness() as h:
            async def slow(msg, armed):
                await asyncio.sleep(4.0)
                return {"ok": True, "slow": True}
            gateway.handle_command = slow
            with TestClient(gateway.app) as client:
                with client.websocket_connect("/ws") as ws:
                    _arm(ws)
                    ws.send_json({"cmd": "mdi", "text": "G4 P0"})
                    t_send = time.monotonic()
                    frames = _drain(ws, 8.0, 0.5, stop=lambda f: _is_reply(f, "mdi"))
                    t_reply, reply = frames[-1]
                    self.assertTrue(_is_reply(reply, "mdi"), f"no mdi reply: {reply}")
                    self.assertTrue(reply.get("ok") and reply.get("slow"))
                    self.assertGreaterEqual(t_reply - t_send, 3.5, "handler was not actually slow")
                    pongs = [t for t, f in frames if f.get("type") == "pong"]
                    self.assertGreaterEqual(len(pongs), 6, f"pongs during the handler: {len(pongs)}")
                    gaps = [b - a for a, b in zip(pongs, pongs[1:])]
                    self.assertLess(max(gaps), 1.5, f"pong gaps {gaps}")
                    for _t, f in frames:
                        if f.get("type") in STATUS_FAMILY and "armed" in f:
                            self.assertTrue(f["armed"], "client was disarmed during the slow handler")
                    age = client.portal.call(
                        lambda: time.monotonic() - next(iter(gateway._clients.values())).last_hb_mono)
                    self.assertLess(age, 1.0)
            self.assertEqual(h.tags("safety.hb_stall_disarmed"), [])
            slow_ev = h.tags("ws.command_slow")
            self.assertTrue(slow_ev and slow_ev[0].get("cmd") == "mdi" and slow_ev[0].get("ms", 0) >= 3500)


class TestOrderAndBackpressure(unittest.TestCase):
    def test_commands_execute_in_order(self):
        with _Harness():
            rec = []

            async def h(msg, armed):
                rec.append((msg["text"], "start", time.monotonic()))
                await asyncio.sleep(0.3)
                rec.append((msg["text"], "end", time.monotonic()))
                return {"ok": True, "text": msg["text"]}
            gateway.handle_command = h
            with TestClient(gateway.app) as client:
                with client.websocket_connect("/ws") as ws:
                    _arm(ws)
                    ws.send_json({"cmd": "mdi", "text": "A"})
                    ws.send_json({"cmd": "mdi", "text": "B"})
                    frames = _drain(ws, 6.0, 0.5, stop=lambda f: _is_reply(f, "mdi") and f.get("text") == "B")
                    replies = [f["text"] for _t, f in frames if _is_reply(f, "mdi")]
                    self.assertEqual(replies, ["A", "B"])
            a_end = next(t for n, k, t in rec if n == "A" and k == "end")
            b_start = next(t for n, k, t in rec if n == "B" and k == "start")
            self.assertGreaterEqual(b_start, a_end)

    def test_queue_full_rejects_with_reply_and_trace_but_never_a_stop(self):
        with _Harness() as h:
            with TestClient(gateway.app) as client:
                ev = client.portal.call(asyncio.Event)

                async def blocking(msg, armed):
                    await ev.wait()
                    return {"ok": True, "text": msg.get("text")}
                gateway.handle_command = blocking
                with client.websocket_connect("/ws") as ws:
                    _arm(ws)
                    n = 1 + gateway._WS_CMD_QUEUE_MAX + 2
                    for i in range(n):
                        ws.send_json({"cmd": "mdi", "text": f"c{i}"})
                    frames = _drain(ws, 2.0, 0.5)
                    full = [f for _t, f in frames if _is_reply(f, "mdi") and "queue full" in str(f.get("error", ""))]
                    self.assertGreaterEqual(len(full), 1, "overflow was not rejected")
                    self.assertLessEqual(len(full), 2)
                    self.assertGreaterEqual(len([1 for _t, f in frames if f.get("type") == "pong"]), 2,
                                            "reader stalled while the worker was blocked")
                    self.assertTrue(h.tags("ws.command_queue_full"))
                    self.assertEqual(h.tags("ws.command_queue_full")[0].get("inflight_cmd"), "mdi")
                    # A stop-class command is NEVER the one rejected.
                    ws.send_json({"cmd": "jog_stop"})
                    frames2 = _drain(ws, 0.7, 0.5)
                    self.assertEqual([f for _t, f in frames2 if _is_reply(f, "jog_stop")], [])
                    client.portal.call(ev.set)
                    frames3 = _drain(ws, 6.0, 0.5, stop=lambda f: _is_reply(f, "jog_stop"))
                    self.assertTrue(_is_reply(frames3[-1][1], "jog_stop") and frames3[-1][1].get("ok"))
                    ok_mdi = [f for _t, f in frames3 if _is_reply(f, "mdi") and f.get("ok")]
                    self.assertEqual(len(ok_mdi), n - len(full))


class TestDisconnectAndFailures(unittest.TestCase):
    def test_disconnect_cancels_inflight_and_traces_drops(self):
        with _Harness() as h:
            cancelled = []

            async def h_slow(msg, armed):
                try:
                    await asyncio.sleep(10.0)
                except asyncio.CancelledError:
                    cancelled.append(msg.get("text"))
                    raise
                return {"ok": True}
            gateway.handle_command = h_slow
            with TestClient(gateway.app) as client:
                with client.websocket_connect("/ws") as ws:
                    _arm(ws)
                    for i in range(3):
                        ws.send_json({"cmd": "mdi", "text": f"d{i}"})
                    _drain(ws, 0.5, 0.5)   # let d0 start and d1/d2 queue
                # socket closed here → finally: cancel the worker, drain the queue
                canc = h.wait_tag("ws.command_cancelled_on_disconnect")
                self.assertTrue(canc and canc[0].get("cmd") == "mdi", canc)
                dropped = h.wait_tag("ws.command_dropped_on_disconnect")
                self.assertTrue(dropped, "queued commands were dropped silently")
                self.assertEqual(dropped[0].get("count"), 2)
                self.assertEqual(dropped[0].get("cmds"), ["mdi", "mdi"])
                disc = h.wait_tag("ws.disconnect")
                self.assertTrue(disc and disc[0].get("inflight_at_drop") == "mdi" and disc[0].get("queue_dropped") == 2, disc)
                deadline = time.monotonic() + 3.0
                while not cancelled and time.monotonic() < deadline:
                    time.sleep(0.05)
                self.assertEqual(cancelled, ["d0"])

    def test_worker_exception_replies_bounded_and_survives(self):
        with _Harness() as h:
            async def boom(msg, armed):
                raise RuntimeError("boom")
            gateway.handle_command = boom
            with TestClient(gateway.app) as client:
                with client.websocket_connect("/ws") as ws:
                    _arm(ws)
                    ws.send_json({"cmd": "mdi", "text": "X"})
                    frames = _drain(ws, 4.0, 0.5, stop=lambda f: _is_reply(f, "mdi"))
                    reply = frames[-1][1]
                    self.assertTrue(_is_reply(reply, "mdi") and reply.get("ok") is False)
                    self.assertIn("RuntimeError", reply.get("error", ""))
                    ws.send_json({"cmd": "heartbeat"})
                    frames2 = _drain(ws, 2.0, 0, stop=lambda f: f.get("type") == "pong")
                    self.assertEqual(frames2[-1][1].get("type"), "pong", "worker death took the socket with it")
            exc = h.tags("ws.command_exception")
            self.assertTrue(exc and exc[0].get("cmd") == "mdi" and exc[0].get("exc") == "RuntimeError")

    def test_hb_stall_disarms_silent_client(self):
        """The watchdog itself still works: a client that stops beating is
        disarmed, and the event now names the (absent) in-flight command."""
        with _Harness() as h:
            gateway._HB_STALL_SEC = 1.0
            with TestClient(gateway.app) as client:
                with client.websocket_connect("/ws") as ws:
                    _arm(ws)
                    time.sleep(1.8)   # silence: no heartbeats
                    frames = _drain(ws, 4.0, 0,
                                    stop=lambda f: _is_reply(f) and "Heartbeat timeout" in str(f.get("error", "")))
                    self.assertIn("Heartbeat timeout", str(frames[-1][1].get("error", "")))
                    self.assertIs(frames[-1][1].get("armed"), False)
            ev = h.tags("safety.hb_stall_disarmed")
            self.assertTrue(ev)
            self.assertIsNone(ev[0].get("inflight_cmd"))
            self.assertIn("inflight_ms", ev[0])


class TestCmdBlockingHoldsLockThroughCancel(unittest.TestCase):
    def test_cmd_blocking_holds_lock_until_thread_returns(self):
        """A cancel must not free _cmd_lock while the NML call is still
        running on its thread (the next holder would call NML concurrently)."""
        orig_lock = gateway._cmd_lock
        gateway._cmd_lock = None
        try:
            async def main():
                started, release = threading.Event(), threading.Event()

                def cmd_fn():
                    started.set()
                    release.wait(5.0)
                lock = gateway._get_cmd_lock()

                async def holder():
                    async with lock:
                        await gateway._cmd_blocking(cmd_fn, wait=None)
                t = asyncio.create_task(holder())
                await asyncio.to_thread(started.wait, 2.0)
                self.assertTrue(started.is_set())
                t.cancel()
                await asyncio.sleep(0.2)
                self.assertTrue(lock.locked(), "lock released while the NML thread was still running")
                self.assertFalse(t.done())
                release.set()
                with self.assertRaises(asyncio.CancelledError):
                    await t
                self.assertFalse(lock.locked())
            asyncio.run(main())
        finally:
            gateway._cmd_lock = orig_lock


if __name__ == "__main__":
    unittest.main()
