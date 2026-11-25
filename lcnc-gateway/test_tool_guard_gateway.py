"""Tool guard (Codex R476 answers 2 and 6): what a tool-table write that sends
a reload must not do — on the real WS path (save, add, delete, renumber) and
the real REST import:

- a PREPARED tool (`T5` without `M6`): LinuxCNC keeps it as a table index and
  its pocket on HAL; a load gives the indices anew in file order. The row that
  will stand at that index in the file ABOUT TO BE WRITTEN must be the same T
  and the same P as prepared (MT476-02) — else nothing is written;
- STANDSTILL: a load sent while something moves runs later;
- every line of the file about to be written is one line for LinuxCNC (255
  bytes with its newline) and every integer one its %d holds (MT476-03).

The table, the library and LinuxCNC's table as in test_tool_commit_gateway."""
import asyncio
import io
import json
import unittest

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()
import gateway  # noqa: E402
import tool_proof  # noqa: E402
from fastapi import HTTPException, UploadFile  # noqa: E402
from unittest.mock import patch  # noqa: E402
from command_policy import NOT_ARMED  # noqa: E402
from test_tool_commit_gateway import _Commit  # noqa: E402
from tool_io_fixture import READER_AT_REST, at_rest, entry, load_into  # noqa: E402

#: file order = number order: index 1 T2, index 2 T5, index 3 T8
ROWS = ("T2 P2 Z20 D2 ; two\n"
        "T5 P5 Z50 D5 ; five\n"
        "T8 P8 Z80 D8 ; eight\n")

MOVING = "Machine moving — wait until it stands"
MOTION_UNREAD = "Motion state unknown — wait for status"
UNREAD = "Prepared tool not read — try again"
UNKNOWN = "Prepared tool unknown — send T0 or restart LinuxCNC"
PREPARING = "A tool is being prepared — wait until it is done"
PREPARED = "A tool is prepared — change to another tool or send T0"
CLEARED = "Prepared tool unclear since the E-Stop — send T0 first"


def library_of(*numbers, text="imported"):
    return json.dumps({"data": [{"type": "flat end mill", "post-process": {"number": n},
                                 "geometry": {"DC": 6, "OAL": 60, "LB": 45}, "description": text}
                                for n in numbers]}).encode()


class _Guard(_Commit):

    def setUp(self):
        super().setUp()
        self.reader = dict(READER_AT_REST)
        gateway._reader_get = lambda f: self.reader.get(f)     # (restored by _Handlers)
        self.fresh()

    def fresh(self, text=ROWS):
        super().fresh()
        self.table.write_text(text)
        load_into(self.conn.stat, self.table)
        at_rest(self.conn.stat)
        self.reader.clear()
        self.reader.update(READER_AT_REST)
        gateway._reader_is_stale = lambda: False
        gateway._source_claims.clear()

    def prepare(self, index, tool, pocket):
        """`T<tool>` prepared without M6, as LinuxCNC's io leaves it: the
        index in STAT, number and pocket on the pins."""
        self.conn.stat.pocket_prepped = index
        self.reader.update(tool_prep_number=tool, tool_prep_pocket=pocket)

    def edit(self, **msg):
        if msg["cmd"] in ("save_tool", "renumber_tool"):
            msg["expected"] = self.expect(msg.get("old_tool_number", msg["tool_number"]))
        return lambda: self.send(msg)

    def importing(self, *numbers, text="imported"):
        blob = library_of(*numbers, text=text)

        async def run():
            gateway._cmd_lock = None
            try:
                return await gateway.apply_tool_library_import(
                    UploadFile(file=io.BytesIO(blob), filename="tools.json"), x_conn_key=self.writer.conn_key)
            except HTTPException as e:
                return {"ok": False, "http": e.status_code, "error": e.detail}
        return lambda: asyncio.run(run())

    def refused(self, write, why, http=409):
        before = self.files()
        r = write()
        self.assertEqual((r["ok"], r.get("error")), (False, why), r)
        self.assertEqual(r.get("http", http), http, r)
        self.assertEqual(self.files(), before, "table and library byte-identical")
        self.assertEqual(self.io.loads, 0, "no reload")

    def written(self, write):
        before = self.files()
        r = write()
        self.assertEqual((r["ok"], r.get("reload")), (True, "confirmed"), r)
        self.assertNotEqual(self.files()[0], before[0])
        self.assertEqual(self.io.loads, 1, "one reload")


