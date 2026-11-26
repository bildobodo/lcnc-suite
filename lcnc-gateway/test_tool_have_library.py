"""get_tool_table's `have_library` (P6-c plan v8 §1.8, Codex R480/R482): the
caller names the library revision it holds; when it is THIS read's, the rows
leave out the form payload by name and nothing else, `library.state` says
"same". A composed reply (same + the forms of the full one) is the full one.
Through handle_command, on a real tool.tbl and tool_library.json."""
import json
import unittest

import fake_linuxcnc

fake_linuxcnc.install()
import gateway  # noqa: E402
import tool_proof  # noqa: E402
from link_fixture import current  # noqa: E402
from test_tool_proof_gateway import LIBRARY, _Tools  # noqa: E402
from tool_io_fixture import load_into  # noqa: E402
from tool_table import FORM_PAYLOAD_FIELDS, _TOOL_META_FIELDS  # noqa: E402

MESH = {"vertices": [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 5]], "triangles": [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]}
FORMS = {"1": {"type": "formmill", "native_mesh": MESH, "oal": 5, "source_metadata": {"version": 2, "name": "x"}},
         "2": {"type": "ball", "native_profile": [[0, 0], [3, 0], [3, 40], [0, 40]], "description": "two"},
         "3": {"type": "endmill", "shaft_segments": [{"height": 5, "lower_diameter": 6, "upper_diameter": 6}],
               "holder_segments": [{"height": 5, "lower_diameter": 20, "upper_diameter": 20}],
               "profile": [{"end": [0, 0]}, {"end": [2, 0]}, {"end": [2, 9]}, {"end": [0, 9]}]}}


class TestHaveLibrary(_Tools):

    def setUp(self):
        super().setUp()
        self.store.save(json.loads(json.dumps(FORMS)))

    def get(self, **fields):
        gateway._cmd_lock = None
        import asyncio
        return asyncio.run(gateway.handle_command({"cmd": "get_tool_table", **fields}, False))

    def test_the_names_are_the_form_payload(self):
        self.assertEqual(set(FORM_PAYLOAD_FIELDS),
                         {"native_mesh", "native_profile", "profile", "shaft_segments", "holder_segments",
                          "source_metadata"})
        self.assertTrue(set(FORM_PAYLOAD_FIELDS) <= set(_TOOL_META_FIELDS))

    def test_a_full_read_says_full_and_carries_everything(self):
        r = self.get()
        self.assertEqual(r["library"], {"state": "full", "rev": tool_proof.library_rev(FORMS)})
        self.assertEqual(r["library"]["rev"], r["rev"]["library"])
        by = {t["T"]: t for t in r["tools"]}
        self.assertEqual(by[1]["native_mesh"], MESH)
        self.assertEqual(set(by[1]) >= set(FORM_PAYLOAD_FIELDS), True)

    def test_same_leaves_out_exactly_the_payload(self):
        full = self.get()
        same = self.get(have_library=full["rev"]["library"])
        self.assertEqual(same["library"], {"state": "same", "rev": full["rev"]["library"]})
        self.assertEqual(len(same["tools"]), 3)
        for f, s in zip(full["tools"], same["tools"]):
            self.assertEqual(s, {k: v for k, v in f.items() if k not in FORM_PAYLOAD_FIELDS})
        self.assertEqual({k: v for k, v in same.items() if k not in ("tools", "library")},
                         {k: v for k, v in full.items() if k not in ("tools", "library")})

    def test_a_changed_remark_still_changes_the_description(self):
        # T3's library entry has no description: it falls back to the remark
        rev = self.get()["rev"]["library"]
        self.table.write_text(self.table.read_text().replace("; third", "; third, resharpened"))
        load_into(current().stat, self.table)
        same = self.get(have_library=rev)
        by = {t["T"]: t for t in same["tools"]}
        self.assertEqual((same["library"]["state"], by[3]["description"], by[2]["description"]),
                         ("same", "third, resharpened", "two"))

    def test_another_revision_is_full(self):
        rev = self.get()["rev"]["library"]
        self.store.save({**json.loads(json.dumps(FORMS)), "2": {"type": "flat"}})
        r = self.get(have_library=rev)
        self.assertEqual(r["library"], {"state": "full", "rev": r["rev"]["library"]})
        self.assertIn("native_mesh", r["tools"][0])

    def test_what_is_no_revision_is_full(self):
        rev = self.get()["rev"]["library"]
        for have in (None, "", rev[:-1], rev.upper() + "x", 5, True, [rev], {"rev": rev}):
            self.assertEqual(self.get(have_library=have)["library"]["state"], "full", repr(have))

    def test_a_failed_read_names_no_library(self):
        rev = self.get()["rev"]["library"]
        self.store._path.write_text("{")
        r = self.get(have_library=rev)
        self.assertEqual((r["ok"], "library" in r, "tools" in r), (False, False, False))

    def test_the_library_itself_is_untouched(self):
        rev = self.get()["rev"]["library"]
        self.get(have_library=rev)
        self.assertEqual(self.store.load(), FORMS)
        self.assertEqual(self.get()["tools"][0]["native_mesh"], MESH)

    def test_one_revision_per_file_state_through_the_command(self):
        import tool_store
        from unittest.mock import patch
        n = []
        real = tool_store.library_rev
        with patch.object(tool_store, "library_rev", lambda s: (n.append(1), real(s))[1]):
            for _ in range(4):
                self.get()
        self.assertEqual(len(n), 1)
        self.assertEqual(LIBRARY, {"1": {"type": "flat"}, "2": {"type": "ball"}})


del _Tools

if __name__ == "__main__":
    unittest.main()
