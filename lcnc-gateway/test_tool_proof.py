"""Rule R, pure (P6 "tool files read", plan maschinentag.r465 v4 §3/§9,
Codex R465): a read of tool.tbl is admitted by LinuxCNC's own table.

TF-1 every cut of an io-written content is not complete (the newline, the
tool set, TOL), the full content is; Codex's cut-last-digit case is a
proven ROW in a partial read. TF-2 old file / new memory. TF-3 rounding at
TOL. TF-4 unread lines and their T. TF-5 scope: index 0, duplicates, T0,
a random changer, a tool database, an unread or empty controller table.
Plus the real STAT dumps of the native run 2 (positive side) and the
Q465-1 switch point. No gateway, no linuxcnc."""
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import tool_proof
from tool_proof import (TOL, compare, edit_basis_refusal, prove, scan_table, content_rev,
                        library_rev, changed_while_read, NOT_READ, SCOPE_RANDOM, SCOPE_DATABASE,
                        SCOPE_UNKNOWN, DIFFERS, EDIT_CHANGED, EDIT_FILE_CHANGED, EDIT_INCOMPLETE,
                        EDIT_LOADING, EDIT_NO_LINE_END, EDIT_NOT_CONFIRMED, EDIT_TOO_MANY, IO_TOOLS_MAX,
                        LOAD_EMPTY, LoadRead, load_refusal)

FIXTURE = Path(__file__).resolve().parents[1] / "scripts/test_fixtures/tool_proof/run2-checkpoints.json"
LETTERS = ("X", "Y", "Z", "A", "B", "C", "U", "V", "W", "D", "I", "J", "Q")
ATTR = {"X": "xoffset", "Y": "yoffset", "Z": "zoffset", "A": "aoffset", "B": "boffset", "C": "coffset",
        "U": "uoffset", "V": "voffset", "W": "woffset", "D": "diameter", "I": "frontangle",
        "J": "backangle", "Q": "orientation"}


def entry(t, **f):
    """A STAT.tool_table entry (the binding's tool_result) from file letters."""
    e = {a: 0.0 for k, a in ATTR.items() if k != "Q"}
    e["orientation"] = int(f.pop("Q", 0))
    for k, v in f.items():
        e[ATTR[k]] = float(v)
    return SimpleNamespace(id=t, **e)


def table(mem):
    """STAT.tool_table: index 0 the spindle copy (empty), then the home
    entries {T: fields} in order."""
    return (entry(-1),) + tuple(entry(t, **f) for t, f in mem.items())


def io_line(t, f, remark=""):
    """io's tooldata_format_toolline (tooldata_common.cc): T%-3d P%-3d, every
    NONZERO field in D X Y Z A B C U V W I J order as %+f, Q as %d, then
    ' ;%s\\n'."""
    s = "T%-3d P%-3d" % (t, t)
    for k in ("D", "X", "Y", "Z", "A", "B", "C", "U", "V", "W", "I", "J"):
        if f.get(k, 0.0):
            s += " %s%+f" % (k, f[k])
    if f.get("Q", 0):
        s += " Q%d" % f["Q"]
    return s + " ;%s\n" % remark


def io_memory(n):
    """n tools with values io prints ROUNDED (more digits than %+f keeps)."""
    return {t: {"Z": 40 + t * 0.1234567891, "D": 3 + (t % 7) * 0.5000004, "X": (t % 3) * 0.25,
                "Q": t % 4} for t in range(1, n + 1)}


def io_content(mem, remark="x"):
    return "".join(io_line(t, f, f"{remark} {t:03d}") for t, f in mem.items()).encode()


def refusal(data, stat, loading=False, scope=None, spindle=0):
    """What an edit on this read is refused with (None: admitted) — with why
    LinuxCNC may not be asked to load the file, as the gateway asks it (TF-2)."""
    scan = scan_table(data)
    proof = compare(scan, stat, scope)
    return edit_basis_refusal(proof, scan, loading, load_refusal(LoadRead(data, scan, proof, spindle, loading)))


