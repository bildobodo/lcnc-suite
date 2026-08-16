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
    resolve_loaded_file,
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


class TestResolveLoadedFile(unittest.TestCase):
    """Loaded-program resolver: STAT.file flips to subroutine paths while the
    interpreter executes (M6 remap, o-word CALLs); active_file must keep
    meaning "loaded program" through those flips."""

    MAIN = "/nc/main.ngc"
    SUB = "/nc/subroutines/tool_touch_off.ngc"

    def test_idle_load_adopts(self):
        self.assertEqual(resolve_loaded_file(self.MAIN, True, None), (self.MAIN, None))

    def test_idle_unload_adopts_none(self):
        self.assertEqual(resolve_loaded_file(None, True, self.MAIN), (None, None))
        # Empty string normalizes to None (STAT.file reads "" for "no file")
        self.assertEqual(resolve_loaded_file("", True, self.MAIN), (None, None))

    def test_midrun_sub_flip_held_and_reported(self):
        # The bug: M6 remap opens tool_touch_off.ngc mid-run — hold the main
        # program and surface the ignored raw value for tracing.
        self.assertEqual(resolve_loaded_file(self.SUB, False, self.MAIN), (self.MAIN, self.SUB))

    def test_midrun_same_file_not_reported(self):
        self.assertEqual(resolve_loaded_file(self.MAIN, False, self.MAIN), (self.MAIN, None))

    def test_midrun_transient_empty_held(self):
        # A transiently empty STAT.file mid-run must not unload the program
        # (raw "" would otherwise clear the shared preview cache).
        loaded, flip = resolve_loaded_file("", False, self.MAIN)
        self.assertEqual(loaded, self.MAIN)
        self.assertIsNone(flip)  # "" normalizes to None; nothing adoptable to report

    def test_mdi_sub_with_no_program_held(self):
        # MDI `O<probe_x> CALL` with no program loaded: prev None is an honest
        # "no file" baseline — do not adopt the probe sub.
        self.assertEqual(resolve_loaded_file(self.SUB, False, None), (None, self.SUB))

    def test_first_sight_midrun_adopts_raw(self):
        # Gateway restarted under a running program: no baseline yet — adopt
        # raw so the UI shows something; corrects itself at the next idle tick.
        self.assertEqual(
            resolve_loaded_file(self.SUB, False, None, prev_seen=False), (self.SUB, None)
        )

    def test_run_lifecycle(self):
        # load → run → M6 flip → back to main → idle at program end.
        prev, seen = None, False
        for raw, idle, want in [
            (self.MAIN, True, self.MAIN),   # operator loads
            (self.MAIN, False, self.MAIN),  # running
            (self.SUB, False, self.MAIN),   # M6 remap flips STAT.file
            (self.MAIN, False, self.MAIN),  # sub returned
            (self.MAIN, True, self.MAIN),   # program done
            (None, True, None),             # unload
        ]:
            prev, _ = resolve_loaded_file(raw, idle, prev, seen)
            seen = True
            self.assertEqual(prev, want)


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


class TestReadAxisLimits(unittest.TestCase):
    """XYZAC mask (0b100111 | A bit) — C is joint 4 but letter index 5, the
    exact joint↔axis divergence the JOINT_<n> fallback must respect."""

    MASK_XYZAC = 0b101111  # X|Y|Z|A|C

    def _ini(self, table):
        return lambda section, var: table.get((section, var))

    def test_axis_section_preferred_over_joint(self):
        find = self._ini({
            ("AXIS_X", "MIN_LIMIT"): "-200", ("AXIS_X", "MAX_LIMIT"): "200",
            ("JOINT_0", "MIN_LIMIT"): "-999", ("JOINT_0", "MAX_LIMIT"): "999",
        })
        limits = gateway_util.read_axis_limits(find, 0b1)
        self.assertEqual(limits, {"X": (-200.0, 200.0)})

    def test_joint_fallback_uses_joint_order_not_letter_index(self):
        # Only JOINT sections present: C (letter idx 5) must read JOINT_4.
        find = self._ini({
            ("JOINT_3", "MIN_LIMIT"): "-100", ("JOINT_3", "MAX_LIMIT"): "50",
            ("JOINT_4", "MIN_LIMIT"): "-36000", ("JOINT_4", "MAX_LIMIT"): "36000",
        })
        limits = gateway_util.read_axis_limits(find, self.MASK_XYZAC)
        self.assertEqual(limits, {"A": (-100.0, 50.0), "C": (-36000.0, 36000.0)})

    def test_missing_bound_is_none_and_axis_without_bounds_omitted(self):
        find = self._ini({("AXIS_Z", "MAX_LIMIT"): "0"})
        limits = gateway_util.read_axis_limits(find, 0b111)
        self.assertEqual(limits, {"Z": (None, 0.0)})

    def test_unparseable_value_falls_through_to_joint(self):
        find = self._ini({
            ("AXIS_Y", "MIN_LIMIT"): "garbage",
            ("JOINT_1", "MIN_LIMIT"): "-100",
        })
        limits = gateway_util.read_axis_limits(find, 0b11)
        self.assertEqual(limits, {"Y": (-100.0, None)})


