"""TF-2, the pure half (plan v3 §1.2, Codex R476–R479): may LinuxCNC be asked
to load the tool table file (tool_proof.load_refusal) — every row of the rule
with its words, the ORDER by pairs (the priority of causes), the T / P / Q
edges, forms and indices against LinuxCNC's own compiled reader
(scripts/test_fixtures/tool_load/golden.json, docs/reviews/tf2.golden.py) —;
both sides' revision and the named differences. No gateway, no linuxcnc."""
import json
import unittest
from pathlib import Path
from unittest.mock import patch

import tool_proof
from command_policy import REASON_MAX_CHARS
from test_tool_proof import entry, table
from tool_proof import (EDIT_INCOMPLETE, EDIT_LOADING, EDIT_NO_LINE_END, EDIT_TOO_MANY, IO_TOOLS_MAX,
                        LOAD_DATABASE, LOAD_FILE_CHANGED, LOAD_LINE_ENDS, LOAD_NO_TOOLS, LOAD_OTHERWISE,
                        LOAD_RANDOM, LOAD_SCOPE_UNKNOWN, LOAD_SPINDLE_UNREAD, LOAD_T_INT, LOAD_T_RANGE,
                        LOAD_TABLE_UNREAD, LOAD_UNKNOWN, SCOPE_DATABASE, SCOPE_RANDOM, SCOPE_UNKNOWN, LoadRead,
                        changed_while_read, compare, edit_basis_refusal, load_differences, load_refusal,
                        memory_rev, scan_table)
from tool_table import LINE_BYTES_MAX, parse_tool_table_bytes

GOLDEN = Path(__file__).resolve().parents[1] / "scripts/test_fixtures/tool_load/golden.json"
FILE = b"T1 P1 Z10 D1 ; one\nT2 P2 Z20 D2 ; two\n"
MEM = {1: {"Z": 10, "D": 1}, 2: {"Z": 20, "D": 2}}
#: LinuxCNC holding what every other case's file does not matter to
HELD = table(MEM)


def read(data=FILE, stat=HELD, scope=None, spindle=0, awaited=False, changed=False):
    scan = scan_table(data)
    proof = changed_while_read(scan) if changed else compare(scan, stat, scope)
    return LoadRead(data, scan, proof, spindle, awaited)


def why(data=FILE, **kw):
    return load_refusal(read(data, **kw))


def at_line(n, line, lines=12):
    """A file whose line `n` is `line`, the others tools of their own."""
    return b"".join((line if i == n else b"T%d P%d Z1 D1" % (i + 100, i)) + b"\n" for i in range(1, lines + 1))


LONG = b"T5 P5 Z1 ; "
LONG += b"r" * (LINE_BYTES_MAX - len(LONG))      # LINE_BYTES_MAX bytes BEFORE its newline: one too many
MANY = b"".join(b"T%d P1 Z1\n" % t for t in range(1, IO_TOOLS_MAX + 2))
TWICE = (entry(-1), entry(1, Z=10, D=1), entry(1, Z=9), entry(2, Z=20, D=2))

