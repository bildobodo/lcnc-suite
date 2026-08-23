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

    def test_unknown_start_endpoint_counts_as_moved_to(self):
        # W3 P1: a suppressed first-move endpoint arrives with start=None
        # (unknown path). A zero-length tuple would read "parked" under the
        # attribution rule and an out-of-limits endpoint would silently
        # pass; start=None must flag every out-of-bounds endpoint axis.
        end = (250.0 / 25.4, 0.0, -1.0 / 25.4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        recs, total = gateway_util.check_limit_violations(
            [(4, None, end, self.TLO0)], self.LIMITS, 25.4)
        self.assertEqual(total, 1)
        self.assertEqual((recs[0]["line"], recs[0]["axis"], recs[0]["kind"]),
                         (4, "X", "max"))
        # The zero-length form (start == end) is what the parked rule
        # skips — pinning the contrast so the None convention stays load-
        # bearing rather than redundant.
        recs2, total2 = gateway_util.check_limit_violations(
            [(4, end, end, self.TLO0)], self.LIMITS, 25.4)
        self.assertEqual((recs2, total2), ([], 0))

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


class TestTrsrnKins(unittest.TestCase):
    """xyzacb_trsrn twin vs the compiled-C-oracle fixtures (TWP phase 3).

    Same contract as TestTrtKins: the trsrn_sets in kins_fixtures.gen.json
    are generated from the vendored upstream comp (master @493926b56c)
    compiled via scripts/kins_oracle/, and the SAME sets pin the TS mirror
    (kinsFixtures.test.ts TrsrnKins) — divergence is a red test somewhere.
    The 'spike-live-*' sets carry the exact geometry + plane values that
    were live-validated against the 2.9.4 spike captures.
    """

    TOL = 1e-9

    # fixture camelCase -> kins pin snake_case (the twins' param keys)
    _KEYMAP = {
        "yPivot": "y_pivot", "zPivot": "z_pivot",
        "xOffset": "x_offset", "yOffset": "y_offset",
        "yRotAxis": "y_rot_axis", "zRotAxis": "z_rot_axis",
        "nutAngle": "nut_angle", "toolOffset": "tool_offset_z",
        "preRot": "pre_rot", "primaryAngle": "primary_angle",
        "secondaryAngle": "secondary_angle",
    }

    @classmethod
    def setUpClass(cls):
        import json
        path = os.path.join(os.path.dirname(__file__), "kins_fixtures.gen.json")
        with open(path) as f:
            cls.sets = json.load(f)["trsrn_sets"]

    @classmethod
    def _params(cls, fixture_params):
        return {cls._KEYMAP[k]: v for k, v in fixture_params.items()}

    def test_forward_matches_oracle(self):
        for s in self.sets:
            params = self._params(s["params"])
            for case in s["forward"]:
                got = gateway_util.trsrn_kins_forward(case["input"], params, s["mode"])
                for slot, (g, e) in enumerate(zip(got, case["expect"])):
                    self.assertLess(
                        abs(g - e), self.TOL,
                        f"{s['label']}/m{s['mode']} joints={case['input']} slot {slot}: {g} vs {e}")

    def test_inverse_matches_oracle(self):
        for s in self.sets:
            params = self._params(s["params"])
            for case in s["inverse"]:
                got = gateway_util.trsrn_kins_inverse(case["input"], params, s["mode"])
                for jno, (g, e) in enumerate(zip(got, case["expect"])):
                    self.assertLess(
                        abs(g - e), self.TOL,
                        f"{s['label']}/m{s['mode']} world={case['input']} joint {jno}: {g} vs {e}")

    def test_roundtrip(self):
        for s in self.sets:
            params = self._params(s["params"])
            for case in s["forward"]:
                world = gateway_util.trsrn_kins_forward(case["input"], params, s["mode"])
                joints = gateway_util.trsrn_kins_inverse(world, params, s["mode"])
                for g, e in zip(joints, case["input"]):
                    self.assertLess(abs(g - e), self.TOL)


class TestTrsrnCapturePins(unittest.TestCase):
    """Live-capture golden pins for the trsrn twin's COORDINATE CONVENTIONS
    (TWP phase 3 close-out, 2026-08-20 task run of simple_example.ngc /
    capture-g536 on the fork): world side is TLO-INCLUSIVE stat.position;
    mode 1 folds TLO into the pivot via tool_offset_z; mode 2 ignores TLO
    entirely (motion applies it upstream of the kins in plane mode).
    The oracle fixtures pin the math — these pin the PLUMBING conventions
    the limit check and the client transform rely on.
    """

    GEO = {"nut_angle": 55.0, "y_pivot": 50.0, "z_pivot": 120.0,
           "x_offset": 0.0, "y_offset": 0.0,
           "y_rot_axis": -1000.0, "z_rot_axis": -2000.0}
    FRAME = {"pre_rot": -1.781762, "primary_angle": 130.2455,
             "secondary_angle": -40.8555}

    def test_mode2_end_state_and_tlo_ignored(self):
        geo = dict(self.GEO, **self.FRAME)
        joints = [1390.773, -379.602, -1279.861, 0.0, -40.855, 130.245]
        pos = [1609.597, -854.904, -571.098, 0.0, -40.855, 130.245]
        w = gateway_util.trsrn_kins_forward(joints, geo, 2)
        for i in range(3):
            self.assertAlmostEqual(w[i], pos[i], places=2)
        inv = gateway_util.trsrn_kins_inverse(pos, geo, 2)
        for i in range(3):
            self.assertAlmostEqual(inv[i], joints[i], places=2)
        # TLO param must be a no-op in mode 2 (capture: G43 h3=100 active,
        # forward(joints) matched stat.position with no TLO term).
        w_tlo = gateway_util.trsrn_kins_forward(
            joints, dict(geo, tool_offset_z=100.0), 2)
        for i in range(3):
            self.assertAlmostEqual(w_tlo[i], w[i], places=9)

    def test_mode1_tcp_window_needs_tlo_in_pivot(self):
        # G53.6 orient: world pinned (1300,-200,-1200) TLO-inclusive while
        # joints migrated to ~(1309.7,-371.6,-1230.2) (capture, 1 decimal).
        geo = dict(self.GEO, tool_offset_z=100.0)
        j = [1309.7, -371.6, -1230.2, 0.0, -40.855, 130.245]
        w = gateway_util.trsrn_kins_forward(j, geo, 1)
        self.assertAlmostEqual(w[0], 1300.0, delta=0.1)
        self.assertAlmostEqual(w[1], -200.0, delta=0.1)
        self.assertAlmostEqual(w[2], -1200.0, delta=0.1)
        # Without the TLO fold the same joints land tens of mm away.
        w0 = gateway_util.trsrn_kins_forward(j, dict(self.GEO), 1)
        self.assertGreater(abs(w0[1] + 200.0), 10.0)


class TestInsertKinsRelabels(unittest.TestCase):
    """W8 phantom-jump fix: a switchkins flip relabels the frame at a
    stationary pose, but the offline canon's post-flip segment starts at the
    PRE-flip position (no motion controller to resync against), bundling
    relabel + real entry move. insert_flip_relabels must insert the
    relabeled start vertex (joint-invariant across the flip), patch the next
    segment's start, and re-key every seq (doubled; inserts odd)."""

    GEO = TestTrsrnCapturePins.GEO
    FRAME = TestTrsrnCapturePins.FRAME
    TRSRN = {"type": "xyzacb-trsrn", "params": GEO}

    @staticmethod
    def _seg9(x, y, z):
        return (x, y, z, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

    def _flip_fixture(self, frames):
        # identity rapid (seq1) -> flip markers -> plane rapid (seq2)
        p0 = self._seg9(50.0, 0.0, 100.0)
        p1 = self._seg9(0.0, 0.0, 100.0)
        rapid = [(5, self._seg9(0, 0, 0), p0, None, 1),
                 (8, p0, p1, None, 2)]
        events = [(1, 2)]
        return rapid, events, p0, p1

    def test_trsrn_flip_inserts_joint_invariant_relabel(self):
        rapid, events, p0, _p1 = self._flip_fixture(True)
        frames = [(1,) + tuple(self.FRAME[k] for k in
                               ("pre_rot", "primary_angle", "secondary_angle"))]
        feed2, rapid2, ev2, fr2, _w2, brks, unres = gateway_util.insert_flip_relabels(
            [], rapid, events, frames, [], self.TRSRN, unit_scale=1.0)
        self.assertEqual(unres, 0)
        self.assertEqual(len(rapid2), 3)
        self.assertEqual(feed2, [])
        # seqs doubled; the insert takes the odd seq between the pair
        self.assertEqual([t[4] for t in rapid2], [2, 3, 4])
        self.assertEqual(brks, {3})
        self.assertEqual(ev2, [(2, 2)])
        self.assertEqual(fr2[0][0], 2)
        ins = rapid2[1]
        self.assertEqual(ins[1], ins[2], "relabel vertex is zero-length")
        # The physical property: joints under the OLD side at the pre-flip
        # pose == joints under the NEW side at the relabeled pose.
        j_old = gateway_util.trsrn_kins_inverse(list(p0[:6]), dict(self.GEO), 0)
        j_new = gateway_util.trsrn_kins_inverse(
            list(ins[2][:6]), dict(self.GEO, **self.FRAME), 2)
        for a, b in zip(j_old, j_new):
            self.assertAlmostEqual(a, b, places=6)
        # ...and the next segment now starts at the relabeled pose.
        self.assertEqual(rapid2[2][1], ins[2])
        # The relabel is a real displacement here, not a degenerate skip.
        self.assertGreater(
            max(abs(ins[2][i] - p0[i]) for i in range(3)), 1.0)

    def test_frameless_type2_flip_is_unresolved_not_guessed(self):
        rapid, events, _p0, _p1 = self._flip_fixture(False)
        feed2, rapid2, _ev2, _fr2, _w2, brks, unres = gateway_util.insert_flip_relabels(
            [], rapid, events, [], [], self.TRSRN, unit_scale=1.0)
        self.assertEqual(unres, 1)
        self.assertEqual(len(rapid2), 2, "no vertex may be invented")
        self.assertEqual(brks, set())
        self.assertEqual(rapid2[1][1], rapid2[0][2],
                         "unresolved flip keeps the raw start")

    def test_unknown_family_is_unresolved(self):
        rapid, events, _p0, _p1 = self._flip_fixture(True)
        cfg = {"type": "5axiskins", "params": {}}
        _f, rapid2, _e, _fr, _w2, brks, unres = gateway_util.insert_flip_relabels(
            [], rapid, events, [], [], cfg, unit_scale=1.0)
        self.assertEqual((len(rapid2), brks, unres), (2, set(), 1))

    def test_no_events_is_passthrough_with_doubled_seqs(self):
        rapid = [(5, self._seg9(0, 0, 0), self._seg9(1, 0, 0), None, 1)]
        feed = [(6, self._seg9(1, 0, 0), self._seg9(2, 0, 0), 0.1, None, 2)]
        f2, r2, e2, fr2, _w2, brks, unres = gateway_util.insert_flip_relabels(
            feed, rapid, [], [], [], self.TRSRN, unit_scale=1.0)
        self.assertEqual(([t[5] for t in f2], [t[4] for t in r2]), ([4], [2]))
        self.assertEqual((e2, fr2, brks, unres), ([], [], set(), 0))

    def test_trt_flip_and_feed_next_start_patch(self):
        # xyzac-trt, no identity_first: type 0 IS the world kins. Flip
        # world->identity with the next segment a FEED: the relabel vertex
        # still lands in the rapid stream (by seq), and the FEED's start is
        # patched. Pivot geometry chosen so the relabel is a real jump.
        cfg = {"type": "xyzac-trt",
               "params": {"y_rot_point": 30.0, "z_rot_point": -40.0}}
        w_end = (10.0, 20.0, -5.0, 30.0, 0.0, 45.0)  # A=30 C=45: tilted pose
        rapid = [(4, self._seg9(0, 0, 0), w_end + (0.0, 0.0, 0.0), None, 1)]
        feed = [(7, w_end + (0.0, 0.0, 0.0), self._seg9(0, 0, 50) , 0.1, None, 2)]
        events = [(1, 1)]  # flip to type 1 = identity on plain sparm
        f2, r2, _e2, _fr2, _w2, brks, unres = gateway_util.insert_flip_relabels(
            feed, rapid, events, [], [], cfg, unit_scale=1.0)
        self.assertEqual(unres, 0)
        self.assertEqual(len(r2), 2, "relabel vertex inserted into rapid")
        ins = r2[1]
        self.assertEqual(ins[4], 3)
        self.assertEqual(brks, {3})
        # identity side: world == joints, so the relabeled pose must equal
        # the trt inverse of the pre-flip world pose (canonical 6-slot).
        j5 = gateway_util.trt_kins_inverse(list(w_end), dict(cfg["params"]))
        expect = [j5[0], j5[1], j5[2], j5[3], 0.0, j5[4]]
        for i in range(6):
            self.assertAlmostEqual(ins[2][i], expect[i], places=9)
        self.assertEqual(f2[0][1], ins[2], "feed start patched to the relabel")
        self.assertGreater(max(abs(ins[2][i] - w_end[i]) for i in range(3)), 1.0)

    def test_preamble_marker_patches_first_segment_start(self):
        # W3 P2 (the 962 mm phantom): every marker fires BEFORE the first
        # recorded segment (a preamble remap, or the first move suppressed
        # into a ustart vertex) — no k-loop flip exists, yet the first
        # tuple's start is still the STARTUP-labeled initcode pose. The
        # k=0 correction must re-express it in the governing labeling.
        # FEED-first on purpose: feeds are never suppressed, so this is
        # the general class that P1's ustart vertex does not absorb.
        p0 = self._seg9(50.0, 0.0, 100.0)
        p1 = self._seg9(0.0, 0.0, 100.0)
        feed = [(7, p0, p1, 0.1, None, 1)]
        events = [(0, 2)]   # marker at seq 0 governs seq 1
        frames = [(0,) + tuple(self.FRAME[k] for k in
                               ("pre_rot", "primary_angle", "secondary_angle"))]
        f2, r2, _e2, _fr2, _w2, brks, unres = gateway_util.insert_flip_relabels(
            feed, [], events, frames, [], self.TRSRN, unit_scale=1.0)
        self.assertEqual((unres, len(f2), len(r2), brks), (0, 1, 0, set()))
        # No vertex inserted — the start is PATCHED in place: joints under
        # the new labeling at the patched start == joints under startup
        # (type 0 = identity: joints == world) at the raw start.
        patched = f2[0][1]
        self.assertNotEqual(patched, p0)
        j_new = gateway_util.trsrn_kins_inverse(
            list(patched[:6]), dict(self.GEO, **self.FRAME), 2)
        for a, b in zip(j_new, p0[:6]):
            self.assertAlmostEqual(a, b, places=6)
        # The end is untouched — geometry on the wire is endpoint-only.
        self.assertEqual(f2[0][2], p1)
        # The phantom class this kills: the raw start was ~a machine-frame
        # jump away from where the segment really begins.
        self.assertGreater(max(abs(patched[i] - p0[i]) for i in range(3)), 1.0)

    def test_preamble_marker_without_twin_is_unresolved(self):
        p0 = self._seg9(50.0, 0.0, 100.0)
        rapid = [(7, p0, self._seg9(0, 0, 100), None, 1)]
        _f2, r2, _e2, _fr2, _w2, brks, unres = gateway_util.insert_flip_relabels(
            [], rapid, [(0, 2)], [], [], {"type": "5axiskins", "params": {}},
            unit_scale=1.0)
        self.assertEqual((unres, brks), (1, set()))
        self.assertEqual(r2[0][1], p0, "unresolved keeps the raw start")

    def test_preamble_marker_skips_ustart_first_tuple(self):
        # merged[0] is a suppressed-first-move endpoint (W3 P1): its start
        # is a synthetic copy of its end — patching it would fabricate a
        # segment out of a zero-length vertex.
        p1 = self._seg9(0.0, 0.0, 100.0)
        rapid = [(7, p1, p1, None, 1)]
        frames = [(0,) + tuple(self.FRAME[k] for k in
                               ("pre_rot", "primary_angle", "secondary_angle"))]
        _f2, r2, _e2, _fr2, _w2, brks, unres = gateway_util.insert_flip_relabels(
            [], rapid, [(0, 2)], frames, [], self.TRSRN, unit_scale=1.0,
            ustart_seqs={1})
        self.assertEqual((unres, brks), (0, set()))
        self.assertEqual(r2[0][1], r2[0][2], "zero length preserved")
        self.assertEqual(r2[0][1], p1)

    def test_degenerate_flip_at_neutral_pose_inserts_nothing(self):
        # trt flip at A=0 C=0 with no offsets: world == joints on both sides,
        # the relabel lands exactly on the pre-flip pose — no vertex, no brk.
        cfg = {"type": "xyzac-trt", "params": {}}
        rapid = [(4, self._seg9(0, 0, 0), self._seg9(10, 0, 5), None, 1),
                 (8, self._seg9(10, 0, 5), self._seg9(20, 0, 5), None, 2)]
        events = [(1, 1)]
        _f2, r2, _e2, _fr2, _w2, brks, unres = gateway_util.insert_flip_relabels(
            [], rapid, events, [], [], cfg, unit_scale=1.0)
        self.assertEqual((len(r2), brks, unres), (2, set(), 0))

    @staticmethod
    def _basis(g5x_xyz, g92=(0.0,) * 9, rot=0.0):
        return (tuple(g5x_xyz) + (0.0,) * 6, tuple(g92), rot)

    def test_epoch_only_flip_inserts_identity_relabel(self):
        # G54 -> G59 fixture switch, no kins involved: the machine does not
        # move, so the relabel is the pre-flip endpoint VERBATIM — but the
        # vertex must exist (its epoch differs, so extraction re-expresses
        # the pose under the new basis). Twins must never be consulted.
        p0 = self._seg9(50.0, 0.0, 100.0)
        p1 = self._seg9(0.0, 0.0, 100.0)
        rapid = [(4, self._seg9(0, 0, 0), p0, None, 1),
                 (8, p0, p1, None, 2)]
        wcs = [(0, 1, self._basis((51.2, -7.9, -55.1))),
               (1, 6, self._basis((63.4, -33.7, -31.1)))]
        f2, r2, _e2, _fr2, w2, brks, unres = gateway_util.insert_flip_relabels(
            [], rapid, [], [], wcs, {"type": "not-a-family"}, unit_scale=1.0)
        self.assertEqual((unres, len(r2), f2), (0, 3, []))
        ins = r2[1]
        self.assertEqual(ins[4], 3)
        self.assertEqual(brks, {3})
        self.assertEqual(ins[1], p0, "identity relabel — same machine pose")
        self.assertEqual(ins[2], p0)
        self.assertEqual(r2[2][1], p0, "next start already there — unchanged")
        self.assertEqual([w[0] for w in w2], [0, 2], "wcs events re-keyed")

    def test_combined_kins_and_epoch_flip_gets_one_vertex(self):
        # TWP G53.x switches fixture AND kins back-to-back: ONE inserted
        # vertex, twin-relabeled pose (epoch handling lives in extraction).
        rapid, events, p0, _p1 = self._flip_fixture(True)
        frames = [(1,) + tuple(self.FRAME[k] for k in
                               ("pre_rot", "primary_angle", "secondary_angle"))]
        wcs = [(0, 1, self._basis((0, 0, 0))),
               (1, 6, self._basis((10, 20, 30)))]
        _f2, r2, _e2, _fr2, _w2, brks, unres = gateway_util.insert_flip_relabels(
            [], rapid, events, frames, wcs, self.TRSRN, unit_scale=1.0)
        self.assertEqual((unres, len(r2), len(brks)), (0, 3, 1))
        self.assertNotEqual(r2[1][2], p0, "kins flip relabels the pose")

    def test_single_epoch_and_no_kins_returns_early(self):
        rapid = [(4, self._seg9(0, 0, 0), self._seg9(1, 0, 0), None, 1)]
        wcs = [(0, 1, self._basis((5, 5, 5)))]
        _f2, r2, _e2, _fr2, w2, brks, unres = gateway_util.insert_flip_relabels(
            [], rapid, [], [], wcs, None, unit_scale=1.0)
        self.assertEqual((len(r2), brks, unres), (1, set(), 0))
        self.assertEqual(w2, [(0, 1, wcs[0][2])], "seqs doubled, values kept")

    # ---- W2 P2: seed from the true canon start, not the previous end ----
    # The interpreter's `lo` tracks through canon-SUPPRESSED moves (a G43
    # shift, a deduped first move), so when one sits between the pre-flip
    # tuple and the flip, the next tuple's START — not the previous tuple's
    # END — is where the relabel physically happens. These fixtures make the
    # two diverge and pin the seed choice.

    def test_kins_flip_seeds_from_true_canon_start_not_prev_end(self):
        p0 = self._seg9(50.0, 0.0, 100.0)
        p0_shift = self._seg9(50.0, 0.0, 130.0)   # suppressed +30 Z shift
        p1 = self._seg9(0.0, 0.0, 100.0)
        rapid = [(5, self._seg9(0, 0, 0), p0, None, 1),
                 (8, p0_shift, p1, None, 2)]      # canon start ≠ prev end
        events = [(1, 2)]
        frames = [(1,) + tuple(self.FRAME[k] for k in
                               ("pre_rot", "primary_angle", "secondary_angle"))]
        _f2, r2, _e2, _fr2, _w2, brks, unres = gateway_util.insert_flip_relabels(
            [], rapid, events, frames, [], self.TRSRN, unit_scale=1.0)
        self.assertEqual((unres, len(r2), brks), (0, 3, {3}))
        ins = r2[1]
        # Joint invariance must hold against the TRUE start (the shifted
        # pose), not the stale previous end.
        j_true = gateway_util.trsrn_kins_inverse(
            list(p0_shift[:6]), dict(self.GEO), 0)
        j_ins = gateway_util.trsrn_kins_inverse(
            list(ins[2][:6]), dict(self.GEO, **self.FRAME), 2)
        for a, b in zip(j_true, j_ins):
            self.assertAlmostEqual(a, b, places=6)
        # ...and it must DIFFER from what a prev-end seed would produce.
        j_stale = gateway_util.trsrn_kins_inverse(list(p0[:6]), dict(self.GEO), 0)
        self.assertGreater(max(abs(a - b) for a, b in zip(j_stale, j_ins)), 1.0)
        self.assertEqual(r2[2][1], ins[2], "next start patched to the relabel")

    def test_epoch_only_flip_seeds_from_true_canon_start(self):
        p0 = self._seg9(50.0, 0.0, 100.0)
        p0_shift = self._seg9(50.0, 0.0, 130.0)
        p1 = self._seg9(0.0, 0.0, 100.0)
        rapid = [(4, self._seg9(0, 0, 0), p0, None, 1),
                 (8, p0_shift, p1, None, 2)]
        wcs = [(0, 1, self._basis((51.2, -7.9, -55.1))),
               (1, 6, self._basis((63.4, -33.7, -31.1)))]
        _f2, r2, _e2, _fr2, _w2, brks, unres = gateway_util.insert_flip_relabels(
            [], rapid, [], [], wcs, {"type": "not-a-family"}, unit_scale=1.0)
        self.assertEqual((unres, len(r2), brks), (0, 3, {3}))
        ins = r2[1]
        self.assertEqual(ins[1], p0_shift, "relabel = true canon start")
        self.assertEqual(ins[2], p0_shift)
        self.assertEqual(r2[2][1], p0_shift, "next start untouched")

    def test_kins_flip_unpeels_with_next_segments_tlo(self):
        # A G43 change hides at the flip boundary: prev peeled with tlo 50,
        # nxt with tlo 20 — the same PHYSICAL pose, different stored coords.
        # The seed must un-peel nxt's start with nxt's OWN tlo; mixing
        # prev's tlo would shift the pose by the 30-unit delta. trt
        # world→identity at a tilted pose makes the twin path exercise the
        # TLO fold on the world side.
        cfg = {"type": "xyzac-trt",
               "params": {"y_rot_point": 30.0, "z_rot_point": -40.0}}
        w_tilt = (10.0, 20.0, -5.0, 30.0, 0.0, 45.0)
        w_tilt_n = (10.0, 20.0, 25.0, 30.0, 0.0, 45.0)  # z: -5+50 = 25+20
        rapid = [(4, self._seg9(0, 0, 0), w_tilt + (0.0,) * 3,
                  (0.0, 0.0, 50.0), 1),
                 (8, w_tilt_n + (0.0,) * 3, self._seg9(0, 0, 50),
                  (0.0, 0.0, 20.0), 2)]
        events = [(1, 1)]  # flip to identity
        _f2, r2, _e2, _fr2, _w2, brks, unres = gateway_util.insert_flip_relabels(
            [], rapid, events, [], [], cfg, unit_scale=1.0)
        self.assertEqual((unres, len(r2), brks), (0, 3, {3}))
        ins = r2[1]
        # Expected: inverse of the physical pose (world z = 25 + 20 = 45)
        # under the world side with tool_offset 20 folded, re-peeled by 20.
        j5 = gateway_util.trt_kins_inverse(
            [10.0, 20.0, 45.0, 30.0, 0.0, 45.0],
            {"y_rot_point": 30.0, "z_rot_point": -40.0, "tool_offset": 20.0})
        expect = [j5[0], j5[1], j5[2] - 20.0, j5[3], 0.0, j5[4]]
        for i in range(6):
            self.assertAlmostEqual(ins[2][i], expect[i], places=9)


class TestShouldShipAbc(unittest.TestCase):
    """W2 P3 ship condition: abc rides the wire whenever the tool-vs-work
    pose depends on it. The row that matters most is the TWP defect this
    replaced: constant RAW tilt held in fixture rotary offsets → the
    per-epoch peel zeroes the peeled stream → the old sweep test said 'no
    rotary' and the client drew the plane flat."""

    Z = (0.0, 0.0, 0.0)

    def test_all_zero_no_markers_does_not_ship(self):
        self.assertFalse(gateway_util.should_ship_abc(
            False, [self.Z, self.Z], [self.Z, self.Z]))

    def test_empty_streams_do_not_ship(self):
        self.assertFalse(gateway_util.should_ship_abc(False, [], []))

    def test_kins_markers_ship_even_all_zero(self):
        self.assertTrue(gateway_util.should_ship_abc(
            True, [self.Z], [self.Z]))

    def test_peeled_sweep_ships(self):
        self.assertTrue(gateway_util.should_ship_abc(
            False, [self.Z, self.Z], [self.Z, (5.0, 0.0, 0.0)]))

    def test_constant_raw_tilt_with_peeled_zero_MUST_ship(self):
        # THE fixture-offset case: raw abc constant at the TWP tilt, peeled
        # stream identically zero (G54 carries the rotaries).
        tilt = (19.05, -40.855498, 130.245477)
        self.assertTrue(gateway_util.should_ship_abc(
            False, [tilt, tilt, tilt], [self.Z, self.Z, self.Z]))

    def test_any_nonzero_peeled_value_ships(self):
        # Nonzero PEELED values must ship however constant (schema 5: a
        # live-rebased parked rotary under a nonzero fixture offset peels
        # to a constant nonzero — a client without the channel zero-fills
        # and re-adds the offset, reconstructing the wrong pose). Also
        # covers the epoch-differing-offsets case (varying ⇒ nonzero).
        self.assertTrue(gateway_util.should_ship_abc(
            False, [self.Z, self.Z], [(-10.0, 0.0, 0.0), (-10.0, 0.0, 0.0)]))
        self.assertTrue(gateway_util.should_ship_abc(
            False, [self.Z, self.Z], [(-10.0, 0.0, 0.0), (-20.0, 0.0, 0.0)]))

    def test_raw_accepts_one_shot_generator(self):
        raw = ((v, 0.0, 0.0) for v in (0.0, 0.0, 3.0, 0.0))
        self.assertTrue(gateway_util.should_ship_abc(False, raw, []))

    def test_sub_eps_noise_does_not_ship(self):
        n = (1e-12, -1e-12, 5e-13)
        self.assertFalse(gateway_util.should_ship_abc(False, [n, n], [n, n]))


class TestLineTrustMachinery(unittest.TestCase):
    """W2 P6 per-point line trust: classification, stream compatibility,
    and marked-subroutine span resolution."""

    SRC = "\n".join([
        "G0 X0 Y0",            # 1 rapid
        "G1 X10 F200",         # 2 feed
        "(comment only)",      # 3 none
        "X20 Y5",              # 4 either (modal axis words)
        "G10 L2 P1 X0",        # 5 none (settings-only axis words)
        "G81 X1 Y1 Z-2 R1",    # 6 either (canned: rapids AND feeds)
        "G28",                 # 7 rapid
        "M6 T3",               # 8 none
        "G2 X0 I5",            # 9 feed
    ])

    def test_classification(self):
        cls = gateway_util.classify_motion_lines(self.SRC)
        L = gateway_util
        self.assertEqual(cls, [
            L.LINE_RAPID, L.LINE_FEED, L.LINE_NONE, L.LINE_EITHER,
            L.LINE_NONE, L.LINE_EITHER, L.LINE_RAPID, L.LINE_NONE,
            L.LINE_FEED])

    def test_stream_compatibility(self):
        cls = gateway_util.classify_motion_lines(self.SRC)
        # A FEED point on the rapid-only line 1 is a colliding sub number.
        self.assertEqual(
            gateway_util.line_trust_flags([1, 2, 4, 6], cls, is_rapid_stream=False),
            [0, 1, 1, 1])
        # A RAPID point on the feed-only line 2 likewise.
        self.assertEqual(
            gateway_util.line_trust_flags([1, 2, 4, 7], cls, is_rapid_stream=True),
            [1, 0, 1, 1])

    def test_out_of_range_and_cannot_move_untrusted(self):
        cls = gateway_util.classify_motion_lines(self.SRC)
        self.assertEqual(
            gateway_util.line_trust_flags([0, 3, 5, 8, 99], cls, False),
            [0, 0, 0, 0, 0])

    def test_sub_indices_strict_seq_and_nesting(self):
        events = [(2, "toolchange"), (5, "probe"), (7, None), (9, None)]
        idx = {"toolchange": 0, "probe": 1}
        # Marker at seq N governs points with seq > N (strict).
        self.assertEqual(
            gateway_util.resolve_sub_indices([1, 2, 3, 6, 8, 10], events, idx),
            [0xff, 0xff, 0, 1, 0, 0xff])

    def test_sub_indices_unbalanced_end_pops_nothing(self):
        self.assertEqual(
            gateway_util.resolve_sub_indices([1, 5], [(2, None)], {}),
            [0xff, 0xff])

    def test_parse_sub_marker(self):
        self.assertEqual(gateway_util.parse_sub_marker("WEBUI_SUB=tool_touch_off"),
                         ("start", "tool_touch_off"))
        self.assertEqual(gateway_util.parse_sub_marker(" WEBUI_SUB = g53x core "),
                         ("start", "g53x core"))
        self.assertEqual(gateway_util.parse_sub_marker("WEBUI_SUB_END"),
                         ("end", None))
        self.assertIsNone(gateway_util.parse_sub_marker("WEBUI_KINSTYPE=2"))
        self.assertIsNone(gateway_util.parse_sub_marker("plain comment"))


class TestRotarySyncInitcode(unittest.TestCase):
    """Schema-5 fix for the parity gate's wave-2 find: the offline interp
    starts every axis at program-zero of the active fixture, so an axis
    the program never commands poses at the fixture's rotary offset while
    the machine holds its parked pose. The fix seeds the interp with one
    G53 rotary move built from LIVE stat — no motion recorded (first-move
    suppression eats it, re-armed by the canon at the first real line),
    no value guessed; commanded axes then behave exactly as the run will
    (the command records a real change from the live pose — this is also
    why a rebase-the-output heuristic was rejected: a remap commanding an
    axis to exactly the fixture offset is indistinguishable from an
    uncommanded axis in the output, and rebasing it would UNTILT a
    correct preview whenever the machine parks elsewhere)."""

    # xyzacb axis_mask: X|Y|Z|A|B|C = bits 0..5.
    MASK6 = 0b111111
    MASK3 = 0b000111

    def test_builds_g53_move_from_live_rotaries(self):
        code = gateway_util.rotary_sync_initcode(
            self.MASK6, (1.0, 2.0, 3.0, 0.0, -40.855498, -229.754523))
        self.assertEqual(code, "G53 G0 A0.000000000 B-40.855498000 C-229.754523000")

    def test_only_axes_in_the_mask(self):
        code = gateway_util.rotary_sync_initcode(
            0b001111, (0, 0, 0, 19.05, 99.0, 99.0))   # A only
        self.assertEqual(code, "G53 G0 A19.050000000")

    def test_no_rotary_axes_no_sync(self):
        self.assertIsNone(gateway_util.rotary_sync_initcode(
            self.MASK3, (1.0, 2.0, 3.0, 0.0, 0.0, 0.0)))

    def test_missing_or_partial_live_data_no_sync(self):
        # Absence = the honest pre-5 behavior, never a guessed value.
        self.assertIsNone(gateway_util.rotary_sync_initcode(self.MASK6, None))
        self.assertIsNone(gateway_util.rotary_sync_initcode(
            self.MASK6, (1.0, 2.0, 3.0)))
        self.assertIsNone(gateway_util.rotary_sync_initcode(
            self.MASK6, (0, 0, 0, 1.0, None, 2.0)))


class TestCanonFirstMoveRearm(unittest.TestCase):
    """The rotary-sync initcode consumes the canon's one first-move
    suppression; next_line must re-arm it at the first REAL program line
    so the program's own first move stays suppressed exactly as before."""

    def _canon(self):
        import types
        import gcode_canon
        c = object.__new__(gcode_canon.PreviewCanon)
        # Minimal state — bypass StatMixin (needs a live stat object).
        c.feed = []
        c.rapid = []
        c.seq = 0
        c.lineno = -1
        c.lo = (0.0,) * 9
        c.first_move = True
        c.suppress = 0
        c.basis_at_start = None
        c.wcs_used = []
        c._last_motion_g5x = None
        c.wcs_events = []
        c._last_wcs_basis = None
        c.sub_events = []
        c.unknown_start = []
        c.rotation_xy = 0.0
        c.xo = c.yo = c.zo = 0.0
        c.ao = c.bo = c.co = 0.0
        c.uo = c.vo = c.wo = 0.0
        for s in c._WCS_SUFFIXES:
            setattr(c, "g5x_offset_" + s, 0.0)
            setattr(c, "g92_offset_" + s, 0.0)
        c.g5x_index = 1
        c.rotate_and_translate = lambda *a: tuple(a)
        return c, types.SimpleNamespace

    def test_initcode_move_seeds_lo_and_program_first_move_is_ustart(self):
        c, ns = self._canon()
        # Initcode G53 rotary sync (sequence_number 0): fully suppressed —
        # NOT even a ustart vertex (its endpoint IS the live parked pose
        # the client-built entry move starts from) — and seeds lo.
        c.next_line(ns(sequence_number=0))
        c.straight_traverse(0, 0, 0, 0, -40.86, -229.75, 0, 0, 0)
        self.assertEqual(c.rapid, [])
        self.assertEqual(c.unknown_start, [])
        self.assertEqual(c.lo[4], -40.86)
        # First REAL line re-arms: the program's first move records a
        # ZERO-LENGTH unknown-start vertex at its endpoint (W3 P1 — the
        # prior XYZ is still unknown, but the endpoint is a commanded pose
        # the run will visit; pre-schema-6 it vanished entirely and the sim
        # entry lerped past it).
        c.next_line(ns(sequence_number=1))
        self.assertTrue(c.first_move)
        c.straight_traverse(5, 0, 0, 0, -40.86, -229.75, 0, 0, 0)
        self.assertEqual(len(c.rapid), 1)
        self.assertEqual(c.rapid[0][1], c.rapid[0][2])          # zero-length
        self.assertEqual(c.rapid[0][2][0], 5)                    # at the endpoint
        self.assertEqual(c.unknown_start, [c.rapid[0][4]])       # seq flagged
        # The SECOND program move records normally from the first's end.
        c.next_line(ns(sequence_number=2))
        c.straight_traverse(9, 0, 0, 0, -40.86, -229.75, 0, 0, 0)
        self.assertEqual(len(c.rapid), 2)
        self.assertEqual(c.rapid[1][1][0], 5)
        self.assertEqual(c.rapid[1][2][4], -40.86)
        self.assertEqual(c.unknown_start, [c.rapid[0][4]])       # still just one

    def test_without_initcode_first_move_records_as_ustart(self):
        c, ns = self._canon()
        c.next_line(ns(sequence_number=1))
        c.straight_traverse(5, 0, 0, 0, 0, 0, 0, 0, 0)   # ustart vertex
        c.next_line(ns(sequence_number=2))
        c.straight_traverse(9, 0, 0, 0, 0, 0, 0, 0, 0)   # records normally
        self.assertEqual(len(c.rapid), 2)
        self.assertEqual(c.rapid[0][1], c.rapid[0][2])
        self.assertEqual(c.unknown_start, [c.rapid[0][4]])
        self.assertEqual(c.rapid[1][1][0], 5)

    def test_midprogram_toolchange_gains_ustart_vertex(self):
        # Post-M6/G43 suppression is the same defect class: the excursion
        # to the toolchange position is unknown, but the first move after
        # it lands at a known endpoint — an honest gap + endpoint now, not
        # a silently stretched false connector.
        c, ns = self._canon()
        c.next_line(ns(sequence_number=1))
        c.straight_traverse(5, 0, 0, 0, 0, 0, 0, 0, 0)   # program-start ustart
        c.next_line(ns(sequence_number=2))
        c.straight_traverse(9, 0, 0, 0, 0, 0, 0, 0, 0)
        c.first_move = True                               # what change_tool sets
        c.next_line(ns(sequence_number=3))
        c.straight_traverse(1, 2, 3, 0, 0, 0, 0, 0, 0)
        self.assertEqual(len(c.rapid), 3)
        self.assertEqual(c.rapid[2][1], c.rapid[2][2])    # zero-length endpoint
        self.assertEqual(c.rapid[2][2][:3], (1, 2, 3))
        self.assertEqual(len(c.unknown_start), 2)
        self.assertEqual(c.unknown_start[1], c.rapid[2][4])


class TestEvaluateTloDrift(unittest.TestCase):
    """W2 P4 drift edge: the per-line limit flags bake the parse-time tool
    table; this decides when the poller must reparse. G49 (applied offset
    zero) must never read as drift."""

    META = {"table_path": "/cfg/tool.tbl", "table_mtime": 100.0,
            "tlos": [[3, 0.0, 0.0, 156.5596], [7, 0.0, 0.0, 80.0]]}

    def test_no_meta_is_never_drift(self):
        self.assertIsNone(gateway_util.evaluate_tlo_drift(None, 101.0, 3, 156.5596))
        self.assertIsNone(gateway_util.evaluate_tlo_drift({}, 101.0, 3, 156.5596))

    def test_table_mtime_change_is_drift(self):
        self.assertEqual(
            gateway_util.evaluate_tlo_drift(self.META, 101.0, None, None),
            "table_mtime")

    def test_matching_mtime_and_offset_is_clean(self):
        self.assertIsNone(
            gateway_util.evaluate_tlo_drift(self.META, 100.0, 3, 156.5596))

    def test_applied_offset_drift_on_loaded_tool(self):
        # The live defect's numbers: parsed 156.5596, re-measured 56.6346.
        self.assertEqual(
            gateway_util.evaluate_tlo_drift(self.META, 100.0, 3, 56.6346),
            "tool_offset")

    def test_g49_zero_applied_offset_is_not_drift(self):
        self.assertIsNone(gateway_util.evaluate_tlo_drift(self.META, 100.0, 3, 0.0))
        self.assertIsNone(gateway_util.evaluate_tlo_drift(self.META, 100.0, 3, None))

    def test_unknown_tool_and_no_tool_are_clean(self):
        self.assertIsNone(gateway_util.evaluate_tlo_drift(self.META, 100.0, 5, 42.0))
        self.assertIsNone(gateway_util.evaluate_tlo_drift(self.META, 100.0, 0, 42.0))
        self.assertIsNone(gateway_util.evaluate_tlo_drift(self.META, 100.0, None, 42.0))

    def test_missing_mtimes_skip_the_file_signal(self):
        meta = dict(self.META, table_mtime=None)
        self.assertIsNone(gateway_util.evaluate_tlo_drift(meta, 101.0, None, None))
        self.assertIsNone(gateway_util.evaluate_tlo_drift(self.META, None, None, None))


class TestWcsEventRewritten(unittest.TestCase):
    """P2 `rewritten` flag: the client must re-add the PARSE snapshot for a
    fixture the program overwrites (G10 L2 — the normal TWP path), and the
    live table row for everything else."""

    B = ((1300.0, -200.0, -1400.0) + (0.0,) * 6, (0.0,) * 9, 0.0)

    def _rows(self, g5x=(1300.0, -200.0, -1400.0), rot=0.0):
        rows = {i: ([0.0] * 9, 0.0) for i in range(1, 10)}
        rows[1] = (list(g5x) + [0.0] * 6, rot)
        return rows

    def test_matching_row_is_not_rewritten(self):
        self.assertFalse(gateway_util.wcs_event_rewritten(
            self.B, 1, self._rows(), self.B[1], 1.0))

    def test_program_written_offsets_are_rewritten(self):
        self.assertTrue(gateway_util.wcs_event_rewritten(
            self.B, 1, self._rows(g5x=(1290.0, -200.0, -1400.0)), self.B[1], 1.0))
        self.assertTrue(gateway_util.wcs_event_rewritten(
            self.B, 1, self._rows(rot=30.0), self.B[1], 1.0))

    def test_mid_program_g92_marks_rewritten(self):
        basis = (self.B[0], (5.0,) + (0.0,) * 8, 0.0)
        self.assertTrue(gateway_util.wcs_event_rewritten(
            basis, 1, self._rows(), (0.0,) * 9, 1.0))

    def test_unit_scale_applies_to_linear_axes(self):
        # Canon inches vs machine-mm var rows: 1300 mm = 51.1811 in.
        basis = ((51.18110236, -7.874015748, -55.11811024) + (0.0,) * 6,
                 (0.0,) * 9, 0.0)
        self.assertFalse(gateway_util.wcs_event_rewritten(
            basis, 1, self._rows(), basis[1], 25.4))

    def test_unreadable_table_degrades_to_snapshot(self):
        # "Cannot tell" must never become "trust the live table".
        self.assertTrue(gateway_util.wcs_event_rewritten(
            self.B, 1, {}, self.B[1], 1.0))

    def test_read_var_wcs_rows(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".var", delete=False) as f:
            f.write("5221\t1300.0\n5222\t-200.0\n5230\t15.5\n5241\t7.0\njunk line\n")
            path = f.name
        try:
            rows = gateway_util.read_var_wcs_rows(path)
            self.assertEqual(rows[1][0][:2], [1300.0, -200.0])
            self.assertEqual(rows[1][1], 15.5)
            self.assertEqual(rows[2][0][0], 7.0)
            self.assertEqual(rows[3], ([0.0] * 9, 0.0))
        finally:
            os.unlink(path)
        self.assertEqual(gateway_util.read_var_wcs_rows("/nonexistent"), {})


class TestLineAttribution(unittest.TestCase):
    """Motion line numbers only index the MAIN file when nothing was called.

    Pinned against the real observed case: the TWP demo's motion comes back
    tagged with square.ngc's lines 2..7 and remap.py's line 1029, which is why
    the run highlight parked on an unrelated line and never reached the
    o<square> call. The number cannot be repaired, so it must be disowned.
    """

    CLEAN = "g0 x0 y0 z10\ng1 x50 f100\nx60\nm2\n"

    def test_single_file_program_is_trusted(self):
        untrusted, bad, why = gateway_util.check_line_attribution(
            self.CLEAN, [1, 2, 3])
        self.assertFalse(untrusted)
        self.assertEqual(bad, [])
        self.assertEqual(why, "")

    def test_line_number_past_end_of_file_is_caught(self):
        untrusted, bad, why = gateway_util.check_line_attribution(
            self.CLEAN, [1, 1029])
        self.assertTrue(untrusted)
        self.assertIn(1029, bad)
        self.assertIn("beyond the file's 4 lines", why)

    def test_motion_blamed_on_a_line_that_cannot_move_is_caught(self):
        # line 2 is a tool change, line 3 blank: neither can produce motion,
        # so motion tagged with them came from somewhere else.
        src = "g0 x1\nm6 t3\n\ng1 x2 f10\n"
        untrusted, bad, _why = gateway_util.check_line_attribution(src, [1, 2, 3])
        self.assertTrue(untrusted)
        self.assertEqual(bad, [2, 3])

    def test_comment_only_and_bare_axis_word_are_classified_correctly(self):
        src = "(just a comment)\nx10\n; another\ng4 p1\n"
        untrusted, bad, _why = gateway_util.check_line_attribution(src, [2])
        self.assertFalse(untrusted, "a bare axis word under modal motion moves")
        untrusted, bad, _why = gateway_util.check_line_attribution(src, [1, 3, 4])
        self.assertTrue(untrusted)
        self.assertEqual(bad, [1, 3, 4], "comments and a dwell cannot move")

    def test_no_line_numbers_is_not_an_accusation(self):
        self.assertEqual(gateway_util.check_line_attribution(self.CLEAN, []),
                         (False, [], ""))
        self.assertEqual(gateway_util.check_line_attribution("", []),
                         (False, [], ""))

    def test_remapped_g53_3_counts_as_motion_capable(self):
        # G53.x is remapped but IS the line that commands the move — motion
        # attributed to it is legitimate and must not be flagged.
        src = "g68.2 x1 y1 z1 q121 i30 j15\ng53.3 x0y0z100\n"
        untrusted, _bad, _why = gateway_util.check_line_attribution(src, [2])
        self.assertFalse(untrusted)

    def test_bare_g28_g30_are_motion_capable(self):
        # G28/G30 move with NO axis words — flagging them disabled the
        # highlight on clean single-file programs with a false "came from a
        # subroutine" banner (review-caught false positive).
        src = "g28\ng30\ng0 x1\n"
        untrusted, bad, _why = gateway_util.check_line_attribution(src, [1, 2, 3])
        self.assertFalse(untrusted)
        self.assertEqual(bad, [])

    def test_reference_store_and_cancel_are_not_motion(self):
        # G28.1/G30.1 only STORE the reference point; G80 CANCELS canned
        # cycles. None can be a motion's source line.
        src = "g28.1\ng30.1\ng80\ng81 x1 z-2 r1\n"
        untrusted, bad, _why = gateway_util.check_line_attribution(
            src, [1, 2, 3, 4])
        self.assertTrue(untrusted)
        self.assertEqual(bad, [1, 2, 3], "g81 canned cycle stays trusted")

    def test_settings_axis_words_are_not_motion(self):
        # G10/G92/G52 carry axis words that write offsets, not moves — a sub
        # line colliding with one must not keep the attribution trusted.
        src = "g10 l2 p1 x0 y0 z0\ng92 x5\ng52 x1 y1\ng0 x1\n"
        untrusted, bad, _why = gateway_util.check_line_attribution(
            src, [1, 2, 3, 4])
        self.assertTrue(untrusted)
        self.assertEqual(bad, [1, 2, 3])


class TestTrsrnLimitCheck(unittest.TestCase):
    """Phase 3 close-out: joint-side soft limits for trsrn TCP/TOOL segs."""

    CFG = {"type": "xyzacb-trsrn", "identity_first": False,
           "params": {"nut_angle": 55.0, "y_pivot": 50.0, "z_pivot": 120.0,
                      "x_offset": 0.0, "y_offset": 0.0,
                      "y_rot_axis": -1000.0, "z_rot_axis": -2000.0}}
    FRAME = (-1.781762, 130.2455, -40.8555)
    NINE = staticmethod(lambda x, y, z, a, b, c: (x, y, z, a, b, c, 0.0, 0.0, 0.0))

    def test_plane_move_drives_joint_past_limit(self):
        # Capture point: machine world (1609.597,-854.904,-571.098)
        # TLO-inclusive = joint X 1390.773; canon-style z carries TLO 100
        # subtracted (the checker adds it back). A 1 mm plane move keeps
        # joint X moving so attribution fires.
        start = self.NINE(1609.597, -854.904, -671.098, 0.0, -40.855, 130.245)
        end = self.NINE(1610.597, -853.904, -671.098, 0.0, -40.855, 130.245)
        seg = (7, start, end, (0.0, 0.0, 100.0), 2, self.FRAME)
        records, total, unchecked = gateway_util.check_limit_violations_trsrn(
            [seg], {"X": (-2000.0, 1390.0)}, self.CFG)
        self.assertEqual(unchecked, 0)
        self.assertEqual(total, 1)
        self.assertEqual((records[0]["axis"], records[0]["kind"]), ("X", "max"))
        self.assertGreater(records[0]["value"], 1390.5)
        self.assertLess(records[0]["value"], 1392.0)

    def test_tcp_orient_sweep_checked_with_tlo(self):
        # G53.6 orient: world pinned while B/C sweep — the joints migrate
        # MID-segment (rotary subdivision is the point). End joint Y is
        # ~-371.6 (capture); a -300 bound must flag it.
        start = self.NINE(1300.0, -200.0, -1300.0, 0.0, 0.0, 0.0)
        end = self.NINE(1300.0, -200.0, -1300.0, 0.0, -40.855, 130.245)
        seg = (6, start, end, (0.0, 0.0, 100.0), 1, None)  # mode 1: no frame
        records, total, unchecked = gateway_util.check_limit_violations_trsrn(
            [seg], {"Y": (-300.0, 300.0)}, self.CFG)
        self.assertEqual(unchecked, 0)
        self.assertEqual(total, 1)
        self.assertEqual((records[0]["axis"], records[0]["kind"]), ("Y", "min"))
        self.assertLess(records[0]["value"], -350.0)

    def test_frameless_type2_is_unchecked_never_guessed(self):
        seg = (9, self.NINE(0, 0, 0, 0, 0, 0), self.NINE(1, 0, 0, 0, 0, 0),
               None, 2, None)
        records, total, unchecked = gateway_util.check_limit_violations_trsrn(
            [seg], {"X": (-1.0, 1.0)}, self.CFG)
        self.assertEqual(records, [])
        self.assertEqual(total, 0)
        self.assertEqual(unchecked, 1)

    def test_identity_segments_skipped(self):
        seg = (3, self.NINE(500, 0, 0, 0, 0, 0), self.NINE(600, 0, 0, 0, 0, 0),
               None, 0, None)
        records, total, unchecked = gateway_util.check_limit_violations_trsrn(
            [seg], {"X": (-1.0, 1.0)}, self.CFG)
        self.assertEqual((records, total, unchecked), ([], 0, 0))


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

    # The upstream TWP machine (phase 3). Pin prefix is <module>_kins. —
    # the trsrn comp names its pins that way, unlike trt where prefix ==
    # module — and tool-offset-z stays netted (live TLO), never parsed.
    TRSRN_HALCMDS = [
        "net :tool-offset motion.tooloffset.z xyzacb_trsrn_kins.tool-offset-z",
        "setp xyzacb_trsrn_kins.nut-angle 55",
        "setp xyzacb_trsrn_kins.y-pivot 50",
        "setp xyzacb_trsrn_kins.z-pivot 120",
        "setp xyzacb_trsrn_kins.x-offset 0",
        "setp xyzacb_trsrn_kins.y-offset 0",
        "setp xyzacb_trsrn_kins.y-rot-axis -1000",
        "setp xyzacb_trsrn_kins.z-rot-axis -2000",
    ]

    def test_trsrn_twp_ini(self):
        got = gateway_util.parse_kins_config("xyzacb_trsrn", self.TRSRN_HALCMDS)
        self.assertEqual(got, {
            "module": "xyzacb_trsrn",
            "type": "xyzacb-trsrn",
            "identity_first": False,
            "params": {"nut_angle": 55.0, "y_pivot": 50.0, "z_pivot": 120.0,
                       "x_offset": 0.0, "y_offset": 0.0,
                       "y_rot_axis": -1000.0, "z_rot_axis": -2000.0},
        })

    def test_trsrn_tool_offset_z_never_parsed(self):
        got = gateway_util.parse_kins_config(
            "xyzacb_trsrn", ["setp xyzacb_trsrn_kins.tool-offset-z 100"])
        self.assertEqual(got["params"], {})

    def test_trsrn_pivot_warning_without_setp_lines(self):
        # A trsrn config seeding geometry via net/sets (the upstream idiom)
        # is invisible here — the warning must fire like it does for trt.
        cfg = gateway_util.parse_kins_config("xyzacb_trsrn", [])
        self.assertIsNotNone(gateway_util.kins_pivot_warning(cfg))
        cfg = gateway_util.parse_kins_config("xyzacb_trsrn", self.TRSRN_HALCMDS)
        self.assertIsNone(gateway_util.kins_pivot_warning(cfg))


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
        # Twin with the FULL pin set: configured.
        full = {p.replace("-", "_"): 0.0 for p in gateway_util._KINS_PARAM_PINS}
        self.assertIsNone(f({"module": "xyzac-trt-kins", "type": "xyzac-trt",
                             "params": full}))
        # Twin without params: the silent pivot-zero trap (setp lines in a
        # .hal file instead of [HAL]HALCMD).
        r = f({"module": "xyzac-trt-kins", "type": "xyzac-trt", "params": {}})
        self.assertIn("HALCMD", r)
        # PARTIAL set — one pin missing because it was misspelled. This is the
        # case the old all-or-nothing check waved through, and it is worse
        # than the empty one: everything else looks configured.
        partial = dict(full)
        del partial["y_offset"]
        r = f({"module": "xyzac-trt-kins", "type": "xyzac-trt", "params": partial})
        self.assertIsNotNone(r)
        self.assertIn("y-offset", r)

    def test_kins_pivot_warning_catches_one_misspelled_trsrn_pin(self):
        # The trsrn hazard concretely: `nut-angle` mistyped parses as ABSENT,
        # the twin substitutes nutAngle = 0, and the entire nutating solution
        # collapses with nothing else wrong anywhere in the config.
        halcmds = [
            "setp xyzacb_trsrn_kins.y-pivot 50", "setp xyzacb_trsrn_kins.z-pivot 120",
            "setp xyzacb_trsrn_kins.x-offset 0", "setp xyzacb_trsrn_kins.y-offset 0",
            "setp xyzacb_trsrn_kins.y-rot-axis -1000",
            "setp xyzacb_trsrn_kins.z-rot-axis -2000",
            "setp xyzacb_trsrn_kins.nut_angle 55",     # underscore, not hyphen
        ]
        cfg = gateway_util.parse_kins_config("xyzacb_trsrn", halcmds)
        self.assertNotIn("nut_angle", cfg["params"])
        r = gateway_util.kins_pivot_warning(cfg)
        self.assertIsNotNone(r)
        self.assertIn("nut-angle", r)
        self.assertIn("6 of 7", r)

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

    def test_twpframe_marker_parse(self):
        f = gateway_util.parse_twpframe_marker
        self.assertEqual(f("WEBUI_TWPFRAME=-1.781762,130.2455,-40.8555"),
                         (-1.781762, 130.2455, -40.8555))
        self.assertEqual(f("  webui_twpframe = 0 , 0 , 0  "), (0.0, 0.0, 0.0))
        self.assertEqual(f("WEBUI_TWPFRAME=1e-3,2E2,+4.5"), (0.001, 200.0, 4.5))
        self.assertIsNone(f("WEBUI_TWPFRAME=1,2"))          # three values required
        self.assertIsNone(f("WEBUI_TWPFRAME=a,b,c"))
        self.assertIsNone(f("WEBUI_KINSTYPE=2"))
        self.assertIsNone(f("note: WEBUI_TWPFRAME=1,2,3 elsewhere"))
        self.assertIsNone(f(""))
        self.assertIsNone(f(None))

    def test_type_flags_raw(self):
        # Same event resolution as the world flags, but RAW types survive —
        # trsrn type 1 (TCP) and type 2 (TOOL) have different joint
        # mappings, so the wire must not collapse them to a bool.
        f = gateway_util.kins_type_flags
        self.assertEqual(f([1, 2, 3, 4], [(1, 1), (3, 2)]), [0, 1, 1, 2])
        self.assertEqual(f([5, 1], [(2, 2)]), [2, 0])       # unordered seqs
        self.assertEqual(f([3], [(2, 1), (2, 0)]), [0])     # same-seq: last wins
        self.assertEqual(f([3], [(2, 0), (2, 1)]), [1])

    def test_world_flags_wrap_type_flags(self):
        # kins_world_flags is a thin mapping over kins_type_flags — the two
        # must resolve events identically.
        seqs, events = [1, 2, 3, 4, 5], [(1, 1), (3, 2), (4, 0)]
        types = gateway_util.kins_type_flags(seqs, events)
        idf = gateway_util.kins_world_flags(seqs, events, identity_first=True)
        self.assertEqual(idf, [1 if t == 1 else 0 for t in types])

    def test_nonidentity_flags_by_family(self):
        f = gateway_util.kins_nonidentity_flags
        trt_plain = {"type": "xyzac-trt", "identity_first": False}
        trt_idf = {"type": "xyzac-trt", "identity_first": True}
        trsrn = {"type": "xyzacb-trsrn", "identity_first": False}
        # trt follows sparm; userk type 2 = identity in the stock template.
        self.assertEqual(f([0, 1, 2], trt_plain), [1, 0, 0])
        self.assertEqual(f([0, 1, 2], trt_idf), [0, 1, 0])
        # trsrn: type 0 identity; 1 (TCP) and 2 (TOOL) both non-identity.
        self.assertEqual(f([0, 1, 2], trsrn), [0, 1, 1])
        # No config degrades to the plain-sparm trt mapping (unreachable in
        # the worker: mode arrays are only built once kins_cfg parsed).
        self.assertEqual(f([0, 1, 2], None), [1, 0, 0])

    def test_marker_policy(self):
        f = gateway_util.kins_marker_policy
        # trivkins / no [KINS]: machine can't switch — markers are noise.
        self.assertEqual(f(None), "ignore")
        self.assertEqual(f({"type": "trivkins"}), "ignore")
        # Twin exists: full world checking.
        self.assertEqual(f({"type": "xyzac-trt"}), "twin")
        self.assertEqual(f({"type": "xyzbc-trt"}), "twin")
        self.assertEqual(f({"type": "xyzacb-trsrn"}), "twin")
        # Declared switchable module without a twin: flags are real but
        # world segments must ship as an explicit unchecked count.
        self.assertEqual(f({"type": "genhexkins"}), "unchecked")

    def test_frame_indices(self):
        f = gateway_util.kins_frame_indices
        frames = [(2, -1.7, 130.0, -40.0), (7, 0.5, 10.0, 20.0)]
        # Event at seq N governs segments with seq > N (marker convention).
        self.assertEqual(f([1, 2, 3, 7, 8], frames), [None, None, 0, 0, 1])
        self.assertEqual(f([5, 1], frames), [0, None])   # unordered seqs
        self.assertEqual(f([3], []), [None])
        # Two frames on one seq: the LAST recorded wins.
        self.assertEqual(f([3], [(2, 1, 1, 1), (2, 2, 2, 2)]), [1])

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

    def test_unknown_start_endpoint_flags_without_joint_motion(self):
        # W3 P1: a suppressed first-move endpoint under world kins arrives
        # with start=None — its joints never "move" within the segment, but
        # the machine does reach them, so an out-of-limits endpoint joint
        # must flag. Parked at world (60,0,0) A0 C0 → joint X = 60 past a
        # ±50 limit; the zero-length form would be skipped as parked.
        end = self.NINE(60, 0, 0, 0, 0)
        records, total = gateway_util.check_limit_violations_world(
            [(4, None, end, None)], {"X": (-50.0, 50.0)}, self.CFG)
        self.assertEqual(total, 1)
        self.assertEqual((records[0]["line"], records[0]["axis"]), (4, "X"))
        _, z_total = gateway_util.check_limit_violations_world(
            [(4, end, end, None)], {"X": (-50.0, 50.0)}, self.CFG)
        self.assertEqual(z_total, 0)   # the contrast the convention exists for

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
