"""Unit tests for hal_bridge (M6) — real Unix sockets in a tempdir.

No HAL, no gateway import. The watchdog side is exercised against a plain
blocking AF_UNIX listener in a thread (mirroring hal_watchdog.py's select
loop); the reader side against an asyncio unix server (mirroring
hal_reader.py's push/RPC protocol). Both stand-ins speak the session-binding
handshake: the first line from the bridge is the hello, answered with
welcome / rejected — or, for a scripted "legacy" helper, not answered at all.
"""
import asyncio
import json
import os
import socket
import tempfile
import threading
import time
import unittest

import hal_bridge
import session_bind

BOUND = (1234, 5678)


def _noop_phase(name: str) -> None:
    pass


def _hello_bound():
    return session_bind.make_hello(BOUND)


def _hello_unbound():
    return session_bind.make_hello(None)


class _WatchdogServer:
    """Threaded stand-in for hal_watchdog.py's accept + hello handling."""

    def __init__(self, path: str, *, verdict: str = "welcome", reason: str = "stale_instance"):
        self.path = path
        self.verdict = verdict            # "welcome" | "rejected" | "silent"
        self.reason = reason
        self.lines = []
        self.accepts = 0
        self.done = threading.Event()
        self.srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        if os.path.exists(path):
            os.unlink(path)  # a closed Unix socket leaves its path behind
        self.srv.bind(path)
        self.srv.listen(4)
        self.srv.settimeout(3.0)
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        try:
            conn, _ = self.srv.accept()
        except OSError:
            self.done.set()
            return
        self.accepts += 1
        with conn:
            conn.settimeout(3.0)
            buf = b""
            verdict_sent = False
            # Like the real helper: answer the FIRST line, then keep the
            # connection until the peer closes it (a rejection closes at once).
            while True:
                try:
                    chunk = conn.recv(4096)
                except OSError:
                    break
                if not chunk:
                    break
                buf += chunk
                if not verdict_sent and b"\n" in buf and self.verdict != "silent":
                    verdict_sent = True
                    if self.verdict == "welcome":
                        conn.sendall(b'{"type": "welcome"}\n')
                    else:
                        conn.sendall(json.dumps({"type": "rejected", "reason": self.reason}).encode() + b"\n")
                        break
            self.lines = [json.loads(line) for line in buf.decode().split("\n") if line.strip()]
        self.done.set()

    def close(self):
        self.srv.close()