class TestTF1EveryCutIsNotComplete(unittest.TestCase):

    def check_cuts(self, n):
        mem = io_memory(n)
        data = io_content(mem)
        stat = table(mem)
        self.assertEqual(prove(data, stat, None)[2]["state"], "complete", "the full content")
        for p in range(len(data)):
            rows, unread, proof = prove(data[:p], stat, None)
            self.assertNotEqual(proof["state"], "complete", f"cut at {p}: {data[max(0, p - 40):p]!r}")
            by_t = {r["T"]: r for r in rows}
            for t in proof["proven"]:   # a proven row carries the memory's values
                for k in LETTERS:
                    self.assertLessEqual(abs(float(by_t[t].get(k, 0)) - float(mem[t].get(k, 0))), TOL, (p, t, k))

    def test_every_cut_of_50_tools(self):
        self.check_cuts(50)

    def test_every_cut_of_150_tools(self):
        self.check_cuts(150)

    def test_the_cut_last_digit_is_a_proven_row_of_a_partial_read(self):
        # Codex R465: memory D 1.00000051, io writes D+1.000001, a cut keeps
        # D+1.00000 — 5.1e-7 within TOL: the ROW is proven (proven = within
        # TOL, not "fully printed"); the read stays partial (no final newline)
        mem = {1: {"D": 1.00000051}}
        rows, _u, proof = prove(b"T1  P1   D+1.00000", table(mem), None)
        self.assertEqual(proof["proven"], [1])
        self.assertEqual(proof["state"], "partial")
        self.assertFalse(proof["ends_newline"])
        self.assertEqual(prove(b"T1  P1   D+1.000001 ;\n", table(mem), None)[2]["state"], "complete")

    def test_codex_r461_paused_writer(self):
        # `T13 P13 D1.` against memory D 1.875: not complete, nothing proven
        _r, _u, proof = prove(b"T13 P13 D1.", table({13: {"D": 1.875, "Z": 63.192}}), None)
        self.assertEqual((proof["state"], proof["proven"]), ("partial", []))
        self.assertEqual([d["T"] for d in proof["differs"]], [13])

    def test_the_empty_file_with_tools_in_memory(self):
        _r, _u, proof = prove(b"", table(io_memory(3)), None)
        self.assertEqual(proof["state"], "partial")
        self.assertEqual(proof["missing"], [1, 2, 3])
        self.assertEqual(proof["why"], DIFFERS, "neutral — never 'is being written'")

    def test_a_last_line_remark_cut(self):
        mem = io_memory(3)
        data = io_content(mem)
        cut = data[:-4]     # inside the last remark: every value whole, no newline
        _r, _u, proof = prove(cut, table(mem), None)
        self.assertEqual(proof["proven"], [1, 2, 3])
        self.assertEqual(proof["state"], "partial")

    def test_a_cut_at_a_line_end(self):
        mem = io_memory(4)
        data = io_content(mem)
        cut = data[:data.index(b"\n", data.index(b"T2 ")) + 1]   # T1, T2 whole, ends in a newline
        _r, _u, proof = prove(cut, table(mem), None)
        self.assertEqual((proof["state"], proof["proven"], proof["missing"]), ("partial", [1, 2], [3, 4]))

    def test_a_partial_read_named_the_same_whether_a_writer_runs_or_not(self):
        # a paused writer and a closed incomplete file are the same
        # observation (Codex R465): the proof names the facts only
        _r, _u, proof = prove(b"T1 P1 D6\n", table({1: {"D": 6.0}, 2: {"D": 8.0}}), None)
        self.assertEqual((proof["state"], proof["proven"], proof["missing"], proof["why"]),
                         ("partial", [1], [2], DIFFERS))


