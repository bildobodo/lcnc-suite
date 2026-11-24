"""The program's start-dependent beginning (docs/reviews/parity-ef.plan.md E,
Fassung 7, Codex R122–R131) against the REAL worker and LinuxCNC's native
offline interpreter (native_start_probe.py, one fresh process per case), the
E4a source guards over the suite's TWP Python remaps, and the binding of
their entries to the reviewed bodies (suite_py_bind_probe.py).

X, Y and Z stand where the machine stands when the program starts — a value
no parse knows. An axis stays START-DEPENDENT (`dep`) until a block commands
it absolutely, by the interpreter's own words (never by a changed value);
the client binds it to the check's start basis. Out of the straight-move,
identity, unrotated scope the axis becomes UNKNOWN (`stale`); a value read
from the position or written from it while an axis depends on the start or is
unknown is the preview's guess: every axis unknown to the end."""
import ast
import hashlib
import importlib.util
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock
from pathlib import Path

import gateway_util

try:  # the canon imports LinuxCNC's rs274 — absent off the machine (CI)
    import gcode_canon
    _HAVE_RS274 = True
except ImportError:
    gcode_canon = None
    _HAVE_RS274 = False
from test_start_tlo_worker import probe

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TWP_PY = ROOT / "examples" / "sim_config" / "twp" / "python"
ROUTINE = ROOT / "subroutines" / "tool_length_probe" / "tool_touch_off.ngc"
TWP_INI = ROOT / "examples" / "sim_config" / "lcnc_suite_sim_6axis_twp_xyzabc.ini"


def bind(case):
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    p = subprocess.run([sys.executable, str(HERE / "suite_py_bind_probe.py"), case],
                       capture_output=True, text=True, timeout=120, env=env, cwd=HERE)
    lines = [ln for ln in p.stdout.splitlines() if ln.startswith("{")]
    if not lines:
        raise AssertionError(f"{case}: rc={p.returncode} {p.stderr[-800:]}")
    return {k: frozenset(v) for k, v in json.loads(lines[-1])["bound"].items()}


class TestTheCanonBooksTheMask(unittest.TestCase):
    """E2: what a block commands, read from the interpreter."""

    def test_codex_s_rdp_counterexample_keeps_both_corners(self):
        # 1 / 15 (VP122-01): G53 G0 Z0 / G0 X0 / G0 Y0 / G0 X10 — the
        # believed corners coincide, the real ones need not: each mask change
        # and its predecessor are anchors
        r = probe("e_g53_rdp")
        self.assertIsNone(r["parse_error"])
        self.assertEqual(r["rapid"], [[0, 0, 0], [0, 0, 0], [0, 0, 0], [10, 0, 0]])
        self.assertEqual(r["rapid_dep"], [3, 2, 0])
        self.assertEqual(r["rapid_dep_basis"], [1, 1, 1])
        self.assertEqual(r["start_believed"], [0.0, 0.0, 0.0])

    def test_single_axis_moves(self):
        # 2: X with Y, Z dependent, then Y, then a feed of Z
        r = probe("e_single")
        self.assertEqual((r["rapid_dep"], r["feed_dep"]), ([6, 4], [0]))
        self.assertEqual((r["feed_dep_basis"], r["feed_dep_f"]), ([2], [100.0]))

    def test_a_turned_fixture_makes_x_and_y_unknown_and_keeps_z(self):
        # 3
        r = probe("e_rotated")
        self.assertEqual((r["rapid_ustart"], r["rapid_dep"]), ([1, 0], [4, 0]))

    def test_an_incremental_move_keeps_the_axis_dependent(self):
        # 4: start + delta
        r = probe("e_g91")
        self.assertEqual(r["rapid_dep"], [7, 5])

    def test_g28_and_g30_legs(self):
        # 5: no words — all at home; Z10 — the intermediate and Z home known,
        # X/Y dependent; G91 Z0 (Fusion) — the intermediate is where Z
        # stands, home makes it known; G30 X5 Y5 — Z dependent throughout
        self.assertEqual(probe("e_g28_none")["rapid_dep"], [7, 0])
        r = probe("e_g28_z")
        self.assertEqual((r["rapid"], r["rapid_dep"]), ([[0, 0, 10], [0, 0, 3]], [3, 3]))
        self.assertEqual(probe("e_g28_g91_z0")["rapid_dep"], [7, 3])
        r = probe("e_g30_xy")
        self.assertEqual((r["rapid"], r["rapid_dep"]), ([[5, 5, 0], [10, 20, 0]], [4, 4]))

    def test_a_later_unknown_start_is_never_dependent(self):
        # 6: the M6 at a tool change position after the beginning
        r = probe("e_m6_tc")
        self.assertEqual(r["rapid_ustart"], [1, 1])
        self.assertIsNone(r["rapid_dep"], "no bit set anywhere")

    def test_the_word_not_the_value(self):
        # 7: G0 X0 at a believed X0 commands X
        self.assertEqual(probe("e_g0x0")["rapid_dep"], [6])

    def test_a_g43_and_a_fixture_switch_carry_the_mask(self):
        # 8: the relabel vertex keeps the mask (Δ unchanged)
        r = probe("e_g43_fixture")
        self.assertEqual(r["rapid_brk"], [0, 1, 0, 0])
        self.assertEqual(r["rapid_dep"], [6, 6, 6, 4])

    def test_a_g92_from_a_dependent_axis_is_unknown_to_the_end(self):
        # 9 (E6)
        r = probe("e_g92")
        self.assertEqual((r["rapid_ustart"], r["stale_offset_lines"]), ([1, 1, 1], [3]))

    def test_a_world_labeling_at_the_start_is_unknown(self):
        # 13: TCP (type 1) — no per-axis translation
        r = probe("e_world_start")
        self.assertEqual(r["rapid_ustart"], [1, 1])
        self.assertIsNone(r["rapid_dep"])

    def test_an_arc_outside_its_plane_keeps_the_mask_and_decimates_alike(self):
        # 15 (b): Z dependent through an XY arc — the same points as with Z
        # known (no anchor inside one mask)
        a, b = probe("e_arc_dep"), probe("e_arc_known")
        self.assertEqual(len(a["feed"]), len(b["feed"]))
        self.assertEqual(set(a["feed_dep"]), {4})
        self.assertIsNone(b["feed_dep"])

    def test_an_arc_in_a_plane_with_a_dependent_axis_is_unknown(self):
        r = probe("e_arc_plane_dep")
        self.assertEqual((r["rapid_ustart"][:2], r["rapid_dep"]), ([1, 1], [2, 0]))
        self.assertEqual(r["feed"], [], "never drawn shifted")

    def test_a_track_dependent_to_its_end(self):
        # 18: K = n
        self.assertEqual(probe("e_all_dep")["rapid_dep"], [7, 7])


class TestCodexR132(unittest.TestCase):
    """Codex R132's counterexamples to E1 (VP-I78..VP-I82)."""

    def test_a_read_before_the_first_callback(self):
        # VP-I78: the call-less lines from the program's first line to its
        # first callback are judged under the start's dependence — a numeric
        # and a named read, after a modal preamble, with modal words in the
        # line, after a blank line, in a `%` file; the read in the first
        # motion line as the control
        for case, line in (("e_read_first", 1), ("e_read_first_named", 1), ("e_read_first_modal", 2),
                           ("e_read_first_same", 1), ("e_read_first_blank", 2), ("e_read_first_pct", 2),
                           ("e_read_first_motion", 1)):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual(r["position_read_lines"], [line], case)
            self.assertEqual(r["rapid_ustart"], [1, 1], f"{case}: unknown to the end")
            self.assertIsNone(r["rapid_dep"], case)

    def test_an_early_tool_change_leaves_no_start_mask(self):
        # VP-I79: after the M6 at a tool change position X, Y are unknown,
        # never start-dependent as well; the point before keeps its mask
        r = probe("e_m6_early")
        self.assertEqual((r["rapid_dep"], r["rapid_ustart"]), ([3], [1, 1, 1]))
        r = probe("e_m6_first")
        self.assertEqual((r["rapid_dep"], r["rapid_ustart"]), (None, [1, 1]))

    def test_no_interpreter_words_is_an_unknown_start(self):
        # VP-I80 (injected): no known path, the reason on the wire
        r = probe("e_no_interp")
        self.assertEqual((r["start_dep_unavailable"], r["rapid_dep"], r["rapid_ustart"]),
                         ("interpreter", None, [1, 1]))
        r = probe("e_with_interp")
        self.assertEqual((r["start_dep_unavailable"], r["rapid_dep"], r["rapid_ustart"]), (None, [3, 2], [1, 0]))

    def test_writes_in_a_beginning_out_of_order_are_named(self):
        # R132 point 8, by existence since Codex R133 VP-I88: a call into
        # another file is followed — one that stores nothing raises no flag,
        # a beginning or not
        self.assertIsNone(probe("e_foreign_known_start")["start_writes_untracked"])
        r = probe("e_foreign_dep_start")
        self.assertIsNone(r["start_writes_untracked"])
        self.assertEqual(r["rapid_dep"][0], 3)

    def test_an_unknown_kinematics_type_is_never_identity(self):
        # VP-I81: a switchable kinematics whose live type was not read — out
        # of scope; its type 0 confirmed, and a machine that cannot switch
        self.assertEqual((probe("e_kins_unknown")["rapid_dep"], probe("e_kins_unknown")["rapid_ustart"]),
                         (None, [1, 1]))
        self.assertEqual(probe("e_kins_zero")["rapid_dep"], [3, 2])
        self.assertEqual(probe("e_kins_fixed")["rapid_dep"], [3, 2])


