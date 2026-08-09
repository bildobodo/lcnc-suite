"""Unit tests for gateway_util — the pure, linuxcnc-free helpers.

Written as unittest.TestCase so they run with zero extra install via
``python3 -m unittest test_gateway_util`` and are also discovered by pytest
(``pytest test_gateway_util.py``).
"""

import math
import os
import tempfile
import unittest

import gateway_util
from gateway_util import (
    sanitize_filename,
    validate_extension,
    validate_path_within,
    origin_allowed,
    token_ok,
    finite_float,
    finite_int,
    evaluate_trip_latch,
)


class TestPathContainment(unittest.TestCase):
    """Uses a real temp tree + real symlinks so realpath behaviour (issue #20)
    is exercised deterministically rather than depending on the host FS."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.root = os.path.join(self.tmp, "ncfiles")
        self.outside = os.path.join(self.tmp, "secret")
        os.makedirs(os.path.join(self.root, "sub"))
        os.makedirs(self.outside)
        with open(os.path.join(self.outside, "passwd"), "w") as f:
            f.write("x")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_within(self):
        self.assertTrue(validate_path_within(os.path.join(self.root, "sub", "f.ngc"), self.root))

    def test_equal_root(self):
        self.assertTrue(validate_path_within(self.root, self.root))

    def test_outside(self):
        self.assertFalse(validate_path_within(os.path.join(self.outside, "passwd"), self.root))

    def test_dotdot_traversal_normalized_out(self):
        self.assertFalse(validate_path_within(os.path.join(self.root, "..", "secret"), self.root))

    def test_sibling_prefix_not_confused(self):
        # ncfiles2 must NOT count as inside ncfiles (the +os.sep guard).
        sibling = self.root + "2"
        os.makedirs(sibling)
        self.assertFalse(validate_path_within(os.path.join(sibling, "f.ngc"), self.root))

    def test_symlink_inside_root_escaping_is_rejected(self):
        # The #20 fix: a symlink inside the root pointing OUTSIDE resolves out.
        link = os.path.join(self.root, "escape")
        os.symlink(self.outside, link)
        self.assertFalse(validate_path_within(os.path.join(link, "passwd"), self.root))

    def test_symlinked_root_still_allowed(self):
        # A symlinked NC-files root must keep working: resolving the root too
        # means a real file under it still validates.
        linked_root = os.path.join(self.tmp, "ncfiles_link")
        os.symlink(self.root, linked_root)
        self.assertTrue(validate_path_within(os.path.join(linked_root, "sub", "f.ngc"), linked_root))


class TestFilename(unittest.TestCase):
    def test_strips_directory(self):
        self.assertEqual(sanitize_filename("../../etc/passwd"), "passwd")

    def test_strips_leading_dots(self):
        self.assertEqual(sanitize_filename(".hidden"), "hidden")

    def test_empty_becomes_default(self):
        self.assertEqual(sanitize_filename(""), "uploaded.ngc")

    def test_strips_nul(self):
        self.assertEqual(sanitize_filename("with\x00null.ngc"), "withnull.ngc")

    def test_extension_allowed(self):
        self.assertTrue(validate_extension("part.ngc"))
        self.assertTrue(validate_extension("PART.NGC"))

    def test_extension_rejected(self):
        self.assertFalse(validate_extension("evil.exe"))


class TestToken(unittest.TestCase):
    def test_no_config_disables_auth(self):
        self.assertTrue(token_ok(None, ""))
        self.assertTrue(token_ok("whatever", ""))

    def test_match(self):
        self.assertTrue(token_ok("s3cret", "s3cret"))

    def test_mismatch(self):
        self.assertFalse(token_ok("wrong", "s3cret"))

    def test_missing_when_required(self):
        self.assertFalse(token_ok(None, "s3cret"))
        self.assertFalse(token_ok("", "s3cret"))


class TestOrigin(unittest.TestCase):
    def test_same_host_allowed(self):
        self.assertTrue(origin_allowed("http://machine:8000", "machine:8000"))

    def test_same_host_case_insensitive(self):
        self.assertTrue(origin_allowed("http://Machine:8000", "machine:8000"))

    def test_cross_origin_rejected(self):
        self.assertFalse(origin_allowed("http://evil.com", "machine:8000"))

    def test_missing_origin_allowed(self):
        # Non-browser client (browsers always send Origin); token gates these.
        self.assertTrue(origin_allowed(None, "machine:8000"))

    def test_explicit_allowlist_adds(self):
        self.assertTrue(origin_allowed("http://other:9000", "machine:8000", {"http://other:9000"}))

    def test_explicit_allowlist_does_not_break_same_host(self):
        self.assertTrue(origin_allowed("http://machine:8000", "machine:8000", {"http://other:9000"}))

    def test_dev_extra_origin(self):
        self.assertTrue(origin_allowed("http://localhost:5173", "127.0.0.1:8000", set(), {"http://localhost:5173"}))


class TestFiniteFloat(unittest.TestCase):
    def test_parses_number(self):
        self.assertEqual(finite_float("1.5"), 1.5)

    def test_uses_default_for_none(self):
        self.assertEqual(finite_float(None, 2.0), 2.0)

    def test_rejects_overflow_literal(self):
        with self.assertRaises(ValueError):
            finite_float("1e999")  # parses to inf

    def test_rejects_nan(self):
        with self.assertRaises(ValueError):
            finite_float(math.nan)

    def test_rejects_inf_string(self):
        with self.assertRaises(ValueError):
            finite_float("inf")

    def test_rejects_garbage(self):
        with self.assertRaises((ValueError, TypeError)):
            finite_float("abc")

    def test_range_below_lo_rejected(self):
        with self.assertRaises(ValueError):
            finite_float(-0.1, lo=0)

    def test_range_above_hi_rejected(self):
        with self.assertRaises(ValueError):
            finite_float(2.5, hi=2.0)

    def test_within_range_ok(self):
        self.assertEqual(finite_float(1.5, lo=0, hi=2), 1.5)


class TestFiniteInt(unittest.TestCase):
    def test_parses_int_str_float(self):
        self.assertEqual(finite_int(5), 5)
        self.assertEqual(finite_int("5"), 5)
        self.assertEqual(finite_int(5.0), 5)

    def test_truncates_toward_zero(self):
        self.assertEqual(finite_int(2.9), 2)
        self.assertEqual(finite_int(-2.9), -2)

    def test_missing_without_default_rejected(self):
        # None with no explicit default is a missing required field, NOT 0 —
        # so an absent axis/joint can't silently become index 0.
        with self.assertRaises(ValueError):
            finite_int(None)

    def test_missing_uses_explicit_default(self):
        self.assertEqual(finite_int(None, -1), -1)

    def test_rejects_inf_via_json_overflow(self):
        # json.loads("1e999") -> inf; int(inf) would raise OverflowError, which
        # the dispatch boundary does not catch. finite_int turns it into a
        # ValueError the boundary DOES catch.
        with self.assertRaises(ValueError):
            finite_int(float("inf"))

    def test_rejects_nan(self):
        with self.assertRaises(ValueError):
            finite_int(math.nan)

    def test_rejects_garbage(self):
        with self.assertRaises((ValueError, TypeError)):
            finite_int("abc")

    def test_lo_rejects_negative(self):
        with self.assertRaises(ValueError):
            finite_int(-1, lo=0)

    def test_hi_rejects_above(self):
        with self.assertRaises(ValueError):
            finite_int(9, hi=8)

    def test_within_range_ok(self):
        self.assertEqual(finite_int(0, lo=0), 0)
        self.assertEqual(finite_int(8, lo=0, hi=8), 8)


class TestAtomicWriteFsync(unittest.TestCase):
    """atomic_write_bytes durable-publish path (B1)."""

    def setUp(self):
        from gateway_util import atomic_write_bytes
        self.atomic_write_bytes = atomic_write_bytes
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_fsync_writes_correct_content(self):
        p = os.path.join(self.tmp, "out.txt")
        self.atomic_write_bytes(p, b"hello-durable", fsync=True)
        with open(p, "rb") as f:
            self.assertEqual(f.read(), b"hello-durable")

    def test_no_tmp_leftover(self):
        p = os.path.join(self.tmp, "out.txt")
        self.atomic_write_bytes(p, b"x", fsync=True)
        self.assertEqual([n for n in os.listdir(self.tmp) if n.endswith(".tmp")], [])


class TestEvaluateTripLatch(unittest.TestCase):
    """The HAL-latch banner state machine (issue #34). The gateway reads the
    servo-thread estop_latch level (webui-hb-latch.fault-out); this pure helper
    decides when that level becomes an operator banner."""

    def _run(self, levels, last=None, baseline=False):
        """Feed a sequence of fault-out levels; return list of per-step results
        with carried state, mimicking the poller loop."""
        steps = []
        for lvl in levels:
            r = evaluate_trip_latch(lvl, last, baseline)
            last, baseline = r["last_latched"], r["baseline_seen"]
            steps.append(r)
        return steps

    def test_no_reader_snapshot_makes_no_decision(self):
        r = evaluate_trip_latch(None, None, False)
        self.assertFalse(r["tripped"])
        self.assertFalse(r["faulted_on_connect"])
        self.assertIsNone(r["last_latched"])
        self.assertFalse(r["baseline_seen"])

    def test_boot_faulted_does_not_banner(self):
        # Latch boots faulted (LinuxCNC starts in ESTOP): first-sight TRUE is
        # ambiguous → audit, never banner.
        r = evaluate_trip_latch(True, None, False)
        self.assertFalse(r["tripped"])
        self.assertTrue(r["faulted_on_connect"])
        self.assertTrue(r["last_latched"])

    def test_clean_baseline_then_trip_banners(self):
        # FALSE (operator cleared estop → baseline) → TRUE (a real trip).
        steps = self._run([False, True])
        self.assertTrue(steps[0]["baseline_seen"])
        self.assertFalse(steps[0]["tripped"])
        self.assertTrue(steps[1]["tripped"])

    def test_sustained_latch_banners_only_once(self):
        steps = self._run([False, True, True, True])
        self.assertEqual([s["tripped"] for s in steps], [False, True, False, False])

    def test_frozen_poller_sees_sticky_true_after_baseline(self):
        # Baseline seen, then the poller misses the FALSE→TRUE moment and only
        # resumes to find the sticky level already TRUE — still a trip.
        steps = self._run([False, True])  # last observed False, baseline True
        self.assertTrue(steps[-1]["tripped"])

    def test_ack_then_reset_then_retrip(self):
        # baseline → trip (banner) → still latched (no re-banner, models the
        # post-ack ticks) → reset clears (FALSE) → trips again on next TRUE.
        steps = self._run([False, True, True, False, True])
        self.assertEqual([s["tripped"] for s in steps], [False, True, False, False, True])

    def test_faulted_on_connect_then_clear_then_trip(self):
        # Connect while latched (no banner) → operator resets (FALSE baseline)
        # → genuine later trip banners.
        steps = self._run([True, False, True])
        self.assertTrue(steps[0]["faulted_on_connect"])
        self.assertFalse(steps[0]["tripped"])
        self.assertTrue(steps[2]["tripped"])


if __name__ == "__main__":
    unittest.main()


class TestParseTelemetryBatch(unittest.TestCase):
    """M1: bounded, pure NDJSON telemetry ingestion."""

    def test_valid_batch(self):
        raw = b'{"kind":"ws.open","dt_ms":12}\n{"tag":"tab.visibility","hidden":true}\n'
        events, rejected = gateway_util.parse_telemetry_batch(raw)
        self.assertEqual(rejected, 0)
        self.assertEqual(events[0], ("ws.open", {"dt_ms": 12}))
        self.assertEqual(events[1], ("tab.visibility", {"hidden": True}))

    def test_bad_lines_counted_not_fatal(self):
        raw = b'not json\n{"kind":"ok"}\n[1,2,3]\n\n'
        events, rejected = gateway_util.parse_telemetry_batch(raw)
        self.assertEqual(len(events), 1)
        self.assertEqual(rejected, 2)  # bad json + non-dict; blank line ignored

    def test_kind_falls_back_to_event(self):
        events, _ = gateway_util.parse_telemetry_batch(b'{"x":1}\n')
        self.assertEqual(events[0][0], "event")

    def test_event_cap_enforced(self):
        raw = b"\n".join(b'{"kind":"k"}' for _ in range(20))
        events, rejected = gateway_util.parse_telemetry_batch(raw, max_events=5)
        self.assertEqual(len(events), 5)
        self.assertEqual(rejected, 15)

    def test_empty(self):
        self.assertEqual(gateway_util.parse_telemetry_batch(b""), ([], 0))


class TestScanToolStats(unittest.TestCase):
    """Textual M6/M600/M601 scan for program stats — mirrors the word-matcher
    semantics of the frontend scanToolchangesBefore (gcodeRfl.test.ts)."""

    def scan(self, text):
        return gateway_util.scan_tool_stats(text)

    def test_plain_m6_with_t(self):
        self.assertEqual(self.scan("G21\nT5 M6\nG0 X0\n"), (1, {5}))

    def test_m600_remap_counts(self):
        self.assertEqual(self.scan("T13 M600\nG0 X0\n"), (1, {13}))

    def test_m601_counts(self):
        self.assertEqual(self.scan("T2 M601\n"), (1, {2}))

    def test_t_before_change_on_earlier_line(self):
        # T is a modal prepare — a later bare M6 changes to it.
        self.assertEqual(self.scan("T7\nG0 X0\nM6\n"), (1, {7}))

    def test_modal_t_reused_for_second_change(self):
        self.assertEqual(self.scan("T5 M600\nG1 X1\nM600\n"), (2, {5}))

    def test_multiple_tools(self):
        text = "T1 M6\nG1 X1\nT2 M600\nG1 X2\nT1 M6\n"
        self.assertEqual(self.scan(text), (3, {1, 2}))

    def test_ignores_comments(self):
        text = "; T5 M6 in comment\n(T3 M600 inline)\nG0 X0 ; M6\n"
        self.assertEqual(self.scan(text), (0, set()))

    def test_no_false_match_m60_m66_m61(self):
        # M60 (pallet change), M66 (wait input), M61 (set tool number),
        # M602 (unknown) must not count.
        self.assertEqual(self.scan("M60\nM66 P0\nM61 Q3\nM602\n"), (0, set()))

    def test_leading_zeros(self):
        self.assertEqual(self.scan("T05 M06\n"), (1, {5}))

    def test_t0_unload_counts_change_not_tool(self):
        self.assertEqual(self.scan("T0 M6\n"), (1, set()))

    def test_unevaluable_t_expression_counts_change_only(self):
        self.assertEqual(self.scan("T#100 M6\n"), (1, set()))

    def test_case_insensitive(self):
        self.assertEqual(self.scan("t3 m600\n"), (1, {3}))

    def test_word_boundaries(self):
        # Preceding word characters must not produce matches.
        self.assertEqual(self.scan("G0 XM6\nO100 CALL [6]\n"), (0, set()))

    def test_crlf_lines(self):
        self.assertEqual(self.scan("T4 M6\r\nG0 X0\r\n"), (1, {4}))

    def test_empty(self):
        self.assertEqual(self.scan(""), (0, set()))
