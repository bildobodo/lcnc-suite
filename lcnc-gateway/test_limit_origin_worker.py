"""A limit record is bound to the motion that made it and to where it ran
(Codex R177 VP-I130), against the REAL worker and LinuxCNC's native offline
interpreter — one fresh process per case (native_start_probe.py; X max 500).

The canon reports a move by the raw line number of the file it runs in: a
called subroutine's L5 and the main program's L5 are the same number. The
record names its origin — the main program, or the marked subroutine with
the verified call line of its outermost span — and its violating stretches
as seq runs, which the client places by; both ends of every stretch survive
the decimation."""
import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
_CACHE = {}


def probe(case):
    if case not in _CACHE:
        env = dict(os.environ)
        env.pop("PYTHONPATH", None)
        p = subprocess.run([sys.executable, os.path.join(HERE, "native_start_probe.py"), case],
                           capture_output=True, text=True, timeout=120, env=env, cwd=HERE)
        lines = [ln for ln in p.stdout.splitlines() if ln.startswith("{")]
        if not lines:
            raise AssertionError(f"{case}: no result rc={p.returncode} stderr={p.stderr[-800:]}")
        _CACHE[case] = json.loads(lines[-1])
    r = _CACHE[case]
    if "skip" in r:
        raise unittest.SkipTest(r["skip"])
    return r


def outside_seqs(r):
    """The seqs of the shipped vertices a move ENDS outside the window at."""
    out = set()
    for stream in ("feed", "rapid"):
        for q, o in zip(r[f"{stream}_seq"] or [], r[f"{stream}_outside"] or []):
            if o:
                out.add(q)
    return out


def shipped(r):
    return set(r["feed_seq"] or []) | set(r["rapid_seq"] or [])


class TestLimitOrigin(unittest.TestCase):

    def records(self, case):
        r = probe(case)
        self.assertIsNone(r["parse_error"], case)
        return r, [(v["line"], v.get("sub"), v.get("site"), v["runs"], v["nruns"]) for v in r["violations"]]

    def test_a_subroutine_limit_names_its_call_not_the_main_line_of_its_number(self):
        # Codex's case: the subroutine's L5 runs X10 → X600, the main L5 X20 → X30
        r, recs = self.records("lim_sub")
        self.assertEqual(recs, [(5, "lim_child", 3, [[4, 4]], 1)])
        self.assertEqual(outside_seqs(r), {4})
        # the per-point call line the client reads it by (the call sites
        # attributed once, with the limit records)
        self.assertEqual(r["feed_cline"], [3, 3, 3, 3, 0, 0, 0])

    def test_a_main_program_limit_is_the_main_line_whatever_a_subroutine_numbers(self):
        # haus.ngc's case: the main L5 leaves the window, the subroutine's L5 does not
        r, recs = self.records("lim_main")
        self.assertEqual(recs, [(5, None, None, [[7, 7]], 1)])
        self.assertEqual(outside_seqs(r), {7})

    def test_both_at_one_raw_number_are_two_records(self):
        r, recs = self.records("lim_both")
        self.assertEqual(recs, [(5, "lim_child", 3, [[4, 4]], 1), (5, None, None, [[7, 7]], 1)])
        self.assertEqual(r["violations_total"], 2)

    def test_an_unmarked_subroutine_keeps_its_place(self):
        # no span names it: the record is the main program's by the markers
        # (the named W2 P6 limit), its stretch the move that left the window —
        # the client reads the line at that place (here no line of the
        # program: the main L5 is a comment)
        r, recs = self.records("lim_unmarked")
        self.assertEqual(recs, [(5, None, None, [[4, 4]], 1)])
        self.assertEqual(outside_seqs(r), {4})

    def test_each_call_site_is_a_record(self):
        r, recs = self.records("lim_two_sites")
        self.assertEqual(recs, [(5, "lim_child", 3, [[4, 4]], 1), (5, "lim_child", 5, [[9, 9]], 1)])

    def test_one_site_run_twice_is_one_record_with_two_stretches(self):
        r, recs = self.records("lim_loop_site")
        self.assertEqual(recs, [(5, "lim_child", 5, [[4, 4], [9, 9]], 2)])
        self.assertEqual(r["violations_total"], 1)

    def test_a_stretch_of_an_arc_keeps_its_ends_and_the_move_before(self):
        r, recs = self.records("lim_arc")
        (line, sub, site, runs, nruns), = recs
        self.assertEqual((line, sub, nruns), (4, None, 1))
        lo, hi = runs[0]
        self.assertGreater(hi, lo)
        have = shipped(r)
        self.assertLessEqual({lo - 1, lo, hi, hi + 1}, have)
        self.assertLessEqual(outside_seqs(r), set(range(lo, hi + 1)))

    def test_a_stretch_inside_a_collinear_run_keeps_its_ends(self):
        # one line run four times, X400 → X700: without the anchors the
        # decimation keeps only its first and last point, and the stretch
        # X500 → X700 would start at X400 — a move inside the window
        r, recs = self.records("lim_collinear")
        self.assertEqual(recs, [(6, None, None, [[5, 6]], 1)])
        self.assertLessEqual({4, 5, 6, 7}, shipped(r))
        self.assertEqual([p[0] for p in r["feed"]], [300.0, 400.0, 500.0, 600.0, 700.0, 0.0])

    def test_a_stretch_of_traverses_keeps_its_ends_too(self):
        # the rapid stream anchors nothing at a line change: X400 goes, the
        # stretch's start X500 and its points stay
        r, recs = self.records("lim_collinear_rapid")
        self.assertEqual(recs, [(6, None, None, [[5, 6]], 1)])
        self.assertLessEqual({4, 5, 6, 7}, set(r["rapid_seq"]))
        self.assertEqual([p[0] for p in r["rapid"]], [0.0, 300.0, 500.0, 600.0, 700.0, 0.0])


if __name__ == "__main__":
    unittest.main()
