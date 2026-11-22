"""R435 independent checks; fake controller/worker only."""
import asyncio
import os
from unittest.mock import patch
import test_bulk_pipeline as bp
import test_toolsetter_basis as ts


class TestPublicationBoundary(bp._NiceBase):
    def test_failed_first_load_does_not_make_a_refresh(self):
        real = self.b._run_gcode_worker_blocking
        self.b._run_gcode_worker_blocking = lambda *a: (1, b'', b'failed')
        self.parse_attempt = asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason='file'))
        self.assertFalse(self.b.preview_available())
        self.b._run_gcode_worker_blocking = real
        ctx, _ = self.parse('tool_offset')
        self.assertNotIn('nice', ctx)

    def test_missing_payload_blocks_nice_even_when_identity_matches(self):
        self.parse('file')
        self.b.preview_bytes = self.b.preview_bytes_gz = None
        ctx, _ = self.parse('toolsetter')
        self.assertNotIn('nice', ctx)

    def test_gzip_only_publication_still_counts(self):
        self.parse('file')
        self.b.preview_bytes_gz = b'serving gzip'
        self.b.preview_bytes = None
        ctx, _ = self.parse('wcsoff:G54:z')
        self.assertEqual(ctx.get('nice'), 19)

    def test_unknown_mtime_keeps_normal_priority(self):
        self.parse('file')
        with patch('bulk_pipeline.os.path.getmtime', side_effect=OSError('no stat')):
            ctx, _ = self.parse('toolsetter')
        self.assertNotIn('nice', ctx)

    def test_changed_mtime_keeps_normal_budget_and_updates_history(self):
        self.parse('file')
        st = os.stat(self.ngc)
        os.utime(self.ngc, (st.st_atime, st.st_mtime + 5))
        self.b.parse_ms_by_file[self.ngc] = 30000
        ctx, timeout = self.parse('tool_offset')
        self.assertNotIn('nice', ctx)
        self.assertEqual(timeout, 90.0)
        self.assertLess(self.b.parse_ms_by_file[self.ngc], 30000)


class TestAutoPoll(ts._HoldBase):
    payload = ts.TestAutoOnFromTheRealPayload.payload

    def test_poll_does_not_consume_auto_attempt_then_retries_same_key_in_mdi(self):
        self.probe_op()
        key = ts.gateway._ts_attempt_key()
        st = self.payload(ts.gateway.linuxcnc.MODE_AUTO)
        for state in (ts.gateway.linuxcnc.RCS_DONE, ts.gateway.linuxcnc.RCS_EXEC, ts.gateway.linuxcnc.RCS_ERROR):
            st.state = state
            self.assertEqual(self.poll(st), 'toolsetter')
            self.assertIsNone(ts.gateway._ts_readback_tried)
            self.assertNotIn(key, ts.gateway._ts_readback_outcomes)
        mdi = self.payload(ts.gateway.linuxcnc.MODE_MDI)
        self.assertIsNone(self.poll(mdi))
        self.assertEqual(ts.gateway._ts_readback_outcomes.get(key), 'confirmed')
        self.assertIsNone(ts.gateway._ts_drift_reason())