# ---- the prepared tool ---------------------------------------------------------

class TestTheSameIndexAndToolInAnotherPocket(_Guard):
    """MT476-02: HAL holds the pocket the changer prepared — a load does not
    prepare it again."""

    def test_save(self):
        self.prepare(2, 5, 5)
        self.refused(self.edit(cmd="save_tool", tool_number=5, pocket=9), PREPARED)

    def test_renumber_onto_its_own_number(self):
        self.prepare(2, 5, 5)
        self.refused(self.edit(cmd="renumber_tool", old_tool_number=5, tool_number=5, pocket=9), PREPARED)

    def test_import(self):
        # an import gives every tool the pocket of its number
        self.prepare(2, 5, 15)
        self.refused(self.importing(2, 5, 8), PREPARED)

    def test_add_and_delete_write_the_pocket_the_file_got_meanwhile(self):
        # T5 prepared from P5; the file changed to P9 and LinuxCNC loaded it
        # (STAT carries no pocket: the read proves complete) — the write would
        # leave P9 for a changer that prepared P5
        for what, write in (("add", dict(cmd="add_tool", tool_number=9)),
                            ("delete", dict(cmd="delete_tool", tool_number=8)),
                            ("save of another", dict(cmd="save_tool", tool_number=8, z_offset=81.0))):
            with self.subTest(what):
                self.fresh(ROWS.replace("T5 P5", "T5 P9"))
                self.prepare(2, 5, 5)
                self.refused(self.edit(**write), PREPARED)


class TestTheIndexShifted(_Guard):

    SHIFTS = {
        "add before it": lambda s: s.edit(cmd="add_tool", tool_number=3),
        "delete before it": lambda s: s.edit(cmd="delete_tool", tool_number=2),
        "delete it": lambda s: s.edit(cmd="delete_tool", tool_number=5),
        "renumber past it": lambda s: s.edit(cmd="renumber_tool", old_tool_number=2, tool_number=9),
        "renumber before it": lambda s: s.edit(cmd="renumber_tool", old_tool_number=8, tool_number=1),
        "renumber it": lambda s: s.edit(cmd="renumber_tool", old_tool_number=5, tool_number=6),
        "import without it": lambda s: s.importing(2, 8),
        "import with another before it": lambda s: s.importing(1, 2, 5),
    }

    def test_refused_while_prepared(self):
        for what, make in self.SHIFTS.items():
            with self.subTest(what):
                self.fresh()
                self.prepare(2, 5, 5)
                self.refused(make(self), PREPARED)

    def test_admitted_when_nothing_is_prepared(self):
        # -1: LinuxCNC's start and every finished change; 0: T0 prepared (M6
        # unloads: index 0 is no row of the file)
        for index in (-1, 0):
            for what, make in self.SHIFTS.items():
                with self.subTest(what, index=index):
                    self.fresh()
                    self.prepare(index, 0, 0)
                    self.written(make(self))

    def test_the_sorted_rewrite_of_a_hand_sorted_file(self):
        # the writer sorts by T: a Z correction of T8 moves T5 from index 1
        self.fresh("T5 P5 Z50 D5 ; five\nT2 P2 Z20 D2 ; two\nT8 P8 Z80 D8 ; eight\n")
        self.prepare(1, 5, 5)
        self.refused(self.edit(cmd="save_tool", tool_number=8, z_offset=81.0), PREPARED)
        self.fresh("T5 P5 Z50 D5 ; five\nT2 P2 Z20 D2 ; two\nT8 P8 Z80 D8 ; eight\n")
        self.prepare(3, 8, 8)                                  # T8 stays at index 3
        self.written(self.edit(cmd="save_tool", tool_number=8, z_offset=81.0))

    def test_a_hash_line_takes_an_index_the_rewrite_drops(self):
        # measured with the compiled reader: "#T3 P3 …" is no tool but takes
        # index 2 — T5 stands at 3; the rewrite keeps no comment line
        text = ROWS.replace("T5 P5", "#T3 P3 Z30\nT5 P5")
        for index, why in ((3, PREPARED), (2, None)):
            with self.subTest(index=index):
                self.fresh(text)
                self.conn.stat.tool_table = (entry(0), entry(2, Z=20, D=2), entry(-1), entry(5, Z=50, D=5),
                                             entry(8, Z=80, D=8))
                self.prepare(index, 5, 5)
                write = self.edit(cmd="save_tool", tool_number=8, z_offset=81.0)
                if why:
                    self.refused(write, why)
                else:                                          # (what the pins say at the index it WILL have)
                    self.written(write)

    def test_past_the_end_of_the_file(self):
        self.prepare(3, 8, 8)
        self.refused(self.edit(cmd="delete_tool", tool_number=8), PREPARED)