class TestAPermanentPartial(unittest.TestCase):
    """A named limit: a table that never reads complete keeps every edit
    refused (MT-TF1) — "read again" does not resolve it, so the refusal names
    the cause and the way out (Codex R468 TF-1a/b; the rule is unchanged).
    The cases: LinuxCNC loaded a file without its final newline, a tool
    number twice, a line LinuxCNC skips (unread here), more tools than io
    holds."""

    def test_a_tool_number_twice_stays_partial_whatever_linuxcnc_holds(self):
        stat = (entry(-1), entry(1, Z=5), entry(1, Z=6), entry(2, Z=1))    # io loads both lines
        _r, _u, proof = prove(b"T1 P1 Z5 ;\nT1 P2 Z6 ;\nT2 P3 Z1 ;\n", stat, None)
        self.assertEqual((proof["state"], proof["proven"], proof["duplicates"]), ("partial", [2], [1]))
        self.assertEqual(refusal(b"T1 P1 Z5 ;\nT1 P2 Z6 ;\nT2 P3 Z1 ;\n", stat),
                         "T1 twice in the file — remove one, restart LinuxCNC", "the repairing delete too")

    def test_a_loaded_table_without_its_final_newline_stays_partial(self):
        mem = {1: {"D": 6.0}, 2: {"D": 4.0}}
        _r, _u, proof = prove(b"T1 P1 D6 ;\nT2 P2 D4 ;", table(mem), None)
        self.assertEqual((proof["state"], proof["proven"], proof["ends_newline"]), ("partial", [1, 2], False))
        self.assertEqual(refusal(b"T1 P1 D6 ;\nT2 P2 D4 ;", table(mem)), EDIT_NO_LINE_END)
        self.assertEqual(prove(b"T1 P1 D6 ;\nT2 P2 D4 ;\n", table(mem), None)[2]["state"], "complete",
                         "the way out: the file rewritten with its line end")

    def test_more_tools_than_io_holds_stay_partial(self):
        # io loads at most CANON_POCKETS_MAX - 1 (1000) home entries
        _r, _u, proof = prove(b"T1 P1 ;\nT2 P2 ;\n", table({1: {}}), None)
        self.assertEqual((proof["state"], proof["extra"]), ("partial", [2]))


