"""F-TOOLEDIT.S4, the gateway's part (Codex R321–R323 FI321-02, FI-I50,
FI-I51): each tool edit changes exactly its record — every value of the
untouched records (all fields, the comment, the library metadata) stays, an
unsent field of its own stays — and LinuxCNC is asked ONCE to reload the
table, after it was written. Value equality, not bytes: the writer may sort
and reformat. The expectations are literals here, never the product parser's
reading of the fixture: a line the parser skipped would vanish from both
sides. The fields stand in any order on a line (LinuxCNC reads them so); a
line the reader does not understand stops the edit before anything is
written. The real tool.tbl and tool_library.json in a temporary folder, the
real reload helper — only the controller's load_tool_table is a recorder that
reads the file at the moment it is called. LinuxCNC's own reload is the native
part (S4b, open)."""
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

T1 = "T1 P8 X0.5 Y-0.25 Z50 D6 ; first"
T3 = "T3 P3 Z42.1234567 D4 ; third"
#: T2 in four spellings LinuxCNC reads alike (tooldata_read_entry: fields in
#: any order, the letter in either case)
T2_ORDERS = {
    "tool first": "T2 P5 X3.25 Y-4.5 Z50.1 A1.5 B0 D6 I12 J34 Q3 ; second",
    "pocket first": "P5 T2 X3.25 Y-4.5 Z50.1 A1.5 B0 D6 I12 J34 Q3 ; second",
    "offset between": "T2 X3.25 P5 Y-4.5 Z50.1 A1.5 B0 D6 I12 J34 Q3 ; second",
    "lower case": "t2 p5 x3.25 y-4.5 z50.1 a1.5 b0 d6 i12 j34 q3 ; second",
}
#: what the table holds — written by hand, not read by the product
EXPECTED = {
    1: {"T": 1, "P": 8, "X": 0.5, "Y": -0.25, "Z": 50.0, "D": 6.0, "remark": "first"},
    2: {"T": 2, "P": 5, "X": 3.25, "Y": -4.5, "Z": 50.1, "A": 1.5, "B": 0.0, "D": 6.0,
        "I": 12.0, "J": 34.0, "Q": 3, "remark": "second"},
    3: {"T": 3, "P": 3, "X": 0.0, "Y": 0.0, "Z": 42.1234567, "D": 4.0, "remark": "third"},
}
LIBRARY = {"1": {"type": "flat", "flutes": 2}, "2": {"type": "ball", "oal": 60.5}, "3": {"type": "drill"}}


def table(t2: str = T2_ORDERS["tool first"]) -> str:
    return f"{T1}\n{t2}\n{T3}\n"


class _Reloads:
    """CMD: load_tool_table records the table file AS IT IS at the call;
    every other command a no-op."""

    def __init__(self, path: Path):
        self.path, self.seen = path, []

    def load_tool_table(self):
        self.seen.append(self.path.read_text())

    def __getattr__(self, _name):
        return lambda *a, **k: None


class _ToolEdit(_Admission):

    def setUp(self):
        super().setUp()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.table = self.dir / "tool.tbl"
        self.table.write_text(table())
        self.store = ToolLibraryStore(self.dir / "tool_library.json", lambda: "/cfg/machine.ini")
        self.store.save(json.loads(json.dumps(LIBRARY)))

    def library(self):
        return json.loads(json.dumps(self.store.load()))   # a copy: the store hands out its own dict

    def send(self, msg):
        gateway._shared_status = _payload()
        gateway._cmd_lock = None
        gateway.STAT.tool_in_spindle = 0
        replies, cmd = [], _Reloads(self.table)

        async def reply(ws, m):
            replies.append(m)
        with patch.object(gateway, "get_tool_tbl_path", lambda: str(self.table)), \
                patch.object(gateway, "_tool_lib_store", self.store), \
                patch.object(gateway, "CMD", cmd), \
                patch.object(gateway, "ws_send_json", reply):
            asyncio.run(gateway._execute_client_command(901, self.writer, None, dict(msg)))
        return replies[-1], cmd.seen

    def edit(self, msg, expected_tools, expected_library):
        reply, reloads = self.send(msg)
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(len(reloads), 1, "LinuxCNC asked once to reload the table")
        at_reload = {t["T"]: t for t in parse_tool_table_text(self.dir, reloads[0])}
        self.assertEqual(at_reload, expected_tools, "the table LinuxCNC is asked to load is the edited one")
        self.assertEqual({t["T"]: t for t in parse_tool_table(str(self.table))}, expected_tools)
        self.assertEqual(self.library(), expected_library)


def parse_tool_table_text(folder: Path, text: str) -> list:
    snap = folder / "at_reload.tbl"
    snap.write_text(text)
    return parse_tool_table(str(snap))


def without(d: dict, *keys) -> dict:
    return {k: v for k, v in d.items() if k not in keys}


