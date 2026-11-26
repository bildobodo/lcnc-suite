"""R498: JSON library -> real get_tool_table reply and status metadata helper.
No native LinuxCNC. Loaded with -p conftest from the isolated archive.
"""
import json
from pathlib import Path
from test_tool_proof_gateway import _Tools
from tool_table import tool_visual_metadata


class TestR498MetadataBoundary(_Tools):
    def test_library_values_reach_both_drawing_sources(self):
        rows = []
        cases = [
            ("boolean number", {"flute_length": True}),
            ("array number", {"oal": [16]}),
            ("missing mesh arrays", {"native_mesh": {}}),
            ("empty mesh marker", {"native_mesh": []}),
            ("empty mesh arrays", {"native_mesh": {"vertices": [], "triangles": []}}),
            ("invalid profile marker", {"native_profile": False}),
            ("invalid shaft marker", {"shaft_segments": {}}),
            ("valid decimal control", {"flute_length": "16"}),
        ]
        for name, fields in cases:
            with self.subTest(name=name):
                meta = {"type": "endmill", "flute_length": 20, "oal": 60,
                        "shaft_segments": [{"height": 16, "lower_diameter": 12, "upper_diameter": 6}], **fields}
                self.store.save({"1": meta})
                reply = self.read()
                row = next(t for t in reply["tools"] if t["T"] == 1)
                status_meta = tool_visual_metadata(self.store.load()["1"])
                self.assertTrue(reply["ok"], reply)
                self.assertEqual(reply["proof"]["state"], "complete")
                for k, v in fields.items():
                    self.assertEqual(row[k], v)
                    self.assertEqual(status_meta[k], v)
                    self.assertIs(type(row[k]), type(v))
                    self.assertIs(type(status_meta[k]), type(v))
                rows.append({"name": name, "input": meta, "proof": reply["proof"]["state"],
                             "row_fields": {k: row[k] for k in fields}, "status_meta": status_meta})
        Path('/tmp/r498/wire-probe.json').write_text(json.dumps(rows, indent=2))


del _Tools
