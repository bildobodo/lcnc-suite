"""The move after a G43 / G49 or an M6 against the REAL worker and LinuxCNC's
native offline interpreter (native_start_probe.py, one fresh process per
case). It reports `skip` where the native modules are missing.

Operator 2026-10-07 (haus.ngc, L18 `G43 Z15. H13`): the preview followed axis'
convention and took the move after every G43 and M6 for one whose start is
unknown — a zero-length endpoint: 0 s on the timeline, its limit row tied with
the next line's collision, and the collision sweep checked it at its end only.
A G43 moves nothing; nor does an M6 the controller has no tool change position
for. Their next move starts where the machine stands: a relabel vertex (the
pose re-expressed in the new offset's frame, `brk`), then the real move —
timed, limit-checked and swept along its path. Only a controller that moves at
the change (TOOL_CHANGE_POSITION) keeps the unknown start."""
import unittest

from test_start_tlo_worker import probe


class TestToolOffsetMove(unittest.TestCase):

    def test_the_move_after_a_g43_is_a_real_move(self):
        r = probe("g43_mid")
        self.assertIsNone(r["parse_error"])
        # L2 the first move (unknown start), L3, then L5 `G0 Z15`: the relabel
        # vertex where the machine stands — tip Z40 under no offset is Z30
        # under the new Z10 — and the move from there.
        self.assertEqual(r["rapid"], [[0, 0, 40], [10, 0, 40], [10, 0, 30], [10, 0, 15]])
        self.assertEqual(r["rapid_lines"], [2, 3, 5, 5])
        self.assertEqual(r["rapid_brk"], [0, 0, 1, 0], "the relabel connector, nothing else")
        self.assertEqual(r["rapid_ustart"], [1, 0, 0, 0], "only the program's own start is unknown")
        t = r["rapid_tcum"]
        self.assertAlmostEqual(t[2] - t[1], 0.0, places=6, msg="the relabel takes no time")
        self.assertAlmostEqual(t[3] - t[2], 1.5, places=5, msg="15 mm at 10 mm/s")
        self.assertEqual(r["violations"], [])

    def test_a_g43_in_the_block_of_the_move_with_a_traverse_a_feed_or_before_an_arc(self):
        # Codex R91 on R92: only a traverse used to lose its start; a feed or
        # an arc after a G43 ran from the previous point in the OLD frame —
        # the relabel serves all three. (G43 without H: the spindle tool, Z10.)
        r = probe("g43_g0_block")
        self.assertEqual(r["rapid"], [[0, 0, 40], [10, 0, 40], [10, 0, 30], [10, 0, 15]])
        self.assertEqual((r["rapid_brk"], r["rapid_ustart"]), ([0, 0, 1, 0], [1, 0, 0, 0]))
        self.assertAlmostEqual(r["rapid_tcum"][3] - r["rapid_tcum"][2], 1.5, places=5)
        r = probe("g43_g1_block")
        self.assertEqual(r["rapid"], [[0, 0, 40], [10, 0, 40], [10, 0, 30]])
        self.assertEqual(r["rapid_brk"], [0, 0, 1])
        self.assertEqual(r["feed"], [[10, 0, 5]])
        self.assertEqual(r["feed_seq"], [r["rapid_seq"][2] + 1], "the feed starts at the relabel")
        self.assertAlmostEqual(r["feed_tcum"][0], 25 / (100 / 60), places=3)   # 25 mm at F100
        r = probe("g43_arc")
        self.assertEqual(r["rapid"], [[0, 0, 40], [0, 0, 30]])
        self.assertEqual(r["rapid_brk"], [0, 1])
        self.assertTrue(all(abs(p[2] - 30) < 1e-6 for p in r["feed"]), "the arc runs at Z30, no phantom")
        self.assertAlmostEqual(r["feed_tcum"][-1], 3.14159265 * 5 / (100 / 60), delta=0.05)
        r = probe("g43_alone")
        self.assertIsNone(r["parse_error"])
        self.assertEqual((r["rapid"], r["rapid_ustart"]), ([[0, 0, 40]], [1]))

    def test_a_g43_does_not_make_an_unknown_start_known(self):
        r = probe("m6_tc_then_g43")
        self.assertEqual(r["rapid_ustart"][-1], 1)
        self.assertEqual(set(r["rapid_tcum"]), {0.0}, "nothing timed across the unknown")
        self.assertNotIn(1, r["rapid_brk"] or [], "no relabel in front of an unknown start (R92)")

    def test_an_m6_that_moves_nothing_keeps_the_next_start(self):
        r = probe("m6_in_place")
        self.assertIsNone(r["parse_error"])
        self.assertEqual(r["rapid"], [[0, 0, 40], [10, 5, 40]])
        self.assertEqual(r["rapid_ustart"], [1, 0])
        self.assertAlmostEqual(r["rapid_tcum"][1], 125 ** 0.5 / 10, places=5)

    def test_the_interpreter_s_g30_move_at_an_m6_is_recorded(self):
        # TOOL_CHANGE_AT_G30: the interpreter traverses to G30 (#5181 = X10,
        # Y0 Z0 here) before CHANGE_TOOL — a canon call, on the M6's line. It
        # used to arrive as line -1 and end the parse in an OverflowError.
        r = probe("m6_at_g30")
        self.assertIsNone(r["parse_error"])
        self.assertEqual(r["rapid"], [[0, 0, 40], [10, 0, 0], [10, 5, 0]])
        self.assertEqual(r["rapid_lines"], [2, 3, 4])
        self.assertEqual(r["rapid_ustart"], [1, 0, 0])
        self.assertAlmostEqual(r["rapid_tcum"][1], (100 + 1600) ** 0.5 / 10, places=4)

    def test_an_m6_at_a_tool_change_position_leaves_the_next_start_unknown(self):
        # Positive control: the controller moves the machine where the
        # preview cannot see it, so the move after the change starts unknown.
        r = probe("m6_tc_position")
        self.assertIsNone(r["parse_error"])
        self.assertEqual(r["rapid_ustart"], [1, 1])
        self.assertEqual(r["rapid_tcum"], [0.0, 0.0])