class TestTheRefusalNamesTheCauseAndTheWayOut(unittest.TestCase):
    """Codex R468 TF-1a/b: one function, "why — what to do", ≤ 60 characters;
    "read again" only where a read may come out differently; nothing is
    written in any of them (the edits: test_tool_proof_gateway)."""

    A = b"T1 P1 Z5 ;\nT2 P2 Z6 ;\n"
    MEM = {1: {"Z": 5}, 2: {"Z": 6}}

    def test_each_cause(self):
        twice = (entry(-1), entry(1, Z=5), entry(1, Z=9), entry(2, Z=6))
        many = "".join(f"T{t} P{t} ;\n" for t in range(1, IO_TOOLS_MAX + 2)).encode()
        cases = [
            # the file's own, lasting causes
            ("Last line has no line end — add it in an editor", self.A[:-1], table(self.MEM)),
            ("T1 twice in the file — remove one, restart LinuxCNC", b"T1 P1 Z5 ;\nT1 P3 Z9 ;\nT2 P2 Z6 ;\n", twice),
            ("Line 2 not readable — fix it in an editor", b"T1 P1 Z5 ;\nT2 P2 E7 ;\n", table({1: {"Z": 5}})),
            ("Line 2 not readable — fix it in an editor", b"T1 P1 Z5 ;\nT2 P2 Z6mm ;\n", table(self.MEM)),
            # … and one LinuxCNC took a tool from (%d of "2a" is 2; the last T):
            # that tool is missing WITH its line, never "not in the file"
            ("Line 2 not readable — fix it in an editor", b"T1 P1 Z5 ;\nT2a P2 Z6 ;\n", table(self.MEM)),
            ("Line 2 not readable — fix it in an editor", b"T1 P1 Z5 ;\nT9 T2 P2 Z6 ;\n", table(self.MEM)),
            (EDIT_TOO_MANY, many, table({t: {} for t in range(1, IO_TOOLS_MAX + 1)})),
            # LinuxCNC's
            ("LinuxCNC holds T1 twice — restart it", self.A, twice),
            # a pure difference
            ("T2 differs from LinuxCNC — load the file or restart", self.A, table({1: {"Z": 5}, 2: {"Z": 7}})),
            ("T2 differs from LinuxCNC — load the file or restart", self.A, table({1: {"Z": 5}})),
            ("2 tools differ from LinuxCNC — load the file or restart", self.A, table({1: {"Z": 5}, 9: {"Z": 6}})),
            ("T3 not in the file — restore it, or load the file", self.A, table({**self.MEM, 3: {}})),
            ("2 tools not in the file — restore them, or load the file", self.A, table({**self.MEM, 3: {}, 4: {}})),
            # missing AND other differences: loading or a restart, both take the file as it is
            ("2 tools differ from LinuxCNC — load the file or restart", self.A, table({1: {"Z": 5}, 2: {"Z": 7}, 3: {}})),
            # 0 bytes are no cut line (plan TF-2 §1.2 E) — and what an io save shows for an instant (R491)
            (LOAD_EMPTY, b"", table(self.MEM)),
            # what LinuxCNC must not be asked to load names its own way out (TF-2 §2.4)
            ("Line 2 too long for LinuxCNC — shorten it in an editor", b"T1 P1 Z5 ;\nT2 P2 Z6 ;" + b"r" * 250 + b"\n",
             table({1: {"Z": 5}, 2: {"Z": 7}})),
            # may come out differently: a save under way, or a closed, cut file
            (EDIT_INCOMPLETE, self.A[:11 + 7], table(self.MEM)),
            (EDIT_INCOMPLETE, b"T1 P1 Z5 ;\nT2 P", table(self.MEM)),
        ]
        for want, data, stat in cases:
            with self.subTest(want, data=data[:40]):
                self.assertEqual(refusal(data, stat), want)
                self.assertLessEqual(len(want), 60)

    def test_a_cause_in_a_file_that_ends_inside_a_line_is_not_named(self):
        # a save under way is cut anywhere: no "fix line 2 in an editor", no
        # "T1 twice" from a file that is still being written
        stat = table({**self.MEM, 3: {}})
        for data in (b"T1 P1 Z5 ;\nT2 P2 E7 ;\nT3", b"T1 P1 Z5 ;\nT1 P2 Z6 ;\nT3 P"):
            self.assertEqual(refusal(data, stat), EDIT_INCOMPLETE)

    def test_read_again_only_where_it_may_help(self):
        scan = scan_table(self.A)
        self.assertEqual(edit_basis_refusal(changed_while_read(scan), scan), EDIT_FILE_CHANGED)
        again = [EDIT_FILE_CHANGED, EDIT_INCOMPLETE, EDIT_LOADING, EDIT_CHANGED]
        for text in again:
            self.assertRegex(text, "again")
            self.assertLessEqual(len(text), 60)
        for data, stat in ((self.A[:-1], table(self.MEM)), (b"T1 P1 ;\nT1 P2 ;\n", table({1: {}})),
                           (b"T1 P1 E1 ;\n", (entry(-1),)), (self.A, table({1: {"Z": 1}})),
                           (self.A, table({**self.MEM, 3: {}}))):
            self.assertNotRegex(refusal(data, stat), "again", data)

    def test_an_awaited_load_is_named_until_it_ends(self):
        stat = table({1: {"Z": 5}, 2: {"Z": 7}})
        self.assertEqual(refusal(self.A, stat, loading=True), EDIT_LOADING)
        self.assertEqual(refusal(self.A, table(self.MEM), loading=True), None, "complete is admitted")

    def test_the_way_out_taken_leaves_the_next_cause_or_none(self):
        # the line end added: complete, no reload needed (Codex TF-1a)
        self.assertIsNone(refusal(self.A, table(self.MEM)))
        # one of the two rows removed in an editor: LinuxCNC still holds two
        # (tooldata_load keeps both) — hence "restart LinuxCNC", then complete
        twice = (entry(-1), entry(1, Z=5), entry(1, Z=9), entry(2, Z=6))
        self.assertEqual(refusal(self.A, twice), "LinuxCNC holds T1 twice — restart it")
        self.assertIsNone(refusal(self.A, table(self.MEM)), "the start loaded the file")
        # a fixed line LinuxCNC skipped: named as what it then is
        self.assertEqual(refusal(self.A, table({1: {"Z": 5}})), "T2 differs from LinuxCNC — load the file or restart")

    def test_the_longest_texts_fit(self):
        big = {t: {} for t in range(1, IO_TOOLS_MAX + 1)}
        full = "".join(f"T{t} P{t} Z1 ;\n" for t in big).encode()
        texts = [refusal(full, table(big)), refusal(b"T99999 P1 ;\n", table({**big, 99999: {}})),
                 refusal(b"T99999 P1 ;\nT99999 P2 ;\n", table({99999: {}})),
                 refusal(b"T99999 P1 Z1 ;\n", table({99999: {}})), refusal(b";\n", table({99999: {}}))]
        self.assertEqual(texts[0], "1000 tools differ from LinuxCNC — load the file or restart")
        self.assertEqual(texts[1], "1000 tools not in the file — restore them, or load the file")
        for t in texts:
            self.assertLessEqual(len(t), 60, t)


