"""The toolsetter set-up rule in the gateway (toolsetter_rules.py) is the
form's (toolsetterSetup.ts): this test holds the module to the committed
contract file; toolsetterRules.contract.test.ts holds the TypeScript side to
the same file (P2, Codex R308–R309)."""
import json
import unittest

import toolsetter_rules as tr


class TestToolsetterRules(unittest.TestCase):

    def test_the_contract_file_is_this_module(self):
        self.assertEqual(json.loads(tr.CONTRACT.read_text()), json.loads(json.dumps(tr.contract())),
                         "toolsetter_rules changed: run `python3 toolsetter_rules.py --write`")

    def test_a_complete_section_is_set_up_with_its_values_canonical(self):
        r = tr.setup({"touchX": 10, "touchY": 10, "touchZ": -180.1234567, "fastFeed": 2000, "slowFeed": 20,
                      "traverseFeed": 500, "maxZTravel": 180, "retractDist": 3, "spindleZeroHeight": 180})
        self.assertTrue(r["ok"], r)
        self.assertEqual(len(r["values"]), 23)
        self.assertEqual(r["values"][3102], -180.123457)           # the sent number, 6 decimals
        self.assertEqual(r["values"][3107], 5)                     # an unsaved option takes its default

    def test_a_missing_or_invalid_field_is_no_set_up(self):
        r = tr.setup({})
        self.assertFalse(r["ok"])
        self.assertEqual(r["reason"], tr.UNSET_REASON)
        self.assertEqual(r["missing"], list(tr.REQUIRED))
        good = {k: 1 for k in tr.REQUIRED}
        self.assertTrue(tr.setup(good)["ok"])
        for bad in ({"addReps": 1.5}, {"offsetValue": 101}, {"spindleStopM": 6}, {"touchZ": True}, {"touchZ": None}):
            r = tr.setup({**good, **bad})
            self.assertFalse(r["ok"], bad)
            self.assertEqual(r["reason"], tr.INVALID_REASON)


if __name__ == "__main__":
    unittest.main()