class TestCodexR133(unittest.TestCase):
    """Codex R133's counterexamples on the worker side (VP-I84, VP-I88)."""

    def test_a_first_point_with_an_unknown_axis_is_unbound(self):
        # VP-I84: a tool change at a position no parse sees, a world
        # labeling, a rotated frame before the first move — X, Y or Z unknown
        # at the first point: no start can be bound there
        for case, axes in (("r133_m6_before_first", [0, 1, 2]), ("r133_world_before_first", [0, 1, 2]),
                           ("e_rotated", [0, 1])):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual(r["start_unbound"], axes, case)
        # Codex R134: the first move's XYZ end commanded whole after such a
        # tool change — no mask (nothing after it depends on the start), the
        # first point an unknown start, and still unbound
        for case, ustart in (("r134_m6_first_absolute", [1, 0]), ("r134_m6_only_absolute", [1])):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual((r["start_unbound"], r["rapid_dep"], r["rapid_ustart"]), ([0, 1, 2], None, ustart), case)
        # a G43 or a fixture switch before the first move is no unknown axis
        for case in ("e_single", "r133_g43_before_first", "r133_g55_before_first", "r133_first_g1_xyz"):
            self.assertIsNone(probe(case)["start_unbound"], case)

    def test_a_stored_position_is_named_by_existence(self):
        # VP-I88: a value stored from the position where no canon call shows
        # it — an inline sub's G30.1 before the first absolute XYZ, a called
        # file's G30.1, a remap body's G28.1 — raises the flag, wherever it
        # runs: the control that stores only after X, Y, Z are known too (the
        # named limit: existence, not timing)
        for case in ("r133_store_before_first_absolute", "r133_untracked_writes", "r133_store_after_known_control",
                     "r133_foreign_write", "r133_remap_write"):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertIs(r["start_writes_untracked"], True, case)
        # a sub, a file or a body that stores nothing, or writes explicit
        # values: none
        for case in ("r133_inline_no_write", "r133_inline_explicit_write", "r133_remap_no_write",
                     "e_foreign_known_start", "e_single", "m600_known"):
            self.assertIsNone(probe(case)["start_writes_untracked"], case)


class TestPosWrites(unittest.TestCase):
    """RemapEnv.pos_writes (Codex R133 VP-I88): which texts may store the
    position where no canon call shows it — own lines, called files, remap
    bodies, hooks."""

    def _env(self, remaps, files):
        import shutil
        import tempfile
        d = tempfile.mkdtemp(prefix="poswrites-")
        self.addCleanup(shutil.rmtree, d, True)
        for name, text in files.items():
            Path(d, name).write_bytes(text if isinstance(text, bytes) else text.encode())
        return gateway_util.RemapEnv(remaps, [d])

    def test_own_lines(self):
        env = self._env([], {})
        self.assertTrue(env.pos_writes("G0 X0\nG30.1\n"))
        self.assertFalse(env.pos_writes("G0 X0\nG30.1\n", own=False))
        self.assertFalse(env.pos_writes("G10 L2 P1 X1 Y2\nG92.1\nG52 X0\n"))
        self.assertTrue(env.pos_writes("G10 L20 P1 X0\n"))

    def test_a_called_file_is_followed(self):
        env = self._env([], {"w.ngc": "o<w> sub\nG28.1\no<w> endsub\n", "n.ngc": "o<n> sub\nG0 X1\no<n> endsub\n"})
        self.assertTrue(env.pos_writes("o<w> call\n", own=False))
        self.assertFalse(env.pos_writes("o<n> call\n", own=False))
        self.assertTrue(env.pos_writes("o<gone> call\n", own=False))      # not found: may
        self.assertTrue(env.pos_writes("M98 P100\n", own=False))           # an M98: may

    def test_a_remap_body_and_a_hook(self):
        env = self._env(["M200 modalgroup=10 ngc=w", "M201 modalgroup=10 python=m201py"],
                        {"w.ngc": "o<w> sub\nG30.1\no<w> endsub\n"})
        self.assertTrue(env.pos_writes("G0 X0\nM200\n", own=False))
        self.assertTrue(env.pos_writes("G0 X0\nM201\n", own=False))       # a hook not bound: may
        env.python_reads = {"m201py": frozenset()}
        self.assertFalse(env.pos_writes("G0 X0\nM201\n", own=False))      # bound as reviewed

    def test_the_marked_routine_stores_nothing_here(self):
        # the suite's routine (by content): its writes follow its reads (E4)
        routine = (ROOT / "subroutines" / "tool_length_probe" / "tool_touch_off.ngc").read_bytes()
        env = self._env(["M600 modalgroup=6 ngc=tool_touch_off"], {"tool_touch_off.ngc": routine})
        self.assertFalse(env.pos_writes("T1 M600\n", own=False))
        env = self._env(["M600 modalgroup=6 ngc=tool_touch_off"], {"tool_touch_off.ngc": routine + b"\n"})
        self.assertTrue(env.pos_writes("T1 M600\n", own=False))


class TestTimeBasis(unittest.TestCase):
    """E7 / E8 (VP122-02): the kind and the time basis of each move ending in
    the beginning; the first G1 keeps its F."""

    def test_the_f_of_each_move_rides_the_wire(self):
        a, b = probe("e_time_a"), probe("e_time_b")
        self.assertEqual((a["rapid_dep_basis"], a["rapid_dep_f"], a["feed_dep_f"]), ([2], [100.0], [200.0]))
        self.assertEqual((b["rapid_dep_f"], b["feed_dep_f"]), ([200.0], [100.0]))

    def test_a_first_g1_is_an_endpoint_with_its_feed(self):
        r = probe("e_first_g1")
        self.assertEqual((r["rapid"], r["rapid_ustart"], r["feed"]), ([[0, 0, 0]], [1], []))
        self.assertEqual((r["rapid_dep_basis"], r["rapid_dep_f"]), ([2], [100.0]))

    def test_inverse_time_and_per_revolution_say_unknown(self):
        self.assertEqual(probe("e_g93")["rapid_dep_basis"], [3])
        r = probe("e_g95")
        self.assertIsNone(r["parse_error"])
        self.assertEqual(r["rapid_dep_basis"], [3])