#: every row of §1.2: name -> (the words, what is read)
ROWS = {
    # A
    "the file changed under the read": (LOAD_FILE_CHANGED, dict(changed=True)),
    # B
    "only the final newline missing": (EDIT_NO_LINE_END, dict(data=FILE[:-1])),
    "cut, and something lacks": (EDIT_INCOMPLETE, dict(data=FILE[:-12])),
    "cut, a line unread": (EDIT_INCOMPLETE, dict(data=FILE + b"T3 P")),
    "cut, no comparison: random changer": (EDIT_INCOMPLETE, dict(data=FILE[:-1], scope=SCOPE_RANDOM)),
    "cut, no comparison: database": (EDIT_INCOMPLETE, dict(data=FILE[:-1], scope=SCOPE_DATABASE)),
    "cut, no comparison: unread controller": (EDIT_INCOMPLETE, dict(data=FILE[:-1], stat=None)),
    "cut, no comparison: empty controller table": (EDIT_INCOMPLETE, dict(data=FILE[:-1], stat=())),
    # C
    "a CR": (LOAD_LINE_ENDS, dict(data=FILE.replace(b"\n", b"\r\n"))),
    "a CR in a remark": (LOAD_LINE_ENDS, dict(data=b"T1 P1 ; a\rb\nT2 P2\n")),
    "a line too long": ("Line 12 too long for LinuxCNC — shorten it in an editor", dict(data=at_line(12, LONG))),
    "a comment too long": ("Line 3 too long for LinuxCNC — shorten it in an editor",
                           dict(data=at_line(3, b";" + b"-" * 254))),
    "a tab in a tool line": ("Line 12 has a tab or control character — remove it",
                             dict(data=at_line(12, b"T12 P12\tZ1"))),
    "a letter past ASCII in a tool line": ("Line 12 has a tab or control character — remove it",
                                           dict(data=at_line(12, "T12 P12 Zä".encode()))),
    "DEL in a tool line": ("Line 2 has a tab or control character — remove it", dict(data=at_line(2, b"T12 P12\x7f"))),
    "NUL in a remark": ("Line 12 has a tab or control character — remove it",
                        dict(data=at_line(12, b"T12 P12 ; a\0b"))),
    "NUL in a comment": ("Line 1 has a tab or control character — remove it", dict(data=b";\0\n" + FILE)),
    "a # line with a P word": ("Line 12 is a # comment with a P word — use ; instead",
                               dict(data=at_line(12, b"#T3 P3 Z1", 13))),
    "an indented # line": ("Line 1 is a # comment with a P word — use ; instead",
                           dict(data=b"  # words P7\n" + FILE)),
    "an unread line": ("Line 12 not readable — fix it in an editor", dict(data=at_line(12, b"T12 P12 E1"))),
    "an unread line LinuxCNC reads cut": ("Line 12 not readable — fix it in an editor",
                                          dict(data=at_line(12, b"T12mm P12"))),
    "a number the mirror does not read": ("Line 2 not readable — fix it in an editor",
                                          dict(data=b"T1 P1\n# Zinf words\n")),
    "T past int32": (LOAD_T_INT, dict(data=at_line(12, b"T4294967301 P12"))),
    "T past int64": (LOAD_T_INT, dict(data=at_line(12, b"T99999999999999999999 P12"))),
    "more digits than any line holds": ("Line 2 too long for LinuxCNC — shorten it in an editor",
                                        dict(data=b"T1 P1\nT5 P5 Q" + b"9" * 5000 + b"\n")),
    "P past int32": ("T5: pocket is past LinuxCNC's integers — correct it", dict(data=at_line(12, b"T5 P4294967301"))),
    "Q past int32": ("T5: Q is past LinuxCNC's integers — correct it", dict(data=at_line(12, b"T5 P5 Q4294967299"))),
    "Q under int32": ("T5: Q is past LinuxCNC's integers — correct it", dict(data=at_line(12, b"T5 P5 Q-2147483649"))),
    "not finite": ("T5: not a finite number — fix it in an editor", dict(data=at_line(12, b"T5 P5 I1e999"))),
    "T -1, LinuxCNC's no tool": (LOAD_OTHERWISE, dict(data=at_line(12, b"T-1 P5"))),
    # D
    "random changer": (LOAD_RANDOM, dict(scope=SCOPE_RANDOM)),
    "tool database": (LOAD_DATABASE, dict(scope=SCOPE_DATABASE)),
    "changer type not read": (LOAD_SCOPE_UNKNOWN, dict(scope=SCOPE_UNKNOWN)),
    # E
    "0 bytes": (LOAD_NO_TOOLS, dict(data=b"")),
    "no tool row": (LOAD_NO_TOOLS, dict(data=b";Tool  Pocket\n# words\n\n")),
    "T past 99999": (LOAD_T_RANGE, dict(data=at_line(12, b"T100000 P12"))),
    "T below 0": (LOAD_T_RANGE, dict(data=at_line(12, b"T-5 P12"))),
    "P past 99999": ("T5: pocket outside 0–99999 — fix it in an editor", dict(data=at_line(12, b"T5 P100000"))),
    "P below 0": ("T5: pocket outside 0–99999 — fix it in an editor", dict(data=at_line(12, b"T5 P-1"))),
    "D below 0": ("T5: diameter below 0 — fix it in an editor", dict(data=at_line(12, b"T5 P5 D-0.001"))),
    "twice in the file": ("T5 twice in the file — remove one, restart LinuxCNC",
                          dict(data=b"T5 P1\nT6 P6\nT5 P2\n")),
    "more than LinuxCNC keeps": (EDIT_TOO_MANY, dict(data=MANY)),
    # F
    "STAT.tool_table not read": (LOAD_TABLE_UNREAD, dict(stat=None)),
    "STAT.tool_table empty": (LOAD_TABLE_UNREAD, dict(stat=())),
    "the spindle tool not read": (LOAD_SPINDLE_UNREAD, dict(spindle=None)),
    "a spindle tool that is no tool": (LOAD_SPINDLE_UNREAD, dict(spindle=-1)),
    "the last change still awaited": (EDIT_LOADING, dict(awaited=True)),
    # G
    "twice in LinuxCNC": ("LinuxCNC holds T1 twice — restart it", dict(stat=TWICE)),
    "the spindle tool not in the file": ("T5 is in the spindle, not in the file — restore it", dict(spindle=5)),
}


