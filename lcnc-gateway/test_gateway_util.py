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


class TestTrtKins(unittest.TestCase):
    """Python twin of the TS kins mirror vs the compiled-C-oracle fixtures.

    kins_fixtures.gen.json is generated by scripts/gen_kins_fixtures.py
    from LinuxCNC v2.9.4 trtfuncs.c compiled via scripts/kins_oracle/ —
    the SAME case set that pins the TS mirror (kinsFixtures.test.ts), so
    the two mirrors cannot diverge without a red test somewhere.
    """

    TOL = 1e-9

    @classmethod
    def setUpClass(cls):
        import json
        path = os.path.join(os.path.dirname(__file__), "kins_fixtures.gen.json")
        with open(path) as f:
            cls.sets = json.load(f)["sets"]

    @staticmethod
    def _params(fixture_params):
        return {
            "x_rot_point": fixture_params["xRotPoint"],
            "y_rot_point": fixture_params["yRotPoint"],
            "z_rot_point": fixture_params["zRotPoint"],
            "x_offset": fixture_params["xOffset"],
            "y_offset": fixture_params["yOffset"],
            "z_offset": fixture_params["zOffset"],
            "tool_offset": fixture_params["toolOffset"],
        }

    def test_forward_matches_oracle(self):
        for s in self.sets:
            bc = s["kins"] == "xyzbc-trt"
            params = self._params(s["params"])
            for case in s["forward"]:
                got = gateway_util.trt_kins_forward(case["input"], params, bc=bc)
                for slot, (g, e) in enumerate(zip(got, case["expect"])):
                    self.assertLess(
                        abs(g - e), self.TOL,
                        f"{s['kins']}/{s['label']} joints={case['input']} slot {slot}: {g} vs {e}")

    def test_inverse_matches_oracle(self):
        for s in self.sets:
            bc = s["kins"] == "xyzbc-trt"
            params = self._params(s["params"])
            for case in s["inverse"]:
                got = gateway_util.trt_kins_inverse(case["input"], params, bc=bc)
                for jno, (g, e) in enumerate(zip(got, case["expect"])):
                    self.assertLess(
                        abs(g - e), self.TOL,
                        f"{s['kins']}/{s['label']} world={case['input']} joint {jno}: {g} vs {e}")

    def test_roundtrip(self):
        for s in self.sets:
            bc = s["kins"] == "xyzbc-trt"
            params = self._params(s["params"])
            for case in s["forward"]:
                world = gateway_util.trt_kins_forward(case["input"], params, bc=bc)
                joints = gateway_util.trt_kins_inverse(world, params, bc=bc)
                for g, e in zip(joints, case["input"]):
                    self.assertLess(abs(g - e), self.TOL)


class TestParseKinsConfig(unittest.TestCase):
    """INI -> viewer kins declaration (phase 1d single-source parse)."""

    # The real lcnc_suite_sim_5axis_tcp.ini wiring
    TCP_HALCMDS = [
        "net :kinstype-select motion.analog-out-02 => motion.switchkins-type",
        "setp xyzac-trt-kins.x-rot-point 0",
        "setp xyzac-trt-kins.y-rot-point 0",
        "setp xyzac-trt-kins.z-rot-point 0",
        "setp xyzac-trt-kins.y-offset 20",
        "setp xyzac-trt-kins.z-offset 10",
        "net vismach-tool-offset => xyzac-trt-kins.tool-offset",
    ]

    def test_tcp_sim_ini(self):
        got = gateway_util.parse_kins_config(
            "xyzac-trt-kins sparm=identityfirst", self.TCP_HALCMDS)
        self.assertEqual(got, {
            "module": "xyzac-trt-kins",
            "type": "xyzac-trt",
            "identity_first": True,
            "params": {"x_rot_point": 0.0, "y_rot_point": 0.0,
                       "z_rot_point": 0.0, "y_offset": 20.0, "z_offset": 10.0},
        })

    def test_tool_offset_never_parsed(self):
        # tool-offset is live TLO (netted from motion.tooloffset.z) — a
        # static copy would double-count against wcs.tool client-side.
        got = gateway_util.parse_kins_config(
            "xyzac-trt-kins", ["setp xyzac-trt-kins.tool-offset 35.5"])
        self.assertEqual(got["params"], {})

    def test_trivkins(self):
        got = gateway_util.parse_kins_config("trivkins coordinates=XYZAC", [])
        self.assertEqual(got["type"], "trivkins")
        self.assertFalse(got["identity_first"])
        self.assertEqual(got["params"], {})

    def test_xyzbc_no_sparm(self):
        got = gateway_util.parse_kins_config(
            "xyzbc-trt-kins", ["setp xyzbc-trt-kins.x-offset 15",
                               "setp xyzbc-trt-kins.z-offset -12"])
        self.assertEqual(got["type"], "xyzbc-trt")
        self.assertFalse(got["identity_first"])
        self.assertEqual(got["params"], {"x_offset": 15.0, "z_offset": -12.0})

    def test_unknown_module_ships_verbatim(self):
        got = gateway_util.parse_kins_config("genhexkins", [])
        self.assertEqual(got["type"], "genhexkins")  # client refuses loudly

    def test_foreign_setp_and_garbage_ignored(self):
        got = gateway_util.parse_kins_config("xyzac-trt-kins", [
            "setp compensation.method 1",
            "setp xyzac-trt-kins.y-offset not-a-number",
            "setp xyzac-trt-kins.bogus-pin 5",
        ])
        self.assertEqual(got["params"], {})

    def test_none_input(self):
        self.assertIsNone(gateway_util.parse_kins_config(None, []))
        self.assertIsNone(gateway_util.parse_kins_config("", []))