class TestLimits(unittest.TestCase):
    """E7: a dependent axis gives no limit verdict; a known one does."""

    def test_a_dependent_axis_beyond_a_limit_is_no_record(self):
        self.assertEqual(probe("e_limit_dep")["violations"], [])

    def test_a_known_axis_beyond_a_limit_is(self):
        self.assertEqual(probe("e_limit_known")["violations"],
                         [{"line": 2, "axis": "X", "value": 600.0, "limit": 500.0, "kind": "max",
                           "runs": [[1, 1]], "nruns": 1}])

    def test_nan_reads_false_in_both_checkers(self):
        nan = float("nan")
        segs = [(1, (nan, 0, 0) + (0,) * 6, (600.0, 0, 0) + (0,) * 6, (0, 0, 0)),
                (2, (600.0, 0, 0) + (0,) * 6, (nan, 0, 0) + (0,) * 6, (0, 0, 0))]
        lim = {"X": (-500.0, 500.0)}
        want = ([{"line": 1, "axis": "X", "value": 600.0, "limit": 500.0, "kind": "max"}], 1)
        self.assertEqual(gateway_util.check_limit_violations(segs, lim), want)
        self.assertEqual(gateway_util._check_limit_violations_scalar(segs, lim), want)
        self.assertEqual(gateway_util.segment_outside_flags(segs, lim).tolist(), [True, False])

    def test_dep_nan(self):
        p = (1.0, 2.0, 3.0, 4.0)
        self.assertEqual(gateway_util.dep_nan(p, 0), p)
        q = gateway_util.dep_nan(p, 5)
        self.assertTrue(math.isnan(q[0]) and math.isnan(q[2]))
        self.assertEqual((q[1], q[3]), (2.0, 4.0))
        self.assertIsNone(gateway_util.dep_nan(None, 7))
        self.assertEqual(gateway_util.dep_nan((None, 1.0, 2.0), 1), (None, 1.0, 2.0))


class TestPositionReads(unittest.TestCase):
    """E4: a value read from the position while the axis it reads depends on
    the start or is unknown — every axis unknown to the end."""

    def test_reads_in_the_main_text(self):
        # 10: a line of its own, the line with the move, a name — the axis
        # dependent; the same with it known; an inline sub that may read
        for case, line in (("e_read_dep", 3), ("e_read_same_line", 3), ("e_read_named", 3)):
            r = probe(case)
            self.assertEqual((r["position_read_lines"], r["rapid_ustart"]), ([line], [1, 1]), case)
            self.assertEqual(len(r["rapid_dep"]), 1, f"{case}: unknown to the end outranks dependent")
            self.assertEqual([row[2] for row in r["probe_unpredicted"]], ["position_read"], case)
        r = probe("e_read_known")
        self.assertEqual((r["position_read_lines"], r["rapid_ustart"]), (None, [1, 0]))
        self.assertEqual(probe("e_read_inline")["position_read_lines"], [0])

    def test_a_remap_body_that_reads(self):
        # 12 (ordered)
        self.assertEqual(probe("e_remap_read")["position_read_lines"], [3])
        self.assertIsNone(probe("e_remap_read_known")["position_read_lines"])

    def test_a_bound_python_reader_of_the_rotaries(self):
        # 12a: rotaries never depend on the start — no read
        r = probe("e_py_rotary_known")
        self.assertEqual(r["python_reads"], ["python remap reads: bound g683; every axis: none"])
        self.assertEqual((r["position_read_lines"], r["rapid_ustart"]), (None, [1, 0]))
        # 12b / 12d: a six-value tool change position makes A unknown — the
        # read is a guess, and a later absolute A move does not undo it
        r = probe("e_py_rotary_tc6")
        self.assertEqual(r["position_read_lines"], [5])
        self.assertEqual(set(r["rapid_ustart"]), {1})
        # 12c: XYZ only — A stays known
        r = probe("e_py_rotary_tc3")
        self.assertIsNone(r["position_read_lines"])
        self.assertEqual(r["rapid_ustart"][-1], 0)
        # out of order: harmless unless a rotary may become unknown
        self.assertIsNone(probe("e_py_rotary_inline_tc3")["position_read_lines"])
        self.assertEqual(probe("e_py_rotary_inline_tc6")["position_read_lines"], [0])

    def test_an_unbound_python_body_reads_every_axis(self):
        r = probe("e_py_unbound")
        self.assertEqual(r["python_reads"], ["python remap reads: bound none; every axis: g683"])
        self.assertEqual(r["position_read_lines"], [3])

    def test_the_reader(self):
        f = gateway_util.position_reads_norm
        n = gateway_util.nc_norm
        self.assertEqual(f(n("#1 = #5420")), frozenset({0}))
        self.assertEqual(f(n("G0 X[#5422 + 1]")), frozenset({2}))
        self.assertEqual(f(n("#1 = #<_y> + #<_abs_z>")), frozenset({1, 2}))
        self.assertEqual(f(n("#1 = # 5 4 2 3")), frozenset({3}))
        self.assertEqual(f(n("#1 = #5420.00001")), frozenset({0}))
        self.assertEqual(f(n("#1 = #+5421")), frozenset({1}))
        self.assertIsNone(f(n("#1 = #[5420]")))
        self.assertIsNone(f(n("#1 = ##2")))
        self.assertEqual(f(n("(LOG, #5420) G0 X1")), frozenset())
        self.assertEqual(f(n("#1 = #5419 + #5429")), frozenset())
        self.assertEqual(f(n("o100 if [#<_x> GT 0]")), frozenset({0}))


class TestTheRoutine(unittest.TestCase):
    """E4: the bundled routine marks its own reads."""

    def test_the_return_takes_the_saved_state(self):
        # 11: #3106 = 1 — after the measurement X/Y are dependent again, to
        # the end (the program never commands them); #3106 = 0 — the setter
        # position stays known. The trip point and offset_z read known axes:
        # the measurement is predicted in both. The last two feeds: the drive
        # free G53 Z0 above the setter (X/Y known) and the ONE return move to
        # the saved X/Y at the top (dependent again) — Z stays up since
        # 2026-11-05, the second return move (to the start Z) is gone.
        r = probe("e_m600_return")
        self.assertEqual(r["rapid_dep"], [3, 3, 0, 3])
        self.assertEqual(r["feed_dep"][-2:], [0, 3])
        self.assertIsNotNone(r["toollen_table"])
        r = probe("e_m600_no_return")
        self.assertEqual(r["rapid_dep"], [3, 3])
        self.assertIsNotNone(r["toollen_table"])

    def test_every_read_of_the_routine_carries_its_marker(self):
        text = ROUTINE.read_text()
        self.assertEqual(gateway_util.unmarked_position_reads(text), [])
        self.assertIn(hashlib.sha256(ROUTINE.read_bytes()).hexdigest(), gateway_util.MARKED_POS_ROUTINES,
                      "the routine changed: check its reads, then pin the new sha256")

    def test_a_routine_that_differs_reads_for_the_text(self):
        env = gateway_util.RemapEnv([], [str(ROUTINE.parent)])
        self.assertEqual(env.text_reads("o<tool_touch_off> call\n"), frozenset())
        env = gateway_util.RemapEnv([], [str(ROUTINE.parent)])
        env.marked_files = frozenset()
        self.assertEqual(env.text_reads("o<tool_touch_off> call\n"), frozenset(range(9)))

    def test_the_markers(self):
        f = gateway_util.parse_pos_marker
        self.assertEqual(f("WEBUI_POS_SAVE"), ("save", None))
        self.assertEqual(f(" webui_pos_return "), ("return", None))
        self.assertEqual(f("WEBUI_POS_READ=XYZ"), ("read", frozenset({0, 1, 2})))
        self.assertEqual(f("WEBUI_POS_READ=A"), ("read", frozenset({3})))
        self.assertIsNone(f("WEBUI_POS_READ=Q"))
        self.assertIsNone(f("WEBUI_POS"))


class _Interp:
    """The interpreter's words for one callback (blocks[0] flags, modes)."""

    def __init__(self, words="", g0=-1, g1=0, dist=0):
        b = types.SimpleNamespace(x_flag="X" in words, y_flag="Y" in words, z_flag="Z" in words,
                                  g_modes=[g0, g1])
        self.this = types.SimpleNamespace(blocks=[b], distance_mode=dist, feed_mode=0)


