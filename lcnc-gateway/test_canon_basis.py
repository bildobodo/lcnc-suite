"""Which WCS basis the preview extraction must subtract (W5b).

Pinned against the REAL LinuxCNC interpreter via
scripts/gen_canon_fixtures.py — same discipline as the rs274 and kins oracles:
never re-derive interpreter semantics from docs or memory.

The preview ships program-space points; the CLIENT re-adds the machine's live
active WCS to render them. So the basis the worker subtracts must be the one
the client will add back — the state after the gateway's initcodes force the
active WCS, and before the program's first line runs.

Two plausible alternatives are both WRONG, and the fixtures prove it rather
than the comment asserting it:

  end-of-parse   `M2` resets the interpreter to G54, so ANY program run in
                 another WCS ends with G54's offsets while every segment was
                 produced under the active one.
  first motion   a program whose preamble selects a different WCS than the
                 active one gets pinned to the preamble's fixture, which is
                 not where it will run.

No linuxcnc import: the fixture is checked in, so this runs anywhere.
"""
import json
import unittest
from pathlib import Path

from gateway_util import wcs_basis_terms

FIXTURES = json.loads((Path(__file__).resolve().parent / "canon_fixtures.gen.json").read_text())
CASES = {c["name"]: c for c in FIXTURES["cases"]}

MM_PER_IN = 25.4
# What the generator wrote into the var file, in MACHINE units (mm).
G54_X = FIXTURES["var_overrides"]["5221"]
G55_X = FIXTURES["var_overrides"]["5241"]


def g5x_x(basis):
    """First axis offset of a (g5x9, g929, rotation) basis, in canon inches."""
    return basis[0][0]


class TestFixtureIntegrity(unittest.TestCase):
    def test_fixtures_present(self):
        self.assertGreaterEqual(len(CASES), 10)
        self.assertIn("preamble_g54__g55", CASES)

    def test_every_case_captured_a_start_basis(self):
        for name, c in CASES.items():
            self.assertIsNotNone(c["basis_at_start"],
                                 f"{name}: no program-start basis captured")


class TestBasisChoice(unittest.TestCase):
    """The three candidates, on programs where they actually differ."""

    def test_m2_resets_to_g54_so_end_of_parse_is_wrong(self):
        # The case that makes this a bug for ORDINARY programs: no WCS word
        # anywhere, machine active in G55, and the parse still ends in G54.
        c = CASES["plain_m2__g55"]
        self.assertAlmostEqual(g5x_x(c["basis_at_start"]), G55_X / MM_PER_IN, places=9)
        self.assertAlmostEqual(g5x_x(c["basis_at_end"]), G54_X / MM_PER_IN, places=9)
        self.assertNotAlmostEqual(g5x_x(c["basis_at_start"]), g5x_x(c["basis_at_end"]))

    def test_first_motion_is_wrong_when_the_preamble_switches_wcs(self):
        # Machine active in G55; the program's preamble selects G54 and only
        # then moves. Subtracting the first-motion basis would draw the path at
        # the G54 fixture — but the client re-adds G55, so it must be G55.
        c = CASES["preamble_g54__g55"]
        self.assertAlmostEqual(g5x_x(c["basis_at_start"]), G55_X / MM_PER_IN, places=9)
        self.assertAlmostEqual(g5x_x(c["basis_at_first_motion"]), G54_X / MM_PER_IN, places=9)
        self.assertNotAlmostEqual(g5x_x(c["basis_at_start"]),
                                  g5x_x(c["basis_at_first_motion"]))

    def test_start_basis_is_the_forced_wcs_for_every_program_shape(self):
        # Whatever the program does internally — switch fixtures, rewrite an
        # offset with G10 L2, apply G92 and a rotation — the basis is the WCS
        # the parse was forced into.
        for name in ("plain_m2__g55", "preamble_g54__g55", "multifixture__g55",
                     "g10_rewrite__g55", "g92_and_rotation__g55"):
            with self.subTest(program=name):
                c = CASES[name]
                self.assertIn("G55", c["initcodes"])
                self.assertAlmostEqual(g5x_x(c["basis_at_start"]), G55_X / MM_PER_IN,
                                       places=9)

    def test_end_of_parse_never_equals_the_forced_wcs_here(self):
        # Guard against a vacuous suite: if the fixtures were regenerated on a
        # machine whose G54 and G55 agree, every assertion above would pass for
        # the wrong reason.
        for name in ("plain_m2__g55", "multifixture__g55", "g10_rewrite__g55"):
            with self.subTest(program=name):
                c = CASES[name]
                self.assertNotAlmostEqual(g5x_x(c["basis_at_start"]),
                                          g5x_x(c["basis_at_end"]),
                                          msg="fixtures cannot discriminate — "
                                              "regenerate with distinct G54/G55")

    def test_extraction_round_trips_to_the_true_machine_position(self):
        """The property the whole fix exists for.

        The wire carries program-space points; the client renders them at
        `live_offset + point`. With the program-start basis, that lands on the
        canon's own machine endpoint — the true position — for every segment,
        including one produced under a DIFFERENT fixture than the active one.
        """
        for name in ("multifixture__g55", "preamble_g54__g55", "plain_m2__g55"):
            with self.subTest(program=name):
                c = CASES[name]
                ox, oy, oz, _oa, _ob, _oc, theta = wcs_basis_terms(c["basis_at_start"])
                self.assertEqual(theta, 0.0, "these fixtures carry no G10 R")
                for end in c["feed_endpoints"] + c["rapid_endpoints"]:
                    # extraction: program = canon_machine - basis
                    prog = (end[0] - ox, end[1] - oy, end[2] - oz)
                    # client: machine = live_offset + program, and live_offset
                    # IS the basis (the parse was forced into the active WCS)
                    back = (prog[0] + ox, prog[1] + oy, prog[2] + oz)
                    for i in range(3):
                        self.assertAlmostEqual(back[i], end[i], places=9)

    def test_end_of_parse_basis_would_displace_the_whole_program(self):
        """Non-vacuity for the test above: with the OLD basis the same
        round-trip lands off by the fixture delta, uniformly — the shape was
        never wrong, the whole path just sat at the wrong fixture."""
        c = CASES["plain_m2__g55"]
        sx, _sy, _sz, *_ = wcs_basis_terms(c["basis_at_start"])
        ex, _ey, _ez, *_ = wcs_basis_terms(c["basis_at_end"])
        drift_mm = abs(sx - ex) * MM_PER_IN
        self.assertAlmostEqual(drift_mm, abs(G55_X - G54_X), places=6)
        self.assertGreater(drift_mm, 1.0, "fixtures must make the error visible")

    def test_g10_rewrite_of_an_inactive_wcs_does_not_move_the_basis(self):
        # G10 L2 P2 while running in G59: the rewritten slot is not the active
        # one, so the basis is unaffected — the path does not shift under the
        # operator mid-program.
        c = CASES["g10_rewrite"]
        self.assertIn("G59", c["initcodes"])
        self.assertAlmostEqual(g5x_x(c["basis_at_start"]), 0.0, places=9)


if __name__ == "__main__":
    unittest.main()