class TestWatchdogSocket(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "wd.sock")
        self.rejections = []

    def tearDown(self):
        self.tmp.cleanup()

    def _bridge(self, hello=_hello_bound, **kw):
        args = dict(
            set_phase=_noop_phase,
            on_reader_connect=lambda: None,
            hello=hello,
            on_rejected=lambda role, reason: self.rejections.append((role, reason)),
            watchdog_path=self.path,
            reader_path=os.path.join(self.tmp.name, "rd.sock"),
            reject_backoff_sec=0.3,
            helper_reply_sec=0.3,
        )
        args.update(kw)
        return hal_bridge.HalBridge(**args)

    def test_connect_failed_is_nonfatal(self):
        # No listener at the path: send must not raise, state stays disconnected.
        b = self._bridge()
        b.watchdog_send({"heartbeat": True})
        self.assertFalse(b.watchdog_connected)

    def test_connect_failures_are_rate_limited_and_recovery_reports_total(self):
        # The connect is retried per heartbeat send (~30 Hz); an outage must
        # emit ONE failure line up front — not one per attempt — and the
        # recovery emit must carry the outage's attempt count so nothing is
        # silently dropped.
        emitted = []
        real_emit = hal_bridge._trace.emit
        hal_bridge._trace.emit = lambda tag, **kw: emitted.append((tag, kw))
        try:
            b = self._bridge()
            for _ in range(5):
                b.watchdog_send({"heartbeat": True})  # 5 failed connects, no listener
            fails = [e for e in emitted if e[0] == "hal.socket_connect_failed"]
            self.assertEqual(len(fails), 1, f"burst must emit once, got {fails}")
            self.assertEqual(fails[0][1]["fails"], 1)  # first failure emits immediately

            srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            srv.bind(self.path)
            srv.listen(1)
            try:
                b.watchdog_send({"heartbeat": True})  # connects now
                self.assertTrue(b.watchdog_connected)
                conns = [e for e in emitted if e[0] == "hal.socket_connected"]
                self.assertEqual(len(conns), 1)
                self.assertEqual(conns[0][1]["after_fails"], 5)
            finally:
                srv.close()
        finally:
            hal_bridge._trace.emit = real_emit

    def test_failure_aggregator_interval_and_reset(self):
        emitted = []
        real_emit = hal_bridge._trace.emit
        hal_bridge._trace.emit = lambda tag, **kw: emitted.append((tag, kw))
        try:
            agg = hal_bridge._FailureAggregator("t.fail", interval_sec=0.05)
            err = OSError("nope")
            for _ in range(10):
                agg.failure(err)
            self.assertEqual(len(emitted), 1)          # burst → one line
            time.sleep(0.06)
            agg.failure(err)                            # interval elapsed
            self.assertEqual(len(emitted), 2)
            self.assertEqual(emitted[1][1]["fails"], 11)  # cumulative count
            self.assertEqual(agg.success(), 11)
            agg.failure(err)                            # new outage: immediate again
            self.assertEqual(len(emitted), 3)
            self.assertEqual(emitted[2][1]["fails"], 1)
        finally:
            hal_bridge._trace.emit = real_emit

    def test_hello_precedes_first_message_and_welcome_admits(self):
        srv = _WatchdogServer(self.path, verdict="welcome")
        try:
            b = self._bridge()
            b.watchdog_send({"heartbeat": True, "connected": True})
            self.assertTrue(b.watchdog_connected)
            time.sleep(0.05)
            b.watchdog_send({"heartbeat": False, "connected": True})  # drains the welcome
            self.assertTrue(b.watchdog_admitted)
            self.assertIsNone(b.helper_status_reason())
            b.watchdog_disconnect()
            self.assertTrue(srv.done.wait(2.0))
            self.assertEqual(srv.lines[0]["type"], "hello")
            self.assertEqual(srv.lines[0]["gateway_pid"], os.getpid())
            self.assertEqual(srv.lines[0]["instance"], {"pid": BOUND[0], "start": BOUND[1]})
            self.assertEqual(srv.lines[1], {"heartbeat": True, "connected": True})
            self.assertFalse(b.watchdog_connected)
        finally:
            srv.close()

    def test_rejected_disconnects_backs_off_then_redials(self):
        srv = _WatchdogServer(self.path, verdict="rejected", reason="stale_instance")
        emitted = []
        real_emit = hal_bridge._trace.emit
        hal_bridge._trace.emit = lambda tag, **kw: emitted.append((tag, kw))
        try:
            b = self._bridge()
            b.watchdog_send({"heartbeat": True})   # connect + hello
            self.assertTrue(srv.done.wait(2.0))    # server answered + closed
            time.sleep(0.05)
            b.watchdog_send({"heartbeat": False})  # drains the verdict
            self.assertFalse(b.watchdog_connected)
            self.assertEqual(b.watchdog_reject_reason, "stale_instance")
            self.assertEqual(self.rejections, [("watchdog", "stale_instance")])
            self.assertIn("stale_instance", b.helper_status_reason())
            rej = [e for e in emitted if e[0] == "hal.rejected"]
            self.assertEqual(rej[0][1]["level"], "error")
            srv.close()
            # Within the backoff: no redial (a listener would otherwise be dialled).
            srv2 = _WatchdogServer(self.path, verdict="welcome")
            b.watchdog_send({"heartbeat": True})
            self.assertFalse(b.watchdog_connected)
            time.sleep(0.35)
            b.watchdog_send({"heartbeat": True})   # backoff over → redial
            self.assertTrue(b.watchdog_connected)
            time.sleep(0.05)
            b.watchdog_send({"heartbeat": False})
            self.assertTrue(b.watchdog_admitted)
            self.assertIsNone(b.watchdog_reject_reason)
            b.watchdog_disconnect()
            srv2.done.wait(2.0)
            srv2.close()
        finally:
            hal_bridge._trace.emit = real_emit

    def test_legacy_helper_never_replies_keeps_sending(self):
        srv = _WatchdogServer(self.path, verdict="silent")
        try:
            b = self._bridge()
            deadline = time.monotonic() + 1.0
            while time.monotonic() < deadline:
                b.watchdog_send({"heartbeat": True})
                time.sleep(0.05)
            self.assertTrue(b.watchdog_connected)
            self.assertFalse(b.watchdog_admitted)
            self.assertIn("predates session binding", b.helper_status_reason())
            b.watchdog_disconnect()
            self.assertTrue(srv.done.wait(2.0))
            self.assertEqual(srv.lines[0]["type"], "hello")
            self.assertGreaterEqual(len(srv.lines), 4)
        finally:
            srv.close()

    def test_unbound_gateway_never_dials(self):
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(self.path)
        srv.listen(1)
        srv.settimeout(0.2)
        emitted = []
        real_emit = hal_bridge._trace.emit
        hal_bridge._trace.emit = lambda tag, **kw: emitted.append((tag, kw))
        try:
            b = self._bridge(hello=_hello_unbound)
            for _ in range(3):
                b.watchdog_send({"heartbeat": True})
            self.assertFalse(b.watchdog_connected)
            with self.assertRaises(socket.timeout):
                srv.accept()  # nobody dialled
            deferred = [e for e in emitted if e[0] == "hal.connect_deferred_unbound"]
            self.assertEqual(len(deferred), 1)  # rate-limited
        finally:
            hal_bridge._trace.emit = real_emit
            srv.close()

    def test_send_after_peer_close_never_raises(self):
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(self.path)
        srv.listen(1)
        b = self._bridge()
        b.watchdog_send({"heartbeat": True})
        conn, _ = srv.accept()
        conn.close()
        srv.close()
        # Contract: watchdog_send NEVER raises — a dead peer is a logged drop.
        b.watchdog_send({"heartbeat": False})
        b.watchdog_send({"heartbeat": True})
        self.assertFalse(b.watchdog_connected)

    def test_outq_disconnected(self):
        self.assertEqual(self._bridge().watchdog_outq(), -1)


