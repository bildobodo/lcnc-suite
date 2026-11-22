"""R431: a retried read-back still has an independently observed terminal end."""
import asyncio
from unittest.mock import patch
from test_toolsetter_basis import _HoldBase, _St, gateway
from test_g30 import _run, linuxcnc

class TestR431Retry(_HoldBase):
    def test_retry_after_not_admitted_books_its_binding_failure(self):
        self.probe_op()
        key = gateway._ts_attempt_key()
        async def refused():
            raise gateway.NotConnected("lost Link")
        async def broken():
            raise linuxcnc.error("synch send failed")
        async def go():
            with patch.object(gateway, "_synch_interp_params", refused):
                self.assertIsNone(gateway._ts_poll(_St))
                await gateway._ts_readback_task
            self.assertEqual(gateway._ts_readback_outcomes[key], "not_admitted")
            self.assertIsNone(gateway._ts_readback_tried)
            with patch.object(gateway, "_synch_interp_params", broken):
                self.assertIsNone(gateway._ts_poll(_St))
                with self.assertRaises(linuxcnc.error):
                    await gateway._ts_readback_task
            await asyncio.sleep(0)
        _run(go())
        self.assertEqual(gateway._ts_readback_outcomes[key], "failed")
        self.assertIsNone(gateway._ts_hold_reason(_St))
        self.assertEqual(self.poll(), "toolsetter")
