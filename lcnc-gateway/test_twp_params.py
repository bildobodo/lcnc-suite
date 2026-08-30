"""Pin the fixture-parameter layout twins to each other.

The gateway reads var-file fixture rows (gateway_util.WCS_VAR_BASES,
read_var_wcs_rows) and the TWP remap reads the same rows through the
interpreter (examples/sim_config/twp/python/twp_params.py) — to add work
offsets back onto raw rotary reads, to refuse a G92 rotary, and to clear the
reserved rows at every orient. Same doctrine as test_twp_prov: the layout
lives in one linuxcnc-free module per side and this test names the other.
"""
import os
import sys
import unittest

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "examples", "sim_config", "twp", "python",
    ),
)

import twp_params  # noqa: E402
import gateway_util  # noqa: E402


class TestFixtureParamTwins(unittest.TestCase):
    def test_bases_agree_with_the_gateway(self):
        # gateway: base+1+j for the 9 axes, base+10 for R; fork: X at base.
        for i, gbase in enumerate(gateway_util.WCS_VAR_BASES, start=1):
            row = twp_params.wcs_row_params(i)
            for j, letter in enumerate("XYZABCUVW"):
                self.assertEqual(row[letter], gbase + 1 + j, (i, letter))
            self.assertEqual(row["R"], gbase + 10, i)

    def test_known_rows(self):
        # The rows the live var file showed poisoned (G59 A/B/C).
        self.assertEqual(twp_params.wcs_row_params(6)["A"], 5324)
        self.assertEqual(twp_params.wcs_row_params(6)["B"], 5325)
        self.assertEqual(twp_params.wcs_row_params(6)["C"], 5326)
        self.assertEqual(twp_params.wcs_row_params(1)["X"], 5221)
        self.assertEqual(twp_params.wcs_row_params(9)["R"], 5390)
        self.assertEqual(twp_params.G92_PARAMS["A"], 5214)

    def test_reserved_rows_are_the_top_four(self):
        self.assertEqual(twp_params.RESERVED_FIXTURES, (6, 7, 8, 9))

    def test_index_range(self):
        with self.assertRaises(ValueError):
            twp_params.wcs_row_params(0)
        with self.assertRaises(ValueError):
            twp_params.wcs_row_params(10)
        self.assertEqual(twp_params.active_index({5220: 6.0}), 6)


if __name__ == "__main__":
    unittest.main()
