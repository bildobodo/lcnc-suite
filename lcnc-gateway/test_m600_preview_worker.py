"""M600 in the preview (Codex R102–R104, docs/reviews/m600-preview.plan.md)
against the REAL worker, LinuxCNC's native offline interpreter and the
bundled tool_touch_off.ngc through the M600 remap (native_start_probe.py, one
fresh process per case; `skip` where the native modules are missing).

The preview's G38 never trips: it runs the whole travel and leaves #5070 = 0.
The routine's preview branch moves to the point the tool's TABLE length would
trip at instead — only where the machine's probe would trip there too — and
sets the probe results there. Elsewhere it stops at the probe's start.

The toolsetter values are the 3-axis sim profile's: the setter at X10 Y10,
machine Z −180; the fast probe starts 5 mm above where T2 (80 mm in the table)
trips, at −95, the trip point is −100, the retract 3 mm; G30 is X10 Y0 Z0. The
program stands at X50 Y50 Z−100 before `T2 M600` and goes on with
`G0 X60 Y60`."""
import unittest

from test_start_tlo_worker import probe

FAST = 2000 / 60.0   # mm/s
SLOW = 200 / 60.0


def path(r):
    """[(seq, kind, (x, y, z), line)] in execution order."""
    ev = [(s, "F", tuple(p), ln) for s, p, ln in zip(r["feed_seq"], r["feed"], r["feed_lines"])]
    ev += [(s, "R", tuple(p), ln) for s, p, ln in zip(r["rapid_seq"], r["rapid"], r["rapid_lines"])]
    return sorted(ev)


def feeds_at(r, x, y):
    """Z of every feed point at (x, y), in order."""
    return [round(p[2], 6) for _, k, p, _ in path(r) if k == "F" and p[:2] == (x, y)]


def tool_rows(r, tool):
    return [row for row in r["tlo_events"] or () if row[4] == tool]