class _ReaderServer:
    """Scriptable hal_reader.py stand-in: answers the hello, pushes lines,
    echoes RPC replies."""

    def __init__(self, path: str):
        self.path = path
        self.server = None
        self.writer = None
        self.requests = []
        self.hellos = []
        self.connected = asyncio.Event()   # set once the verdict was sent
        self.reply_ok = True
        self.reject_reason = None          # str → reject every client
        self.legacy = False                # True → answer like an old reader
        self.pre_welcome = []              # objects pushed BEFORE the verdict

    async def start(self):
        self.server = await asyncio.start_unix_server(self._on_client, path=self.path)

    async def _on_client(self, reader, writer):
        first = await reader.readline()
        if not first:
            writer.close()
            return
        hello = json.loads(first.decode())
        self.hellos.append(hello)
        for obj in self.pre_welcome:
            writer.write((json.dumps(obj) + "\n").encode())
        if hello.get("type") != "hello" or self.reject_reason:
            writer.write(json.dumps({"type": "rejected",
                                     "reason": self.reject_reason or "no_hello"}).encode() + b"\n")
            await writer.drain()
            writer.close()
            self.connected.set()
            return
        if self.legacy:
            writer.write(json.dumps({"type": "reply", "id": None, "ok": False,
                                     "error": "unknown req 'None'"}).encode() + b"\n")
        else:
            writer.write(b'{"type": "welcome"}\n')
        await writer.drain()
        self.writer = writer
        self.connected.set()
        while True:
            line = await reader.readline()
            if not line:
                break
            req = json.loads(line.decode())
            self.requests.append(req)
            if req.get("req") == "no_reply":
                continue
            reply = {"type": "reply", "id": req["id"], "ok": self.reply_ok,
                     "result": {"echo": req.get("req")}, "error": "scripted failure"}
            writer.write((json.dumps(reply) + "\n").encode())
            await writer.drain()

    async def push(self, obj: dict):
        self.writer.write((json.dumps(obj) + "\n").encode())
        await self.writer.drain()

    async def push_raw(self, data: bytes):
        self.writer.write(data)
        await self.writer.drain()

    async def stop(self):
        if self.writer is not None:
            self.writer.close()
        if self.server is not None:
            self.server.close()
            await self.server.wait_closed()