class TestCheckLimitViolations(unittest.TestCase):
    LIMITS = {"X": (-200.0, 200.0), "Z": (-120.0, 0.0), "A": (-100.0, 50.0)}
    TLO0 = (0.0, 0.0, 0.0)

    START0 = (0.0,) * 9

    def _seg(self, line, x=0.0, z=-1.0, a=0.0, tlo=None, start=None):
        # Canon tuples are inches; tests use unit_scale=25.4 (mm machine).
        return (line, start or self.START0,
                (x / 25.4, 0.0, z / 25.4, a, 0.0, 0.0, 0.0, 0.0, 0.0),
                tlo or self.TLO0)

    def test_clean_program_reports_nothing(self):
        recs, total = gateway_util.check_limit_violations(
            [self._seg(1, x=199.9), self._seg(2, z=-119.9, a=-99.9)],
            self.LIMITS, 25.4)
        self.assertEqual((recs, total), ([], 0))

    def test_no_limits_means_unchecked_not_clean(self):
        recs, total = gateway_util.check_limit_violations(
            [self._seg(1, x=9999.0)], {}, 25.4)
        self.assertEqual((recs, total), ([], 0))

    def test_linear_scaled_and_rotary_unscaled(self):
        recs, total = gateway_util.check_limit_violations(
            [self._seg(3, x=250.0), self._seg(7, a=-104.2)],
            self.LIMITS, 25.4)
        self.assertEqual(total, 2)
        self.assertEqual(recs[0], {"line": 3, "axis": "X", "value": 250.0,
                                   "limit": 200.0, "kind": "max"})
        self.assertEqual(recs[1], {"line": 7, "axis": "A", "value": -104.2,
                                   "limit": -100.0, "kind": "min"})

    def test_tool_offset_added_back_to_z(self):
        # Tip at Z −10 is fine; with 120 mm of G43 length the JOINT sits at
        # +110 — past Z max 0. The tip-only check would miss this.
        recs, _ = gateway_util.check_limit_violations(
            [self._seg(5, z=-10.0, tlo=(0.0, 0.0, 120.0 / 25.4))],
            self.LIMITS, 25.4)
        self.assertEqual(recs[0]["axis"], "Z")
        self.assertEqual(recs[0]["kind"], "max")
        self.assertAlmostEqual(recs[0]["value"], 110.0, places=3)

    def test_aggregates_worst_per_line_axis(self):
        # One source line, three tessellated segments — a single record with
        # the worst excursion.
        segs = [self._seg(9, x=210.0), self._seg(9, x=260.0), self._seg(9, x=220.0)]
        recs, total = gateway_util.check_limit_violations(segs, self.LIMITS, 25.4)
        self.assertEqual(total, 1)
        self.assertEqual(recs[0]["value"], 260.0)

    def test_exactly_at_limit_is_not_flagged(self):
        recs, total = gateway_util.check_limit_violations(
            [self._seg(1, x=200.0, z=-120.0, a=50.0)], self.LIMITS, 25.4)
        self.assertEqual((recs, total), ([], 0))

    def test_unbounded_side_never_fires(self):
        recs, total = gateway_util.check_limit_violations(
            [self._seg(1, x=-1e6)], {"X": (None, 200.0)}, 25.4)
        self.assertEqual((recs, total), ([], 0))

    def test_parked_axis_not_reflagged_on_later_lines(self):
        # Line 12 moves A to -104 (flagged); line 14 moves Z while A sits
        # parked at -104 — the culprit is line 12, line 14 stays quiet on A
        # but still flags its own Z overtravel.
        parked = (0.0, 0.0, 0.0, -104.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        segs = [
            self._seg(12, a=-104.0),
            self._seg(14, z=-125.0, a=-104.0, start=parked),
        ]
        recs, total = gateway_util.check_limit_violations(segs, self.LIMITS, 25.4)
        self.assertEqual(total, 2)
        self.assertEqual([(r["line"], r["axis"]) for r in recs],
                         [(12, "A"), (14, "Z")])

    def test_max_report_caps_records_but_not_total(self):
        segs = [self._seg(i, a=-101.0) for i in range(1, 12)]
        recs, total = gateway_util.check_limit_violations(
            segs, self.LIMITS, 25.4, max_report=5)
        self.assertEqual(len(recs), 5)
        self.assertEqual(total, 11)
        self.assertEqual([r["line"] for r in recs], [1, 2, 3, 4, 5])


try:
    from rs274.interpret import Translated as _RS274Translated
    _HAVE_RS274 = True
except ImportError:  # non-LinuxCNC host (future CI subset)
    _HAVE_RS274 = False


@unittest.skipUnless(_HAVE_RS274, "rs274 (LinuxCNC python) not importable")
class TestRs274EffectiveOffset(unittest.TestCase):
    """Differential oracle: pin rs274_effective_xy_offset to the REAL
    interpreter source. rs274.interpret.Translated.rotate_and_translate is
    the exact offset-application order the running interp uses (g92 BEFORE
    rotation, g5x after); these tests build a canon-shaped dummy, run the
    genuine method, and assert our single-offset model inverts it to the
    original program point. Any future divergence from LinuxCNC's order
    fails here instead of mis-posing the dry-run sim."""

    AXES = "xyzabcuvw"

    def _canon(self, g5x, g92, rotation_deg):
        class _C:
            pass
        c = _C()
        for i, ax in enumerate(self.AXES):
            setattr(c, f"g5x_offset_{ax}", g5x[i] if i < len(g5x) else 0.0)
            setattr(c, f"g92_offset_{ax}", g92[i] if i < len(g92) else 0.0)
        c.rotation_xy = rotation_deg
        c.rotation_cos = math.cos(math.radians(rotation_deg))
        c.rotation_sin = math.sin(math.radians(rotation_deg))
        return c

    def _roundtrip(self, g5x, g92, theta, program):
        """program → machine via the REAL rotate_and_translate, then back
        via our effective-offset inversion (the parse worker's math)."""
        c = self._canon(g5x, g92, theta)
        m = _RS274Translated.rotate_and_translate(c, *program)
        ox, oy = gateway_util.rs274_effective_xy_offset(
            g5x[0], g5x[1], g92[0], g92[1], theta)
        ca = math.cos(math.radians(theta))
        sa = math.sin(math.radians(theta))
        dx, dy = m[0] - ox, m[1] - oy
        px = dx * ca + dy * sa
        py = -dx * sa + dy * ca
        pz = m[2] - (g5x[2] + g92[2])
        pabc = [m[3 + i] - (g5x[3 + i] + g92[3 + i]) for i in range(3)]
        return (px, py, pz, *pabc)

    def _assert_close(self, got, want):
        for g, w in zip(got, want):
            self.assertAlmostEqual(g, w, places=9)

    def test_rotation_with_g92_matches_interp(self):
        # The case the old combined g5x+g92 model got WRONG: both active.
        g5x = [100.0, -50.0, 25.0, 10.0, 0.0, -30.0]
        g92 = [7.5, -3.25, 1.5, 2.0, 0.0, 5.0]
        program = (12.5, -8.0, 3.0, 15.0, 0.0, 90.0, 0.0, 0.0, 0.0)
        self._assert_close(
            self._roundtrip(g5x, g92, 33.0, program), program[:6])

    def test_zero_rotation_reduces_to_plain_sum(self):
        g5x = [10.0, 20.0, 30.0, 0.0, 0.0, 0.0]
        g92 = [1.0, 2.0, 3.0, 0.0, 0.0, 0.0]
        ox, oy = gateway_util.rs274_effective_xy_offset(10.0, 20.0, 1.0, 2.0, 0.0)
        self.assertAlmostEqual(ox, 11.0)
        self.assertAlmostEqual(oy, 22.0)
        program = (5.0, 6.0, 7.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        self._assert_close(self._roundtrip(g5x, g92, 0.0, program), program[:6])

    def test_naive_sum_actually_deviates(self):
        # Guard the guard: prove the OLD model disagrees with the interp on
        # this input, so a regression to g5x+g92 cannot silently pass.
        g5x = [100.0, -50.0, 0.0, 0.0, 0.0, 0.0]
        g92 = [10.0, 0.0, 0.0, 0.0, 0.0, 0.0]
        theta = 30.0
        c = self._canon(g5x, g92, theta)
        m = _RS274Translated.rotate_and_translate(
            c, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        naive_ox = g5x[0] + g92[0]
        self.assertGreater(abs(m[0] - naive_ox), 1.0)  # ~1.34 for 10mm @ 30°
        ox, _oy = gateway_util.rs274_effective_xy_offset(
            g5x[0], g5x[1], g92[0], g92[1], theta)
        self.assertAlmostEqual(m[0], ox, places=9)

    def test_randomized_sweep(self):
        import random
        rng = random.Random(0xC0FFEE)  # fixed seed — deterministic
        for _ in range(200):
            g5x = [rng.uniform(-500, 500) for _ in range(6)]
            g92 = [rng.uniform(-50, 50) for _ in range(6)]
            theta = rng.uniform(-180, 180)
            program = tuple(rng.uniform(-300, 300) for _ in range(6)) + (0.0, 0.0, 0.0)
            self._assert_close(
                self._roundtrip(g5x, g92, theta, program), program[:6])


class TestCanonicalToJointOrder(unittest.TestCase):
    """canonical_to_joint_order — the joint↔canonical re-indexing that the
    work_pos computation mixes up without it. Masks: bit0=X … bit8=W."""

    XYZBC = 0b0110111 & ~0b1000  # X Y Z B C = bits 0,1,2,4,5
    XYZAC = 0b0101111            # X Y Z A C = bits 0,1,2,3,5

    def test_xyzbc_rotary_slots(self):
        # Canonical g5x with B (slot 4) and C (slot 5) offsets → joint
        # slots 3 and 4. This exact case was the "Zero B does nothing" bug:
        # index-wise subtraction took B's offset from C's angle.
        g5x = [0.0, 0.0, -204.48, 0.0, -18.295, -26.755, 0.0, 0.0, 0.0]
        self.assertEqual(
            gateway_util.canonical_to_joint_order(g5x, self.XYZBC),
            [0.0, 0.0, -204.48, -18.295, -26.755])

    def test_xyzac_c_slot(self):
        g5x = [1.0, 2.0, 3.0, 4.0, 0.0, 6.0, 0.0, 0.0, 0.0]
        self.assertEqual(
            gateway_util.canonical_to_joint_order(g5x, self.XYZAC),
            [1.0, 2.0, 3.0, 4.0, 6.0])

    def test_lathe_xz(self):
        vals = [10.0, 99.0, 30.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
        self.assertEqual(
            gateway_util.canonical_to_joint_order(vals, 0b101), [10.0, 30.0])

    def test_xyz_identity_prefix(self):
        vals = [1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
        self.assertEqual(
            gateway_util.canonical_to_joint_order(vals, 0b111), [1.0, 2.0, 3.0])

    def test_short_input_pads_zero(self):
        self.assertEqual(
            gateway_util.canonical_to_joint_order([1.0, 2.0], self.XYZBC),
            [1.0, 2.0, 0.0, 0.0, 0.0])

    def test_none_passthrough(self):
        self.assertIsNone(gateway_util.canonical_to_joint_order(None, 0b111))

    def test_work_pos_regression_xyzbc(self):
        # Full work_pos math for the observed live-session state: joints
        # [0,0,0,-18.295,-26.755], canonical g5x zeroing Z/B/C. Work B and C
        # must both read 0 after Zero B / Zero C.
        joints = [0.0, 0.0, 0.0, -18.295, -26.755]
        g5x = [0.0, 0.0, -204.48, 0.0, -18.295, -26.755, 0.0, 0.0, 0.0]
        g5x_j = gateway_util.canonical_to_joint_order(g5x, self.XYZBC)
        work = [j - o for j, o in zip(joints, g5x_j)]
        self.assertEqual(work, [0.0, 0.0, 204.48, 0.0, 0.0])
