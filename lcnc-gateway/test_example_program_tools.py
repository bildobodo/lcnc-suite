"""Every tool an example program calls is in its configuration's tool table.

A T word whose number the table lacks stops LinuxCNC's interpreter at that
line ("Requested tool 13 not found in the tool table"): the preview shows
nothing of the program and a run refuses it (operator 2026-09-29 — the sim
tables carried only the example library's T1001+/T2001+ while the programs
call T2, T3, T8, T13).
"""
import json
import re
import unittest
from pathlib import Path

SIM = Path(__file__).resolve().parent.parent / "examples" / "sim_config"

_COMMENT = re.compile(r"\([^)]*\)|;.*$")
_T_WORD = re.compile(r"(?<![A-Za-z#<_])[Tt]\s*(\d+)")


def called_tools(program: str) -> set[int]:
    """The tool numbers a program's T words name (comments stripped)."""
    tools = set()
    for line in program.splitlines():
        tools.update(int(n) for n in _T_WORD.findall(_COMMENT.sub("", line)))
    return tools


def table_tools(table: str) -> set[int]:
    return {int(m.group(1)) for m in re.finditer(r"^\s*T(\d+)\b", table, re.M)}


class ExampleProgramTools(unittest.TestCase):
    def test_the_word_scan(self):
        self.assertEqual(called_tools("N25 T13 M600\n(T2 D=6. - comment)\nm6 t3 g43 h3 ; T9 note\n"), {13, 3})
        self.assertEqual(called_tools("#<_tool> = 5\nG43 H#<_tool>\no<t1> call\n"), set())

    def test_every_called_tool_is_in_the_profile_table(self):
        catalog = json.loads((SIM / "profiles.json").read_text())
        checked = 0
        for profile in catalog["profiles"]:
            tools = table_tools((SIM / profile["state_dir"] / "tool.tbl").read_text(encoding="utf-8"))
            for rel in profile["programs"]:
                missing = called_tools((SIM / rel).read_text(encoding="utf-8")) - tools
                self.assertEqual(missing, set(), f"{profile['id']}: {rel} calls tools its table lacks")
                checked += 1
        self.assertGreater(checked, 0)

    def test_the_shop_tools_the_test_programs_call(self):
        # the operator's test programs (nc_files, not shipped) call these
        for state_dir in ("xyz3", "xyzac5", "xyzabc6"):
            tools = table_tools((SIM / state_dir / "tool.tbl").read_text(encoding="utf-8"))
            self.assertLessEqual({1, 2, 3, 8, 13}, tools, state_dir)


if __name__ == "__main__":
    unittest.main()
