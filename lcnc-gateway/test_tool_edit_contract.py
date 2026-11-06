"""F-TOOLEDIT.S4, the gateway's part (Codex R321–R322 FI321-02): each tool
edit changes exactly its record — every value of the untouched records (all
fields, the comment, the library metadata) stays, an unsent field of its own
stays — and the table is reloaded once. Value equality, not bytes: the writer
may sort and reformat. Two defects R321 found: the writer dropped X/Y (and
the parser never read A–C, U–W, I, J, Q), and renumber_tool set an unsent
pocket to the new number. The real tool.tbl and tool_library.json in a
temporary folder; LinuxCNC's own reload is the native part (S4b, open)."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()
import gateway  # noqa: E402
from test_button_gates import _payload  # noqa: E402
from test_button_gates_b import _Admission  # noqa: E402
from tool_store import ToolLibraryStore  # noqa: E402
from tool_table import parse_tool_table  # noqa: E402

TABLE = ("T1 P8 X0.5 Y-0.25 Z50 D6 ; first\n"
         "T2 P5 X3.25 Y-4.5 Z50.1 A1.5 B0 D6 I12 J34 Q3 ; second\n"
         "T3 P3 Z42.1234567 D4 ; third\n")
LIBRARY = {"1": {"type": "flat", "flutes": 2}, "2": {"type": "ball", "oal": 60.5}, "3": {"type": "drill"}}


class TestEachToolEditChangesItsRecord(_Admission):

    def setUp(self):
        super().setUp()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.table = self.dir / "tool.tbl"
        self.table.write_text(TABLE)
        self.store = ToolLibraryStore(self.dir / "tool_library.json", lambda: "/cfg/machine.ini")
        self.store.save(json.loads(json.dumps(LIBRARY)))
        self.reloads = 0

    def edit(self, msg):
        gateway._shared_status = _payload()
        gateway._cmd_lock = None
        gateway.STAT.tool_in_spindle = 0
        replies = []

        async def reply(ws, m):
            replies.append(m)

        async def reload():
            self.reloads += 1
        before = (self.tools(), json.loads(json.dumps(self.store.load())))   # a copy: the store hands out its own dict
        with patch.object(gateway, "get_tool_tbl_path", lambda: str(self.table)), \
                patch.object(gateway, "_tool_lib_store", self.store), \
                patch.object(gateway, "_reload_tool_table_and_bump", reload), \
                patch.object(gateway, "ws_send_json", reply):
            asyncio.run(gateway._execute_client_command(901, self.writer, None, dict(msg)))
        self.assertTrue(replies[-1]["ok"], replies)
        self.assertEqual(self.reloads, 1, "the table reloaded once after the write")
        return before, (self.tools(), json.loads(json.dumps(self.store.load())))

    def tools(self):
        return {t["T"]: t for t in parse_tool_table(str(self.table))}

    def assert_others_kept(self, before, after, *touched):
        (tb, lb), (ta, la) = before, after
        for n in set(tb) - set(touched):
            self.assertEqual(ta[n], tb[n], f"T{n}'s values")
            self.assertEqual(la[str(n)], lb[str(n)], f"T{n}'s metadata")

    def test_save_changes_only_the_sent_fields_of_its_tool(self):
        before, after = self.edit({"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "flutes": 3})
        self.assert_others_kept(before, after, 1)
        t_b, t_a = before[0][1], after[0][1]
        self.assertEqual({**t_b, "Z": 49.0}, t_a, "only Z of T1 — P8, X0.5, Y-0.25, D6 and the comment stay")
        self.assertEqual(after[1]["1"], {"type": "flat", "flutes": 3})

    def test_add_adds_one_record_and_keeps_every_other(self):
        before, after = self.edit({"cmd": "add_tool", "tool_number": 7, "z_offset": 12.5, "diameter": 3.0,
                                   "type": "flat"})
        self.assert_others_kept(before, after)
        self.assertEqual(set(after[0]) - set(before[0]), {7})
        self.assertEqual((after[0][7]["Z"], after[0][7]["D"], after[0][7]["P"]), (12.5, 3.0, 7))
        self.assertEqual(after[1]["7"], {"type": "flat"})

    def test_delete_removes_one_record_and_keeps_every_other(self):
        before, after = self.edit({"cmd": "delete_tool", "tool_number": 1})
        self.assert_others_kept(before, after, 1)
        self.assertEqual(set(before[0]) - set(after[0]), {1})
        self.assertNotIn("1", after[1])

    def test_renumber_moves_the_number_and_keeps_an_unsent_pocket(self):
        before, after = self.edit({"cmd": "renumber_tool", "old_tool_number": 1, "tool_number": 7})
        self.assert_others_kept(before, after, 1)
        self.assertNotIn(1, after[0])
        self.assertEqual({**before[0][1], "T": 7}, after[0][7], "T1 P8 → T7 P8, every other value kept")
        self.assertNotIn("1", after[1])
        self.assertEqual(after[1]["7"], before[1]["1"], "the metadata moved to the new key")

    def test_renumber_takes_a_sent_pocket(self):
        _before, after = self.edit({"cmd": "renumber_tool", "old_tool_number": 1, "tool_number": 7, "pocket": 7})
        self.assertEqual(after[0][7]["P"], 7)


if __name__ == "__main__":
    unittest.main()