class TestNotABluntLock(_Guard):
    """Index, T and P unchanged: admitted while the tool is prepared."""

    def test_a_length_a_diameter_a_text_of_any_tool(self):
        for tool in (2, 5, 8):
            for what, field in (("z", {"z_offset": 33.0}), ("d", {"diameter": 3.5}), ("text", {"remark": "new"})):
                with self.subTest(what, tool=tool):
                    self.fresh()
                    self.prepare(2, 5, 5)
                    self.written(self.edit(cmd="save_tool", tool_number=tool, **field))

    def test_add_delete_renumber_behind_it(self):
        for what, write in (("add", dict(cmd="add_tool", tool_number=9)),
                            ("delete", dict(cmd="delete_tool", tool_number=8)),
                            ("renumber", dict(cmd="renumber_tool", old_tool_number=8, tool_number=30))):
            with self.subTest(what):
                self.fresh()
                self.prepare(2, 5, 5)
                self.written(self.edit(**write))

    def test_another_pocket_of_another_tool(self):
        self.prepare(2, 5, 5)
        self.written(self.edit(cmd="save_tool", tool_number=8, pocket=18))

    def test_an_import_that_keeps_it(self):
        self.prepare(2, 5, 5)
        self.written(self.importing(2, 5, 30))

    def test_a_number_left_by_an_aborted_preparation(self):
        # T6 aborted before it was prepared: the pins keep 6, the index is -1
        self.prepare(-1, 6, 6)
        self.written(self.edit(cmd="add_tool", tool_number=1))


