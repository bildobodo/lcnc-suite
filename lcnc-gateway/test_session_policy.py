"""Gateway-side session-binding policy under the fake binding.

Bind-once is OFF under the fake (test_ws_lifecycle relies on the legacy
"back to disconnected, not exited" contract); here it is forced ON per test
with `_request_process_shutdown` recorded instead of signalling anything.
"""
import asyncio
import os
import time
import unittest

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`

import gateway  # noqa: E402
import session_bind  # noqa: E402


class _Policy(unittest.TestCase):
    def setUp(self):
        self.saved = {k: getattr(gateway, k) for k in (
            "_bound_instance", "_instance_ended", "_shutdown_requested", "lcnc_connected",
            "_lcnc_pid", "STAT", "CMD", "ERR", "_get_lcnc_pid", "_nml_connectable",
            "_bind_once_enabled", "_request_process_shutdown", "_gw_start_mono")}
        self.saved_ifp = session_bind.instance_for_pid
        self.shutdowns = []
        self.emits = []
        self.real_emit = gateway._trace.emit
        gateway._trace.emit = lambda tag, **kw: self.emits.append((tag, kw))
        gateway._request_process_shutdown = lambda reason: self.shutdowns.append(reason)
        gateway._nml_connectable = lambda: True
        gateway._get_lcnc_pid = lambda: os.getpid()   # a real, live /proc entry
        gateway._bound_instance = None
        gateway._instance_ended = False
        gateway._shutdown_requested = False
        gateway.lcnc_connected = False
        gateway._hal_bridge._wd_reject_reason = None
        gateway._hal_bridge._reader_reject_reason = None

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(gateway, k, v)
        session_bind.instance_for_pid = self.saved_ifp
        gateway._trace.emit = self.real_emit
        gateway._hal_bridge._wd_reject_reason = None
        gateway._hal_bridge._reader_reject_reason = None

    def _tags(self):
        return [t for t, _ in self.emits]


class TestBindOnce(_Policy):
    def test_off_under_fake_binding(self):
        self.assertFalse(gateway._bind_once_enabled())

    def test_first_connect_binds_to_live_instance(self):
        gateway._bind_once_enabled = lambda: True
        self.assertTrue(gateway.try_connect_lcnc())
        self.assertEqual(gateway._bound_instance, session_bind.instance_for_pid(os.getpid()))
        self.assertIn("session.bound", self._tags())
        self.assertTrue(gateway._bound_instance_alive())
        self.assertFalse(gateway.check_lcnc_instance())   # bound + alive → nothing to do
        self.assertEqual(self.shutdowns, [])
        hello = gateway._hal_bridge._hello()
        self.assertEqual(hello["instance"], {"pid": os.getpid(), "start": gateway._bound_instance[1]})

    def test_instance_end_shuts_down_and_never_rebinds(self):
        gateway._bind_once_enabled = lambda: True
        self.assertTrue(gateway.try_connect_lcnc())
        # The bound instance dies (simulated: /proc no longer identifies it).
        session_bind.instance_for_pid = lambda pid, proc_root="/proc": None
        self.assertFalse(gateway.check_lcnc_instance())
        self.assertTrue(gateway._instance_ended)
        self.assertFalse(gateway.lcnc_connected)
        self.assertEqual(self.shutdowns, ["linuxcnc instance ended"])
        self.assertIn("session.instance_ended", self._tags())
        # A new instance appearing must NOT be adopted.
        session_bind.instance_for_pid = lambda pid, proc_root="/proc": (pid, 999)
        self.assertFalse(gateway.try_connect_lcnc())
        self.assertFalse(gateway.check_lcnc_instance())
        self.assertEqual(len(self.shutdowns), 1)          # idempotent

    def test_reconnect_to_different_instance_is_refused(self):
        gateway._bind_once_enabled = lambda: True
        self.assertTrue(gateway.try_connect_lcnc())
        session_bind.instance_for_pid = lambda pid, proc_root="/proc": (pid, 999)  # different start
        self.assertFalse(gateway.try_connect_lcnc())
        self.assertIsNone(gateway.STAT)
        self.assertIn("session.instance_changed", self._tags())
        self.assertEqual(self.shutdowns, ["linuxcnc instance ended"])

    def test_rebind_allowed_follows_new_instance(self):
        gateway._bind_once_enabled = lambda: False     # WEBUI_ALLOW_REBIND=1 / fake
        self.assertTrue(gateway.try_connect_lcnc())
        first = gateway._bound_instance
        session_bind.instance_for_pid = lambda pid, proc_root="/proc": (pid, 999)
        self.assertTrue(gateway.try_connect_lcnc())
        self.assertEqual(gateway._bound_instance, (os.getpid(), 999))
        self.assertNotEqual(gateway._bound_instance, first)
        self.assertIn("session.rebind", self._tags())
        self.assertEqual(self.shutdowns, [])

    def test_unresolved_pid_connects_unbound(self):
        gateway._bind_once_enabled = lambda: True
        gateway._get_lcnc_pid = lambda: 424242          # no such /proc entry (test_ws_lifecycle style)
        self.assertTrue(gateway.try_connect_lcnc())
        self.assertIsNone(gateway._bound_instance)
        self.assertIn("session.bind_unresolved", self._tags())
        self.assertIsNone(gateway._hal_bridge._hello()["instance"])  # helpers would not admit us
        self.assertEqual(self.shutdowns, [])

    def test_watch_loop_detects_end_without_clients(self):
        gateway._bind_once_enabled = lambda: True
        self.assertTrue(gateway.try_connect_lcnc())
        session_bind.instance_for_pid = lambda pid, proc_root="/proc": None

        async def run():
            task = asyncio.create_task(gateway._instance_watch_loop())
            try:
                for _ in range(40):
                    if self.shutdowns:
                        break
                    await asyncio.sleep(0.05)
            finally:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        asyncio.run(run())
        self.assertEqual(self.shutdowns, ["linuxcnc instance ended"])

    def test_helper_rejection_policy(self):
        gateway._bind_once_enabled = lambda: True
        gateway._on_helper_rejected("reader", "duplicate_gateway")
        self.assertEqual(self.shutdowns, [])
        gateway._on_helper_rejected("watchdog", "stale_instance")
        self.assertEqual(self.shutdowns, ["HAL watchdog rejected this gateway as stale"])
        self.assertEqual([kw["reason"] for t, kw in self.emits if t == "session.helper_rejected"],
                         ["duplicate_gateway", "stale_instance"])

    def test_banner_carries_helper_reason(self):
        gateway._gw_start_mono = time.monotonic() - 1000  # grace expired
        gateway._hal_bridge._wd_reject_reason = "duplicate_gateway"
        reason = gateway._safety_chain_reason()
        self.assertIn("duplicate_gateway", reason)


class TestShutdownRequest(unittest.TestCase):
    def test_fake_binding_only_records(self):
        emits = []
        real_emit = gateway._trace.emit
        gateway._trace.emit = lambda tag, **kw: emits.append((tag, kw))
        saved = gateway._shutdown_requested
        gateway._shutdown_requested = False
        try:
            gateway._request_process_shutdown("test")
            gateway._request_process_shutdown("test again")   # idempotent
            self.assertEqual([t for t, _ in emits], ["session.shutdown_requested"])
            self.assertEqual(emits[0][1]["reason"], "test")
        finally:
            gateway._shutdown_requested = saved
            gateway._trace.emit = real_emit


if __name__ == "__main__":
    unittest.main()
