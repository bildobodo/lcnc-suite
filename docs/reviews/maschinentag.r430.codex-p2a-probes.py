"""R430: toolsetter read-back terminal paths, real poll and cancellation."""
import asyncio
from test_toolsetter_basis import TestHoldAndAttempt as _HoldCase, _St, gateway
from test_g30 import _run, linuxcnc


class TestR430ReadbackEnd(_HoldCase):
    def test_r430_cancel_before_first_task_step_ends_the_hold(self):
        self.probe_op()
        key = (gateway._ts_basis_version, "/p.ngc")
        async def go():
            # A stop already ready in the loop, before the task this tick creates.
            asyncio.get_running_loop().call_soon(gateway._preempt_inflight, "abort", 0)
            self.assertIsNone(gateway._ts_poll(_St))
            with self.assertRaises(asyncio.CancelledError):
                await gateway._ts_readback_task
        _run(go())
        self.assertEqual((gateway._ts_readback_outcome, gateway._ts_hold_reason(_St), self.poll()),
                         ((key, "aborted"), None, "toolsetter"))

    def test_r430_binding_error_ends_the_hold_as_failed(self):
        self.probe_op()
        key = (gateway._ts_basis_version, "/p.ngc")
        def broken():
            raise linuxcnc.error("synch send failed")
        broken.__name__ = "task_plan_synch"
        self.task.task_plan_synch = broken
        async def go():
            self.assertIsNone(gateway._ts_poll(_St))
            try:
                await gateway._ts_readback_task
            except linuxcnc.error:
                pass  # Whether it also reports the error is independent of ending the hold.
        _run(go())
        self.assertEqual((gateway._ts_readback_outcome, gateway._ts_hold_reason(_St), self.poll()),
                         ((key, "failed"), None, "toolsetter"))

    def test_r430_new_source_at_the_same_path_gets_its_readback_attempt(self):
        self.probe_op()
        self.task.synch_rc = 3
        self.assertIsNone(self.poll())
        self.assertEqual(gateway._ts_readback_outcome[1], "failed")
        old_version = gateway._ts_basis_version
        # A new file version was loaded/parsed using the still assumed book.
        gateway._bulk.published_source = "src-2"
        self.publish()
        self.task.synch_rc = 1
        self.assertEqual(gateway._ts_basis_version, old_version)
        self.assertTrue(gateway._ts_read_back_due(_St),
                        "the old source's failed attempt suppressed the new source's read-back")
