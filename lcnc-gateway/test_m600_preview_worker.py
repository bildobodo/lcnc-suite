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
        # one tool change, to T2 — the routine's M6, at the M600 line (its
        # unique call site; the sub file's own line would collide)
        self.assertEqual(r["tool_change_lines"], [[3, 2]])
        # the length the routine's G43 applied is the table's — said with that
        # G43's own row; nothing stopped
        g43 = [row for row in r["tlo_events"] if row[3] != 0]
        # …and with its call line, verified (the only M600 line): the note
        # goes on that call's row (Codex R105 VP-I63)
        self.assertEqual(r["toollen_table"], [[g43[-1][0], 2, 80.0, 3]])
        self.assertIsNone(r["probe_unpredicted"])

    def test_the_measured_tool_is_named_by_its_number_not_its_row(self):
        # a library tool ahead of T1 and T2: T2 is the table's third row
        r = probe("m600_row_not_number")
        self._clean(r)
        self.assertEqual(r["tool_change_lines"], [[3, 2]])
        self.assertEqual([row[1] for row in r["toollen_table"]], [2])
        self.assertAlmostEqual(tool_rows(r, 2)[-1][3], 80.0, places=9)
        self.assertIn(2, [t[0] for t in r["parse_tlos"]])

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
        self.assertEqual(r["tool_change_lines"], [[3, 0]])
        self.assertEqual(feeds_at(r, 10, 10), [])
        self.assertEqual({row[4] for row in r["tlo_events"]}, {0})
        self.assertIsNone(r["toollen_table"], "no table-length claim without the routine's marker")
        self.assertIsNone(r["probe_unpredicted"])

    def test_m601_measures_in_manual_mode(self):
        # #2000 = 0: to the setter before the change already (-70-, no G30),
        # no way back after
        r = probe("m601_known")
        self._clean(r)
        self.assertEqual(feeds_at(r, 10, 0), [])
        self.assertEqual(feeds_at(r, 10, 10)[:8], [0, 0, 0, -95, -100, -97, -100, -97])
        self.assertAlmostEqual(tool_rows(r, 2)[-1][3], 80.0, places=9)
        self.assertEqual(r["tool_change_lines"], [[3, 2]])
        self.assertEqual(path(r)[-1][2], (60, 60, -80))

    def test_a_routine_called_from_two_lines_names_each_call(self):
        # T2 (80 mm) then T1 (10 mm: trip at −170): both predicted; the
        # interpreter names the line each call ran from (Codex R107) — never
        # the sub's own line, never one line for both
        r = probe("m600_twice")
        self._clean(r)
        self.assertEqual(r["tool_change_lines"], [[3, 2], [5, 1]])
        self.assertEqual([(t, z, ln) for _, t, z, ln in r["toollen_table"]], [(2, 80.0, 3), (1, 10.0, 5)])
        self.assertIn(-170, feeds_at(r, 10, 10))

    def test_only_the_routines_own_g43_carries_the_table_length(self):
        # the program's G43 H2 after the call applies 80 too — its own, no claim
        r = probe("m600_g43_after")
        self._clean(r)
        g43 = [row for row in r["tlo_events"] if row[3] != 0]
        self.assertEqual(len(g43), 2)
        self.assertEqual(r["toollen_table"], [[g43[0][0], 2, 80.0, 3]])

    def test_the_limits_after_a_predicted_measurement_are_checked(self):
        r = probe("m600_known_then_high")
        self.assertEqual([(v["line"], v["axis"], v["value"]) for v in r["violations"]], [(4, "Z", 280.0)])