@unittest.skipUnless(_HAVE_RS274, "rs274 (LinuxCNC python) not importable")
class TestTheCanonUnits(unittest.TestCase):
    """E2 cases the native interpreter does not produce on demand."""

    def _canon(self):
        c = object.__new__(gcode_canon.PreviewCanon)
        c.stale = frozenset()
        c.dep = frozenset((0, 1, 2))
        c._frame_unknown = frozenset()
        c.kins_events = []
        c.start_kins_type = 0
        c.rotation_xy = 0.0
        c.plane = 1
        c._block_moves = 0
        c._internal_move = False
        c._pos_return = 0
        c._pos_saved = None
        c.ever_stale = False
        return c

    def _step(self, c, **kw):
        t = _Interp(**kw).this
        c.interp = lambda: t
        return c._dep_step("traverse")

    def test_a_third_callback_of_a_g28_is_never_the_stored_position(self):
        # 17 (Codex R122): leg 3 of one block — the dependent axes unknown
        c = self._canon()
        self._step(c, g0=280)                       # leg 1, no words
        self._step(c, g0=280)                       # leg 2: home, all known
        self.assertEqual(c.dep, frozenset())
        c = self._canon()
        self._step(c, words="Z", g0=280)            # leg 1: Z known
        self._step(c, words="Z", g0=280)            # leg 2: Z home
        self._step(c, words="Z", g0=280)            # leg 3: unknown
        self.assertEqual((c.dep, c.stale), (frozenset(), frozenset({0, 1})))

    def test_a_g28_or_g30_leg_as_a_feed_is_never_the_stored_position(self):
        # VP-I82: the second callback a feed — the dependent axes unknown
        for g0 in (280, 300):
            c = self._canon()
            t = _Interp(g0=g0).this
            c.interp = lambda t=t: t
            c._dep_step("traverse")                 # leg 1: no words, nothing known
            c._dep_step("feed")                     # leg 2 as a feed
            self.assertEqual((c.dep, c.stale), (frozenset(), frozenset({0, 1, 2})), g0)
            c = self._canon()
            c.interp = lambda t=t: t
            c._dep_step("feed")                     # leg 1 as a feed
            self.assertEqual(c.stale, frozenset({0, 1, 2}), g0)
        c = self._canon()
        t = _Interp(g0=280).this
        c.interp = lambda: t
        c._dep_step("traverse")
        c._dep_step("traverse")                     # the supported pair: home, all known
        self.assertEqual((c.dep, c.stale), (frozenset(), frozenset()))

    def test_unknown_axes_leave_the_start_mask(self):
        # VP-I79: dep ∩ stale stays empty wherever an axis becomes unknown
        c = self._canon()
        c._to_stale({0, 2})
        self.assertEqual((c.dep, c.stale), (frozenset({1}), frozenset({0, 2})))

    def test_the_return_never_lifts_unknown_to_the_end(self):
        # 18 (b): RETURN after an axis became unknown for good
        c = self._canon()
        c._pos_saved = {0: "dep", 1: "dep", 2: "known"}
        c._pos_return = 2
        c._frame_unknown = frozenset({0})
        c.dep = frozenset()
        self._step(c, words="XY", g1=10)
        self.assertEqual((c.dep, 0 in c.stale), (frozenset({1}), True))
        self._step(c, words="Z", g1=10)
        self.assertEqual((c.dep, c._pos_return), (frozenset({1}), 0))

    def test_a_save_while_unknown_returns_unknown(self):
        c = self._canon()
        c._pos_saved = {0: "stale", 1: "known", 2: "known"}
        c._pos_return = 2
        c.dep = frozenset()
        self._step(c, words="XY", g1=10)
        self.assertEqual((c.dep, c.stale), (frozenset(), frozenset({0})))


class _AtTheCallback:
    """The interpreter at a motion callback: the block commands X only
    (absolutely), and the position it holds — in its own length unit
    (CANON_UNITS_INCHES 1, _MM 2), cutter compensation (side, radius)."""

    def __init__(self, cur=(0.0, 0.0, 0.0), units=2, comp=(0, 0.0)):
        self.blocks = [types.SimpleNamespace(x_flag=True, y_flag=False, z_flag=False, g_modes=[-1, 0])]
        self.distance_mode, self.feed_mode = 0, 0
        self.current_x, self.current_y, self.current_z = cur
        self.length_units = units
        self.cutter_comp_side, self.cutter_comp_radius = comp