class TestEveryRow(unittest.TestCase):

    def test_each_row_has_its_words(self):
        for name, (words, kw) in ROWS.items():
            with self.subTest(name):
                self.assertEqual(why(**kw), words)

    def test_the_loadable_file(self):
        for name, kw in {"as LinuxCNC holds it": {}, "changed": dict(stat=table({1: {"Z": 9}, 2: {"Z": 20, "D": 2}})),
                         "a tool only in LinuxCNC": dict(stat=table({**MEM, 7: {}})),
                         "a tool only in the file": dict(stat=table({1: MEM[1]})),
                         "LinuxCNC holds no tool": dict(stat=(entry(-1),)),
                         "its spindle tool in the file": dict(spindle=2),
                         "255 bytes with the newline": dict(data=at_line(3, LONG[:-1])),
                         "past ASCII and a tab behind the ;": dict(data="T1 P1 ; Fräser\tgroß\nT2 P2\n".encode()),
                         "1000 tools": dict(data=MANY[:MANY.rindex(b"T1001")]),
                         "T0 and T99999, P0 and P99999": dict(data=b"T0 P0 Z1\nT99999 P99999 Z1\n"),
                         "Q at its ends": dict(data=b"T5 P5 Q2147483647\nT6 P6 Q-2147483648\n"),
                         "a whole decimal": dict(data=b"T5.0 P5. Q3.000000\n"),
                         "a # line without a P word": dict(data=b"# old tools\n" + FILE),
                         "a tab in a comment": dict(data=b";\ta\n#\tb\n\t\n" + FILE)}.items():
            with self.subTest(name):
                self.assertIsNone(why(**kw))

    def test_every_reason_fits_and_names_a_way_out(self):
        worst = [why(data=at_line(1200, line, 1200)) for line in (
            LONG, b"T5 P5\tZ1", b"T5 E5", b"T99999 P4294967301", b"T99999 P5 Q4294967301", b"T99999 P5 Z1e999",
            b"T99999 P100000", b"T99999 P5 D-1")]
        worst += [why(data=at_line(1200, b"# P7", 1201)), why(data=b"T99999 P1\nT99999 P2\n"), why(spindle=99999),
                  why(stat=(entry(-1), entry(99999), entry(99999)))]
        # a number no table may hold is not spelled out: it would run past the line
        worst += [why(data=b"T-2147483648 P4294967301\n"), why(data=b"T-2147483648 P1 Q4294967301\n"),
                  why(data=b"T2147483647 P1 Z1e999\n"), why(stat=(entry(-1), entry(2147483647), entry(2147483647)))]
        for words in [*worst, *(w for w, _kw in ROWS.values())]:
            with self.subTest(words):
                self.assertLessEqual(len(words), REASON_MAX_CHARS)
                self.assertRegex(words, " — |^T.* is in the spindle")

    def test_the_parsers_comment_is_no_tool_line(self):
        # Codex R479: the equality of the indices is the rule, no blanket `#` clause beside it
        for data in (b"#\tP\n" + FILE, b"# a\x07b\n" + FILE, b"#T5\n" + FILE):
            self.assertIsNone(why(data=data), data)