class TestForeignRemap(unittest.TestCase):

    def test_the_boundary_is_the_first_main_line_that_may_call_it(self):
        # Codex R107: the interpreter names the remap when it runs; the text
        # adds what the run may do where the preview does not. A body that
        # moves nothing the preview sees: from the next main line on (L4); a
        # call in a body's branch the preview does not take (#5399 is the
        # run's input): from M200's line on; moves before M200 stay known —
        # and M200's own body's move before its call (X57) is unknown too:
        # the call may come first where the text cannot say
        for case in ("foreign_silent_body", "foreign_in_branch"):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            ev = path(r)
            own = next(q for q, k, p, ln in ev if p == (50.0, 50.0, -100.0))
            self.assertEqual(r["probe_unpredicted"], [[own, -1, "foreign_remap", 0]], case)
            self.assertEqual(r["rapid_ustart"], [1, 1], case)
        r = probe("foreign_remap_late")
        ev = path(r)
        x55 = next(q for q, k, p, ln in ev if p == (55.0, 50.0, -100.0))
        self.assertEqual(r["probe_unpredicted"], [[x55, -1, "foreign_remap", 0]])
        ustart = dict(zip(r["rapid_seq"], r["rapid_ustart"]))
        self.assertEqual(ustart[x55], 0, "the main program's move before M200 is known")
        self.assertEqual({ustart.get(q) for q, *_ in ev if q > x55}, {1})

    def test_a_foreign_m600_is_not_predicted_from_the_block_before_it(self):
        # `REMAP=M600 ngc=othertc` (no suite marker): what the call does is
        # unknown — the program's G1 at L3 is known, its own G53 move and the
        # program after it are not
        r = probe("m600_foreign")
        self.assertIsNone(r["parse_error"])
        ev = path(r)
        g1 = next(q for q, k, p, ln in ev if k == "F" and ln == 3)
        self.assertEqual(r["probe_unpredicted"], [[g1, -1, "foreign_remap", 0]])
        ustart = dict(zip(r["rapid_seq"], r["rapid_ustart"]))
        self.assertEqual({(k, ustart.get(q)) for q, k, _, _ in ev if q > g1}, {("R", 1)})

    def test_with_o_words_from_the_programs_start(self):
        r = probe("m600_foreign_oword")
        self.assertEqual(r["probe_unpredicted"][0][2], "foreign_remap")
        ustart = dict(zip(r["rapid_seq"], r["rapid_ustart"]))
        self.assertEqual(set(ustart.values()), {1})

    def test_the_suites_own_routine_is_not_foreign(self):
        self.assertIsNone(probe("m600_known")["probe_unpredicted"])


class TestSubSpans(unittest.TestCase):

    def test_the_program_after_the_call_is_outside_every_span(self):
        # every way out of the routine — its end, the stop at an unpredicted
        # probe, the T0 branch — closes its span: a return skips the
        # endsub's marker, so the routine closes it before each return
        for case in ("m600_known", "m600_length_unknown", "m600_t0", "m601_known"):
            with self.subTest(case=case):
                r = probe(case)
                subs = dict(zip(r["feed_seq"], r["feed_sub"] or [])) | dict(zip(r["rapid_seq"], r["rapid_sub"] or []))
                ev = path(r)
                self.assertEqual(subs[ev[-1][0]], 0xff, f"{case}: {r['sub_names']}")
                self.assertTrue(any(subs[q] != 0xff for q, *_ in ev[:-1]), "the routine's own points are in the span")


class TestTableLengthPairing(unittest.TestCase):

    def test_the_marker_pairs_with_the_first_g43_of_its_call_only(self):
        # tl_pair: the marker, T2 M6, G43 H2 (paired), G43 H1 (not); tl_open:
        # a marker its call never pairs — the main file's G43 H1 after it is
        # no claim either
        r = probe("toollen_pairing")
        self.assertIsNone(r["parse_error"])
        g43 = [row for row in r["tlo_events"] if row[3] != 0]
        self.assertEqual([(row[3], row[4]) for row in g43], [(80.0, 2), (10.0, 2), (80.0, 2), (10.0, 2)])
        self.assertEqual(r["toollen_table"], [[g43[0][0], 2, 80.0, 3]])