class TestPredictedMeasurement(unittest.TestCase):

    def _clean(self, r):
        self.assertIsNone(r["parse_error"])
        self.assertTrue(r["mmap_unchanged"], "the preview wrote the tool data a live LinuxCNC shares")
        self.assertEqual(r["violations"], [])

    def test_the_probe_moves_to_the_trip_point_and_the_table_length_is_applied(self):
        r = probe("m600_known")
        self._clean(r)
        # G30 X10 Y0 first, then the setter: the start, the fast probe to the
        # trip point, the retract, the slow probe back to it, the retract
        self.assertEqual(feeds_at(r, 10, 0), [0, 0, 0])
        self.assertEqual(feeds_at(r, 10, 10)[:6], [0, -95, -100, -97, -100, -97])
        # the routine's own formula gives the table length; G10 L1 writes it,
        # G43 H applies it; the retract G53 Z0 is program Z −80 under it
        self.assertAlmostEqual(tool_rows(r, 2)[-1][3], 80.0, places=9)
        self.assertEqual(feeds_at(r, 10, 10)[6], -80)
        # back to where the program stood (in its frame: under the new offset)
        self.assertEqual(feeds_at(r, 50, 50)[-2:], [-80, -100])
        self.assertEqual(path(r)[-1][2], (60, 60, -100))
        # one tool change, to T2
        self.assertEqual([t for _, t in r["tool_change_lines"]], [2])

    def test_the_probe_moves_take_the_probe_feeds(self):
        r = probe("m600_known")
        pts = [(s, p) for s, k, p, _ in path(r) if k == "F"]
        tcum = dict(zip(r["feed_seq"], r["feed_tcum"]))
        z = [p[2] if p[:2] == (10, 10) else None for _, p in pts]
        i = z.index(-95)
        t = [tcum[pts[i + k][0]] for k in range(5)]
        self.assertAlmostEqual(t[1] - t[0], 5 / FAST, places=4)    # fast: −95 → −100
        self.assertAlmostEqual(t[3] - t[2], 3 / SLOW, places=4)    # slow: −97 → −100

    def test_a_single_probe_when_the_slow_one_is_off(self):
        r = probe("m600_single")
        self._clean(r)
        self.assertEqual(feeds_at(r, 10, 10)[:5], [0, -95, -100, -97, -80])
        self.assertAlmostEqual(tool_rows(r, 2)[-1][3], 80.0, places=9)

    def test_a_clamped_travel_that_still_reaches_the_trip_point(self):
        # Z limit −110: the travel is clamped to 13 mm, the probe ends at −108
        r = probe("m600_clamp_in")
        self._clean(r)
        self.assertEqual(feeds_at(r, 10, 10)[:6], [0, -95, -100, -97, -100, -97])

    def test_the_edge_finder_probes_its_own_reference(self):
        # T2 is the finder: its X/Y, the reference 5 mm higher; the length
        # formula takes the 5 mm off again
        r = probe("m600_finder")
        self._clean(r)
        self.assertEqual(feeds_at(r, 30, 40)[:6], [0, -90, -95, -92, -95, -92])
        self.assertAlmostEqual(tool_rows(r, 2)[-1][3], 80.0, places=9)

    def test_the_diameter_offset_moves_the_probe_point(self):
        r = probe("m600_diameter")
        self._clean(r)
        self.assertEqual(feeds_at(r, 13, 10)[:6], [0, -95, -100, -97, -100, -97])

    def test_the_options_for_the_way_back_and_the_change_position(self):
        r = probe("m600_no_back")
        self._clean(r)
        self.assertEqual(feeds_at(r, 50, 50), [0])        # only the retract before the change
        self.assertEqual(path(r)[-1][2], (60, 60, -80))
        r = probe("m600_no_prepos")
        self._clean(r)
        self.assertEqual(feeds_at(r, 10, 0), [])          # never at G30
        self.assertEqual(feeds_at(r, 10, 10)[:6], [0, 0, 0, -95, -100, -97])

    def test_the_program_reads_the_predicted_probe_result(self):
        # Codex VP103-01: in G54 Z10 and G92 Z−5 the trip point (machine −100)
        # is program −105; `o100 if [#5070 EQ 1]` takes X5, `G0 Y[#5063]` goes
        # to −105 — the results set before the call (−999, 0) do not count
        r = probe("m600_result")
        self._clean(r)
        self.assertEqual(feeds_at(r, 10, 10)[:6], [-5, -100, -105, -102, -105, -102])
        self.assertAlmostEqual(tool_rows(r, 2)[-1][3], 80.0, places=9)
        self.assertEqual([p for _, k, p, _ in path(r)][-2:], [(5, 50, -95), (5, -105, -95)])

    def test_t0_unloads_without_a_probe(self):
        r = probe("m600_t0")
        self._clean(r)
        self.assertEqual([t for _, t in r["tool_change_lines"]], [0])
        self.assertEqual(feeds_at(r, 10, 10), [])
        self.assertEqual({row[4] for row in r["tlo_events"]}, {0})


class TestUnpredictedMeasurement(unittest.TestCase):
    """Where the machine's probe need not trip at the predicted point, the
    preview draws the known positioning up to the probe's START and stops
    there: no move to a trip point, no G10, no G43 — the program goes on from
    the start point (everything after it is unknown: the canon's job)."""

    CASES = (
        ("m600_length_unknown", -30),   # no table length: the start is −180 + 150
        ("m600_setter_above", 95),      # #3102 = 10 (the start itself is past Z max 50)
        ("m600_trip_outside", -95),     # Codex R102: a 1 mm travel from −95
        ("m600_clamp_out", -95),        # Z limit −101: the travel clamped to 4 mm
        ("m600_slow_limit", -95),       # Z limit −102.5: the slow probe would end at −103
        ("m600_retract_zero", -95),
        ("m600_feed_zero", -95),
    )

    def test_the_preview_stops_at_the_probe_start(self):
        for case, start in self.CASES:
            with self.subTest(case=case):
                r = probe(case)
                self.assertIsNone(r["parse_error"])
                self.assertTrue(r["mmap_unchanged"])
                self.assertEqual(feeds_at(r, 10, 10), [0, start])
                self.assertEqual([row for row in tool_rows(r, 2) if row[3] != 0], [], "no G43 with a length")
                self.assertEqual(path(r)[-1][2], (60, 60, start))
                self.assertEqual([t for _, t in r["tool_change_lines"]], [2])

    def test_a_start_past_the_z_limit_is_a_limit_violation(self):
        r = probe("m600_setter_above")
        self.assertEqual([(v["axis"], v["value"], v["kind"]) for v in r["violations"]], [("Z", 95.0, "max")])


if __name__ == "__main__":
    unittest.main()