@unittest.skipUnless(_HAVE_RS274, "rs274 (LinuxCNC python) not importable")
class TestTheReadBelongsToTheFirstPoint(unittest.TestCase):
    """P6-a (machine-day F9, Codex R457): the believed start is read in the
    motion callback that records the program's FIRST point — the proof
    belongs to exactly that callback; no read is no believed start and X, Y,
    Z unbound, never a guess. The canon under G54 (100, 200, −30) mm."""

    G54 = (100 / 25.4, 200 / 25.4, -30 / 25.4)

    def _canon(self, t):
        c = object.__new__(gcode_canon.PreviewCanon)
        c.feed, c.rapid, c.unknown_start = [], [], []
        c.seq, c.lineno, c.lo, c.first_move, c.suppress, c.feedrate = 0, -1, (0.0,) * 9, True, 0, 1.0
        c.basis_at_start, c.wcs_used, c._last_motion_g5x = None, [], None
        c.wcs_events, c._last_wcs_basis = [], None
        c.sub_events, c.tlo_events, c.offset_events, c.cur_tool = [], [], [], -1
        c.xo = c.yo = c.zo = c.ao = c.bo = c.co = c.uo = c.vo = c.wo = 0.0
        c.g5x_index, c.plane, c.arcdivision, c.arc_dist, c.arc_moves = 1, 1, 8, 0.0, 0
        c.rotation_cos, c.rotation_sin = 1.0, 0.0
        c.kins_events, c.dep_seg, c.dep_time = [], {}, {}
        for k in c._WCS_SUFFIXES:                 # floats: gcode.arc_to_segments parses them
            setattr(c, "g5x_offset_" + k, 0.0)
            setattr(c, "g92_offset_" + k, 0.0)
        c.g5x_offset_x, c.g5x_offset_y, c.g5x_offset_z = self.G54
        c.interp = lambda: t
        return c

    def _begin(self, c):
        c.next_line(types.SimpleNamespace(sequence_number=1))
        self.assertTrue(c._program_started)

    def _close(self, a, b, msg=None):
        self.assertIsNotNone(a, f"{msg}: no believed start")
        self.assertEqual(len(a), len(b), msg)
        for x, y in zip(a, b):
            self.assertAlmostEqual(x, y, places=12, msg=msg)

    def test_the_first_point_s_own_callback_reads(self):
        # each motion entry gcodemodule calls (gcodemodule.cc STRAIGHT_TRAVERSE,
        # STRAIGHT_FEED, STRAIGHT_PROBE, ARC_FEED, RIGID_TAP): program zero of
        # G54 at its point is the start, in the canon's inch
        # (an arc in the plane of a dependent axis and a tap hand those axes
        # to `stale` — unbound for their own reason, the read stands)
        for name, call, unbound in (
                ("traverse", lambda c: c.straight_traverse(1, 0, 0, 0, 0, 0, 0, 0, 0), ()),
                ("feed", lambda c: c.straight_feed(1, 0, 0, 0, 0, 0, 0, 0, 0), ()),
                ("probe", lambda c: c.straight_probe(1, 0, 0, 0, 0, 0, 0, 0, 0), ()),
                ("arc", lambda c: c.arc_feed(1, 0, 0.5, 0, 1, 0, 0, 0, 0, 0, 0, 0), (0, 1)),
                ("tap", lambda c: c.rigid_tap(0, 0, -1), (0, 1, 2))):
            c = self._canon(_AtTheCallback())
            self._begin(c)
            # the arc's segments as gcode.arc_to_segments hands them to
            # straight_arcsegments — inside the arc's own callback
            with mock.patch.object(gcode_canon.ArcsToSegmentsMixin, "arc_feed",
                                   lambda self, *a: self.straight_arcsegments([(1.0,) + (0.0,) * 8])):
                call(c)
            self.assertGreater(c.seq, 0, name)
            self._close(c.start_lo, self.G54, name)
            self.assertEqual(c.start_unbound, unbound, name)
            self.assertIsNone(c._start_proof, f"{name}: the read ends with its callback")

    def test_a_recorder_no_handler_covers_finds_no_read(self):
        # fail closed in ONE place: the first point recorded outside a
        # handler that read (here the stale path's recorder called bare)
        c = self._canon(_AtTheCallback())
        self._begin(c)
        c._unknown_move((0.0,) * 9)
        self.assertEqual((c.seq, c.start_lo, c.start_unbound), (1, None, (0, 1, 2)))

    def test_a_callback_that_records_nothing_leaves_no_read(self):
        # a suppressed traverse, an arc of no segments: their callback ends,
        # and a later recorder that did not read finds nothing (Codex R457)
        c = self._canon(_AtTheCallback())
        self._begin(c)
        c.suppress = 1
        c.straight_traverse(1, 0, 0, 0, 0, 0, 0, 0, 0)
        c.suppress = 0
        self.assertEqual((c.seq, c._start_proof), (0, None))
        with mock.patch.object(gcode_canon.ArcsToSegmentsMixin, "arc_feed",
                               lambda self, *a: self.straight_arcsegments([])):
            c.arc_feed(1, 0, 0.5, 0, 1, 0, 0, 0, 0, 0, 0, 0)
        self.assertEqual((c.seq, c._start_proof), (0, None))
        c._unknown_move((0.0,) * 9)
        self.assertEqual((c.start_lo, c.start_unbound), (None, (0, 1, 2)))

    def test_no_read_is_no_believed_start(self):
        # the cutter-compensation queue (its callback runs in a LATER block),
        # a unit gcodemodule does not convert (CANON_UNITS_CM 3, or none), a
        # value not read or not finite, no interpreter words, no program yet
        for why, t in (("comp queue", _AtTheCallback(comp=(1, 0.1))),
                       ("centimetres", _AtTheCallback(units=3)),
                       ("no unit", _AtTheCallback(units=0)),
                       ("not finite", _AtTheCallback(cur=(float("nan"), 0.0, 0.0))),
                       ("not a number", _AtTheCallback(cur=("x", 0.0, 0.0))),
                       ("no words", None)):
            c = self._canon(t)
            self._begin(c)
            c.straight_traverse(1, 0, 0, 0, 0, 0, 0, 0, 0)
            self.assertEqual((c.seq, c.start_lo, c.start_unbound), (1, None, (0, 1, 2)), why)
        t = _AtTheCallback()
        del t.current_y
        c = self._canon(t)
        self._begin(c)
        c.straight_traverse(1, 0, 0, 0, 0, 0, 0, 0, 0)
        self.assertEqual((c.start_lo, c.start_unbound), (None, (0, 1, 2)), "no position word")
        # a comp side with radius 0 queues nothing (interp_convert.cc 4812)
        c = self._canon(_AtTheCallback(comp=(1, 0.0)))
        self._begin(c)
        c.straight_traverse(1, 0, 0, 0, 0, 0, 0, 0, 0)
        self._close(c.start_lo, self.G54, "radius 0: read")
        # before the program's begin no callback reads (an initcode's motion)
        c = self._canon(_AtTheCallback())
        c.next_line(types.SimpleNamespace(sequence_number=0))
        self.assertIsNone(c._start_read())

    def test_the_interpreter_s_unit_and_the_start_tool_basis(self):
        # G20: inches pass through; G21: millimetres divided by 25.4 as
        # gcodemodule divides them — then into the canon frame by the canon's
        # own rotate_and_translate
        c = self._canon(_AtTheCallback(cur=(1.0, 2.0, 3.0), units=1))
        self._begin(c)
        c.straight_traverse(1, 0, 0, 0, 0, 0, 0, 0, 0)
        self._close(c.start_lo, (self.G54[0] + 1, self.G54[1] + 2, self.G54[2] + 3), "inch")
        c = self._canon(_AtTheCallback(cur=(25.4, 50.8, -25.4), units=2))
        self._begin(c)
        c.straight_traverse(1, 0, 0, 0, 0, 0, 0, 0, 0)
        self._close(c.start_lo, (self.G54[0] + 1, self.G54[1] + 2, self.G54[2] - 1), "mm")
        # a tool offset set before the first point (G43.1 Z10 on its own
        # line): the interpreter's position re-expressed by it, the start
        # re-based to the offset at the program's begin — machine Z unchanged
        t = _AtTheCallback()
        c = self._canon(t)
        self._begin(c)
        c.tool_offset(0, 0, 10 / 25.4, 0, 0, 0, 0, 0, 0)
        t.current_z = -10.0                       # convert_tool_length_offset re-expresses current_z
        c.straight_traverse(1, 0, 0, 0, 0, 0, 0, 0, 0)
        self._close(c.start_lo, self.G54, "re-based to the begin's tool offset")
        self.assertEqual(c._start_tlo, (0.0, 0.0, 0.0))

    def test_every_recorder_is_named(self):
        # The methods that record a point (call _next_seq) are these five,
        # reached only from the four motion entries gcodemodule calls — each
        # reads at its top. A new recorder fails here until it is covered by
        # a read (or it records no first point: fail closed anyway).
        tree = ast.parse(Path(gcode_canon.__file__).read_text())
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "PreviewCanon")
        calls = lambda f, name: any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                                    and n.func.attr == name for n in ast.walk(f))
        fns = {f.name: f for f in cls.body if isinstance(f, ast.FunctionDef)}
        self.assertEqual(sorted(n for n, f in fns.items() if calls(f, "_next_seq")),
                         ["_straight_arcsegments", "_straight_traverse", "_unknown_move", "rigid_tap", "straight_feed"])
        self.assertEqual(sorted(n for n, f in fns.items() if calls(f, "_start_read")),
                         ["arc_feed", "rigid_tap", "straight_feed", "straight_traverse"])
        self.assertIs(gcode_canon.PreviewCanon.straight_probe, gcode_canon.PreviewCanon.straight_feed)


_G55 = [-200.0, -200.0, 30.0]       # Codex's frame: G54 (100, 200, −30) in G55 (300, 400, −60)