class TestUnpredictedMeasurement(unittest.TestCase):
    """Where the machine's probe need not trip at the predicted point, the
    preview draws the known positioning up to the probe's START and stops
    there: no move to a trip point, no G10, no G43 — the program goes on from
    the start point (everything after it is unknown: the canon's job)."""

    CASES = (
        ("m600_length_unknown", -30, "length"),     # no table length: the start is −180 + 150
        ("m600_setter_above", 95, "setter_z"),      # #3102 = 10 (the start itself is past Z max 50)
        ("m600_trip_outside", -95, "travel"),       # Codex R102: a 1 mm travel from −95
        ("m600_clamp_out", -95, "travel"),          # Z limit −101: the travel clamped to 4 mm
        ("m600_slow_limit", -95, "slow_limit"),     # Z limit −102.5: the slow probe would end at −103
        ("m600_retract_zero", -95, "retract"),
        ("m600_feed_zero", -95, "feed"),
    )

    def test_the_preview_stops_at_the_probe_start(self):
        for case, start, reason in self.CASES:
            with self.subTest(case=case):
                r = probe(case)
                self.assertIsNone(r["parse_error"])
                self.assertTrue(r["mmap_unchanged"])
                self.assertEqual(feeds_at(r, 10, 10), [0, start])
                self.assertEqual([row for row in tool_rows(r, 2) if row[3] != 0], [], "no G43 with a length")
                self.assertEqual(path(r)[-1][2], (60, 60, start))
                self.assertEqual(r["tool_change_lines"], [[3, 2]])
                self.assertIsNone(r["toollen_table"])
                # the stop is at the probe start's own point; every point after
                # it is an unknown-start endpoint (rapid stream, zero length)
                ev = path(r)
                start_seq = next(q for q, k, p, _ in ev if k == "F" and p == (10, 10, start))
                self.assertEqual(r["probe_unpredicted"], [[start_seq, 2, reason, 3]])
                ustart = dict(zip(r["rapid_seq"], r["rapid_ustart"]))
                after = [(q, k) for q, k, _, _ in ev if q > start_seq]
                self.assertTrue(after)
                self.assertEqual({(k, ustart.get(q)) for q, k in after}, {("R", 1)})

    def test_nothing_is_limit_checked_after_the_stop(self):
        # the same Z200 move as test_the_limits_after_a_predicted_measurement_are_checked
        r = probe("m600_unknown_then_high")
        self.assertEqual(r["probe_unpredicted"][0][2], "length")
        self.assertEqual(r["violations"], [])
        self.assertEqual(r["rapid_outside"][-1], 0)

    def test_the_booked_basis_wins_over_the_parameter_file(self):
        # the file says −150 / a 1 mm travel (written by the gateway, never
        # taken over); the basis the interpreter holds says −180 / 60: the
        # routine is predicted with the booked values, and says which
        r = probe("m600_basis_patched")
        self.assertIsNone(r["parse_error"])
        self.assertIsNone(r["probe_unpredicted"])
        self.assertEqual(feeds_at(r, 10, 10)[:6], [0, -95, -100, -97, -100, -97])
        b = r["toolsetter_basis"]
        self.assertEqual((b["state"], b["origin"], b["version"]), ("confirmed", "applied", 3))
        self.assertEqual((b["values"]["3102"], b["values"]["3007"], b["values"]["3009"]), (-180.0, 60.0, 3.0))

    def test_values_never_stored_run_nothing_of_the_routine(self):
        # zeros would end the parse ("zero feed rate") — the machine may hold
        # other values: the routine returns at once, named from its start
        r = probe("m600_not_set_up")
        self.assertIsNone(r["parse_error"])
        ev = path(r)
        self.assertEqual(r["probe_unpredicted"], [[ev[0][0], -1, "toolsetter_not_set_up", 3]])
        self.assertEqual(r["tool_change_lines"], [])
        self.assertEqual(r["toolsetter_basis"]["state"], "not_set_up")
        ustart = dict(zip(r["rapid_seq"], r["rapid_ustart"]))
        self.assertEqual({(k, ustart.get(q)) for q, k, _, _ in ev[1:]}, {("R", 1)})

    def test_an_offset_written_after_the_stop_is_no_cause_of_its_own(self):
        r = probe("m600_unknown_then_g92")
        self.assertEqual(r["probe_unpredicted"][0][2], "length")
        self.assertIsNone(r["stale_offset_lines"])

    def test_unknown_toolsetter_values_stop_at_the_routine_start(self):
        # the gateway's word (package 1): the values the routine would read are
        # unknown — the routine returns at once (-0-), every later point unknown
        r = probe("m600_basis_unknown")
        self.assertIsNone(r["parse_error"])
        ev = path(r)
        self.assertEqual(r["probe_unpredicted"], [[ev[0][0], -1, "toolsetter_unknown", 3]])
        ustart = dict(zip(r["rapid_seq"], r["rapid_ustart"]))
        self.assertEqual({(k, ustart.get(q)) for q, k, _, _ in ev[1:]}, {("R", 1)})
        self.assertIsNone(r["toollen_table"])

    def test_a_start_past_the_z_limit_is_a_limit_violation(self):
        r = probe("m600_setter_above")
        self.assertEqual([(v["axis"], v["value"], v["kind"]) for v in r["violations"]], [("Z", 95.0, "max")])


