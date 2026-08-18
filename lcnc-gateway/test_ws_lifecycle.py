"""WS endpoint lifecycle tests (WS-B).

Two regression guards for the ws_endpoint connect/teardown contract:

1. viewer_init is sent EXACTLY ONCE per connection. Before WS-B the endpoint
   sent a connect-time viewer_init, then unconditionally reset the flag so the
   post-poll send fired again — every connect double-sent, and a mid-session
   double-send with changed content forces a full scene rebuild in the client.

2. Cancelling the handler task (what uvicorn does to live WS connections on
   SIGTERM, BEFORE lifespan shutdown runs) must push a server_shutdown frame
   and a going-away close out to the client. Before WS-B the client saw a bare
   abnormal close: by the time the lifespan broadcast ran, every handler's
   finally had already popped its client, so the broadcast saw zero clients.

Harness notes: same TestClient-portal pattern as test_ws_smoke.py. The fake
linuxcnc binding's STAT.poll() succeeds, so the shared poller runs and the
post-poll viewer_init path is live. The cancel test reaches into the app's
event loop via the TestClient portal to cancel the ws_endpoint task by its
coroutine name — the same delivery mechanism as uvicorn's shutdown cancel.
"""
import asyncio
import time
import unittest
from concurrent import futures

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`

import msgspec  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.testclient import WebSocketDenialResponse  # noqa: F401,E402  (import guards starlette API drift)

import gateway  # noqa: E402


def _decode(message) -> dict:
    if message.get("bytes") is not None:
        return msgspec.msgpack.decode(message["bytes"])
    import json
    return json.loads(message["text"])


class TestViewerInitSingleSend(unittest.TestCase):
    def test_viewer_init_sent_exactly_once(self):
        """Pump the session well past connect; count viewer_init frames.

        The PID liveness check (check_lcnc_instance) sees no real
        linuxcncsvr process under the fake binding, resets the connection,
        and the stream degrades to rate-limited status_error — the drain
        below then starves past its deadline (found by the 2026-08 CI
        repair). This test's subject is the WS lifecycle, not instance
        discovery: pin the PID probe + NML gate for the duration so the
        fake stays connected and the real 30 Hz status path runs — the
        harness premise in the module docstring. State restores itself
        after the patch: the next check sees the real (absent) PID and
        transitions back to disconnected.
        """
        counts = 0
        saw_status = 0
        deadline = time.monotonic() + 15.0
        # Only the FAKE binding gets the connect pin: under `unittest`
        # discover the real binding may already be loaded (no conftest),
        # and without a running LinuxCNC its stat() constructor raises —
        # there the legacy error-frame stream exercises the drain instead.
        is_fake = getattr(gateway.linuxcnc, "__lcnc_fake__", False)
        orig_pid, orig_nml = gateway._get_lcnc_pid, gateway._nml_connectable
        try:
            if is_fake:
                gateway._get_lcnc_pid = lambda: 424242
                gateway._nml_connectable = lambda: True
                self.assertTrue(gateway.try_connect_lcnc(),
                                "fake linuxcnc must connect")
            with TestClient(gateway.app) as client:
                with client.websocket_connect("/ws") as ws:
                    ws.send_json({"cmd": "hello", "session": "vinit-once", "resume_armed": False})
                    # Drain until we've seen a healthy number of status-family
                    # frames — enough ticks that the old double-send (connect-time
                    # + first-poll) would certainly have produced 2 by now.
                    while saw_status < 10:
                        self.assertLess(time.monotonic(), deadline,
                                        "status stream never became healthy")
                        ws.send_json({"cmd": "heartbeat"})
                        msg = _decode(ws.receive())
                        t = msg.get("type", "?")
                        if t == "viewer_init":
                            counts += 1
                        elif t in ("status", "status_delta", "status_error"):
                            saw_status += 1
                        time.sleep(0.02)
        finally:
            gateway._get_lcnc_pid = orig_pid
            gateway._nml_connectable = orig_nml
        self.assertEqual(counts, 1, f"viewer_init must be sent exactly once per connect, saw {counts}")


class TestShutdownGoodbyeOnCancel(unittest.TestCase):
    def test_cancel_pushes_server_shutdown_frame(self):
        """Cancel ws_endpoint mid-session → the handler sends server_shutdown.

        Cancelling the handler under TestClient also tears down the client
        side of the test session (the whole ASGI chain runs in ONE portal
        task), so client-side receipt can't be asserted here — the wire
        delivery of the frame/1001-close is covered by the frontend e2e
        lifecycle spec. This test asserts at the send seam instead: the
        cancelled handler must push a server_shutdown frame through
        ws_send_json before re-raising. Removing the CancelledError handler
        in ws_endpoint turns this red.
        """
        sent_types: list = []
        real_send = gateway.ws_send_json

        async def recording_send(ws, obj):
            await real_send(ws, obj)  # only record frames that actually sent
            sent_types.append(obj.get("type"))

        def _cancel_ws_endpoint_tasks():
            # The endpoint is NOT the task's outermost coroutine under
            # TestClient (the session task runs the whole ASGI app chain), so
            # walk each task's cr_await chain looking for ws_endpoint. The
            # asyncio Task.cancel() this delivers is the same one-shot edge
            # cancel uvicorn delivers to live WS handler tasks on SIGTERM.
            n = 0
            for t in asyncio.all_tasks():
                coro = t.get_coro()
                while coro is not None:
                    if getattr(coro, "__name__", "") == "ws_endpoint":
                        t.cancel()
                        n += 1
                        break
                    coro = getattr(coro, "cr_await", None)
            return n

        deadline = time.monotonic() + 15.0
        gateway.ws_send_json = recording_send
        try:
            with TestClient(gateway.app) as client:
                try:
                    with client.websocket_connect("/ws") as ws:
                        ws.send_json({"cmd": "hello", "session": "cancel-bye", "resume_armed": False})
                        # Wait until the handler is fully up (any status-family frame).
                        while True:
                            self.assertLess(time.monotonic(), deadline, "no status frame before cancel")
                            ws.send_json({"cmd": "heartbeat"})
                            msg = _decode(ws.receive())
                            if msg.get("type") in ("status", "status_delta", "status_error"):
                                break
                            time.sleep(0.02)

                        cancelled = client.portal.call(_cancel_ws_endpoint_tasks)
                        self.assertEqual(cancelled, 1, "expected exactly one live ws_endpoint task")
                        # Give the cancelled handler a moment to run its goodbye.
                        for _ in range(100):
                            if "server_shutdown" in sent_types:
                                break
                            time.sleep(0.02)
                except BaseException as e:
                    # The cancel rips the shared session task out from under the
                    # client-side plumbing; a CancelledError leaking from the
                    # session teardown is expected, anything else is a real
                    # error. Both flavours: asyncio's (BaseException) from the
                    # loop side, concurrent.futures' (a DISTINCT class here —
                    # the 3.8 aliasing does not hold in this environment) from
                    # the portal's cross-thread future.
                    if not isinstance(e, (asyncio.CancelledError, futures.CancelledError)):
                        raise
        finally:
            gateway.ws_send_json = real_send

        self.assertIn("server_shutdown", sent_types,
                      "cancelled handler must push a server_shutdown frame before re-raising")


class TestBinaryFrameRejected(unittest.TestCase):
    def test_binary_frame_gets_error_reply_and_connection_survives(self):
        """A BINARY frame must be rejected politely, not kill the session.

        Before this guard, starlette's receive_text() raised KeyError('text')
        on a binary frame; the KeyError sailed past the (WebSocketDisconnect,
        RuntimeError) handler and tore the connection down through the
        armed-disconnect side effects — one stray frame from a broken client
        (e.g. a probe sending msgpack commands) killed its session. Now the
        endpoint replies with an error frame and keeps serving: a heartbeat
        sent AFTER the binary frame must still get its pong.
        """
        deadline = time.monotonic() + 15.0
        got_error_reply = False
        got_pong_after = False
        with TestClient(gateway.app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"cmd": "hello", "session": "bin-reject", "resume_armed": False})
                ws.send_bytes(b"\x81\xa3cmd\xa9heartbeat")  # msgpack {"cmd": "heartbeat"}
                while not (got_error_reply and got_pong_after):
                    self.assertLess(time.monotonic(), deadline,
                                    "never saw error reply + post-binary pong")
                    if got_error_reply and not got_pong_after:
                        ws.send_json({"cmd": "heartbeat"})
                    msg = _decode(ws.receive())
                    t = msg.get("type")
                    if t == "reply" and msg.get("ok") is False and "text JSON" in str(msg.get("error", "")):
                        got_error_reply = True
                    elif t == "pong" and got_error_reply:
                        got_pong_after = True
                    time.sleep(0.02)
        self.assertTrue(got_error_reply and got_pong_after)


if __name__ == "__main__":
    unittest.main()