class TestTheOrder(unittest.TestCase):
    """First match wins. Each pair holds BOTH causes; the second must show
    once the first is gone."""

    PAIRS = {
        "changed + everything": (LOAD_FILE_CHANGED, dict(data=LONG + b"\r", changed=True, spindle=None)),
        "cut file + everything": (EDIT_INCOMPLETE, dict(data=b"T5 P1\r\n# P7\nT5 P\t" + LONG, scope=SCOPE_RANDOM,
                                                        spindle=None, awaited=True)),
        "cut + a CR": (EDIT_INCOMPLETE, dict(data=b"T1 P1\r\nT2 P2")),
        "CR + long line": (LOAD_LINE_ENDS, dict(data=LONG + b"\r\n")),
        "long line + tab": ("Line 2 too long for LinuxCNC — shorten it in an editor", dict(data=b"T1\tP1\n" + LONG + b"\n")),
        "tab + # with P": ("Line 2 has a tab or control character — remove it", dict(data=b"# P7\nT1\tP1\nT2 P2\n")),
        "# with P + unread": ("Line 1 is a # comment with a P word — use ; instead", dict(data=b"# P7\nT1 P1\nT2 P2 E1\n")),
        "unread + T past int32": ("Line 2 not readable — fix it in an editor", dict(data=b"T4294967301 P1\nT2 E1\n")),
        "T past int32 + P past int32": (LOAD_T_INT, dict(data=b"T5 P4294967301\nT4294967301 P1\n")),
        "P past int32 + not finite": ("T6: pocket is past LinuxCNC's integers — correct it",
                                      dict(data=b"T5 P5 Z1e999\nT6 P4294967301\n")),
        "not finite + read otherwise": ("T5: not a finite number — fix it in an editor",
                                        dict(data=b"T-1 P1\nT5 P5 Z1e999\n")),
        "read otherwise + random changer": (LOAD_OTHERWISE, dict(data=b"T-1 P1\n", scope=SCOPE_RANDOM)),
        "long line + random changer": ("Line 1 too long for LinuxCNC — shorten it in an editor",
                                       dict(data=LONG + b"\n", scope=SCOPE_RANDOM)),
        "CR + unread controller": (LOAD_LINE_ENDS, dict(data=b"T1 P1\r\n", stat=None)),
        "random changer + no rows": (LOAD_RANDOM, dict(data=b";\n", scope=SCOPE_RANDOM)),
        "no rows + unread controller": (LOAD_NO_TOOLS, dict(data=b";\n", stat=None)),
        "T out of range + P out of range": (LOAD_T_RANGE, dict(data=b"T5 P100000\nT100000 P1\n")),
        "P out of range + D below 0": ("T6: pocket outside 0–99999 — fix it in an editor",
                                       dict(data=b"T5 P5 D-1\nT6 P100000\n")),
        "D below 0 + twice": ("T6: diameter below 0 — fix it in an editor", dict(data=b"T5 P5\nT5 P6\nT6 P7 D-1\n")),
        "twice + too many": ("T1 twice in the file — remove one, restart LinuxCNC", dict(data=MANY + b"T1 P1\n")),
        "too many + unread controller": (EDIT_TOO_MANY, dict(data=MANY, stat=None)),
        "Q overflow + job awaited": ("T5: Q is past LinuxCNC's integers — correct it",
                                     dict(data=b"T5 P5 Q4294967299\n", awaited=True)),
        "unread controller + unread spindle": (LOAD_TABLE_UNREAD, dict(stat=None, spindle=None)),
        "unread spindle + job awaited": (LOAD_SPINDLE_UNREAD, dict(spindle=None, awaited=True)),
        "job awaited + twice in LinuxCNC": (EDIT_LOADING, dict(awaited=True, stat=TWICE)),
        "twice in LinuxCNC + spindle missing": ("LinuxCNC holds T1 twice — restart it", dict(stat=TWICE, spindle=5)),
        "bad line + difference": ("Line 1 not readable — fix it in an editor",
                                  dict(data=b"T1 E1\nT2 P2 Z99\n")),
    }

    def test_by_pairs(self):
        for name, (words, kw) in self.PAIRS.items():
            with self.subTest(name):
                self.assertEqual(why(**kw), words)

    def test_the_second_cause_alone(self):
        second = {"long line + random changer": (LOAD_RANDOM, dict(scope=SCOPE_RANDOM)),
                  "no rows + unread controller": (LOAD_TABLE_UNREAD, dict(stat=None)),
                  "random changer + no rows": (LOAD_NO_TOOLS, dict(data=b";\n")),
                  "job awaited + twice in LinuxCNC": ("LinuxCNC holds T1 twice — restart it", dict(stat=TWICE)),
                  "twice in LinuxCNC + spindle missing": ("T5 is in the spindle, not in the file — restore it",
                                                          dict(spindle=5)),
                  "unread controller + unread spindle": (LOAD_SPINDLE_UNREAD, dict(spindle=None))}
        for name, (words, kw) in second.items():
            with self.subTest(name):
                self.assertEqual(why(**kw), words)

    def test_the_words_of_an_unknown_read(self):
        # groups A and F, and only they (the page says "read again" for these words)
        unknown = {w for n, (w, _kw) in ROWS.items() if w in LOAD_UNKNOWN}
        self.assertEqual(unknown, set(LOAD_UNKNOWN))
        self.assertEqual({w for w, kw in ROWS.values() if w in LOAD_UNKNOWN},
                         {why(changed=True), why(stat=None), why(spindle=None), why(awaited=True)})