class TestWhatIsNotKnown(_Guard):

    WRITES = {
        "save": lambda s: s.edit(cmd="save_tool", tool_number=8, z_offset=81.0),
        "add": lambda s: s.edit(cmd="add_tool", tool_number=9),
        "delete": lambda s: s.edit(cmd="delete_tool", tool_number=8),
        "renumber": lambda s: s.edit(cmd="renumber_tool", old_tool_number=8, tool_number=9),
        "import": lambda s: s.importing(2, 5, 8),
    }

    def each(self, change, why):
        for what, make in self.WRITES.items():
            with self.subTest(what):
                self.fresh()
                change()
                self.refused(make(self), why)

    def test_the_index_not_read(self):
        # (the prepared tool itself is never asked then: nothing is guessed)
        for value in (None, "2", 2.0, True, "absent"):
            def change(value=value):
                self.prepare(2, 5, 5)
                if value == "absent":
                    del self.conn.stat.pocket_prepped
                else:
                    self.conn.stat.pocket_prepped = value
            with self.subTest(value=value):
                self.each(change, UNREAD)

    def test_the_pins_absent_from_the_snapshot(self):
        # an older reader (no tool-prep-pocket pin) or a pin that did not read
        for field in ("tool_prep_number", "tool_prep_pocket"):
            def change(field=field):
                self.prepare(2, 5, 5)
                del self.reader[field]
            with self.subTest(field):
                self.each(change, UNKNOWN)

    def test_the_reader_stale(self):
        def change():
            self.prepare(2, 5, 5)
            gateway._reader_is_stale = lambda: True
        self.each(change, "Tool change request unknown — HAL reader stale")

    def test_the_pins_cleared_by_an_e_stop(self):
        # EMC_AUX_ESTOP_ON clears the pins (hal_init_pins), never the index
        self.each(lambda: self.prepare(2, 0, 0), CLEARED)

    def test_a_preparation_under_way(self):
        # another client left MDI while the changer still turns: the index is
        # the old one, the load would run after the preparation
        for index in (-1, 0, 2):
            def change(index=index):
                self.prepare(index, 5, 5)
                self.reader["tool_prepare"] = True
            with self.subTest(index=index):
                self.each(change, PREPARING)

    def test_an_older_reader_admits_only_where_it_proves_nothing_is_prepared(self):
        def older():
            del self.reader["tool_prepare"], self.reader["tool_prep_pocket"]
        for what, make in self.WRITES.items():
            with self.subTest(what):
                self.fresh()
                older()
                self.written(make(self))               # index -1, number 0: as before

        def maybe_preparing():
            self.prepare(-1, 5, 5)
            older()
        self.each(maybe_preparing, UNKNOWN)

    def test_a_random_changer_and_a_tool_database(self):
        # only the import reaches a write there (UNCHECKED_EDITS_BLOCKED)
        for scope in (tool_proof.SCOPE_RANDOM, tool_proof.SCOPE_DATABASE, tool_proof.SCOPE_UNKNOWN):
            with self.subTest(scope), patch.object(gateway, "_tool_table_scope", lambda scope=scope: scope):
                self.fresh()
                self.prepare(2, 5, 5)
                self.refused(self.importing(2, 5, 8), f"Prepared tool not checked ({scope}) — send T0")
                self.fresh()
                r = self.importing(2, 5, 8)()          # nothing prepared: as before
                self.assertEqual((r["ok"], r["reload"]), (True, "not checked"), r)


# ---- standstill ----------------------------------------------------------------

class TestStandstillAtTheSend(_Guard):

    WRITES = TestWhatIsNotKnown.WRITES

    def test_moving(self):
        # a manual jog keeps the interpreter idle: the gate is open
        for what, make in self.WRITES.items():
            for field, value in (("inpos", False), ("current_vel", 1.5), ("current_vel", -1.5)):
                with self.subTest(what, field=field, value=value):
                    self.fresh()
                    setattr(self.conn.stat, field, value)
                    self.refused(make(self), MOVING)

    def test_unread(self):
        for what, make in self.WRITES.items():
            for field in ("inpos", "current_vel"):
                with self.subTest(what, field=field):
                    self.fresh()
                    delattr(self.conn.stat, field)
                    self.refused(make(self), MOTION_UNREAD)

    def test_a_jog_begun_while_the_write_reads(self):
        # standing at the admission before the reads, moving at the poll after
        for what, make in self.WRITES.items():
            with self.subTest(what):
                self.fresh()
                stat, polls = self.conn.stat, []
                # the import asks the admission once, an edit twice (a delete
                # and a renumber read the spindle's tool before)
                n = {"import": 1, "save": 2, "add": 2}.get(what, 3)

                def poll():
                    polls.append(1)
                    stat.inpos = len(polls) < n
                with patch.object(stat, "poll", poll):
                    self.refused(make(self), MOVING)
                self.assertEqual(len(polls), n)

    def test_the_poll_decides_not_what_was_read_before(self):
        # the jog ended with the poll
        for what, make in self.WRITES.items():
            with self.subTest(what):
                self.fresh()
                stat = self.conn.stat
                stat.inpos = False

                def poll():
                    stat.inpos = True
                with patch.object(stat, "poll", poll):
                    self.written(make(self))

    def test_e_stop_and_machine_off_stand(self):
        for state in (linuxcnc.STATE_ESTOP, linuxcnc.STATE_OFF):
            for what, make in self.WRITES.items():
                with self.subTest(what, state=state):
                    self.fresh()
                    self.conn.stat.task_state, self.conn.stat.enabled = state, False
                    self.conn.stat.estop = int(state == linuxcnc.STATE_ESTOP)
                    self.written(make(self))

    def test_a_write_without_a_reload_is_not_asked(self):
        # the metadata refresh sends nothing to LinuxCNC
        self.conn.stat.inpos = False
        self.prepare(2, 5, 15)
        self.reader["tool_prepare"] = True
        self.assertIsNone(gateway._write_admission_refusal(self.writer.conn_key, tool_table=True))