class TestEachToolEditChangesItsRecord(_ToolEdit):

    def test_the_fixture_reads_as_written(self):
        self.assertEqual({t["T"]: t for t in parse_tool_table(str(self.table))}, EXPECTED)

    def test_save_changes_only_the_sent_fields_of_its_tool(self):
        self.edit({"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "flutes": 3},
                  {**EXPECTED, 1: {**EXPECTED[1], "Z": 49.0}},
                  {**LIBRARY, "1": {"type": "flat", "flutes": 3}})

    def test_add_adds_one_record_and_keeps_every_other(self):
        self.edit({"cmd": "add_tool", "tool_number": 7, "z_offset": 12.5, "diameter": 3.0, "type": "flat"},
                  {**EXPECTED, 7: {"T": 7, "P": 7, "X": 0.0, "Y": 0.0, "Z": 12.5, "D": 3.0, "remark": ""}},
                  {**LIBRARY, "7": {"type": "flat"}})

    def test_delete_removes_one_record_and_keeps_every_other(self):
        self.edit({"cmd": "delete_tool", "tool_number": 1}, without(EXPECTED, 1), without(LIBRARY, "1"))

    def test_renumber_moves_the_number_and_keeps_an_unsent_pocket(self):
        self.edit({"cmd": "renumber_tool", "old_tool_number": 1, "tool_number": 7},
                  {**without(EXPECTED, 1), 7: {**EXPECTED[1], "T": 7}},          # T1 P8 → T7 P8
                  {**without(LIBRARY, "1"), "7": LIBRARY["1"]})

    def test_renumber_takes_a_sent_pocket(self):
        self.edit({"cmd": "renumber_tool", "old_tool_number": 1, "tool_number": 7, "pocket": 7},
                  {**without(EXPECTED, 1), 7: {**EXPECTED[1], "T": 7, "P": 7}},
                  {**without(LIBRARY, "1"), "7": LIBRARY["1"]})


class TestEveryColumnOrderSurvivesAnotherToolsEdit(_ToolEdit):
    """FI-I50: T2 written in another order than T P … is still a tool; an
    edit of T1 or T3 keeps it with every value."""

    def test_each_order_survives_save_delete_and_renumber_of_another_tool(self):
        cases = [
            ({"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0},
             {**EXPECTED, 1: {**EXPECTED[1], "Z": 49.0}}, LIBRARY),
            ({"cmd": "delete_tool", "tool_number": 3}, without(EXPECTED, 3), without(LIBRARY, "3")),
            ({"cmd": "renumber_tool", "old_tool_number": 1, "tool_number": 9},
             {**without(EXPECTED, 1), 9: {**EXPECTED[1], "T": 9}}, {**without(LIBRARY, "1"), "9": LIBRARY["1"]}),
        ]
        for order, t2 in T2_ORDERS.items():
            for msg, tools, library in cases:
                with self.subTest(order=order, cmd=msg["cmd"]):
                    self.table.write_text(table(t2))
                    self.store.save(json.loads(json.dumps(LIBRARY)))
                    self.edit(msg, tools, library)


#: the table as this branch's earlier writer (52454d27) wrote it — Q as a
#: decimal (Codex R324 FI-I54), the values of EXPECTED
EARLIER_WRITER = (";Tool  Pocket Z Offset     Diameter     Remark\n"
                  "T1     P8     X+0.500000 Y-0.250000 Z+00050.000000  D+0006.000000   ; first\n"
                  "T2     P5     X+3.250000 Y-4.500000 Z+00050.100000 A+1.500000 B+0.000000  D+0006.000000"
                  " I+12.000000 J+34.000000 Q+3.000000   ; second\n"
                  "T3     P3     Z+42.1234567  D+0004.000000   ; third\n")


class TestTheEarlierWritersTableReadsWhole(_ToolEdit):
    """FI-I54: a table the earlier writer wrote shows every tool and takes an
    edit; the next write normalizes Q to the integer LinuxCNC reads."""

    def test_shown_whole_edited_and_normalized(self):
        self.table.write_text(EARLIER_WRITER)
        self.assertEqual({t["T"]: t for t in parse_tool_table(str(self.table))}, EXPECTED, "the display")
        self.edit({"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0},
                  {**EXPECTED, 1: {**EXPECTED[1], "Z": 49.0}}, LIBRARY)
        text = self.table.read_text()
        self.assertIn(" Q3", text)
        self.assertNotIn("Q+3.000000", text)


class TestALineNotUnderstoodStopsTheEdit(_ToolEdit):
    """FI-I50: a data line the reader does not read exactly would be dropped
    by the rewrite — the edit answers why and writes nothing."""

    def test_every_edit_refuses_and_writes_nothing(self):
        bad_lines = {
            "unknown field": "T2 P5 X3.25 E7 D6 ; second",
            "tab inside": "T2\tP5 X3.25 D6 ; second",
            "letter twice": "T2 P5 X3.25 X4 D6 ; second",
            "no pocket": "T2 X3.25 D6 ; second",
            "junk after the number": "T2 P5 X3.25mm D6 ; second",
        }
        edits = [{"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0},
                 {"cmd": "add_tool", "tool_number": 7},
                 {"cmd": "delete_tool", "tool_number": 3},
                 {"cmd": "renumber_tool", "old_tool_number": 1, "tool_number": 9}]
        for name, line in bad_lines.items():
            for msg in edits:
                with self.subTest(line=name, cmd=msg["cmd"]):
                    text = table(line)
                    self.table.write_text(text)
                    reply, reloads = self.send(msg)
                    self.assertFalse(reply["ok"], reply)
                    self.assertIn("line 2 not understood", reply["error"])
                    self.assertIn("nothing written", reply["error"])
                    self.assertEqual(self.table.read_text(), text, "the file untouched")
                    self.assertEqual(reloads, [], "no reload")
                    self.assertEqual(self.library(), LIBRARY)

    def test_comment_and_blank_lines_are_no_tool_and_stop_nothing(self):
        self.table.write_text(";Tool  Pocket Z Offset\n\n# a note\n" + table())
        self.edit({"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0},
                  {**EXPECTED, 1: {**EXPECTED[1], "Z": 49.0}}, LIBRARY)


if __name__ == "__main__":
    unittest.main()