class TestTheHashLineR479(unittest.TestCase):
    """`home_tools(data)` gives the valid rows at 1, 2, 3 …: Codex's nine
    files (maschinentag.r479.codex-probe.json, checked there against the
    compiled reader). The admitted set is slightly LARGER than v2's: a `#`
    line with a P word BEHIND the last tool takes an index no tool loses."""

    CASES = {
        "plain": (b"T1 P5 Z10 D6\n", {1: (1, 5)}, True),
        "hash text first": (b"# words\nT1 P5 Z10 D6\n", {1: (1, 5)}, True),
        "hash pocket first": (b"# words P7\nT1 P5 Z10 D6\n", {2: (1, 5)}, False),
        "hash pocket between": (b"T1 P5 Z10 D6\n# words P7\nT2 P6 Z20 D3\n", {1: (1, 5), 3: (2, 6)}, False),
        "hash pocket last": (b"T1 P5 Z10 D6\n# words P7\n", {1: (1, 5)}, True),
        "hash pocket after semicolon": (b"# words ; P7\nT1 P5 Z10 D6\n", {1: (1, 5)}, True),
        "semicolon pocket first": (b";T9 P9\nT1 P5 Z10 D6\n", {1: (1, 5)}, True),
        "indented hash pocket first": (b"  # words P7\nT1 P5 Z10 D6\n", {2: (1, 5)}, False),
        "indented hash pocket last": (b"T1 P5 Z10 D6\n  # words P7\n", {1: (1, 5)}, True),
    }

    def test_the_nine_files(self):
        for name, (data, home, admitted) in self.CASES.items():
            with self.subTest(name):
                self.assertEqual(tool_proof.home_tools(data), home)
                self.assertEqual(why(data=data) is None, admitted)
                if not admitted:
                    self.assertRegex(why(data=data), r"^Line \d+ is a # comment with a P word — use ; instead$")

    def test_behind_the_last_tool_it_takes_the_place_of_none(self):
        # … and stays refused once a tool stands behind it
        self.assertIsNone(why(data=FILE + b"#T3 P3\n"))
        self.assertEqual(why(data=FILE + b"#T3 P3\nT9 P9\n"), "Line 3 is a # comment with a P word — use ; instead")

    def test_a_cause_of_its_own_is_not_the_hash_lines(self):
        # a harmless # line is never named for another line's difference
        self.assertEqual(why(data=b"T4294967301 P1\n#T3 P3\n"), LOAD_T_INT)
        self.assertEqual(why(data=b"# words\nT1 P1\nT2 P2 E1\n"), "Line 3 not readable — fix it in an editor")

    def test_the_words_take_the_first_that_moves_a_tool(self):
        self.assertEqual(why(data=b"# words\n#\n# P\n#P3 P4\nT1 P1\n"),
                         "Line 4 is a # comment with a P word — use ; instead")