# ---- the writer is the last word -----------------------------------------------

class TestTheWriterAfterTheNewReads(_Guard):
    """MT-I35 with the new reads: what the event loop does while the prepared
    tool is read refuses the write with ITS reason."""

    WRITES = TestWhatIsNotKnown.WRITES

    def lost(self, do, why):
        for what, make in self.WRITES.items():
            with self.subTest(what):
                self.fresh()
                self.prepare(2, 5, 5)
                pins = []

                def read(field):
                    if field == "tool_prep_pocket":     # the last of the new reads, in the write's thread
                        pins.append(1)
                        do()
                    return self.reader.get(field)
                gateway._reader_get = read
                try:
                    self.refused(make(self), why)
                finally:
                    gateway._reader_get = lambda f: self.reader.get(f)
                self.assertTrue(pins, "the prepared pocket was read")

    def test_disarmed(self):
        self.lost(lambda: setattr(self.writer, "armed", False), NOT_ARMED)

    def test_unregistered(self):
        self.lost(lambda: gateway._clients.pop(901, None), gateway.CONN_UNKNOWN)

    def test_a_start_claimed(self):
        self.lost(lambda: gateway._source_claims.append(gateway._StartClaim("mdi")),
                  "A program or macro is starting or running — wait")

    def test_another_link(self):
        self.lost(lambda: setattr(gateway, "_bound_instance", (9, 9)), gateway.LINK_CHANGED)

    def test_unchanged_it_commits(self):
        for what, make in self.WRITES.items():
            with self.subTest(what):
                self.fresh()
                self.prepare(2, 5, 5)
                self.written(make(self))


# ---- the line LinuxCNC reads ---------------------------------------------------

def too_long(tool):
    return f"T{tool}: line too long for LinuxCNC — shorten its description"


#: the proven ghost (Codex R476 answer 6; test_tool_guard's golden): a text the
#: command admits whose line has 266 bytes — LinuxCNC reads "T9 P9 Z5 D5" as a
#: line of its own and holds a tool T9
GHOST = "r" * 207 + "T9 P9 Z5 D5"


