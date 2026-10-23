"""The parse call's own bounds (Codex R185 VP185-01): the worker stamps its
monotonic clock right around parse(ctx) — the start before the call (already
written when it runs), the end after it returned, none when it failed — and
the pipeline reads them back (bulk_pipeline.parse_span_of)."""
import io
import time
import unittest

from bulk_pipeline import parse_span_of

try:
    import gcode_parse_worker as worker
except ImportError as e:   # no native interpreter module
    worker = None
    _why = str(e)


@unittest.skipIf(worker is None, "no native LinuxCNC modules")
class TestStampedParse(unittest.TestCase):
    def setUp(self):
        self.real = worker.parse

    def tearDown(self):
        worker.parse = self.real

    def test_the_bounds_hold_the_whole_call(self):
        buf, seen = io.StringIO(), {}

        def fake(ctx):
            seen["t0_written"] = "__PARSE_T0__" in buf.getvalue()
            seen["start"] = time.monotonic_ns()
            time.sleep(0.02)
            seen["end"] = time.monotonic_ns()
            return {"ctx": ctx}
        worker.parse = fake
        self.assertEqual(worker.stamped_parse({"k": 1}, buf), {"ctx": {"k": 1}})
        span = parse_span_of(buf.getvalue().encode())
        self.assertTrue(seen["t0_written"], "the start is out before the call runs")
        self.assertLessEqual(span["p0_ns"], seen["start"])
        self.assertLessEqual(seen["end"], span["p1_ns"])

    def test_a_failed_parse_has_a_start_and_no_end(self):
        buf = io.StringIO()

        def fails(ctx):
            raise RuntimeError("interp error")
        worker.parse = fails
        with self.assertRaises(RuntimeError):
            worker.stamped_parse({}, buf)
        span = parse_span_of(buf.getvalue().encode())
        self.assertIsNotNone(span["p0_ns"])
        self.assertIsNone(span["p1_ns"])


if __name__ == "__main__":
    unittest.main()
