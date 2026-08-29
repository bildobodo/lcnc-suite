"""Pin the two touch-off provenance twins to each other.

The gateway STAMPS the parameters (gateway_util.wcs_prov_params) and the
TWP remap READS them (examples/sim_config/twp/python/twp_prov.py). Both
are plain layout arithmetic, and each docstring says "twin of the other" —
which is a promise nothing enforced until this file. remap.py itself is
unimportable off-machine (interpreter/hal), so the fork keeps its layout
in a linuxcnc-free module precisely so it can be imported HERE, with a
real import rather than a source-text scrape.

Change the layout on one side and this test names the other.
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

import twp_prov  # noqa: E402
import gateway_util  # noqa: E402


class TestProvenanceTwins(unittest.TestCase):
    def test_constants_agree(self):
        self.assertEqual(twp_prov.PROV_BASE, gateway_util.WCS_PROV_BASE)
        self.assertEqual(twp_prov.PROV_STRIDE, gateway_util.WCS_PROV_STRIDE)
        self.assertEqual(twp_prov.PROV_STAMPED, gateway_util.PROV_STAMPED)

    def test_slot_layout_agrees_for_every_fixture(self):
        # Not just base/stride: the ROLE of each slot (which one is the flag,
        # which is A) is what a consumer reads, so the whole dict must match.
        for i in range(1, 10):
            self.assertEqual(twp_prov.prov_params(i),
                             gateway_util.wcs_prov_params(i), i)

    def test_both_refuse_out_of_range(self):
        for bad in (0, 10, -1):
            with self.assertRaises(ValueError):
                twp_prov.prov_params(bad)
            with self.assertRaises(ValueError):
                gateway_util.wcs_prov_params(bad)

    def test_rows_never_collide_with_defined_fixture_rows(self):
        # G54..G59.3 occupy 5221+20k .. 5230+20k; the stamp must sit in the
        # gap 5231+20k .. 5240+20k and never alias a neighbour's row.
        for i in range(1, 10):
            for n in twp_prov.prov_params(i).values():
                k = (n - 5221) // 20
                self.assertEqual(k, i - 1, n)
                self.assertGreaterEqual(n - (5221 + 20 * k), 10, n)
                self.assertLess(n - (5221 + 20 * k), 20, n)


if __name__ == "__main__":
    unittest.main()