class TestSafetyChain(unittest.TestCase):
    """Review B1: safety-chain completeness banner + estop-loop writer check."""

    def test_grace_suppresses_everything(self):
        self.assertIsNone(gateway_util.evaluate_safety_chain(
            grace_expired=False, watchdog_connected=False,
            reader_fresh=True, trip_latched_present=False,
            extra_reason="x"))

    def test_healthy_chain_is_none(self):
        self.assertIsNone(gateway_util.evaluate_safety_chain(
            grace_expired=True, watchdog_connected=True,
            reader_fresh=True, trip_latched_present=True))

    def test_watchdog_down_reported(self):
        r = gateway_util.evaluate_safety_chain(
            grace_expired=True, watchdog_connected=False,
            reader_fresh=True, trip_latched_present=True)
        self.assertIn("webui-safety", r)

    def test_latch_absent_only_on_fresh_snapshot(self):
        # Fresh snapshot without trip_latched = latch missing.
        r = gateway_util.evaluate_safety_chain(
            grace_expired=True, watchdog_connected=True,
            reader_fresh=True, trip_latched_present=False)
        self.assertIn("webui-hb-latch", r)
        # Stale reader is its own banner — no latch claim without evidence.
        self.assertIsNone(gateway_util.evaluate_safety_chain(
            grace_expired=True, watchdog_connected=True,
            reader_fresh=False, trip_latched_present=False))

    def test_reasons_join_and_extra_appends(self):
        r = gateway_util.evaluate_safety_chain(
            grace_expired=True, watchdog_connected=False,
            reader_fresh=True, trip_latched_present=False,
            extra_reason="estop-loop unwritten")
        self.assertIn("webui-safety", r)
        self.assertIn("webui-hb-latch", r)
        self.assertTrue(r.endswith("estop-loop unwritten"))

    def test_unwritten_estop_signal(self):
        f = gateway_util.unwritten_estop_signal
        # Absent signal: the user rewired the chain — their names, no claim.
        self.assertIsNone(f([]))
        self.assertIsNone(f(None))
        self.assertIsNone(f([{"name": "my-estop", "pins": []}]))
        # Written signal (sim wiring): healthy.
        self.assertIsNone(f([{"name": "estop-loop", "pins": [
            {"arrow": "<==", "pin": "iocontrol.0.user-enable-out"},
            {"arrow": "==>", "pin": "and2.0.in0"}]}]))
        # Exists with readers only: the silent stuck-in-ESTOP trap.
        r = f([{"name": "estop-loop", "pins": [
            {"arrow": "==>", "pin": "and2.0.in0"}]}])
        self.assertIn("no writer", r)


class TestViewerConfigWarnings(unittest.TestCase):
    """Review D4/D5: banner-visible viewer-config smells."""

    def test_pivot_warning_only_for_paramless_twin(self):
        f = gateway_util.kins_pivot_warning
        self.assertIsNone(f(None))
        self.assertIsNone(f({"module": "trivkins", "type": "trivkins", "params": {}}))
        # Unknown module: no twin, the viewer math never runs it — no claim.
        self.assertIsNone(f({"module": "genhexkins", "type": "genhexkins", "params": {}}))
        # Twin with params: configured.
        self.assertIsNone(f({"module": "xyzac-trt-kins", "type": "xyzac-trt",
                             "params": {"y_offset": 20.0}}))
        # Twin without params: the silent pivot-zero trap (setp lines in a
        # .hal file instead of [HAL]HALCMD).
        r = f({"module": "xyzac-trt-kins", "type": "xyzac-trt", "params": {}})
        self.assertIn("HALCMD", r)

    def test_rotary_model_warning(self):
        f = gateway_util.rotary_model_warning
        rot = [{"group": "a", "joint": 3, "type": "rotate", "direction": "x", "sign": 1}]
        lin = [{"group": "x", "joint": 0, "direction": "x", "sign": 1}]
        self.assertIsNone(f(["X", "Y", "Z"], lin))            # no rotary axes
        self.assertIsNone(f(["X", "Y", "Z", "A", "C"], rot))  # model articulates
        self.assertIsNone(f([], None))
        # UVW are linear — never trigger the rotary claim.
        self.assertIsNone(f(["X", "Y", "Z", "U", "V", "W"], lin))
        # The silently-wrong-3D case: rotary config on the 3-axis default.
        r = f(["X", "Y", "Z", "A", "C"], lin)
        self.assertIn("A/C", r)