class TestAgainstLinuxCNCsOwnReader(unittest.TestCase):
    """The golden: what the compiled upstream reader (v2.9.4
    tooldata_common.cc) holds for these bytes — index, T, P, Q and every real
    that is not 0. A file load_refusal admits reads the same here, row i at
    index i."""

    @classmethod
    def setUpClass(cls):
        cls.golden = json.loads(GOLDEN.read_text())

    @staticmethod
    def ours(data):
        return [[i, r["T"], r["P"], int(r.get("Q", 0)),
                 {k: float(r[k]) for k in "XYZABCUVWDIJ" if r.get(k)}] for i, r in
                enumerate(parse_tool_table_bytes(data), 1)]

    def test_the_source(self):
        self.assertEqual(self.golden["source"], "ae1e51206f4e15778802553daf0de9bb894e1ea4de1b83f4fa4b5af60d738b0e")

    def test_every_admitted_file_reads_the_same(self):
        seen = {}
        for name, text, rows in self.golden["cases"]:
            data = text.encode("latin-1")
            refused = why(data=data)
            kind = name.split(":")[0]
            seen.setdefault((kind, refused is None, self.ours(data) == rows), []).append(name)
            if refused is None:
                with self.subTest(name, data=data):
                    self.assertEqual(self.ours(data), rows)
        # both directions are in the golden: files admitted, and files refused
        # because LinuxCNC holds something else
        for kind in ("T", "P", "Q", "form", "fuzz"):
            self.assertTrue(seen.get((kind, True, True)), f"{kind}: none admitted")
            self.assertTrue(seen.get((kind, False, False)), f"{kind}: none refused for a difference")
        self.assertFalse([n for k, v in seen.items() if k[1] and not k[2] for n in v])

    def test_the_nine_of_r479(self):
        got = {name.split(": ")[1]: {r[0]: (r[1], r[2]) for r in rows} for name, _t, rows in self.golden["cases"]
               if name.startswith("R479")}
        self.assertEqual(got, {n: home for n, (_d, home, _a) in TestTheHashLineR479.CASES.items()})


class TestTheEditsWords(unittest.TestCase):
    """§2.4: the edit's refusal on a partial read asks load_refusal first;
    only a loadable file gets the difference words."""

    def edit(self, data=FILE, stat=HELD, loading=False, **kw):
        r = read(data, stat, **kw)
        return edit_basis_refusal(r.proof, r.scan, loading, load_refusal(r))

    def test_the_difference_words(self):
        for words, kw in {
            "T7 not in the file — restore it, or load the file": dict(stat=table({**MEM, 7: {}})),
            "2 tools not in the file — restore them, or load the file": dict(stat=table({**MEM, 7: {}, 8: {}})),
            "T2 differs from LinuxCNC — load the file or restart": dict(stat=table({1: MEM[1], 2: {"Z": 21, "D": 2}})),
            "2 tools differ from LinuxCNC — load the file or restart": dict(stat=table({1: {"Z": 9}, 2: {"Z": 21}})),
        }.items():
            with self.subTest(words):
                self.assertEqual(self.edit(**kw), words)
                self.assertLessEqual(len(words), REASON_MAX_CHARS)

    def test_what_is_wrong_with_the_file_comes_first(self):
        other = table({1: {"Z": 9}, 2: {"Z": 21}})
        self.assertEqual(self.edit(data=FILE.replace(b"\n", b"\r\n"), stat=other), LOAD_LINE_ENDS)
        self.assertEqual(self.edit(data=b"# P7\n" + FILE, stat=other), "Line 1 is a # comment with a P word — use ; instead")
        self.assertEqual(self.edit(data=b"T1 P1 Z10 D1\n", spindle=2), "T2 is in the spindle, not in the file — restore it")
        self.assertEqual(self.edit(stat=TWICE), "LinuxCNC holds T1 twice — restart it")

    def test_the_edits_own_two_words(self):
        self.assertEqual(self.edit(changed=True), "File changed while read — nothing written; read again")
        self.assertEqual(self.edit(stat=table({1: {"Z": 9}, 2: {"Z": 21}}), loading=True), EDIT_LOADING)

    def test_without_removal_the_load_is_no_way_out(self):
        with patch.object(tool_proof, "REMOVAL_ALLOWED", False):
            self.assertEqual(self.edit(stat=table({**MEM, 7: {}})), "T7 not in the file — restore it")
            self.assertEqual(self.edit(stat=table({**MEM, 7: {}, 8: {}})), "2 tools not in the file — restore them")