class TestTF2OldFileNewMemory(unittest.TestCase):

    def test_the_changed_tool_differs(self):
        mem = io_memory(5)
        old = io_content(mem)
        new_mem = {**mem, 3: {**mem[3], "Z": mem[3]["Z"] + 0.5}}
        _r, _u, proof = prove(old, table(new_mem), None)
        self.assertEqual(proof["state"], "partial")
        self.assertEqual(proof["differs"], [{"T": 3, "fields": ["Z"]}])
        self.assertNotIn(3, proof["proven"])


class TestTF3Rounding(unittest.TestCase):

    def test_the_printed_digits_are_proven_a_micron_is_not(self):
        mem = {1: {"Z": 50.4703703717}}
        self.assertEqual(prove(b"T1 P1 Z+50.470370 ;\n", table(mem), None)[2]["state"], "complete")
        _r, _u, proof = prove(b"T1 P1 Z+50.470371 ;\n", table({1: {"Z": 50.4703700}}), None)
        self.assertEqual(proof["differs"], [{"T": 1, "fields": ["Z"]}], "1e-6 off is not proven")

    def test_q_is_exact(self):
        self.assertEqual(prove(b"T1 P1 Q3 ;\n", table({1: {"Q": 2}}), None)[2]["differs"],
                         [{"T": 1, "fields": ["Q"]}])

    def test_tol_is_not_exact_comparison(self):
        # an exact comparison would refuse every io content (%+f rounds)
        mem = io_memory(10)
        self.assertEqual(prove(io_content(mem), table(mem), None)[2]["state"], "complete")
        with patch.object(tool_proof, "TOL", 0.0):
            self.assertEqual(prove(io_content(mem), table(mem), None)[2]["state"], "partial")


class TestTF4Unread(unittest.TestCase):

    def test_a_line_without_a_whole_t_is_attached_to_nothing(self):
        mem = {1: {"D": 6.0}, 3: {"D": 4.0}}
        data = b"T1 P1 D6 ;\nT3 P3 D4 E7 ;\nTx P2 Z1 ;\nT4 T5 P4 ;\nP9 Z1mm ;\n"
        rows, unread, proof = prove(data, table(mem), None)
        self.assertEqual(unread, [{"line": 2, "T": 3}, {"line": 3, "T": None},
                                  {"line": 4, "T": None}, {"line": 5, "T": None}])
        self.assertEqual([r["T"] for r in rows], [1])
        self.assertEqual(proof["state"], "partial", "an unread line: never complete")
        self.assertEqual(proof["missing"], [3], "the tool io loaded from it is missing, not proven")

    def test_a_whole_decimal_t_is_read(self):
        self.assertEqual(prove(b"T7.0 P1 E1 ;\n", table({}), None)[1], [{"line": 1, "T": 7}])

    def test_a_non_utf8_line_is_unread_with_its_t(self):
        rows, unread, proof = prove(b"T1 P1 D6 ;\nT2 P2 D4 ; Grad \xb0\n", table({1: {"D": 6}, 2: {"D": 4}}), None)
        self.assertEqual(([r["T"] for r in rows], unread), ([1], [{"line": 2, "T": 2}]))
        self.assertEqual(proof["state"], "partial")

    def test_comments_and_blank_lines_are_no_tool(self):
        mem = {1: {"D": 6.0}}
        self.assertEqual(prove(b";Tool  Pocket\n\n# note\nT1 P1 D6 ;\n", table(mem), None)[2]["state"], "complete")