class TestTheLineLinuxCNCReads(_Guard):

    def test_the_ghost_line_of_every_write(self):
        self.assertLessEqual(len(GHOST), 255, "the command's own limit")
        for what, make in {
                "save": lambda: self.edit(cmd="save_tool", tool_number=5, remark=GHOST),
                "add": lambda: self.edit(cmd="add_tool", tool_number=5000, remark=GHOST),
                "renumber": lambda: self.edit(cmd="renumber_tool", old_tool_number=5, tool_number=6, remark=GHOST),
                }.items():
            with self.subTest(what):
                self.fresh()
                self.refused(make(), too_long({"save": 5, "add": 5000, "renumber": 6}[what]))
        self.fresh()
        self.refused(self.importing(2, 5, text=GHOST), too_long(2), http=400)

    def test_the_bytes_count_not_the_characters(self):
        self.refused(self.edit(cmd="save_tool", tool_number=5, remark="ä" * 120), too_long(5))
        self.fresh()
        self.written(self.edit(cmd="save_tool", tool_number=5, remark="a" * 120))

    def test_numbers_alone(self):
        # 1e300 is a finite number the command admits: 301 digits
        self.refused(self.edit(cmd="save_tool", tool_number=5, z_offset=1e300),
                     "T5: line too long for LinuxCNC — check its numbers")

    def test_a_long_line_in_the_file_names_its_tool_and_its_way_out(self):
        # LinuxCNC read its first 255 bytes (the rest a line it skips): the
        # basis is proven, the rewrite of ANOTHER tool would write the line again
        long = ROWS.replace("; eight", "; " + "e" * 240)
        self.fresh(long)
        self.refused(self.edit(cmd="save_tool", tool_number=2, z_offset=21.0), too_long(8))
        for write in (dict(cmd="save_tool", tool_number=8, remark="eight"), dict(cmd="delete_tool", tool_number=8)):
            with self.subTest(write["cmd"]):
                self.fresh(long)
                self.written(self.edit(**write))

    def test_a_line_break_or_nul_in_the_text(self):
        why = "T5: line break or NUL in its description — remove it"
        for text in ("a\nT9 P9 Z5 D5", "a\rT9 P9 Z5 D5", "a\r\nb", "a\x00b"):
            with self.subTest(text=text):
                self.fresh()
                self.refused(self.edit(cmd="save_tool", tool_number=5, remark=text), why)
        self.fresh()
        self.refused(self.importing(5, text="a\nT9 P9 Z5 D5"), why, http=400)

    def test_a_text_that_is_no_utf_8(self):
        self.refused(self.edit(cmd="save_tool", tool_number=5, remark="a\ud800"),
                     "T5: description is not valid text — retype it")

    def test_a_number_past_linuxcncs_integers(self):
        self.refused(self.importing(2, 2 ** 31), "T2147483648 is past LinuxCNC's integers — renumber it", http=400)
        self.fresh()
        self.written(self.importing(2, 2 ** 31 - 1))

    def test_a_pocket_in_the_file_linuxcnc_reads_as_another(self):
        # LinuxCNC reads P4294967301 as P5 (%d wraps) and STAT carries no
        # pocket: the basis is proven — the rewrite is refused by name, and
        # the tool's own edit is the way out
        self.fresh(ROWS.replace("T5 P5", "T5 P4294967301"))
        self.refused(self.edit(cmd="save_tool", tool_number=2, z_offset=21.0),
                     "T5: P is past LinuxCNC's integers — correct it")
        self.fresh(ROWS.replace("T5 P5", "T5 P4294967301"))
        self.written(self.edit(cmd="save_tool", tool_number=5, pocket=5))

    def test_a_t_or_q_in_the_file_past_them_never_reaches_the_writer(self):
        # LinuxCNC holds the wrapped value: rule R finds the row different
        for text, shown in ((ROWS.replace("T5 P5", "T5 P5 Q4294967299"), entry(5, Z=50, D=5, Q=3)),
                            (ROWS.replace("T5 P5", "T4294967301 P5"), entry(5, Z=50, D=5))):
            self.fresh(text)
            self.conn.stat.tool_table = (entry(0), entry(2, Z=20, D=2), shown, entry(8, Z=80, D=8))
            before = self.files()
            r = self.edit(cmd="save_tool", tool_number=2, z_offset=21.0)()
            self.assertFalse(r["ok"], r)
            self.assertIn("from LinuxCNC", r["error"])
            self.assertEqual(self.files(), before)

    def test_the_refusal_comes_before_the_file_effect(self):
        # nothing is replaced: no parse is superseded for it either
        gen = gateway._calc_gen.snapshot()
        self.refused(self.edit(cmd="save_tool", tool_number=5, remark=GHOST), too_long(5))
        self.assertEqual(gateway._calc_gen.snapshot(), gen)


if __name__ == "__main__":
    unittest.main()