class TestUnknownStartAfterAToolChange(unittest.TestCase):
    """Codex R92 VP-I51: after an M6 at a tool change position the preview
    interpreter computes every left-out axis, an arc's centre and every G91
    move from its OLD position (it resyncs from its own last endpoint). While
    an axis is stale every motion kind is a zero-length unknown-start
    endpoint — no invented path, no duration; an absolute move re-establishes
    the axes it moves."""

    def test_every_motion_kind_from_an_unknown_start_is_an_endpoint(self):
        for case, end in (("r92_m6_feed", [10, 5, 15]), ("r92_m6_arc", [10, 0, 40]),
                          ("r92_m6_g43_feed", [10, 5, 15])):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual(r["feed"], [], f"{case}: no feed path from a guessed start")
            self.assertEqual(r["rapid"][-1], end, case)
            self.assertEqual(r["rapid_ustart"][-1], 1, case)
            self.assertEqual(r["rapid_tcum"][-1], 0.0, f"{case}: no duration")
            self.assertNotIn(1, r["rapid_brk"] or [], f"{case}: no relabel before an unknown start")

    def test_the_position_is_known_again_once_every_stale_axis_is_commanded(self):
        r = probe("r92_m6_feed_then_rapid")        # X Y Z all commanded by the feed
        self.assertEqual(r["rapid_ustart"], [1, 1, 0])
        self.assertAlmostEqual(r["rapid_tcum"][2] - r["rapid_tcum"][1], 0.5, places=5)
        r = probe("m6_tc_partial")                 # G0 X Y leaves Z stale; G0 Z settles it
        self.assertEqual(r["rapid_ustart"], [1, 1, 1, 0])
        self.assertAlmostEqual(r["rapid_tcum"][3] - r["rapid_tcum"][2], 1.0, places=5)

    def test_g91_never_re_establishes_an_axis(self):
        # G91 before the move, and in the move's own block (seen at the next
        # line): no axis comes back; under G90 an axis commanded to the value
        # the preview already believes (Y5) cannot be told from one left out.
        # A G91 drilling cycle is several motions in ONE block: an axis must
        # not come back inside it (the correction at the next line would come
        # after its feed and retract were recorded as known).
        for case in ("m6_tc_g91", "m6_tc_g91_block", "m6_tc_g91_cycle"):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual(set(r["rapid_ustart"][1:]), {1}, case)
            self.assertEqual(set(r["rapid_tcum"]), {0.0}, case)

    def test_the_interpreter_s_own_tool_change_moves_stay_known(self):
        # Codex R92's controls: quill-up, G30 twice, both — canon traverses on
        # the M6's line, the move after them timed.
        for case, lines in (("r92_m6_quill", [2, 3, 4]), ("r92_m6_g30_twice", [2, 3, 4, 5, 6]),
                            ("r92_m6_quill_g30", [2, 3, 3, 4])):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual(r["rapid_lines"], lines, case)
            self.assertEqual(r["rapid_ustart"][1:], [0] * (len(lines) - 1), case)
            self.assertGreater(r["rapid_tcum"][-1], r["rapid_tcum"][-2], case)


if __name__ == "__main__":
    unittest.main()