class TestTF5Scope(unittest.TestCase):

    def test_index_0_is_the_spindle_copy_and_ignored(self):
        mem = {1: {"Z": 50.0}}
        stat = (entry(1, Z=99.0),) + table(mem)[1:]    # index 0 holds another value: never compared
        self.assertEqual(prove(b"T1 P1 Z50 ;\n", stat, None)[2]["state"], "complete")

    def test_a_duplicate_is_unproven_on_both_sides(self):
        stat = (entry(-1), entry(1, Z=5), entry(1, Z=5))
        _r, _u, proof = prove(b"T1 P1 Z5 ;\nT1 P2 Z5 ;\n", stat, None)
        self.assertEqual((proof["state"], proof["proven"], proof["duplicates"]), ("partial", [], [1]))
        _r, _u, proof = prove(b"T1 P1 Z5 ;\n", stat, None)
        self.assertEqual((proof["state"], proof["proven"], proof["duplicates"]), ("partial", [], [1]))
        _r, _u, proof = prove(b"T1 P1 Z5 ;\nT1 P1 Z5 ;\n", table({1: {"Z": 5}}), None)
        self.assertEqual((proof["state"], proof["proven"], proof["duplicates"]), ("partial", [], [1]))

    def test_t0_is_a_home_entry_like_io_saves_it(self):
        # write_tool_line saves every entry with toolno != -1 (T0 too)
        stat = (entry(-1), entry(0, Z=1.5), entry(2, Z=3))
        self.assertEqual(prove(b"T0 P0 Z1.5 ;\nT2 P2 Z3 ;\n", stat, None)[2]["state"], "complete")
        self.assertEqual(prove(b"T2 P2 Z3 ;\n", stat, None)[2]["missing"], [0])

    def test_scopes_are_unchecked_with_their_reason(self):
        mem = io_memory(3)
        data = io_content(mem)
        for scope in (SCOPE_RANDOM, SCOPE_DATABASE, SCOPE_UNKNOWN):
            with self.subTest(scope):
                proof = prove(data, table(mem), scope)[2]
                self.assertEqual((proof["state"], proof["why"], proof["proven"]), ("unchecked", scope, []))

    def test_an_unread_or_empty_controller_table_is_not_read_never_no_tools(self):
        for stat in (None, ()):
            with self.subTest(stat=stat):
                for data in (b"", b"T1 P1 D6 ;\n"):
                    proof = prove(data, stat, None)[2]
                    self.assertEqual((proof["state"], proof["why"]), ("unchecked", NOT_READ))

    def test_an_empty_file_against_an_empty_initialised_table_is_complete(self):
        self.assertEqual(prove(b"", (entry(-1),), None)[2]["state"], "complete")
        self.assertEqual(prove(b";Tool  Pocket\n", (entry(-1),), None)[2]["state"], "complete")

    def test_a_tool_only_in_the_file_is_extra(self):
        _r, _u, proof = prove(b"T1 P1 ;\nT9 P9 ;\n", table({1: {}}), None)
        self.assertEqual((proof["state"], proof["extra"]), ("partial", [9]))


class TestTheRealStatDumps(unittest.TestCase):
    """The positive side against the REAL STAT.tool_table (native run 2): the
    examples' format, io's %+f with T1 loaded, the gateway writer's format
    after a reload (loaded tool, E-Stop) — complete, every tool proven."""

    def test_every_checkpoint_is_complete(self):
        cps = json.loads(FIXTURE.read_text())["checkpoints"]
        self.assertEqual([c["name"] for c in cps], ["fresh", "io-loaded", "edit-loaded", "edit-estop"])
        for cp in cps:
            with self.subTest(cp["name"]):
                stat = tuple(SimpleNamespace(id=r[1], xoffset=r[2], yoffset=r[3], zoffset=r[4], aoffset=r[5],
                                             boffset=r[6], coffset=r[7], uoffset=r[8], voffset=r[9],
                                             woffset=r[10], diameter=r[11], frontangle=r[12], backangle=r[13],
                                             orientation=r[14]) for r in cp["stat_tool_table"])
                self.assertEqual([r[0] for r in cp["stat_tool_table"]], list(range(len(stat))), "index = idx")
                rows, unread, proof = prove(cp["bytes"].encode("latin-1"), stat, None)
                self.assertEqual((proof["state"], len(proof["proven"]), unread), ("complete", 52, []))
                if cp["tool_in_spindle"]:
                    self.assertEqual(stat[0].id, cp["tool_in_spindle"], "index 0 is the loaded tool's copy")