class TestKinsModeHelpers(unittest.TestCase):
    """Phase 2a: marker parsing + per-segment world-mode flags."""

    def test_marker_parse(self):
        f = gateway_util.parse_kinstype_marker
        self.assertEqual(f("WEBUI_KINSTYPE=1"), 1)
        self.assertEqual(f("  webui_kinstype = 0  "), 0)
        self.assertEqual(f("WEBUI_KINSTYPE=2"), 2)
        self.assertIsNone(f("WEBUI_KINSTYPE=x"))
        self.assertIsNone(f("some ordinary comment"))
        self.assertIsNone(f(""))
        self.assertIsNone(f(None))
        # marker must be the WHOLE comment, not embedded prose
        self.assertIsNone(f("note: WEBUI_KINSTYPE=1 is set elsewhere"))

    def test_world_flags_identity_first(self):
        # M429(k0) start, M428(k1) after seg 2, M429(k0) after seg 5.
        # A marker at seq N applies to segments seq > N.
        flags = gateway_util.kins_world_flags(
            [1, 2, 3, 4, 5, 6, 7], [(0, 0), (2, 1), (5, 0)], identity_first=True)
        self.assertEqual(flags, [0, 0, 1, 1, 1, 0, 0])

    def test_world_flags_plain_module_defaults_world(self):
        # Without sparm=identityfirst, startup kinstype 0 IS the world kins.
        flags = gateway_util.kins_world_flags([1, 2, 3], [(2, 1)], identity_first=False)
        self.assertEqual(flags, [1, 1, 0])

    def test_userk_type2_is_identity_in_both_mappings(self):
        self.assertEqual(
            gateway_util.kins_world_flags([1], [(0, 2)], identity_first=True), [0])
        self.assertEqual(
            gateway_util.kins_world_flags([1], [(0, 2)], identity_first=False), [0])

    def test_unordered_seqs(self):
        # feed and rapid lists are each execution-ordered but the helper
        # must not assume it — collision/scrub consumers merge later.
        flags = gateway_util.kins_world_flags([5, 1], [(2, 1)], identity_first=True)
        self.assertEqual(flags, [1, 0])

    def test_same_seq_marker_pair_last_wins(self):
        # Back-to-back toggles with no motion between them share a canon
        # seq; the LAST recorded marker governs. A plain sorted() on the
        # (seq, kinstype) tuples once reordered these by kinstype and
        # resolved M428;M429 preambles to world.
        f = gateway_util.kins_world_flags
        self.assertEqual(f([3], [(2, 1), (2, 0)], identity_first=True), [0])
        self.assertEqual(f([3], [(2, 0), (2, 1)], identity_first=True), [1])

    def test_marker_policy(self):
        f = gateway_util.kins_marker_policy
        # trivkins / no [KINS]: machine can't switch — markers are noise.
        self.assertEqual(f(None), "ignore")
        self.assertEqual(f({"type": "trivkins"}), "ignore")
        # Twin exists: full world checking.
        self.assertEqual(f({"type": "xyzac-trt"}), "twin")
        self.assertEqual(f({"type": "xyzbc-trt"}), "twin")
        # Declared switchable module without a twin: flags are real but
        # world segments must ship as an explicit unchecked count.
        self.assertEqual(f({"type": "genhexkins"}), "unchecked")

    def test_mode_boundary_indices(self):
        f = gateway_util.mode_boundary_indices
        self.assertEqual(f([]), set())
        self.assertEqual(f([0, 0, 0]), set())
        # BOTH flip vertices: i-1 ends the old-mode span, i starts the new
        # one — keeping only i lets RDP collapse a collinear old-mode span
        # into a segment labeled with the NEW mode.
        self.assertEqual(f([0, 0, 1, 1, 0]), {1, 2, 3, 4})
        self.assertEqual(f([0, 1]), {0, 1})