class TestReaderSocket(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        path = os.path.join(self.tmp.name, "rd.sock")
        self.srv = _ReaderServer(path)
        await self.srv.start()
        self.hook_calls = 0
        self.hook_raises = False
        self.hook_saw_welcome = []
        self.rejections = []

        def _hook():
            self.hook_calls += 1
            self.hook_saw_welcome.append(self.srv.connected.is_set())
            if self.hook_raises:
                raise RuntimeError("scripted hook failure")

        self.bridge = hal_bridge.HalBridge(
            set_phase=_noop_phase,
            on_reader_connect=_hook,
            hello=_hello_bound,
            on_rejected=lambda role, reason: self.rejections.append((role, reason)),
            watchdog_path=os.path.join(self.tmp.name, "wd.sock"),
            reader_path=path,
            reader_stale_sec=0.2,
            reject_backoff_sec=0.3,
            helper_reply_sec=0.3,
        )
        self.loop_task = None

    def _start(self):
        self.loop_task = asyncio.create_task(self.bridge.reader_recv_loop())

    async def asyncTearDown(self):
        if self.loop_task is not None:
            self.loop_task.cancel()
            try:
                await self.loop_task
            except asyncio.CancelledError:
                pass
        await self.srv.stop()
        self.tmp.cleanup()

    async def _wait_connected(self):
        await asyncio.wait_for(self.srv.connected.wait(), timeout=2.0)
        for _ in range(100):
            if self.bridge.reader_connected:
                return
            await asyncio.sleep(0.01)
        self.fail("bridge never marked reader_connected")

    async def test_get_is_none_without_snapshot_and_stale(self):
        # No-silent-fallback semantics: absent data is None, never a default.
        self.assertIsNone(self.bridge.reader_get("tool_change"))
        self.assertTrue(self.bridge.reader_is_stale())

    async def test_hello_first_welcome_then_hook(self):
        self._start()
        await self._wait_connected()
        self.assertEqual(len(self.srv.hellos), 1)
        self.assertEqual(self.srv.hellos[0]["type"], "hello")
        self.assertEqual(self.srv.hellos[0]["instance"], {"pid": BOUND[0], "start": BOUND[1]})
        self.assertEqual(self.hook_calls, 1)
        self.assertEqual(self.hook_saw_welcome, [True])  # hook only after the verdict
        self.assertIsNone(self.bridge.reader_reject_reason)
        self.assertIsNone(self.bridge.helper_status_reason())

    async def test_snapshot_get_freshness_and_absent_field(self):
        self._start()
        await self._wait_connected()
        await self.srv.push({"type": "snapshot", "tool_change": True, "z_eoffset": 0.5})
        for _ in range(100):
            if self.bridge.reader_get("tool_change") is not None:
                break
            await asyncio.sleep(0.01)
        self.assertIs(self.bridge.reader_get("tool_change"), True)
        self.assertEqual(self.bridge.reader_get("z_eoffset"), 0.5)
        self.assertIsNone(self.bridge.reader_get("not_in_snapshot"))
        self.assertFalse(self.bridge.reader_is_stale())
        await asyncio.sleep(0.3)  # past reader_stale_sec=0.2 with no new push
        self.assertTrue(self.bridge.reader_is_stale())

    async def test_snapshot_pushed_before_verdict_is_kept(self):
        self.srv.pre_welcome = [{"type": "snapshot", "probe_input": True}]
        self._start()
        await self._wait_connected()
        for _ in range(100):
            if self.bridge.reader_get("probe_input") is not None:
                break
            await asyncio.sleep(0.01)
        self.assertIs(self.bridge.reader_get("probe_input"), True)

    async def test_rejected_backs_off_and_reports(self):
        self.srv.reject_reason = "duplicate_gateway"
        self._start()
        await asyncio.wait_for(self.srv.connected.wait(), timeout=2.0)
        await asyncio.sleep(0.1)
        self.assertFalse(self.bridge.reader_connected)
        self.assertEqual(self.bridge.reader_reject_reason, "duplicate_gateway")
        self.assertEqual(self.rejections, [("reader", "duplicate_gateway")])
        self.assertIn("duplicate_gateway", self.bridge.helper_status_reason())
        self.assertEqual(self.hook_calls, 0)
        self.assertEqual(len(self.srv.hellos), 1)   # no redial inside the backoff
        # After the backoff the loop redials; let it be admitted now.
        self.srv.reject_reason = None
        self.srv.connected.clear()
        await asyncio.wait_for(self.srv.connected.wait(), timeout=3.0)
        for _ in range(100):
            if self.bridge.reader_connected:
                break
            await asyncio.sleep(0.01)
        self.assertTrue(self.bridge.reader_connected)
        self.assertIsNone(self.bridge.reader_reject_reason)
        self.assertEqual(len(self.srv.hellos), 2)

    async def test_legacy_reader_reply_proceeds_with_banner(self):
        self.srv.legacy = True
        self._start()
        await self._wait_connected()
        self.assertIn("hal_reader predates", self.bridge.helper_status_reason())
        self.assertEqual(self.hook_calls, 1)
        result = await self.bridge.reader_request("halshow_dump")
        self.assertEqual(result, {"echo": "halshow_dump"})

    async def test_unbound_gateway_never_dials(self):
        self.bridge._hello = _hello_unbound
        self._start()
        await asyncio.sleep(0.3)
        self.assertEqual(self.srv.hellos, [])
        self.assertFalse(self.bridge.reader_connected)

    async def test_request_reply_roundtrip(self):
        self._start()
        await self._wait_connected()
        result = await self.bridge.reader_request("halshow_dump")
        self.assertEqual(result, {"echo": "halshow_dump"})
        self.assertEqual(self.srv.requests[0]["req"], "halshow_dump")

    async def test_request_kwargs_forwarded(self):
        self._start()
        await self._wait_connected()
        await self.bridge.reader_request("set_p", pin="compensation.reload-req", value="1")
        req = self.srv.requests[0]
        self.assertEqual(req["pin"], "compensation.reload-req")
        self.assertEqual(req["value"], "1")

    async def test_request_error_reply_raises(self):
        self._start()
        await self._wait_connected()
        self.srv.reply_ok = False
        with self.assertRaises(RuntimeError):
            await self.bridge.reader_request("set_p", pin="x", value="1")

    async def test_request_timeout(self):
        self._start()
        await self._wait_connected()
        with self.assertRaises(asyncio.TimeoutError):
            await self.bridge.reader_request("no_reply", timeout=0.1)
        self.assertEqual(self.bridge._reader_pending, {})  # no leaked future

    async def test_request_without_connection_raises(self):
        b = hal_bridge.HalBridge(
            set_phase=_noop_phase, on_reader_connect=lambda: None, hello=_hello_bound,
            reader_path=os.path.join(self.tmp.name, "nowhere.sock"))
        with self.assertRaises(ConnectionError):
            await b.reader_request("set_p", pin="x", value="1")

    async def test_pending_request_fails_on_disconnect(self):
        self._start()
        await self._wait_connected()
        pending = asyncio.create_task(
            self.bridge.reader_request("no_reply", timeout=5.0))
        await asyncio.sleep(0.05)  # let the request reach the server
        await self.srv.stop()
        with self.assertRaises(ConnectionError):
            await asyncio.wait_for(pending, timeout=2.0)

    async def test_on_connect_hook_failure_is_contained(self):
        self.hook_raises = True
        self._start()
        # Force a reconnect so the raising hook fires on a fresh connection:
        # close the current conn; the loop backs off 1 s and reconnects.
        await self._wait_connected()
        first_calls = self.hook_calls
        self.srv.connected.clear()
        self.srv.writer.close()
        await asyncio.wait_for(self.srv.connected.wait(), timeout=3.0)
        for _ in range(100):
            if self.hook_calls > first_calls:
                break
            await asyncio.sleep(0.01)
        self.assertGreater(self.hook_calls, first_calls)
        # The loop survived the raising hook: snapshots still flow.
        await self.srv.push({"type": "snapshot", "probe_input": False})
        for _ in range(100):
            if self.bridge.reader_get("probe_input") is not None:
                break
            await asyncio.sleep(0.01)
        self.assertIs(self.bridge.reader_get("probe_input"), False)

    async def test_bad_json_line_is_skipped(self):
        self._start()
        await self._wait_connected()
        await self.srv.push_raw(b"{not json}\n")
        await self.srv.push({"type": "snapshot", "tool_change": False})
        for _ in range(100):
            if self.bridge.reader_get("tool_change") is not None:
                break
            await asyncio.sleep(0.01)
        self.assertIs(self.bridge.reader_get("tool_change"), False)


if __name__ == "__main__":
    unittest.main()