class TestTheEditAdmissionAndTheQ4651Switch(unittest.TestCase):
    """MT-TF1: an edit needs `complete`; Q465-1 is ONE switch
    (UNCHECKED_EDITS_BLOCKED) for a random changer and a tool database."""

    def proof(self, state, why=None):
        return {"state": state, "why": why}

    SCAN = scan_table(b"T1 P1 Z5 ;\n")

    def test_complete_admits_partial_refuses(self):
        self.assertIsNone(edit_basis_refusal(self.proof("complete"), self.SCAN))
        self.assertIsNotNone(refusal(b"T1 P1 Z5 ;\n", table({1: {"Z": 6}})))
        self.assertLessEqual(len(EDIT_NOT_CONFIRMED), 60)

    def test_a_partial_proof_is_refused_whatever_it_names(self):
        # no fact at all (compare leaves none): refused, never admitted
        empty = {"state": "partial", "why": DIFFERS, "missing": [], "extra": [], "differs": [], "duplicates": []}
        self.assertEqual(edit_basis_refusal(empty, self.SCAN), EDIT_NOT_CONFIRMED)

    def test_the_switch_blocks_by_default_and_names_why(self):
        self.assertTrue(tool_proof.UNCHECKED_EDITS_BLOCKED, "Q465-1's default until the operator answers")
        for why in (SCOPE_RANDOM, SCOPE_DATABASE, SCOPE_UNKNOWN, NOT_READ):
            with self.subTest(why):
                words = edit_basis_refusal(self.proof("unchecked", why), self.SCAN)
                self.assertIn(why, words)
                self.assertIn("nothing written", words)
                self.assertLessEqual(len(words), 60)

    def test_the_switch_off_admits_only_the_two_scopes(self):
        with patch.object(tool_proof, "UNCHECKED_EDITS_BLOCKED", False):
            self.assertIsNone(edit_basis_refusal(self.proof("unchecked", SCOPE_RANDOM), self.SCAN))
            self.assertIsNone(edit_basis_refusal(self.proof("unchecked", SCOPE_DATABASE), self.SCAN))
            self.assertIsNotNone(edit_basis_refusal(self.proof("unchecked", SCOPE_UNKNOWN), self.SCAN))
            self.assertIsNotNone(edit_basis_refusal(self.proof("unchecked", NOT_READ), self.SCAN))
            self.assertIsNotNone(refusal(b"T1 P1 Z5 ;\n", table({1: {"Z": 6}})))
            # a line the rewrite would drop stops it there too
            self.assertEqual(refusal(b"T1 P1 ;\nT2 P2 E7 ;\n", None, scope=SCOPE_RANDOM),
                             "Line 2 not readable — fix it in an editor")


class TestRevisions(unittest.TestCase):

    def test_the_same_bytes_the_same_rev_an_in_place_rewrite_a_new_one(self):
        a, b = b"T1 P1 Z50 ;\n", b"T1 P1 Z51 ;\n"
        self.assertEqual(content_rev(a), content_rev(bytes(a)))
        self.assertNotEqual(content_rev(a), content_rev(b))

    def test_the_library_rev_is_canonical(self):
        self.assertEqual(library_rev({"1": {"a": 1, "b": 2}}), library_rev({"1": {"b": 2, "a": 1}}))
        self.assertNotEqual(library_rev({"1": {"a": 1}}), library_rev({"1": {"a": 2}}))

    def test_a_changed_read_proves_nothing(self):
        proof = changed_while_read(scan_table(b"T1 P1 ;\n"))
        self.assertEqual((proof["state"], proof["proven"]), ("partial", []))

    def test_compare_takes_one_scan(self):
        scan = scan_table(b"T1 P1 Z5 ;\n")
        self.assertEqual(compare(scan, table({1: {"Z": 5}}), None)["state"], "complete")
        self.assertEqual(compare(scan, table({1: {"Z": 6}}), None)["state"], "partial")


if __name__ == "__main__":
    unittest.main()
