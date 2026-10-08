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
        self.assertEqual(r["rapid_tcum"], [0.0, 0.0, 0.0], "nothing timed across the unknown")

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


if __name__ == "__main__":
    unittest.main()
