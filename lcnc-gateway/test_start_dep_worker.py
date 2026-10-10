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
import json
import math
import os
import re
import subprocess
import sys
import types
import unittest
from pathlib import Path

import gateway_util
import gcode_canon
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
                         [{"line": 2, "axis": "X", "value": 600.0, "limit": 500.0, "kind": "max"}])

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
        # the measurement is predicted in both.
        r = probe("e_m600_return")
        self.assertEqual(r["rapid_dep"], [3, 3, 0, 3])
        self.assertEqual(r["feed_dep"][-2:], [3, 3])
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
        return c._dep_step("straight")

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