class TestTheBelievedStartUnderFixtures(unittest.TestCase):
    """P6-a (machine-day F9, plan maschinentag.r457.p6a-plan-v3.md guards
    8–10, Codex R456/R457) natively: `start_believed` is the interpreter's
    position at the program's FIRST point in that point's frame (the first
    point's epoch, the start tool basis) — with fixtures that are not zero,
    where the canon's initial `lo` (machine zero) was a whole fixture off. Each
    `_rot` twin runs on an XYZA machine (the rotary sync initcode: right before
    except after a resync or from the comp queue)."""

    def believed(self, case, want, places=9):
        r = probe(case)
        self.assertIsNone(r["parse_error"], case)
        got = r["start_believed"]
        self.assertIsNotNone(got, case)
        for k, (g, w) in enumerate(zip(got, want)):
            self.assertAlmostEqual(g, w, places=places, msg=f"{case} {'XYZ'[k]}: {got}")
        return r

    def test_a_frame_change_before_the_first_motion(self):
        # Codex R456 MT456-01 and its shapes: G55 on its own line, in the
        # move's block, after a preamble G90, from an inline O-call; the
        # interpreter's start (program zero of G54) in G55's frame — on the
        # XYZ machine before: (−300, −400, 60) (machine 0); v2's read at the
        # begin: (−400, −400, 60) (the interpreter already in G55, the canon
        # still in G54)
        for case in ("g55_first", "g55_with_move", "g55_preamble", "ocall_g55", "g43h_g55_move", "cx_feed_g55",
                     "g28_first_g55", "arc_first_g55", "tap_first_g55", "cx_cycle_g55"):
            for c in (case, case + "_rot") if case != "cx_feed_g55" and not case.startswith("cx_") else (case,):
                self.believed(c, _G55)
        # a rotated G54 (R30) with a stored G92 (7, 9) as the init frame
        for c in ("rot_g92_to_g55", "rot_g92_to_g55_rot"):
            self.believed(c, [100 + 7 * math.cos(math.pi / 6) - 9 * 0.5 - 300 - 7,
                              200 + 7 * 0.5 + 9 * math.cos(math.pi / 6) - 400 - 9, 30.0])
        # a G10 L2 on the active fixture before the first move: G54 written
        # (50, 70, −9) — the start, where G54 was, in the written frame
        self.believed("cx_g10_active", [50.0, 130.0, -21.0])

    def test_the_interpreter_s_unit(self):
        # a G20 block on a mm machine (the canon's frame is inch either way);
        # an inch machine (G54 (2, 3, −1) in, G55 (4, 5, −2) in) under a G43
        # start of 0.5 in — the start re-based to that start offset
        for c in ("g20_g55", "g20_g55_rot"):
            self.believed(c, _G55)
        for c in ("inch_g43_g55", "inch_g43_g55_rot"):
            self.believed(c, [-2.0, -2.0, 0.5])
        for c in ("inch_g43_start", "inch_g43_start_rot"):
            self.believed(c, [0.0, 0.0, -0.5])
        for c in ("g20_first", "f9_inch_g54"):
            self.believed(c, [0.0, 0.0, 0.0])

    def test_the_tool_offset_before_the_first_point_is_re_based(self):
        # G43.1 Z10 on its own line, G43 H1 in the first block, a G43 start
        # with G49 in the first block, M6 + G43 in one block: the start in the
        # tool basis at the program's begin (scrubTrack buildEntryTrack startTlo)
        for c in ("g43_line_then_x", "g43_line_then_x_rot", "g43_first"):
            self.believed(c, [0.0, 0.0, 0.0])
        for c in ("g43_start_g55", "g43_start_g55_rot", "cx_g49_before"):
            self.believed(c, [-200.0, -200.0, 20.0])
        self.believed("f9_g43_start", [0.0, 0.0, -10.0])
        # the M6's resync restores the position before the block's G43
        # (convert_m before convert_g): 20 mm above it in the start basis
        self.believed("cx_m6_g43", [0.0, 0.0, 20.0])

    def test_the_offline_resync_before_the_first_motion(self):
        # M6 / M61 make the next read take gcodemodule's last endpoint (zero
        # before any): the first point is made of THAT position — on both
        # configs (the rotary one was wrong here before: the init-end start)
        for case in ("m6_after_g55", "m61_after_g55", "m6_first_g43", "m6_first_g43_zero", "inch_m6_first_g43",
                     "m6_first_plain", "m6_after_motion_g55"):
            for c in (case, case + "_rot"):
                self.believed(c, [0.0, 0.0, 0.0])
        self.believed("cx_m61_g91", [0.0, 0.0, 0.0])
        # the TWP heads' shape (a G10 L2 P0, then M6 and G43 in one block)
        self.believed("twp_head_shape_rot", [0.0, 0.0, 80.0])

    def test_the_machine_day_s_head(self):
        # G53 G0 Z0 then the routine: the start at program zero, X and Y
        # dependent at the first point — before: (−238.525, −379.696, 96.75)
        for c in ("mday_head", "mday_head_g30_far", "f9_g53z_only", "f9_m600_first", "f9_g91_first", "f9_g91_bare",
                  "plain"):
            r = self.believed(c, [0.0, 0.0, 0.0])
            self.assertIsNone(r["start_unbound"], c)
        self.assertEqual(probe("mday_head")["rapid_dep"][0], 3, "X and Y dependent at the first point")

    def test_a_python_remap_s_motion_first_is_read_after_the_begin(self):
        # its motion is the program's first callback (line 0): the begin is
        # decided in the handler's _enter — the read after it (M10)
        for c in ("py_motion_first_bound", "py_motion_first_bound_rot"):
            r = self.believed(c, [0.0, 0.0, 0.0])
            self.assertEqual((r["start_unbound"], r["rapid_dep"][0]), (None, 6), c)

    def test_the_comp_queue_gives_no_read(self):
        # the first point's callback runs inside a LATER block — no believed
        # start, X, Y, Z unbound (before: a value, and nothing unbound), also
        # where that block commands X, Y and Z, and through a G40
        for case in ("comp_first_g55", "comp_first", "comp_next_xyz_g55"):
            for c in (case, case + "_rot"):
                r = probe(c)
                self.assertEqual((r["parse_error"], r["start_believed"], r["start_unbound"]), (None, None, [0, 1, 2]), c)
        r = probe("cx_comp_g40")
        self.assertEqual((r["start_believed"], r["start_unbound"]), (None, [0, 1, 2]))

    def test_no_interpreter_words_ship_no_believed_start(self):
        # VP-I80's injection: X, Y, Z unknown from the begin anyway — no
        # meaningless value from `lo` any more
        r = probe("e_no_interp")
        self.assertEqual((r["start_believed"], r["start_unbound"]), (None, [0, 1, 2]))

    def test_the_m600_case_with_g54_z_10(self):
        # the in-tree corpus's one F9 instance (G54 Z = 10, no dependent axis):
        # (0, 0, −10) before
        self.believed("m600_result", [0.0, 0.0, 0.0])

    def test_unbound_stays_unbound(self):
        # a G92 first, a turned frame, an arc, a tap, a canned cycle, a tool
        # change at a position no parse sees and the interpreter's own moves
        # at an M6 (quill-up, G30), a Python body that reads: no start a live
        # pose is bound by — as before
        for c, axes in (("g92_first", [0, 1, 2]), ("g92_first_rot", [0, 1, 2]), ("rotated", [0, 1]),
                        ("arc_first_g55", [0, 1]), ("arc_first_g55_rot", [0, 1]), ("tap_first_g55", [0, 1, 2]),
                        ("tap_first_g55_rot", [0, 1, 2]), ("cx_cycle_g55", [0, 1, 2]),
                        ("m6tc_first_partial", [0, 1, 2]), ("m6tc_first_partial_rot", [0, 1, 2]),
                        ("m6tc_first_partial_zero", [0, 1, 2]), ("m6tc_after_g55", [0, 1, 2]),
                        ("m6tc_after_g55_rot", [0, 1, 2]), ("m6_quill_first_g55", [0, 1, 2]),
                        ("m6_quill_first_g55_rot", [0, 1, 2]), ("m6_g30_first_g55", [0, 1, 2]),
                        ("m6_g30_first_g55_rot", [0, 1, 2]), ("py_motion_first", [0, 1, 2]),
                        ("py_motion_first_rot", [0, 1, 2])):
            self.assertEqual(probe(c)["start_unbound"], axes, c)

    def test_equal_where_it_was_right(self):
        # zero fixtures and the rotary sync without a resync: the value of
        # 4eda3892 (the in-tree corpus' frame; `lo` held the start there)
        # (Codex's rotary counter-case first: green before, red under a read
        # at the program's begin — the guard that keeps the rotary config
        # from getting worse)
        for c, want in (("g55_first_rot", _G55), ("g55_zero", [0.0, 0.0, 0.0]), ("f9_g53z_zero", [0.0, 0.0, 0.0]),
                        ("f9_g53z_rotary", [0.0, 0.0, 0.0]), ("g43_start_g55_rot", [-200.0, -200.0, 20.0]),
                        ("g28_first_g55_rot", _G55), ("e_g53_rdp", [0.0, 0.0, 0.0])):
            self.believed(c, want)


# The payloads P6-a added (scripts/test_fixtures/start_dep_payloads/): the
# client's startDepPayloads.test.ts and the page's start-believed.viewer.spec
# take them through the decode, the entry track and the scene — they prove
# only what the worker under test writes.
BELIEVED_START_PAYLOADS = ("g55_first", "g55_first_rot", "mday_head", "m6_after_g55", "m6_after_g55_rot",
                           "m6_first_g43_zero", "inch_g43_g55", "g20_g55", "g43_line_then_x", "g43h_g55_move",
                           "py_motion_first_bound", "comp_first_g55", "comp_next_xyz_g55")
_PAYLOADS = ROOT / "scripts" / "test_fixtures" / "start_dep_payloads"


