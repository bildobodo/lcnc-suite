"""Unit tests for hal_bridge (M6) — real Unix sockets in a tempdir.

No HAL, no gateway import. The watchdog side is exercised against a plain
blocking AF_UNIX listener in a thread (mirroring hal_watchdog.py's select
loop); the reader side against an asyncio unix server (mirroring
hal_reader.py's push/RPC protocol).
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


def _noop_phase(name: str) -> None:
    pass


class TestWatchdogSocket(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "wd.sock")

    def tearDown(self):
        self.tmp.cleanup()

    def _bridge(self):
        return hal_bridge.HalBridge(
            set_phase=_noop_phase,
            on_reader_connect=lambda: None,
            watchdog_path=self.path,
            reader_path=os.path.join(self.tmp.name, "rd.sock"),
        )

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

    def test_send_roundtrip(self):
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(self.path)
        srv.listen(1)
        received = []
        done = threading.Event()

        def _accept():
            conn, _ = srv.accept()
            with conn:
                buf = b""
                while b"\n" not in buf:
                    chunk = conn.recv(4096)
                    if not chunk:
                        break
                    buf += chunk
                received.append(buf)
            done.set()

        t = threading.Thread(target=_accept, daemon=True)
        t.start()
        try:
            b = self._bridge()
            b.watchdog_send({"heartbeat": True, "connected": True})
            self.assertTrue(b.watchdog_connected)
            b.watchdog_disconnect()  # closes the conn so the server thread exits
            self.assertTrue(done.wait(2.0))
            msg = json.loads(received[0].decode().strip())
            self.assertEqual(msg, {"heartbeat": True, "connected": True})
            self.assertFalse(b.watchdog_connected)
        finally:
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
        # (First send after close may land in the buffer; second hits EPIPE.)
        b.watchdog_send({"heartbeat": False})
        b.watchdog_send({"heartbeat": True})

    def test_outq_disconnected(self):
        self.assertEqual(self._bridge().watchdog_outq(), -1)


class _ReaderServer:
    """Scriptable hal_reader.py stand-in: pushes lines, echoes RPC replies."""

    def __init__(self, path: str):
        self.path = path
        self.server = None
        self.writer = None
        self.requests = []
        self.connected = asyncio.Event()
        self.reply_ok = True

    async def start(self):
        self.server = await asyncio.start_unix_server(self._on_client, path=self.path)

    async def _on_client(self, reader, writer):
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

        def _hook():
            self.hook_calls += 1
            if self.hook_raises:
                raise RuntimeError("scripted hook failure")

        self.bridge = hal_bridge.HalBridge(
            set_phase=_noop_phase,
            on_reader_connect=_hook,
            watchdog_path=os.path.join(self.tmp.name, "wd.sock"),
            reader_path=path,
            reader_stale_sec=0.2,
        )
        self.loop_task = asyncio.create_task(self.bridge.reader_recv_loop())

    async def asyncTearDown(self):
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

    async def test_snapshot_get_freshness_and_absent_field(self):
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

    async def test_request_reply_roundtrip(self):
        await self._wait_connected()
        result = await self.bridge.reader_request("halshow_dump")
        self.assertEqual(result, {"echo": "halshow_dump"})
        self.assertEqual(self.srv.requests[0]["req"], "halshow_dump")

    async def test_request_kwargs_forwarded(self):
        await self._wait_connected()
        await self.bridge.reader_request("set_p", pin="compensation.reload-req", value="1")
        req = self.srv.requests[0]
        self.assertEqual(req["pin"], "compensation.reload-req")
        self.assertEqual(req["value"], "1")

    async def test_request_error_reply_raises(self):
        await self._wait_connected()
        self.srv.reply_ok = False
        with self.assertRaises(RuntimeError):
            await self.bridge.reader_request("set_p", pin="x", value="1")

    async def test_request_timeout(self):
        await self._wait_connected()
        with self.assertRaises(asyncio.TimeoutError):
            await self.bridge.reader_request("no_reply", timeout=0.1)
        self.assertEqual(self.bridge._reader_pending, {})  # no leaked future

    async def test_request_without_connection_raises(self):
        b = hal_bridge.HalBridge(
            set_phase=_noop_phase, on_reader_connect=lambda: None,
            reader_path=os.path.join(self.tmp.name, "nowhere.sock"))
        with self.assertRaises(ConnectionError):
            await b.reader_request("set_p", pin="x", value="1")

    async def test_pending_request_fails_on_disconnect(self):
        await self._wait_connected()
        pending = asyncio.create_task(
            self.bridge.reader_request("no_reply", timeout=5.0))
        await asyncio.sleep(0.05)  # let the request reach the server
        await self.srv.stop()
        with self.assertRaises(ConnectionError):
            await asyncio.wait_for(pending, timeout=2.0)

    async def test_on_connect_hook_failure_is_contained(self):
        self.hook_raises = True
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