if __name__ == "__main__":
    unittest.main()


class TestCallLines(unittest.TestCase):
    """A measurement's call line (the rows' 4th element) is the verified one
    or 0 — never another call's (Codex R105 VP-I63 and the call-site reading
    found with VP-I61). Since Codex R107 the interpreter names it
    (gcode_canon.main_line): each call its own line, per occurrence."""

    def test_a_compact_call_is_its_line(self):
        r = probe("m600_compact")
        self.assertIsNone(r["parse_error"])
        self.assertEqual(r["tool_change_lines"], [[3, 2]])
        self.assertEqual([row[3] for row in r["toollen_table"]], [3])

    def test_two_call_sites_each_get_their_line_never_both_on_one(self):
        # `T2M600` (L3) beside `T1 M600` (L5): the regex saw L5 only and put
        # BOTH calls there
        r = probe("m600_compact_pair")
        self.assertIsNone(r["parse_error"])
        self.assertEqual(r["tool_change_lines"], [[3, 2], [5, 1]])
        self.assertEqual([(row[1], row[3]) for row in r["toollen_table"]], [(2, 3), (1, 5)])

    def test_a_near_literal_is_a_site_too(self):
        # Codex R106: M599.99999 reads as 600 — a filter on the digits "600"
        # missed it and put both calls on L5
        r = probe("m600_near_pair")
        self.assertIsNone(r["parse_error"])
        self.assertEqual(r["tool_change_lines"], [[3, 2], [5, 1]])
        self.assertEqual([(row[1], row[3]) for row in r["toollen_table"]], [(2, 3), (1, 5)])
        r = probe("m600_near_single")
        self.assertEqual(r["tool_change_lines"], [[3, 2]])
        self.assertEqual([row[3] for row in r["toollen_table"]], [3])

    def test_the_same_tool_twice_keeps_each_measurement_apart(self):
        # predicted at the first call (L3), not at the second (L6, a 1 mm
        # travel): two events of T2, in order, each on its own call's row —
        # never one note on both
        r = probe("m600_repeat")
        self.assertIsNone(r["parse_error"])
        self.assertEqual(r["tool_change_lines"], [[3, 2], [6, 2]])
        self.assertEqual([(row[1], row[2], row[3]) for row in r["toollen_table"]], [(2, 80.0, 3)])
        self.assertEqual([(row[1], row[2], row[3]) for row in r["probe_unpredicted"]], [(2, "travel", 6)])
        self.assertLess(r["toollen_table"][0][0], r["probe_unpredicted"][0][0])

    def test_the_interpreter_names_the_line_it_runs(self):
        # Codex R107 (its `sequence_named_body`): M200's body runs
        # `o<m600> call` — the measurement is L3's, never the T2 M600 after
        # M2 (L6) that the text alone saw as the one site
        r = probe("m600_via_other_remap")
        self.assertIsNone(r["parse_error"])
        self.assertEqual(r["tool_change_lines"], [[3, 2]])
        self.assertEqual([row[3] for row in r["toollen_table"]], [3])
        # the line of the deepest frame running the main file: a called
        # file's call (L3), a loop's line each time (L5 twice), an inline
        # sub's own line (L2), an M98 sub's (L7), and a `%` file with CRLF
        # and a UTF-8 comment — a frame's position is a byte offset (L5)
        for case, lines in (("m600_ext_call", [3]), ("m600_loop", [5, 5]), ("m600_inline_sub", [2]),
                            ("m600_m98", [7]), ("m600_pct_crlf", [5])):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual(r["tool_change_lines"], [[ln, 2] for ln in lines], case)
            self.assertEqual([row[3] for row in r["toollen_table"]], lines, case)