def _generator():
    """scripts/gen_start_dep_payloads.py, loaded from its file: its own
    `write_payload` writes each case here — the step that made the committed
    payloads, never a second route that could drift from it."""
    spec = importlib.util.spec_from_file_location("gen_start_dep_payloads", ROOT / "scripts" / "gen_start_dep_payloads.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _payload_difference(committed, fresh):
    """The top-level fields two encoded payloads differ in, each with both
    values (a buffer by its length), the believed start first: what the stale
    fixture would still claim."""
    import msgspec
    a, b = msgspec.msgpack.decode(committed), msgspec.msgpack.decode(fresh)

    def show(v):
        return f"<{len(v)} bytes>" if isinstance(v, bytes) else repr(v)[:120]
    keys = sorted(set(a) | set(b), key=lambda k: (k != "start_believed", k))
    diff = [f"{k}: {show(a.get(k))} -> {show(b.get(k))}" for k in keys if a.get(k) != b.get(k)]
    return "; ".join(diff) or "the same fields, encoded differently"


class TestTheBelievedStartPayloadsAreFresh(unittest.TestCase):
    """The 13 payloads P6-a added, regenerated from the CURRENT worker and
    compared with the committed bytes (Codex R459: "aus dem jeweils geprüften
    Worker erzeugen und vergleichen"). A change of what the parse writes —
    the believed start's generation in gcode_canon.py, the worker, a case's
    data in native_start_probe.py — fails here until the payloads are
    regenerated (scripts/gen_start_dep_payloads.py) and the diff reviewed;
    before, the client and page guards kept passing on the old bytes.

    Bytes, not a digest of the decoded payload: the encoding has nothing that
    varies between runs (no time, no path — the probe's temporary directory
    never reaches it, `file` is fixed; Codex R459 regenerated these 13
    byte-equal in another tree, and 38 of the 39 committed payloads are
    byte-equal at P6-a's head), and bytes are what the client guards read.
    The fixtures were written on the VM (aarch64); another architecture's
    native interpreter may round a last bit differently and fail here — that
    is a real difference of the payload, not a stale fixture, to be read from
    the named fields.

    Out of scope: `e_m600_return.msgpack`, older than P6-a, differs from what
    its case writes today — a known data remnant (Codex R459), not this
    package's; the other 25 older payloads are not guarded here."""

    def test_each_payload_is_what_the_worker_under_test_writes(self):
        gen = _generator()
        self.assertEqual([c for c in BELIEVED_START_PAYLOADS if c not in gen.CASES], [],
                         "a guarded payload the generator no longer writes")
        stale = []
        with tempfile.TemporaryDirectory(prefix="start-dep-fresh-") as tmp:
            for case in BELIEVED_START_PAYLOADS:
                dest = Path(tmp) / f"{case}.msgpack"
                result = gen.write_payload(case, dest)    # a failed run raises: no payload is never "fresh"
                if "skip" in result:
                    raise unittest.SkipTest(result["skip"])
                committed, fresh = (_PAYLOADS / f"{case}.msgpack").read_bytes(), dest.read_bytes()
                if committed != fresh:
                    stale.append(f"{case}: {_payload_difference(committed, fresh)}")
        if stale:
            self.fail(f"{len(stale)} of {len(BELIEVED_START_PAYLOADS)} committed payloads are not what this worker "
                      "writes — regenerate (scripts/gen_start_dep_payloads.py) and review the diff:\n"
                      + "\n".join(stale))


def _shifted(case):
    """`case` with EVERY fixture row G54…G59.3 moved by (100, 200, 0)."""
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    env["START_PROBE_SHIFT"] = "100,200,0"
    p = subprocess.run([sys.executable, str(HERE / "native_start_probe.py"), case],
                       capture_output=True, text=True, timeout=120, env=env, cwd=HERE)
    lines = [ln for ln in p.stdout.splitlines() if ln.startswith("{")]
    if not lines:
        raise AssertionError(f"{case} shifted: rc={p.returncode} {p.stderr[-800:]}")
    return json.loads(lines[-1])


class TestAFixtureTranslationMovesNoBelievedStart(unittest.TestCase):
    """P6-a guard 10, metamorphic: every native_start_probe case once more
    with all fixture rows moved by the same D = (100, 200, 0). The
    interpreter's start (program zero of the fixture in effect) moves with
    them; a program-frame answer must not. `start_believed`, the masks, the
    unknown starts and `start_unbound` stay — except where a program WRITES
    the fixture of its first point absolutely before it (G10 L2): that frame
    does not move, so the start in it moves by D on the written axes. Before
    (the canon's initial `lo`) `start_believed` moved by −D in 390 of the 445
    cases and otherwise in 6 more."""

    # case → the written axes' expected move (+D on each axis the G10 L2 names):
    # `G10 L2 P2 X5 Y6 Z7` / G55, an inline sub's `G10 L2 P1 X1 Y2 Z3`, a
    # remap body's line `G10 L2 P1 X0`, Codex R457's `G10 L2 P1 X50 Y70 Z-9`
    WRITTEN = {"r133_g55_before_first": (100.0, 200.0, 0.0), "r133_inline_explicit_write": (100.0, 200.0, 0.0),
               "r107_body_g92_numbered_like_explicit": (100.0, 0.0, 0.0), "cx_g10_active": (100.0, 200.0, 0.0)}
    # translation variances that are no start's (alike before and after
    # P6-a, measured): an arc's tessellation (its segment count follows the
    # machine-frame radius) and an absolute `G10 L2 P1 X0` after an unknown
    # start (the moves after it change shape under D)
    VARIES = {"e_arc_dep": {"feed_dep"}, "r108_explicit_alone": {"rapid_ustart"},
              "r109_py_explicit_alone": {"rapid_ustart"}, "r109_py_line4_explicit_alone": {"rapid_ustart"}}

    def test_every_case(self):
        from concurrent.futures import ThreadPoolExecutor
        env = dict(os.environ)
        env.pop("PYTHONPATH", None)
        cases = json.loads(subprocess.run([sys.executable, str(HERE / "native_start_probe.py"), "--list"],
                                          capture_output=True, text=True, env=env, cwd=HERE, check=True).stdout)
        with ThreadPoolExecutor(4) as ex:
            plain = dict(zip(cases, ex.map(probe, cases)))
            moved = dict(zip(cases, ex.map(_shifted, cases)))
        bad = []
        for c in cases:
            a, b = plain[c], moved[c]
            if "skip" in a:
                raise unittest.SkipTest(a["skip"])
            for f in ("parse_error", "start_unbound", "rapid_dep", "feed_dep", "rapid_ustart", "start_dep_unavailable"):
                if a.get(f) != b.get(f) and f not in self.VARIES.get(c, ()):
                    bad.append((c, f, a.get(f), b.get(f)))
            sa, sb = a.get("start_believed"), b.get("start_believed")
            if (sa is None) != (sb is None):
                bad.append((c, "start_believed", sa, sb))
            elif sa is not None:
                d = self.WRITTEN.get(c, (0.0, 0.0, 0.0))
                if any(abs(y - x - dk) > 1e-6 for x, y, dk in zip(sa, sb, d)):
                    bad.append((c, "start_believed", sa, sb))
        self.assertEqual(bad, [], f"{len(bad)} of {len(cases)} cases")


class TestSuitePythonTable(unittest.TestCase):
    """E4a source guards: the table is the graph of the pinned sources."""

    def _graphs(self):
        return {m: gateway_util.py_module_graph((TWP_PY / (m + ".py")).read_bytes(), str(TWP_PY / (m + ".py")))
                for m in gateway_util.SUITE_PY_MODULES}

    def test_the_pins_are_the_shipped_sources(self):
        for m in gateway_util.SUITE_PY_MODULES:
            self.assertEqual(hashlib.sha256((TWP_PY / (m + ".py")).read_bytes()).hexdigest(),
                             gateway_util.SUITE_PY_SHA256[m],
                             f"{m}.py changed: recompute its graph, check the table, then pin it")

    def test_the_table_is_the_graph(self):
        g = self._graphs()
        for entry, axes in gateway_util.SUITE_PY_READS.items():
            got, _links = gateway_util.suite_graph_reads(g, entry)
            self.assertEqual(got, axes, entry)

    def test_every_python_remap_of_the_twp_profile_is_in_the_table(self):
        hooks = set()
        for raw in TWP_INI.read_text().splitlines():
            if raw.strip().upper().startswith("REMAP"):
                hooks |= set(re.findall(r"\b(?:python|prolog|epilog)\s*=\s*(\S+)", raw, re.I))
        self.assertEqual(hooks - set(gateway_util.SUITE_PY_READS), set())

    def test_no_text_of_the_sources_reads_the_position(self):
        # self.execute("…") runs G-code the graph does not see
        pat = re.compile(r"#\s*54[12]\d|#\s*<\s*_(?:abs_)?[xyzabcuvw]\s*>", re.I)
        for m in gateway_util.SUITE_PY_MODULES:
            tree = ast.parse((TWP_PY / (m + ".py")).read_text())
            for n in ast.walk(tree):
                if isinstance(n, ast.Constant) and isinstance(n.value, str):
                    self.assertIsNone(pat.search(n.value), f"{m}: {n.value[:60]!r}")

    def test_what_the_sources_execute_stores_no_position(self):
        # Codex R133 VP-I88 (RemapEnv.pos_writes): a bound hook writes no
        # register FROM the position by itself — its G10 L2 carries values
        # it computes, and an X/Y/Z-dependent one passes a listed read
        stores = re.compile(r"G\s*0*92(?!\s*\.\s*[123])|G\s*0*28\s*\.\s*1|G\s*0*30\s*\.\s*1|L\s*0*(?:10|11|20)(?![0-9])",
                            re.I)
        seen = 0
        for m in gateway_util.SUITE_PY_MODULES:
            for n in ast.walk(ast.parse((TWP_PY / (m + ".py")).read_text())):
                if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "execute"
                        and n.args):
                    continue
                a = n.args[0]
                if isinstance(a, ast.BinOp) and isinstance(a.op, ast.Mod):
                    a = a.left
                if isinstance(a, ast.JoinedStr):
                    text = "0".join(v.value for v in a.values if isinstance(v, ast.Constant))
                else:
                    self.assertIsInstance(a, ast.Constant, f"{m}: an executed text not read here")
                    text = a.value
                seen += 1
                self.assertIsNone(stores.search(re.sub(r"\([^)]*\)", "", text)), f"{m}: {text[:60]!r}")
        self.assertGreater(seen, 10)

    def test_dynamic_reads_are_the_listed_ones(self):
        allowed_params = {"'_metric'", "5220", "G92_FLAG_PARAM", "G92_PARAMS[l]", "G92_PARAMS[letter]",
                          "pp['a']", "pp['kins']", "pp['stamped']", "pp[k]", "prov['a']", "prov['kins']",
                          "prov['stamped']", "prov['x']", "prov['y']", "prov['z']", "row[l]", "row[letter]",
                          "work_offset_x", "work_offset_y", "work_offset_z"}
        allowed_getattr = {"attr + '_origin_offset'", "attr + '_axis_offset'",
                           "_ROTARY_ATTR[l] + '_axis_offset'", "'sequence_number'", "'linetext'",
                           "'filename'", "'call_level'"}
        for m in gateway_util.SUITE_PY_MODULES:
            tree = ast.parse((TWP_PY / (m + ".py")).read_text())
            for n in ast.walk(tree):
                if isinstance(n, ast.Subscript) and isinstance(n.value, ast.Attribute) and n.value.attr == "params":
                    self.assertIn(ast.unparse(n.slice), allowed_params, m)
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "getattr":
                    self.assertIn(ast.unparse(n.args[1]), allowed_getattr, m)
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Name):
                    self.assertNotIn(n.func.id, ("eval", "exec", "setattr", "globals", "__import__"), m)


