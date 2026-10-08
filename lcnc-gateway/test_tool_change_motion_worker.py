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

    def test_the_mode_a_block_runs_in_decides_after_it_ran(self):
        # Codex R93 VP-I51 A: the distance mode of a block shows only at the
        # next line, so no axis comes back inside a block — a G91 cycle or a
        # G91 G28 in one block, or with G91 before it, stays unknown with no
        # duration — and a G90 in the block of a full XYZ target makes the
        # next move known, as a G90 of its own line does.
        for case in ("r93_inline_g91_cycle", "r93_separate_g91_cycle", "r93_inline_g91_g28"):
            r = probe(case)
            self.assertEqual(set(r["rapid_ustart"]), {1}, case)
            self.assertEqual(set(r["rapid_tcum"]), {0.0}, case)
            self.assertEqual(r["feed"], [], case)
        for case in ("r93_g90_same_block", "r93_g90_separate_block"):
            r = probe(case)
            self.assertEqual(r["rapid_ustart"][-1], 0, case)
            self.assertAlmostEqual(r["rapid_tcum"][-1] - r["rapid_tcum"][-2], 1.0, places=5, msg=case)

    def test_a_rotated_frame_never_confirms_an_axis_left_out(self):
        # Codex R93 VP-I51 B: under G10 L2 R45 an `X10 Z15` moves machine X
        # and Y; Y was never commanded, so the next move stays unknown — with
        # R0 too — while a full `X10 Y5 Z15` makes it known.
        for case in ("r93_rotated_partial", "r93_unrotated_partial"):
            r = probe(case)
            self.assertEqual(r["rapid_ustart"], [1, 1, 1], case)
            self.assertEqual(set(r["rapid_tcum"]), {0.0}, case)
        r = probe("r93_rotated_complete")
        self.assertEqual(r["rapid_ustart"], [1, 1, 0])
        self.assertAlmostEqual(r["rapid_tcum"][2] - r["rapid_tcum"][1], 1.0, places=5)

    def test_a_block_re_establishes_an_axis_only_by_where_it_ends(self):
        # Codex R94 VP-I51 C: a G98 cycle moves Z to R and the bottom and
        # returns to the height before it — a stale one. Its end decides, and
        # under G98 its plane's normal axis never comes back: the machine
        # retracts to max(its REAL height, R), so the believed height below R
        # (the preview retracts to R, its block ends elsewhere) stays unknown
        # too, in G17 and in G18 (Y the cycle's axis). G99 ends at R: known.
        for case, n in (("r94_g98_cycle", 6), ("r94_g98_below_r", 6), ("r94_g98_g18_below_r", 7)):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual(r["rapid_lines"][-1], n, case)
            self.assertEqual(set(r["rapid_ustart"]), {1}, case)
            self.assertEqual(set(r["rapid_tcum"]), {0.0}, case)
        for case in ("r94_g99_cycle", "r94_g99_below_r", "r94_g99_g18_below_r"):
            r = probe(case)
            self.assertEqual(r["rapid_ustart"][-1], 0, case)
            self.assertAlmostEqual(r["rapid_tcum"][-1] - r["rapid_tcum"][-2], 1.0, places=5, msg=case)
        # Codex's position control: the G98 retract really goes to the
        # tool change height (Z30), not to the believed Z40.
        self.assertEqual(probe("r94_g98_cycle_position_control")["rapid"][-1], [20, 5, 30])
        # G76 moves X in and out and ends on its drive line — the stale start
        # — while Z ends at its commanded depth: X stays unknown, Z does not.
        r = probe("r94_g76_returns_x")
        self.assertIsNone(r["parse_error"])
        self.assertEqual((r["rapid_lines"][-1], r["rapid_ustart"][-1], r["rapid_tcum"][-1]), (7, 1, 0.0))
        self.assertEqual(r["rapid"][-2], [0, 3, -10], "G76 ends on its drive line X0")

    def test_a_later_rotation_makes_a_known_x_or_y_unknown_again(self):
        # Codex R94 VP-I51 D: X known, Y stale, then the frame turns — by
        # G10 L2 R or by a switch to a rotated fixture: the new program X
        # holds the unknown old Y, so `Y5 Z15` leaves the next move unknown.
        # A full target re-establishes it; without a turn (R0) the partial
        # knowledge stands.
        for case, n in (("r94_rotated_after_partial", 7), ("r94_fixture_rotated_after_partial", 8)):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual(r["rapid_lines"][-1], n, case)
            self.assertEqual(set(r["rapid_ustart"][1:]) - {0}, {1}, case)
            self.assertEqual(r["rapid_ustart"][-1], 1, case)
            self.assertEqual(set(r["rapid_tcum"]), {0.0}, case)
        for case in ("r94_unrotated_after_partial", "r94_rotated_complete", "r94_fixture_rotated_complete"):
            r = probe(case)
            self.assertEqual(r["rapid_ustart"][-1], 0, case)
            self.assertAlmostEqual(r["rapid_tcum"][-1] - r["rapid_tcum"][-2], 1.0, places=5, msg=case)
        # Codex's position control: the omitted program X is 21.213 there.
        r = probe("r94_rotated_after_partial_position_control")
        self.assertAlmostEqual(r["rapid_tcum"][-1] - r["rapid_tcum"][-2], 0.121320, places=5)

    def test_the_line_number_is_no_g_code(self):
        # Slot 0 of the state's G codes is the sequence number: the move at
        # line 910 does not read as G91, the one at line 810 under G98 not as
        # a G81 — the full target before each makes it known.
        for case, n in (("r94_line_910", 910), ("r94_line_810_g98", 810)):
            r = probe(case)
            self.assertEqual(r["rapid_lines"][-1], n, case)
            self.assertEqual(r["rapid_ustart"][-1], 0, case)
            self.assertAlmostEqual(r["rapid_tcum"][-1] - r["rapid_tcum"][-2], 1.0, places=5, msg=case)

    def test_an_offset_set_from_the_unknown_position_keeps_the_rest_unknown(self):
        # Codex R95 VP-I53: G92 / G10 L20 after the unseen change are
        # computed from the preview's guess — an absolute move does not repair
        # them, a fixture switched to later carries them. Every later move
        # stays unknown, untimed, and the payload names the line.
        for case in ("r95_g92_from_stale", "r95_l20_from_stale", "r95_l20_inactive",
                     "r95_l20_inactive_comment", "r95_l20_inactive_hidden",
                     "r95_g28_1_from_stale", "r95_g28_1_hidden", "r95_g30_1_from_stale"):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual(r["rapid_ustart"][-1], 1, case)
            self.assertEqual(set(r["rapid_tcum"]), {0.0}, case)
            self.assertEqual(r["stale_offset_lines"], [4], case)
            self.assertIsNone(r["stale_offset_untracked"], case)
        # An L20 on an INACTIVE fixture takes effect at the switch to it: the
        # move before the switch, positioned in G54, is known again.
        r = probe("r95_l20_inactive")
        self.assertEqual(r["rapid_lines"], [2, 5, 7, 7, 8])
        self.assertEqual(r["rapid_ustart"], [1, 1, 0, 1, 1])

    def test_an_explicit_offset_a_reset_or_an_earlier_one_stays_known(self):
        # The text tells an explicit G10 L2 from an L20 (no canon call does):
        # Codex's control keeps its known move; G92.1 is an explicit zero; a
        # G92 BEFORE the change came from a known position.
        for case in ("r95_l2_constant", "r95_g92_1_from_stale", "r95_g92_before_change"):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual(r["rapid_ustart"][-1], 0, case)
            self.assertAlmostEqual(r["rapid_tcum"][-1] - r["rapid_tcum"][-2], 1.0, places=5, msg=case)
            self.assertIsNone(r["stale_offset_lines"], case)
        # Codex's position controls: no unseen change, nothing unknown
        for case in ("r95_g92_from_stale_position_control", "r95_l20_from_stale_position_control",
                     "r95_l20_inactive_position_control"):
            r = probe(case)
            self.assertEqual(r["rapid_ustart"][1:], [0] * (len(r["rapid_ustart"]) - 1), case)
            self.assertIsNone(r["stale_offset_lines"], case)

    def test_lines_out_of_text_order_fall_back_to_the_callbacks_and_say_so(self):
        # An o-word loop: the text's order is not the run's. A G92 still
        # reports itself and keeps the rest unknown; the payload says what is
        # not tracked (an inactive fixture's write, a store, in a sub).
        r = probe("r95_oword_g92")
        self.assertEqual(r["rapid_ustart"][-1], 1)
        self.assertEqual(r["stale_offset_lines"], [6])
        self.assertIs(r["stale_offset_untracked"], True)
        # A G92 in a called subroutine FILE: only its callback reports it, and
        # its line number is the sub file's — named 0 ("no main-file line"),
        # never the main file's line of that number.
        r = probe("r95_sub_g92")
        self.assertIsNone(r["parse_error"])
        self.assertEqual(r["rapid_ustart"][-1], 1)
        self.assertEqual(r["stale_offset_lines"], [0])
        self.assertIs(r["stale_offset_untracked"], True)
        r = probe("r95_oword_no_write")
        self.assertEqual(r["rapid_ustart"][-1], 0)
        self.assertIsNone(r["stale_offset_lines"])
        self.assertIs(r["stale_offset_untracked"], True)

    def test_a_call_into_another_file_spelled_any_way(self):
        # Codex R98 VP-I53 rest: `o<touch> c a l l` is a call (whitespace
        # counts nowhere outside a comment) — the main file's explicit L2 of
        # the same number does not swallow the sub file's G92, L7 stays
        # unknown. VP-I56: that G92 is named 0, never the main file's L2.
        for case in ("r98_foreign_plain", "r98_foreign_spaced"):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual(r["rapid_ustart"][-1], 1, case)
            self.assertEqual(set(r["rapid_tcum"][-2:]), {r["rapid_tcum"][-3]}, case)
            self.assertEqual(r["stale_offset_lines"], [0], case)
            self.assertIs(r["stale_offset_untracked"], True, case)
        r = probe("r98_foreign_spaced_position_control")
        self.assertEqual(r["rapid_ustart"][-1], 0)
        self.assertIsNone(r["stale_offset_lines"])

    def test_an_o_word_whose_name_is_no_literal_is_read_as_one(self):
        # Codex R99 VP-I53 rest: `o+100 call` / `oABS[-100] call` run
        # 100.ngc natively — its G92 keeps L7 unknown, named 0 (never the
        # main file's explicit L2); `o+100 if [0]` skips its G92 (L8 known,
        # timed), `o+100 if [1]` runs it (L8 unknown).
        for case in ("r99_o_plus", "r99_o_function", "r99_plus_run"):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual(r["rapid_ustart"][-1], 1, case)
            self.assertEqual(r["stale_offset_lines"], [0], case)
            self.assertIs(r["stale_offset_untracked"], True, case)
        r = probe("r99_plus_skip")
        self.assertEqual(r["rapid_ustart"][-1], 0)
        self.assertAlmostEqual(r["rapid_tcum"][-1] - r["rapid_tcum"][-2], 1.0, places=5)
        self.assertIsNone(r["stale_offset_lines"])
        r = probe("r99_o_plus_position_control")
        self.assertEqual(r["rapid_ustart"][-1], 0)
        self.assertIsNone(r["stale_offset_lines"])

    def test_any_spelling_of_a_write_is_seen(self):
        # Codex R96 VP-I53 rest: G92.0, G10.0, G28.10 are the same codes; a
        # G word the text cannot settle (G[90+2]) counts as a write. An
        # explicit G10.0 L2 stays explicit.
        for case in ("r96_g92_decimal", "r96_g92_expression", "r96_g10_decimal",
                     "r96_g92_standard", "r96_store_decimal"):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual(r["rapid_ustart"][-1], 1, case)
            self.assertEqual(r["stale_offset_lines"], [4], case)
        r = probe("r96_l2_decimal")
        self.assertEqual(r["rapid_ustart"][-1], 0)
        self.assertIsNone(r["stale_offset_lines"])

    def test_a_branch_that_never_runs_writes_nothing(self):
        # Codex R96 VP-I54: with o-words a gap between line numbers proves
        # nothing ran — the G92 of an `if [0]` writes nothing, L8 is known
        # again; run (`if [1]`), its callback reports it.
        r = probe("r96_branch_not_run")
        self.assertEqual(r["rapid_ustart"][-1], 0)
        self.assertAlmostEqual(r["rapid_tcum"][-1] - r["rapid_tcum"][-2], 1.0, places=5)
        self.assertIsNone(r["stale_offset_lines"])
        self.assertIs(r["stale_offset_untracked"], True)
        r = probe("r96_branch_run")
        self.assertEqual(r["rapid_ustart"][-1], 1)
        self.assertEqual(r["stale_offset_lines"], [5])
        # (an inactive fixture's L20 in a branch that runs: tracked since R97,
        # test_a_sign_and_a_value_computed_equal_hide_no_write)

    def test_a_sign_and_a_value_computed_equal_hide_no_write(self):
        # Codex R97 VP-I53 rest: numbers take a sign (L+20, G+28.1, G+92);
        # a G92 Z40 / G10 L20 Z40 inside a branch that runs computes the old
        # value at the believed Z40 — the controller's report is the
        # evidence, not the value. The position controls stay known.
        for case, line in (("r97_l_plus_active", 4), ("r97_g_plus_active", 4), ("r97_l_plus_inactive", 4),
                           ("r97_store_plus", 4), ("r97_branch_same_g92", 5), ("r97_branch_same_l20", 5),
                           ("r97_branch_different_g92", 5)):
            r = probe(case)
            self.assertIsNone(r["parse_error"], case)
            self.assertEqual(r["rapid_ustart"][-1], 1, case)
            self.assertEqual(set(r["rapid_tcum"]), {0.0}, case)
            self.assertEqual(r["stale_offset_lines"], [line], case)
        for case in ("r97_l_plus_explicit", "r97_branch_reselect", "r97_l_plus_active_position_control",
                     "r97_l_plus_inactive_position_control", "r97_store_plus_position_control",
                     "r97_branch_same_g92_position_control", "r97_branch_same_l20_position_control"):
            r = probe(case)
            self.assertEqual(r["rapid_ustart"][-1], 0, case)
            self.assertIsNone(r["stale_offset_lines"], case)
        # an inactive fixture's L20 inside a branch that runs: the line had its
        # own next_line (it ran), and inline subs keep this file's numbers
        self.assertEqual(probe("r96_branch_inactive_l20")["stale_offset_lines"], [5])

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