class TestWorldLimitCheck(unittest.TestCase):
    """Phase 2c: joint-side soft limits for world-mode (TCP) segments."""

    CFG = {"type": "xyzac-trt", "identity_first": True,
           "params": {"y_offset": 20.0, "z_offset": 10.0}}
    # canon tuples are (lineno, start9, end9, tlo3); canon units here = mm
    # (unit_scale 1) to keep the numbers readable.
    NINE = staticmethod(lambda x, y, z, a, c: (x, y, z, a, 0.0, c, 0.0, 0.0, 0.0))

    def test_midsegment_excursion_the_phase0_case(self):
        # THE live regression: C sweep 0->180 at fixed world (20,10,30).
        # Joint X traces cos(c)*20 - sin(c)*10: min = -sqrt(500) = -22.36
        # MID-segment while both endpoints (20 and -20) sit inside +/-21.
        seg = (23, self.NINE(20, 10, 30, 0, 0), self.NINE(20, 10, 30, 0, 180), None)
        limits = {"X": (-21.0, 21.0)}
        records, total = gateway_util.check_limit_violations_world(
            [seg], limits, self.CFG)
        self.assertEqual(total, 1)
        self.assertEqual(records[0]["axis"], "X")
        self.assertEqual(records[0]["kind"], "min")
        # Reported value is the worst SAMPLE (4-degree grid), which can
        # under-read the true extremum by <= (1-cos(step/2))*radius — here
        # 22.3537 vs the analytic 22.3607. Detection is the guarantee.
        self.assertAlmostEqual(records[0]["value"], -22.3607, delta=0.02)
        # Endpoint-only checking (the identity checker) misses it entirely:
        idn, idn_total = gateway_util.check_limit_violations([seg], limits, 1.0)
        self.assertEqual(idn_total, 0)

    def test_parked_joints_not_flagged(self):
        # Pure Z world move at A0 C0: joints X/Y parked outside a fake
        # limit must not re-flag; moving joint Z inside its limit is clean.
        seg = (5, self.NINE(100, 0, 10, 0, 0), self.NINE(100, 0, 50, 0, 0), None)
        records, total = gateway_util.check_limit_violations_world(
            [seg], {"X": (-50.0, 50.0), "Z": (-100.0, 100.0)}, self.CFG)
        self.assertEqual(total, 0)

    def test_unknown_kins_type_returns_unchecked(self):
        seg = (5, self.NINE(0, 0, 0, 0, 0), self.NINE(0, 0, 0, 0, 90), None)
        records, total = gateway_util.check_limit_violations_world(
            [seg], {"X": (-1.0, 1.0)}, {"type": "xyzbc-nutating", "params": {}})
        self.assertIsNone(records)
        self.assertEqual(total, 1)  # count of UNCHECKED segments

    def test_tlo_shifts_joint_z_exactly(self):
        # On xyzac the TOOL never tilts (the table does), so a G43 TLO's
        # only joint-space effect is joint Z = tip-Z-joint + TLO — the
        # check must apply the segment TLO to BOTH the world coords
        # (TLO-inclusive convention) and the kins' tool_offset pivot param;
        # get either half wrong and the shift is no longer exactly +TLO.
        # Sweep A 0..-90 at fixed tip: find the no-TLO joint-Z max, then a
        # limit midway into the +25 shift flags ONLY the TLO segment.
        def jz_max(tlo_z):
            p = {"y_offset": 20.0, "z_offset": 10.0}
            if tlo_z:
                p["tool_offset"] = tlo_z
            return max(gateway_util.trt_kins_inverse(
                [0, 0, 30 + tlo_z, -a, 0, 0], p)[2] for a in range(91))
        m0 = jz_max(0.0)
        self.assertAlmostEqual(jz_max(25.0), m0 + 25.0, places=9)
        lim = {"Z": (None, m0 + 12.5)}
        seg = (7, self.NINE(0, 0, 30, 0, 0), self.NINE(0, 0, 30, -90, 0), None)
        seg_tlo = (7, seg[1], seg[2], (0.0, 0.0, 25.0))
        _, t_no = gateway_util.check_limit_violations_world([seg], lim, self.CFG)
        recs, t_tlo = gateway_util.check_limit_violations_world([seg_tlo], lim, self.CFG)
        self.assertEqual(t_no, 0)
        self.assertEqual(t_tlo, 1)
        self.assertEqual(recs[0]["axis"], "Z")

    def test_merge_keeps_worst_per_pair(self):
        a = [{"line": 5, "axis": "X", "value": -22.0, "limit": -21.0, "kind": "min"}]
        b = [{"line": 5, "axis": "X", "value": -25.0, "limit": -21.0, "kind": "min"},
             {"line": 9, "axis": "C", "value": 361.0, "limit": 360.0, "kind": "max"}]
        records, total = gateway_util.merge_violation_records(a, b)
        self.assertEqual(total, 2)
        self.assertEqual(records[0]["value"], -25.0)
        self.assertEqual(records[1]["axis"], "C")