class TestSuitePythonBinding(unittest.TestCase):
    """12f: the table holds only for the bodies the interpreter will call."""

    def test_the_unchanged_suite_is_bound(self):
        self.assertEqual(bind("plain"), gateway_util.SUITE_PY_READS)

    def test_a_remap_module_earlier_on_the_path_is_not(self):
        self.assertEqual(bind("foreign_remap_first"), {})

    def test_a_changed_file_is_not(self):
        self.assertEqual(bind("changed_file"), {})

    def test_an_entry_bound_to_another_body_is_not(self):
        b = bind("entry_alias")                    # remap.g682 = remap.g683
        self.assertNotIn("g682", b)
        self.assertIn("g683", b)

    def test_a_helper_bound_to_another_body_is_not(self):
        g = {m: gateway_util.py_module_graph((TWP_PY / (m + ".py")).read_bytes(), str(TWP_PY / (m + ".py")))
             for m in gateway_util.SUITE_PY_MODULES}
        reach = {e: {lk for lk in gateway_util.suite_graph_reads(g, e)[1]} for e in gateway_util.SUITE_PY_READS}
        for case, link in (("helper_alias", ("remap", "get_current_work_offset")),
                           ("imported_helper_alias", ("remap", "_active_fixture_index")),
                           ("helper_module_binding", ("twp_transform", "_rot_x"))):
            b = bind(case)
            hit = {e for e, links in reach.items()
                   if link in links or (link[0] == "remap" and link[1] == "_active_fixture_index"
                                        and ("twp_params", "active_index") in links)}
            self.assertTrue(hit, case)
            self.assertEqual(set(b), set(gateway_util.SUITE_PY_READS) - hit, case)

    def test_the_real_suite_binds_in_the_worker(self):
        # the repository's twp/python, loaded by the native interpreter in
        # the worker's process (TOPLEVEL, PATH_APPEND), bound at the first
        # callback
        r = probe("e_twp_real_bind")
        self.assertIsNone(r["parse_error"])
        self.assertEqual(r["python_reads"], ["python remap reads: bound "
                                             "g53x_core,g682,g683,g684,g69_core,twp_touchoff; every axis: none"])

    def test_the_twp_profile_s_m600_may_read_through_m535(self):
        # The routine's `M#<spindle_stop_m>` is an M word the text does not
        # settle: it may run any remapped M — on the TWP profile M535
        # (X, Y, Z, A, B, C). An M600 before the first absolute XYZ move there
        # makes everything unknown to the end (named in R132; the toolsetter
        # basis could settle #3107 later).
        lines = [ln.split("=", 1)[1].strip() for ln in TWP_INI.read_text().splitlines()
                 if re.match(r"\s*REMAP\s*=", ln)]
        base = ROOT / "examples" / "sim_config"
        dirs = [str(base), str(base / "twp" / "remap_subs"), str(ROUTINE.parent)]
        env = gateway_util.RemapEnv(lines, dirs)
        env.python_reads = dict(gateway_util.SUITE_PY_READS)
        self.assertEqual(env.reads(("M", 600)), frozenset(range(6)))
        self.assertEqual(env.reads(("G", 682)), frozenset())
        self.assertEqual(env.reads(("G", 533)), frozenset({3, 4, 5}))

    def test_hooks_each_and_unions(self):
        dirs = [str(ROOT / "examples" / "sim_config" / "remap_subs"), str(ROUTINE.parent)]
        lines = ["G68.2 modalgroup=1 python=g682", "M530 modalgroup=10 python=g53x_core",
                 "M600 modalgroup=6 ngc=m600"]
        env = gateway_util.RemapEnv(lines, dirs)
        env.python_reads = {"g682": frozenset(), "g53x_core": frozenset({3, 4, 5})}
        self.assertEqual(env.reads(("G", 682)), frozenset())
        self.assertEqual(env.reads(("M", 530)), frozenset({3, 4, 5}))
        # the suite's M600: its routine marks its own reads — but its
        # `M#<spindle_stop_m>` may run any remapped M, M530 here (A, B, C)
        self.assertEqual(env.reads(("M", 600)), frozenset({3, 4, 5}))
        env = gateway_util.RemapEnv([lines[0], lines[2]], dirs)
        self.assertEqual(env.reads(("M", 600)), frozenset(), "no other M remap: nothing")
        env = gateway_util.RemapEnv(lines[:2] + ["M600 modalgroup=6 ngc=m600 prolog=extra"], dirs)
        env.python_reads = {"g682": frozenset(), "g53x_core": frozenset({3, 4, 5})}
        self.assertIsNone(env.reads(("M", 600)), "an unbound prolog reads every axis")
        env.python_reads["extra"] = frozenset({1})
        env._reads.clear()
        self.assertEqual(env.reads(("M", 600)), frozenset({1, 3, 4, 5}), "bound: its reads and the body's, united")

    def test_a_hook_on_the_suites_m600_makes_it_foreign(self):
        d = str(ROOT / "examples" / "sim_config" / "remap_subs")
        self.assertEqual(gateway_util.foreign_m600_codes(["M600 modalgroup=6 ngc=m600"], [d]), frozenset())
        for hook in ("prolog=x", "epilog=x", "python=x"):
            self.assertEqual(gateway_util.foreign_m600_codes([f"M600 modalgroup=6 ngc=m600 {hook}"], [d]),
                             frozenset({"m600"}), hook)


if __name__ == "__main__":
    unittest.main()