class TestRemapBodies(unittest.TestCase):
    """Codex R106: a remapped code runs a body the text does not show."""

    def test_a_body_that_writes_a_key_is_in_the_programs_write_set(self):
        # VP-I59 rest: M200 → setter_write `#3009=4` — natively X4 after it
        r = probe("remap_write")
        self.assertIsNone(r["parse_error"])
        self.assertEqual(r["rapid"][-1][0], 4.0)
        self.assertEqual(r["toolsetter_meta"]["writes"], [3009])

    def test_a_foreign_m600_inside_another_remap_is_not_predicted(self):
        # VP-I61 rest (Codex R107's case verbatim): M200 → wrapper `T2 M600`
        # → the foreign othertc, whose `G53 G0 Z0` sits on ITS line 2 after
        # the main program's line 2 — the interpreter fires no next_line
        # there. Judged by the points, never by their line numbers: the
        # program's own move to (50, 50, −100) is the last known point; the
        # body's (50, 50, 0) is an unknown-start endpoint with no time, and
        # so is everything after it
        r = probe("foreign_remap_nested")
        self.assertIsNone(r["parse_error"])
        self.assertEqual([row[2] for row in r["probe_unpredicted"]], ["foreign_remap"])
        ev = path(r)
        own = next(q for q, k, p, ln in ev if p == (50.0, 50.0, -100.0))
        body = next(q for q, k, p, ln in ev if p == (50.0, 50.0, 0.0))
        self.assertEqual(r["probe_unpredicted"][0][0], own, "the stop before the body's first move")
        ustart = dict(zip(r["rapid_seq"], r["rapid_ustart"]))
        self.assertEqual({ustart.get(q) for q, *_ in ev if q > own}, {1})
        self.assertGreater(body, own)
        self.assertEqual(set(r["rapid_tcum"]), {0.0}, "no time for the body's move")

    def test_an_m_whose_value_is_open_is_no_m98_without_a_p_word(self):
        # RemapEnv.word_keys: such an M reaches only remapped M codes
        self.assertIn("no P-word", probe("m98_param_no_p")["parse_error"])


class TestNcSpellings(unittest.TestCase):
    """Which spellings the interpreter takes (scripts/test_fixtures/
    nc_spellings.json, run natively): the word reader the scanners share
    (gateway_util.nc_block_norm) never reads one it takes as "not that"
    (Codex R105 VP-I59, VP-I61)."""

    import json as _json, os as _os
    SPELL = _json.loads(open(_os.path.join(_os.path.dirname(__file__), "..", "scripts", "test_fixtures",
                                           "nc_spellings.json")).read())

    def test_every_setting_the_interpreter_takes_is_seen(self):
        from gateway_util import RemapEnv, toolsetter_assigned_keys
        taken = {}
        for name, text in self.SPELL["assign"].items():
            with self.subTest(name=name):
                r = probe("assign_" + name)
                if r["parse_error"]:
                    taken[name] = None
                    continue
                # `G0 X#3009` after it: 4 = the setting wrote #3009 (3 before)
                wrote = r["rapid"][-1][0] == 4.0
                taken[name] = wrote
                keys = toolsetter_assigned_keys(text, RemapEnv([], []))
                if wrote:
                    self.assertTrue(keys is None or 3009 in keys, f"{text!r} writes #3009, read as {keys}")
        # the interpreter's answers, pinned: every spelling here writes #3009
        # but these two, which it refuses (expressions need brackets; no
        # negative parameter)
        self.assertEqual({n for n, w in taken.items() if w is None}, {"unbracketed_sum", "negative_target"})
        self.assertEqual({n for n, w in taken.items() if w is False}, set())

    def test_literal_targets_are_read_exactly_and_the_rest_as_any(self):
        from gateway_util import RemapEnv, toolsetter_assigned_keys
        def f(text):
            return toolsetter_assigned_keys(text, RemapEnv([], []))
        any_ = {"double_hash", "named_indirect", "expression", "function", "unbracketed_sum", "negative_target",
                "minus_bracket_target"}
        for name, text in self.SPELL["assign"].items():
            with self.subTest(name=name):
                want = None if name in any_ else ({3009, 3010} if name == "two" else {3009})
                self.assertEqual(f(text), None if want is None else frozenset(want))

    def test_every_m_word_the_interpreter_takes_names_the_foreign_remap(self):
        from gateway_util import m_code_lines
        for name, text in self.SPELL["mword"].items():
            with self.subTest(name=name):
                r = probe("mword_" + name)
                self.assertIsNone(r["parse_error"], f"{text!r}")
                self.assertEqual([row[2] for row in r["probe_unpredicted"] or ()], ["foreign_remap"], f"{text!r}")
                if name != "called":
                    # its line (L4, after the call's set-up line where there is one)
                    self.assertIn(3 + text.count("\n") + 1, m_code_lines(
                        "G21 G90\nG0 X50 Y50 Z-100\nG1 X55 F100\n" + text + "\n", {"m600"}))