class TestBothSides(unittest.TestCase):

    FIELDS = ("X", "Y", "Z", "A", "B", "C", "U", "V", "W", "D", "I", "J", "Q")

    def test_the_memory_rev_changes_with_every_field_a_tool_and_the_spindle(self):
        base = memory_rev(HELD, 0)
        self.assertRegex(base, r"^[0-9a-f]{64}$")
        self.assertEqual(memory_rev(table(MEM), 0), base)
        seen = {base, memory_rev(HELD, 2), memory_rev(table({1: MEM[1]}), 0), memory_rev(table({**MEM, 3: {}}), 0)}
        for f in self.FIELDS:
            seen.add(memory_rev(table({1: MEM[1], 2: {**MEM[2], f: MEM[2].get(f, 0) + 1}}), 0))
        self.assertEqual(len(seen), 4 + len(self.FIELDS), "each changes it")

    def test_floats_exact_the_order_of_the_table_not(self):
        self.assertNotEqual(memory_rev(table({1: {"Z": 10.0}}), 0), memory_rev(table({1: {"Z": 10.000000000000002}}), 0))
        self.assertEqual(memory_rev(table({1: MEM[1], 2: MEM[2]}), 0), memory_rev(table({2: MEM[2], 1: MEM[1]}), 0))

    def test_the_spindles_copy_is_no_tool_of_its_own(self):
        self.assertEqual(memory_rev((entry(2, Z=99),) + HELD[1:], 2), memory_rev((entry(2, Z=20, D=2),) + HELD[1:], 2))

    def test_unread_is_no_revision(self):
        for stat, spindle in ((None, 0), ((), 0), (HELD, None), (HELD, -1), (HELD, True)):
            self.assertIsNone(memory_rev(stat, spindle), (stat is HELD, spindle))

    def test_the_differences_both_directions(self):
        stat = table({1: {"Z": 10, "D": 1}, 2: {"Z": -49.123, "D": 6, "Q": 1}, 7: {"Z": 7.5, "D": 3}})
        data = b"T1 P1 Z10 D1\nT2 P2 Z-50 D6.35 X1 Q2\nT9 P9 Z9 D2\n"
        r = read(data, stat)
        self.assertIsNone(load_refusal(r))
        self.assertEqual(load_differences(r.scan, stat, r.proof, {7: "seven", 9: "nine"}), {
            "removed": [{"T": 7, "name": "seven", "Z": 7.5, "D": 3.0}],
            "changed": [{"T": 2, "name": "", "fields": [
                {"f": "X", "now": 0.0, "file": 1.0}, {"f": "Z", "now": -49.123, "file": -50.0},
                {"f": "D", "now": 6.0, "file": 6.35}, {"f": "Q", "now": 1, "file": 2}]}],
            "added": [{"T": 9, "name": "nine", "Z": 9.0, "D": 2.0}]})
        same = read(data, table({1: MEM[1], 2: {"Z": -50, "D": 6.35, "X": 1, "Q": 2}, 9: {"Z": 9, "D": 2}}))
        self.assertEqual(load_differences(same.scan, table({}), same.proof, {}),
                         {"removed": [], "changed": [], "added": []})


if __name__ == "__main__":
    unittest.main()
