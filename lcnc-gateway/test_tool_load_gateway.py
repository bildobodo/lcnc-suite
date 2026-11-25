"""TF-2 on the real WS path (plan v3 §1.1–1.5, §5; Codex R476–R479): the
preview, the admission in the write's own thread, exactly ONE request on the
connection the comparison was made on, and what is said afterwards — a
request and what LinuxCNC's values showed, never that it loaded the file.

The four sequences after the same request (Codex R478) run against an io
whose load, put and save are separate steps (tool_io_fixture.SplitIo)."""
import asyncio
import contextlib
import json
import re
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()
import gateway  # noqa: E402
import tool_proof  # noqa: E402
from command_policy import (COMMAND_GATES, COMMAND_SCHEMA, NOT_ARMED, READ_ONLY_COMMANDS, REASON_MAX_CHARS,  # noqa: E402
                            command_effect)
from link_fixture import swap_connection, use, using  # noqa: E402
from test_tool_commit_gateway import _held_poll  # noqa: E402
from test_tool_guard_gateway import MOVING, PREPARED, PREPARING, ROWS, UNKNOWN, _Guard  # noqa: E402
from test_tool_proof_gateway import INI  # noqa: E402
from tool_io_fixture import SplitIo, entry  # noqa: E402
from tool_table import parse_tool_table  # noqa: E402
from ws_fanout import ClientState  # noqa: E402

#: the hand edit the cases start from: T5's Z and its pocket
EDITED = ROWS.replace("T5 P5 Z50", "T5 P9 Z51")


class _Load(_Guard):

    def setUp(self):
        super().setUp()
        for p in (patch.object(gateway, "TOOL_RELOAD_WAIT_S", .06), patch.object(gateway, "TOOL_RELOAD_POLL_S", .002)):
            p.start()
            self.addCleanup(p.stop)

    def fresh(self, text=ROWS):
        super().fresh(text)
        self.io = SplitIo(self.conn.stat, self.table, immediate=True)
        use(self, stat=self.conn.stat, cmd=self.io, err=self.conn.err)
        self.link0 = gateway._link
        self.conn.stat.tool_in_spindle = 0
        gateway._tool_write_job = None

    def restored(self):
        super().restored()
        self.link0 = gateway._link

    def hand_edit(self, text=EDITED):
        self.table.write_text(text)

    def preview(self):
        async def run():
            gateway._cmd_lock = None
            return await gateway.handle_command({"cmd": "tool_table_preview"}, False)
        return asyncio.run(run())

    def message(self, preview=None, removed=None, **base):
        p = preview or self.preview()
        self.assertIsNone(p["refusal"], p)
        return {"cmd": "tool_table_load", "base": {**p["base"], **base},
                "removed": [r["T"] for r in p["removed"]] if removed is None else removed}

    def load(self, preview=None, removed=None, **base):
        return self.send(self.message(preview, removed, **base))

    def held_side(self):
        """What a load must never touch."""
        return self.table.read_bytes(), (self.dir / "tool_library.json").read_bytes(), dict(gateway._tool_table_watch)

    def not_requested(self, reply, why):
        self.assertEqual((reply["ok"], reply.get("error")), (False, why), reply)
        self.assertNotIn("load", reply)
        self.assertEqual(self.io.loads, 0, "nothing reached LinuxCNC")
        self.assertEqual([c.loads for c in self.others], [0] * len(self.others), "nor another LinuxCNC")
        self.assertLessEqual(len(why), REASON_MAX_CHARS)

    def zs(self):
        return {e.id: e.zoffset for e in self.conn.stat.tool_table[1:]}


# ---- the preview ------------------------------------------------------------------

class TestThePreview(_Load):

    def test_it_names_both_directions_and_binds_both_sides(self):
        self.hand_edit("T2 P2 Z20 D2 ; two\nT5 P9 Z51 D5.5 ; five\nT9 P9 Z90 D9 ; nine\n")
        p = self.preview()
        self.assertEqual((p["ok"], p["refusal"], p["basis"], p["spindle"]), (True, None, "partial", 0))
        self.assertEqual(p["removed"], [{"T": 8, "name": "", "Z": 80.0, "D": 8.0}])
        self.assertEqual(p["changed"], [{"T": 5, "name": "five", "fields": [
            {"f": "Z", "now": 50.0, "file": 51.0}, {"f": "D", "now": 5.0, "file": 5.5}]}])
        self.assertEqual(p["added"], [{"T": 9, "name": "nine", "Z": 90.0, "D": 9.0}])
        self.assertIsNone(p["removal_refusal"])
        st = self.table.stat()
        self.assertEqual(p["saved_at"], st.st_mtime)
        self.assertEqual(p["base"], {
            "path": str(Path(self.table).resolve()), "instance": "111:111", "ini": INI,
            "link": f"{gateway._TRIP_EPOCH}.{gateway._link.seq}",
            "rev": tool_proof.content_rev(self.table.read_bytes()),
            "memory": tool_proof.memory_rev(self.conn.stat.tool_table, 0)})

    def test_the_names_are_the_librarys_else_the_remark(self):
        self.store.save({"2": {"description": "two of the library"}, "8": {"description": "eight"}}, ini_key=INI)
        self.hand_edit("T2 P2 Z21 D2 ; two\nT5 P5 Z51 D5 ; five\n")
        p = self.preview()
        self.assertEqual([t["name"] for t in p["removed"]], ["eight"])
        self.assertEqual([t["name"] for t in p["changed"]], ["two of the library", "five"])
        (self.dir / "tool_library.json").write_text("{")      # the load touches no library: the names alone are missing
        p = self.preview()
        self.assertEqual(([t["name"] for t in p["removed"]], [t["name"] for t in p["changed"]]), ([""], ["two", "five"]))
        self.assertIn("tools.library_unread", self.event_names())

    def test_a_complete_basis_names_nothing_and_offers_the_pocket(self):
        self.hand_edit(ROWS.replace("T5 P5", "T5 P9"))
        p = self.preview()
        self.assertEqual((p["basis"], p["removed"], p["changed"], p["added"]), ("complete", [], [], []))
        self.assertIsNotNone(p["base"])

    def test_a_refusal_has_no_list_and_no_base(self):
        self.hand_edit(ROWS.replace("\n", "\r\n"))
        p = self.preview()
        self.assertEqual((p["ok"], p["refusal"], p["base"]), (True, tool_proof.LOAD_LINE_ENDS, None))
        for k in ("removed", "changed", "added"):
            self.assertNotIn(k, p)

    def test_it_is_a_free_read_of_one_attempt_that_sends_nothing(self):
        self.hand_edit()
        before, reads = self.held_side(), []
        real = gateway._read_table_bytes
        with patch.object(gateway, "_read_table_bytes", lambda path: reads.append(1) or real(path)):
            p = self.preview()                  # (disarmed: handle_command's armed False)
        self.assertEqual((p["ok"], len(reads)), (True, 1))
        self.assertEqual((self.held_side(), self.io.loads), (before, 0))
        self.assertEqual(gateway._tool_write_job, None)

    def test_its_owner_is_judged_last(self):
        for what, do in self.changes().items():
            with self.subTest(what):
                self.fresh()
                self.hand_edit()
                real = gateway.load_tool_library

                def library(*a, **kw):          # the last read of the preview
                    got = real(*a, **kw)
                    do()
                    return got
                with patch.object(gateway, "load_tool_library", library):
                    p = self.preview()
                self.assertEqual((p["ok"], p.get("error")), (False, gateway.LINK_CHANGED), p)

    def test_the_file_then_the_owners_table_then_its_spindle(self):
        self.hand_edit()
        self.conn.stat.tool_in_spindle = 5
        order = []
        real_bytes, real_stat, real_poll = gateway._read_table_bytes, gateway._stat_tool_table, self.conn.stat.poll

        def stat_table(owner=None):
            self.assertIs(owner, self.link0, "the OWNER's STAT")
            order.append("table")
            return real_stat(owner)

        def poll():
            order.append("poll")
            return real_poll()
        with patch.object(gateway, "_read_table_bytes", lambda p: order.append("bytes") or real_bytes(p)), \
                patch.object(gateway, "_stat_tool_table", stat_table), \
                patch.object(self.conn.stat, "poll", poll):
            p = self.preview()
        self.assertEqual((order, p["spindle"]), (["bytes", "table", "poll"], 5))

    def test_a_file_or_a_table_that_is_not_read(self):
        self.table.unlink()
        self.assertEqual(self.preview(), {"ok": False, "error": "Tool table not read — No such file or directory"})
        self.hand_edit()
        with patch.object(gateway, "get_tool_tbl_path", lambda: None):
            self.assertEqual(self.preview(), {"ok": False, "error": "Tool table path not available"})
        swap_connection(None)
        self.assertEqual(self.preview()["refusal"], tool_proof.LOAD_TABLE_UNREAD)

    def test_while_the_last_change_is_awaited(self):
        self.hand_edit()
        self.io.immediate = False

        async def run():
            gateway._cmd_lock = None
            await gateway.handle_command(dict(msg), True, self.writer.conn_key)
            # its job has ended by now (the reply waits for it): loadable again
            ended = await gateway.handle_command({"cmd": "tool_table_preview"}, False)
            gateway._tool_write_job.outcome = None
            return ended, await gateway.handle_command({"cmd": "tool_table_preview"}, False)
        msg = self.message()
        ended, awaited = asyncio.run(run())
        self.assertIsNone(ended["refusal"])
        self.assertEqual(awaited["refusal"], tool_proof.EDIT_LOADING)


class TestTheRead(_Load):
    """get_tool_table's two new fields (nothing else on its wire changes)."""

    def test_load_refusal_and_owner(self):
        r = self.read()
        self.assertEqual((r["load_refusal"], r["edit_refusal"]), (None, None))
        self.assertEqual(r["owner"], {"ini": INI, "link": f"{gateway._TRIP_EPOCH}.{gateway._link.seq}"})
        self.hand_edit()
        r = self.read()
        self.assertEqual((r["proof"]["state"], r["load_refusal"], r["edit_refusal"]),
                         ("partial", None, "T5 differs from LinuxCNC — load the file or restart"))

    def test_the_words_are_the_previews(self):
        for text, spindle in ((ROWS.replace("\n", "\r\n"), 0), ("# P7\n" + ROWS, 0), (ROWS[:-1], 0), ("", 0),
                              (ROWS.replace("T8", "T5"), 0), ("T2 P2 Z20 D2 ; two\n", 5)):
            with self.subTest(text[:30]):
                self.fresh()
                self.hand_edit(text)
                self.conn.stat.tool_in_spindle = spindle
                r, p = self.read(), self.preview()
                self.assertIsNotNone(p["refusal"])
                self.assertEqual(r["load_refusal"], p["refusal"])
                if r["proof"]["state"] == "partial":
                    self.assertEqual(r["edit_refusal"], p["refusal"], "the edit names the same cause")

    def test_an_edit_names_what_is_wrong_with_the_file(self):
        self.hand_edit("# P7\n" + EDITED)
        why = "Line 1 is a # comment with a P word — use ; instead"
        self.refused(self.edit(cmd="add_tool", tool_number=9), why)
        self.fresh()
        self.hand_edit("T2 P2 Z20 D2 ; two\n")
        self.conn.stat.tool_in_spindle = 5
        self.refused(self.edit(cmd="add_tool", tool_number=9), "T5 is in the spindle, not in the file — restore it")


# ---- the four sequences after the same request (Codex R478) -----------------------

class TestTheFourSequences(_Load):

    def request(self, then=None, immediate=False):
        self.hand_edit()
        self.io.immediate, self.io.then = immediate, then
        self.before = self.held_side()
        v0 = gateway._tool_table_version
        self.events.clear()
        r = self.load()
        self.assertEqual((r["ok"], r["load"], r["basis"]), (True, "requested", "partial"), r)
        self.assertEqual(self.io.loads, 1, "exactly one request")
        self.assertEqual(gateway._tool_table_version - v0, 1, "ONE ping, at the job's end")
        self.assertEqual(self.held_side()[1:], self.before[1:], "no library, no watch baseline")
        job = gateway._tool_write_job
        self.assertEqual((job.load.values, job.load.why, job.outcome), (r["values"], r.get("why"), r["values"]))
        return r

    def test_the_load_runs(self):
        r = self.request(immediate=True)
        self.assertEqual((r["values"], "why" in r), ("shown", False))
        self.assertEqual((self.zs()[5], self.io.held[5][0]), (51, 9))
        self.assertEqual(self.held_side(), self.before, "byte-equal file")
        self.assertIn("tools.load_values_shown", self.event_names())

    def test_the_load_is_dropped(self):
        r = self.request(then=lambda: self.io.drop())
        self.assertEqual((r["values"], r["why"]), ("not shown", "in time"))
        self.assertEqual(self.held_side(), self.before)
        self.assertIn("tools.load_values_not_shown", self.event_names())

    def test_dropped_a_foreign_put_of_exactly_these_values_and_a_refused_save(self):
        # the case that forbids any word about a load: the values show, the
        # pocket io holds is the old one, the file is as it was
        def then():
            self.io.drop()
            self.io.set_offset(5, save=False, Z=51, D=5)
        r = self.request(then=then)
        self.assertEqual((r["values"], "why" in r), ("shown", False), "the values alone")
        self.assertEqual((self.io.held[5][0], self.held_side()), (5, self.before))
        words = json.dumps([r, [[e, {k: v for k, v in kw.items() if k != "rev"}] for e, kw in self.events]])
        for success in ("confirmed", "loaded"):
            self.assertNotIn(success, words)
        self.assertNotIn("reload", r)

    def test_a_foreign_put_with_a_successful_save(self):
        def then():
            self.io.drop()
            self.io.set_offset(5, Z=51, D=5)
        r = self.request(then=then)
        self.assertEqual((r["values"], r["why"]), ("not shown", "file changed"))

    def test_a_changed_file_ends_it_at_once(self):
        # a round that sees another revision never waits for the bound
        with patch.object(gateway, "TOOL_RELOAD_WAIT_S", 30.0):
            r = self.request(then=lambda: self.hand_edit(EDITED.replace("Z80", "Z81")))
        self.assertEqual((r["values"], r["why"]), ("not shown", "file changed"))

    def test_the_file_changed_before_the_load_ran(self):
        # the load is a PATH job: io loads what the file holds THEN
        def then():
            self.hand_edit(EDITED.replace("Z80", "Z81"))
            self.io.run()
        r = self.request(then=then)
        self.assertEqual((r["values"], r["why"], self.zs()[8]), ("not shown", "file changed", 81))

    def test_the_file_gone_is_no_revision(self):
        # F2: the load cleared LinuxCNC's table and found no file
        def then():
            self.table.unlink()
            self.assertFalse(self.io.run())
        r = self.request_gone(then)
        self.assertEqual((r["values"], r["why"], self.zs()), ("not shown", "in time", {}))
        self.hand_edit()                    # the way back: the restored file is loadable again
        self.assertIsNone(self.preview()["refusal"])

    def request_gone(self, then):
        self.hand_edit()
        self.io.immediate, self.io.then = False, then
        return self.load()


class TestACompleteBasis(_Load):
    """The values match before LinuxCNC took anything: the reply goes at once,
    the job looks once, at its bound (§1.4, Codex R479)."""

    def request(self, then=None, at_bound=None):
        """(the reply, whether the job still ran when it came, the job)"""
        self.hand_edit(ROWS.replace("T5 P5", "T5 P9"))      # the pocket only: rule R reads complete
        self.io.immediate, self.io.then = then is None, then
        real_sleep = asyncio.sleep
        out = {}

        async def run():
            gateway._cmd_lock = None
            release, reached = asyncio.Event(), asyncio.Event()

            async def sleep(s, *a):
                if s == gateway.TOOL_RELOAD_WAIT_S:         # the job's bound: the test's to let pass
                    reached.set()
                    await release.wait()
                    return
                await real_sleep(s, *a)
            rounds = []
            real_round = gateway._tool_load_round
            with patch.object(asyncio, "sleep", sleep), \
                    patch.object(gateway, "_tool_load_round", lambda j: rounds.append(1) or real_round(j)):
                v0 = gateway._tool_table_version
                # (a task, never a wait_for: a cancelled wait is answered as a preempted one)
                asked = asyncio.ensure_future(gateway.handle_command(msg, True, self.writer.conn_key))
                at_bound_task = asyncio.ensure_future(reached.wait())
                done, _ = await asyncio.wait({asked, at_bound_task}, timeout=5, return_when=asyncio.ALL_COMPLETED)
                self.assertIn(at_bound_task, done, "the job waits for its bound")
                try:
                    self.assertIn(asked, done, "the reply goes at once")
                except AssertionError:
                    release.set()               # let it end: the failure is the assertion, not a hang
                    await asked
                    raise
                r = asked.result()
                job = gateway._tool_write_job
                out.update(running=job.outcome is None and not job.task.done(), rounds=len(rounds),
                           pinged=gateway._tool_table_version - v0, lock_free=not gateway._get_cmd_lock().locked())
                if at_bound:
                    at_bound()
                release.set()
                await job.task
                out.update(after=gateway._tool_table_version - v0, rounds_after=len(rounds))
            return r, job
        msg = self.message()
        r, job = asyncio.run(run())
        self.assertEqual((r["ok"], r["load"], r["values"], r["basis"], "why" in r),
                         (True, "requested", "not awaited", "complete", False), r)
        self.assertEqual((out["running"], out["rounds"], out["pinged"], out["lock_free"]), (True, 0, 0, True),
                         "the reply went at once, the job runs on to its bound")
        self.assertEqual((out["after"], out["rounds_after"]), (1, 1), "its end pings, once")
        return job.load

    def test_the_load_ran(self):
        load = self.request()
        self.assertEqual((load.values, load.why, self.io.held[5][0]), ("shown", None, 9))

    def test_the_load_was_dropped(self):
        load = self.request(then=lambda: self.io.drop())
        self.assertEqual((load.values, self.io.held[5][0]), ("shown", 5), "the same: the values say nothing of a pocket")

    def test_the_load_failed_and_left_the_table_empty(self):
        # F2 within the bound: read, pinged, never "as before"
        text = ROWS.replace("T5 P5", "T5 P9")

        def gone():
            self.table.unlink()
            self.io.run()
            self.table.write_text(text)
        load = self.request(then=lambda: None, at_bound=gone)
        self.assertEqual((load.values, load.why), ("not shown", "in time"))

    def test_a_changed_file_at_the_bound(self):
        load = self.request(then=lambda: None, at_bound=lambda: self.hand_edit(ROWS + "\n"))
        self.assertEqual((load.values, load.why), ("not shown", "file changed"))


class TestWhatEndsTheObservation(_Load):

    def observed(self, do):
        """The load job's end with `do` run inside its first round."""
        real, done = gateway._tool_job_compare, []

        def compare(job):
            proof = real(job)
            if not done:
                done.append(1)
                do()
            return proof
        self.hand_edit()
        v0 = gateway._tool_table_version
        with patch.object(gateway, "_tool_job_compare", compare), patch.object(gateway, "TOOL_RELOAD_WAIT_S", 5.0):
            r = self.load()
        return r, gateway._tool_table_version - v0

    def test_a_newer_write_or_load(self):
        def newer():
            gateway._tool_write_seq += 1
        r, pinged = self.observed(newer)
        self.assertEqual((r["values"], r["why"], pinged), ("not shown", "superseded", 0), "the newer one pings")

    def test_another_controller(self):
        for what, do in self.changes().items():
            with self.subTest(what):
                self.fresh()
                r, pinged = self.observed(do)
                self.assertEqual((r["values"], r["why"], pinged), ("not shown", "controller changed", 1), r)
                self.assertEqual([c.loads for c in self.others], [0] * len(self.others))

    def test_shown_needs_v_and_then_s(self):
        # V: the bound bytes against LinuxCNC; S: one whole read of the same revision
        self.hand_edit()
        self.io.immediate = False
        seen = []
        real_attempt, real_compare = gateway._tool_files_attempt, gateway._tool_job_compare

        def attempt(*a):
            seen.append("S")
            return real_attempt(*a)

        def compare(job):
            seen.append("V")
            return real_compare(job)
        msg = self.message()
        with patch.object(gateway, "_tool_files_attempt", attempt), patch.object(gateway, "_tool_job_compare", compare):
            self.io.then = self.io.run
            r = self.send(msg)
        self.assertEqual((r["values"], seen), ("shown", ["V", "S"]))

    def test_s_alone_does_not_show(self):
        # the file was rewritten to what LinuxCNC still holds: complete, but
        # not the revision the request was made for
        self.hand_edit()
        self.io.immediate = False
        msg = self.message()
        self.io.then = lambda: self.hand_edit(ROWS)
        r = self.send(msg)
        self.assertEqual((r["values"], r["why"]), ("not shown", "file changed"))

    def test_v_alone_does_not_show(self):
        # V holds; the whole read of S is partial (LinuxCNC moved on between them)
        self.hand_edit()
        real = gateway._tool_files_attempt

        def attempt(*a):
            self.conn.stat.tool_table = self.conn.stat.tool_table[:2]
            return real(*a)
        msg = self.message()
        with patch.object(gateway, "_tool_files_attempt", attempt):
            r = self.send(msg)
        self.assertEqual((r["values"], r["why"]), ("not shown", "in time"))

    def test_a_file_changing_under_the_read_decides_nothing(self):
        self.hand_edit()
        real, n = gateway._read_table_bytes, []
        msg = self.message()

        def torn(path):
            data, same, at = real(path)
            n.append(1)
            return (data[:10], False, at) if 2 <= len(n) <= 3 else (data, same, at)
        with patch.object(gateway, "_read_table_bytes", torn):     # (1: the commit's own read)
            r = self.send(msg)
        self.assertEqual(r["values"], "shown")
        self.assertGreater(len(n), 3)

    def test_the_wait_that_fails(self):
        def boom(_job):
            raise RuntimeError("STAT read exploded")
        self.hand_edit()
        v0 = gateway._tool_table_version
        msg = self.message()
        with patch.object(gateway, "_tool_job_compare", boom):
            r = self.send(msg)
        self.assertEqual((r["ok"], r["load"], r["values"], r["why"]), (True, "requested", "not shown", "unknown"))
        self.assertEqual(gateway._tool_table_version - v0, 1)
        self.assertIn("tools.load_observation_failed", self.event_names())

    def test_the_gateway_ends(self):
        self.hand_edit()
        self.io.immediate = False

        async def run():
            gateway._cmd_lock = None
            with patch.object(gateway, "TOOL_RELOAD_WAIT_S", 30.0):
                task = asyncio.ensure_future(gateway.handle_command(msg, True, self.writer.conn_key))
                while gateway._tool_write_job is None:
                    await asyncio.sleep(.001)
                job = gateway._tool_write_job
                job.task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
                return job
        msg = self.message()
        job = asyncio.run(run())
        self.assertEqual((job.load.values, job.load.why), ("not shown", "unknown"))

    def test_the_nml_write_that_raised_once_begun(self):
        for basis, text in (("partial", EDITED), ("complete", ROWS.replace("T5 P5", "T5 P9"))):
            with self.subTest(basis):
                self.fresh()
                self.hand_edit(text)
                v0, seq0 = gateway._tool_table_version, gateway._tool_write_seq

                def raises():
                    raise RuntimeError("the binding")
                self.io.then = raises
                r = self.load()
                self.assertEqual((r["ok"], r["load"], r["values"], r["why"], r["basis"]),
                                 (True, "requested", "not shown", "unknown", basis), r)
                self.assertEqual((self.io.loads, gateway._tool_write_seq - seq0, gateway._tool_table_version - v0),
                                 (1, 1, 1), "booked, pinged, not sent again")


class TestNothingIsSentAgain(_Load):

    def test_neither_at_the_bound_nor_after_a_reconnect(self):
        self.hand_edit()
        self.io.immediate = False
        msg = self.message()

        async def run():
            gateway._cmd_lock = None
            watch = asyncio.ensure_future(gateway._tool_table_watch_loop())
            r = await gateway.handle_command(msg, True, self.writer.conn_key)
            self.another()                          # a Link of the same instance: its table not loaded
            await gateway.handle_command({"cmd": "get_tool_table"}, False)
            await gateway.handle_command({"cmd": "tool_table_preview"}, False)
            for _ in range(50):
                await asyncio.sleep(.001)
            watch.cancel()
            return r
        with patch.object(gateway, "TOOL_TABLE_WATCH_S", .002):
            r = asyncio.run(run())
        self.assertEqual((r["values"], r["why"], self.io.loads), ("not shown", "in time", 1))
        self.assertEqual([c.loads for c in self.others], [0])

    def test_a_later_load_is_read_by_the_next_read(self):
        # io takes it after the bound: the reply said "not shown", the read is the truth
        self.hand_edit()
        self.io.immediate = False
        self.assertEqual(self.load()["why"], "in time")
        self.assertEqual(self.read()["proof"]["state"], "partial")
        self.io.run()
        self.assertEqual(self.read()["proof"]["state"], "complete")
        self.io.immediate = True
        r = self.edit(cmd="save_tool", tool_number=2, z_offset=21.0)()
        self.assertEqual((r["ok"], r["reload"]), (True, "confirmed"), "edits admitted by rule R")


# ---- what is refused, at its read --------------------------------------------------

class TestTheComparison(_Load):

    def test_another_owner_of_the_comparison(self):
        self.hand_edit()
        for k, v in (("path", "/cfg/other.tbl"), ("instance", "9:9"), ("ini", "/cfg/other.ini"),
                     ("link", f"{gateway._TRIP_EPOCH}.999999")):
            with self.subTest(k):
                self.not_requested(self.load(**{k: v}), "Another LinuxCNC or table file — check again")

    def test_between_the_preview_and_the_commit(self):
        def spindle():
            self.conn.stat.tool_in_spindle = 8
        for what, do, why in (
                ("the file", lambda: self.hand_edit(EDITED + "\n"), "The file changed — check again"),
                ("a remark only", lambda: self.hand_edit(EDITED.replace("five", "FIVE")), "The file changed — check again"),
                ("LinuxCNC's table", lambda: self.io.set_offset(2, save=False, Z=20.5, D=2),
                 "LinuxCNC's table changed — check again"),
                ("the spindle tool", spindle, "LinuxCNC's table changed — check again"),
                ("both", lambda: (self.hand_edit(ROWS), self.io.set_offset(2, save=False, Z=20.5, D=2)),
                 "The file changed — check again")):
            with self.subTest(what):
                self.fresh()
                self.hand_edit()
                msg = self.message()
                do()
                before = self.held_side()
                self.not_requested(self.send(msg), why)
                self.assertEqual(self.held_side(), before)
                self.assertIn("tools.load_refused", self.event_names())

    def test_a_revision_of_its_own(self):
        self.hand_edit()
        self.not_requested(self.load(rev="0" * 64), "The file changed — check again")
        self.not_requested(self.load(memory="0" * 64), "LinuxCNC's table changed — check again")

    def test_an_unread_side_is_no_change(self):
        self.hand_edit()
        msg = self.message()
        self.conn.stat.tool_table = ()
        self.not_requested(self.send(msg), tool_proof.LOAD_TABLE_UNREAD)

    def test_the_file_changes_under_the_commits_read(self):
        self.hand_edit()
        msg = self.message()
        real = gateway._read_table_bytes
        with patch.object(gateway, "_read_table_bytes", lambda p: (lambda d, _s, at: (d, False, at))(*real(p))):
            self.not_requested(self.send(msg), tool_proof.LOAD_FILE_CHANGED)

    def test_the_file_gone(self):
        self.hand_edit()
        msg = self.message()
        self.table.unlink()
        self.not_requested(self.send(msg), "Tool table not read — No such file or directory")

    def test_the_rule_at_the_commit(self):
        # what the preview admits, the commit's own read refuses: the same file, another controller state
        self.hand_edit("T2 P2 Z20 D2 ; two\nT8 P8 Z80 D8 ; eight\n")
        p = self.preview()
        self.conn.stat.tool_in_spindle = 5
        memory = tool_proof.memory_rev(self.conn.stat.tool_table, 5)     # bound to this very state: the rule decides
        self.not_requested(self.load(p, memory=memory), "T5 is in the spindle, not in the file — restore it")

    def test_a_job_awaited(self):
        self.hand_edit()
        msg = self.message()
        gateway._tool_write_job = gateway._ToolWriteJob(seq=0, scan=None, owner=gateway._tool_owner())
        self.addCleanup(setattr, gateway, "_tool_write_job", None)
        self.not_requested(self.send(msg), tool_proof.EDIT_LOADING)


class TestRemoval(_Load):

    def test_the_acknowledged_tools_go(self):
        self.hand_edit("T2 P2 Z20 D2 ; two\nT5 P5 Z50 D5 ; five\n")
        before = self.held_side()
        r = self.load()
        self.assertEqual((r["ok"], r["values"], sorted(self.zs())), (True, "shown", [2, 5]), r)
        self.assertEqual(self.held_side(), before, "the library keeps its metadata")
        ev = next(k for e, k in self.events if e == "tools.load_requested")
        self.assertEqual((ev["removed"], ev["removed_count"], ev["basis"], ev["changed"], ev["added"]), ([8], 1, "partial", 0, 0))

    def test_too_few_too_many_or_other_numbers(self):
        self.hand_edit("T2 P2 Z20 D2 ; two\n")
        p = self.preview()
        self.assertEqual([t["T"] for t in p["removed"]], [5, 8])
        for removed in ([], [5], [8], [5, 8, 9], [5, 9], [5, 5]):
            with self.subTest(removed):
                self.not_requested(self.load(p, removed), "Removed tools not confirmed — check again")
        self.assertEqual(self.load(p, [8, 5])["values"], "shown", "in any order")

    def test_never_the_tool_in_the_spindle(self):
        self.hand_edit("T2 P2 Z20 D2 ; two\n")
        self.conn.stat.tool_in_spindle = 8
        p = self.preview()
        self.assertEqual(p["refusal"], "T8 is in the spindle, not in the file — restore it")

    def test_the_switch_off_refuses_and_says_so(self):
        # Q-TF2-1: ONE constant
        self.assertTrue(tool_proof.REMOVAL_ALLOWED, "the plan's recommendation until the operator answers")
        with patch.object(tool_proof, "REMOVAL_ALLOWED", False):
            self.hand_edit("T2 P2 Z20 D2 ; two\nT5 P5 Z50 D5 ; five\n")
            p = self.preview()
            self.assertEqual((p["refusal"], p["removal_refusal"]), (None, tool_proof.REMOVAL_OFF))
            self.assertLessEqual(len(tool_proof.REMOVAL_OFF), REASON_MAX_CHARS)
            self.not_requested(self.load(p), tool_proof.REMOVAL_OFF)
            self.hand_edit()
            p = self.preview()
            self.assertIsNone(p["removal_refusal"])
            self.assertEqual(self.load(p)["values"], "shown", "without removed tools as before")


class TestTheGuardsReads(_Load):
    """Every admission and the comparison at ITS read (§1.3 2a / 2b / 2c): what
    the event loop changes there refuses, nothing is sent. Held in the
    write's thread, changed on the event loop."""

    LOST = {"disarm": (lambda s: setattr(s.writer, "armed", False), NOT_ARMED),
            "unregister": (lambda s: gateway._clients.pop(901, None), gateway.CONN_UNKNOWN),
            "Link": (lambda s: s.another(), gateway.LINK_CHANGED),
            "INI": (lambda s: setattr(s.conn.stat, "ini_filename", "/cfg/other.ini"), gateway.LINK_CHANGED),
            "instance": (lambda s: setattr(gateway, "_bound_instance", (222, 222)), gateway.LINK_CHANGED)}

    def fresh(self, text=ROWS):
        super().fresh(text)
        self.conn.stat.ini_filename = INI

    def run_held(self, msg, reached, release, hook):
        async def run():
            gateway._cmd_lock = gateway._source_lock = None
            self.replies.clear()
            task = asyncio.ensure_future(gateway._execute_client_command(901, self.writer, None, dict(msg)))
            try:
                self.assertTrue(await asyncio.to_thread(reached.wait, 5), "the read was reached")
                hook()
            finally:
                release.set()
            await task
            return self.replies[-1]
        return asyncio.run(run())

    def test_at_each_read(self):
        for what, (do, why) in self.LOST.items():
            for read in ("2a", "2b", "2c"):
                with self.subTest(what, read=read):
                    self.fresh()
                    self.hand_edit()
                    msg = self.message()
                    if read == "2b":
                        reached, release = threading.Event(), threading.Event()
                        real = gateway._stat_tool_table

                        def table(owner=None):
                            got = real(owner)
                            reached.set()
                            if not release.wait(5):
                                raise AssertionError("never released")
                            return got
                        patches = (patch.object(gateway, "_stat_tool_table", table),)
                    else:
                        reached, release, _n, patches = _held_poll(self, 1 if read == "2a" else 2)
                    with contextlib.ExitStack() as st:
                        for p in patches:
                            st.enter_context(p)
                        r = self.run_held(msg, reached, release, lambda: do(self))
                    # (the shared admission's own reads are of the command's Link: gone, its state is unknown)
                    self.not_requested(r, gateway.STATE_UNKNOWN if what == "Link" and read != "2b" else why)

    def test_unchanged_at_each_read_it_is_requested(self):
        for read in (1, 2):
            self.fresh()
            self.hand_edit()
            msg = self.message()
            reached, release, _n, patches = _held_poll(self, read)
            with patches[0], patches[1]:
                r = self.run_held(msg, reached, release, lambda: None)
            self.assertEqual((r["ok"], r["values"], self.io.loads), (True, "shown", 1))

    def test_the_other_admissions_in_memory(self):
        def claim():
            gateway._source_claims.append(gateway._StartClaim("mdi"))

        def loading():
            gateway._status_runtime._changing = True
        for what, do, why in (("a start", claim, "A program or macro is starting or running — wait"),
                              ("a load", loading, "A program is loading — wait")):
            with self.subTest(what):
                self.fresh()
                gateway._status_runtime._changing = False
                self.hand_edit()
                msg = self.message()
                reached, release, _n, patches = _held_poll(self, 2)
                with patches[0], patches[1]:
                    r = self.run_held(msg, reached, release, do)
                self.not_requested(r, why)

    def test_a_refused_writer_reads_nothing(self):
        self.hand_edit()
        msg = self.message()
        self.writer.armed = False
        reads = []
        real = gateway._read_table_bytes
        with patch.object(gateway, "_read_table_bytes", lambda p: reads.append(1) or real(p)):
            # past the dispatcher's own arm: the commit's
            async def run():
                gateway._cmd_lock = None
                return await gateway.handle_command(msg, True, self.writer.conn_key)
            r = asyncio.run(run())
        self.not_requested(r, NOT_ARMED)
        self.assertEqual(reads, [])

    def test_the_shared_admission(self):
        for what, do, why in (
                ("running", lambda: setattr(self.conn.stat, "interp_state", linuxcnc.INTERP_READING),
                 "A program or MDI runs — wait"),
                ("a tool change pending", lambda: self.reader.update(tool_change=True), "Tool change pending — finish it first"),
                ("moving", lambda: setattr(self.conn.stat, "current_vel", 3.0), MOVING),
                ("E-Stop", lambda: setattr(self.conn.stat, "estop", 1), None)):
            with self.subTest(what):
                self.fresh()
                self.conn.stat.interp_state, self.conn.stat.estop = linuxcnc.INTERP_IDLE, 0
                self.hand_edit()
                msg = self.message()
                do()
                r = self.send(msg)
                if why:
                    self.not_requested(r, why)
                else:
                    self.assertEqual((r["ok"], r["values"]), (True, "shown"), r)

    def test_the_prepared_tool_is_judged_on_the_files_bytes(self):
        # T5 prepared from P5 at index 2; the FILE gives T5 P9 at the same index
        self.hand_edit()
        self.prepare(2, 5, 5)
        self.not_requested(self.load(), PREPARED)
        # only a Z changed: the same number and pocket stay at the index
        self.fresh()
        self.hand_edit(ROWS.replace("Z50", "Z51"))
        self.prepare(2, 5, 5)
        self.assertEqual(self.load()["values"], "shown")
        # a row in front of it: the index moves
        self.fresh()
        self.hand_edit("T1 P1 Z1 D1 ; one\n" + ROWS)
        self.prepare(2, 5, 5)
        self.not_requested(self.load(), PREPARED)

    def test_what_is_not_known_of_a_preparation_refuses(self):
        # the tool guard's own rule and its ONE snapshot (Codex R481), through the request
        stale = "Tool change request unknown — HAL reader stale"
        for what, do, why in (
                ("no tool-prepare pin", lambda: self.reader.pop("tool_prepare"), UNKNOWN),
                ("no pocket pin", lambda: self.reader.pop("tool_prep_pocket"), UNKNOWN),
                ("a preparation under way", lambda: self.reader.update(tool_prepare=True), PREPARING),
                ("a stale reader", lambda: self.arrived(stale=True), stale),
                ("no snapshot", lambda: setattr(gateway._hal_bridge, "_reader_state", None), stale)):
            with self.subTest(what):
                self.fresh()
                self.hand_edit(ROWS.replace("Z50", "Z51"))
                msg = self.message()
                self.prepare(2, 5, 5)
                do()
                self.not_requested(self.send(msg), why)

    def test_the_bytes_judged_are_the_bytes_read_at_the_commit(self):
        self.hand_edit()
        given = []
        real = gateway._write_admission_refusal

        def admission(*a, **kw):
            given.append(kw.get("load"))
            return real(*a, **kw)
        msg = self.message()
        with patch.object(gateway, "_write_admission_refusal", admission):
            self.assertTrue(self.send(msg)["ok"])
        self.assertEqual(given, [None, self.table.read_bytes()])

    def test_the_last_word_is_the_writer_from_memory(self):
        # nothing is read between the second admission's end and the NML write
        self.hand_edit()
        order = []
        real_admit, real_bytes, real_stat = (gateway._write_admission_refusal, gateway._read_table_bytes,
                                             gateway._stat_tool_table)

        def admission(*a, **kw):
            got = real_admit(*a, **kw)
            order.append("admitted")
            return got
        msg = self.message()
        self.io.then = lambda: order.append("NML")
        with patch.object(gateway, "_write_admission_refusal", admission), \
                patch.object(gateway, "_read_table_bytes", lambda p: order.append("read") or real_bytes(p)), \
                patch.object(gateway, "_stat_tool_table", lambda o=None: order.append("read") or real_stat(o)):
            self.send(msg)
        self.assertEqual(order[:5], ["admitted", "read", "read", "admitted", "NML"])


class TestTheOwnersLink(_Load):

    def test_one_nml_call_on_the_owners_link(self):
        calls = []

        class Spy(SplitIo):
            def __getattr__(spy, name):
                return lambda *a, **k: calls.append(name)
        self.hand_edit()
        spy = Spy(self.conn.stat, self.table, immediate=True)
        self.conn.stat.tool_table = (entry(0), entry(2, Z=20, D=2), entry(5, Z=50, D=5), entry(8, Z=80, D=8))
        with using(cmd=spy):
            r = self.load()
        self.assertEqual((r["values"], spy.loads, calls), ("shown", 1, []), "load_tool_table and nothing else")

    def test_a_link_replaced_before_the_write_is_never_asked(self):
        real = gateway._cmd_blocking
        for what, do in self.changes().items():
            with self.subTest(what):
                self.fresh()
                self.hand_edit()
                msg = self.message()

                async def cmd(conn, command, *a, **kw):
                    if command.name == "load_tool_table":
                        self.assertIs(conn, self.link0)
                        do()
                    return await real(conn, command, *a, **kw)
                with patch.object(gateway, "_cmd_blocking", cmd):
                    r = self.send(msg)
                self.not_requested(r, gateway.LINK_CHANGED)

    def test_the_request_is_an_input_write(self):
        # the preview's generation moves and the parse waits: the same class as an edit's reload
        self.hand_edit()
        began = []
        real = gateway._calc_gen.began
        with patch.object(gateway._calc_gen, "began", lambda what: began.append(what) or real(what)):
            self.load()
        self.assertEqual(began, ["load_tool_table"])

    def test_the_policy_of_the_two_commands(self):
        # the request: an edit's own gate and effect; the comparison: a read without a gate, refused nothing
        self.assertEqual((COMMAND_GATES["tool_table_load"], command_effect("tool_table_load")),
                         (COMMAND_GATES["renumber_tool"], command_effect("renumber_tool")))
        self.assertIn("tool_table_preview", READ_ONLY_COMMANDS)
        self.assertNotIn("tool_table_preview", COMMAND_GATES)
        self.assertEqual(COMMAND_SCHEMA["tool_table_preview"], {})

    def test_the_edits_own_job_is_untouched(self):
        # a load's job is no write's: an edit after it answers as before
        self.hand_edit()
        self.assertEqual(self.load()["values"], "shown")
        r = self.edit(cmd="save_tool", tool_number=2, z_offset=21.0)()
        self.assertEqual({k: r[k] for k in ("ok", "reload")}, {"ok": True, "reload": "confirmed"})
        self.assertFalse({"load", "values", "why", "basis"} & set(r))


class TestTF1c(_Load):
    """§3 / N7: a commit that was not loaded, its file restored by hand and
    requested again — with a value, and with a pocket only."""

    def test_the_own_commit_repeated(self):
        for what, over, basis, values in (("a Z", dict(z_offset=51.0), "partial", "shown"),
                                          ("a pocket only", dict(pocket=9), "complete", "not awaited")):
            with self.subTest(what):
                self.fresh()
                self.io.immediate = False                       # the commit's reload is dropped
                r = self.edit(cmd="save_tool", tool_number=5, **over)()
                self.assertTrue(r["ok"], r)
                self.io.drop()
                gateway._tool_write_job.outcome = "unconfirmed"
                self.io.immediate = True
                r = self.load()
                self.assertEqual((r["ok"], r["load"], r["basis"], r["values"]), (True, "requested", basis, values), r)
                rows = {t["T"]: t for t in parse_tool_table(str(self.table))}
                self.assertEqual((self.zs()[5], self.io.held[5][0]), (rows[5]["Z"], rows[5]["P"]))


class TestAStopFromAnotherClient(_Load):

    def setUp(self):
        super().setUp()
        self.other = ClientState(ip="b", ws=None, armed=True)
        gateway._clients[902] = self.other
        for p in (patch.object(gateway, "TOOL_RELOAD_WAIT_S", 5.0), patch.object(gateway, "_hal_send", lambda *_a, **_k: None),
                  patch.object(gateway, "_estop_hold", gateway._estop_hold)):
            p.start()
            self.addCleanup(p.stop)

    def client_command(self, msg):
        task = asyncio.ensure_future(gateway._execute_client_command(901, self.writer, None, dict(msg)))
        self.writer.cmd_inflight, self.writer.cmd_inflight_task = msg["cmd"], task
        self.writer.cmd_inflight_since_mono = time.monotonic()
        return task

    async def stop(self, by):
        victims = gateway._preempt_inflight(by, 902)
        return victims, await asyncio.wait_for(gateway.handle_command({"cmd": by}, True, self.other.conn_key), 4)

    def test_before_the_write_nothing_is_requested(self):
        # held at the last admission's poll: the write has not begun
        for by in ("abort", "estop"):
            with self.subTest(by):
                self.fresh()
                self.hand_edit()
                msg = self.message()
                reached, release, _n, patches = _held_poll(self, 2)
                seq0 = gateway._tool_write_seq

                async def run():
                    gateway._cmd_lock = None
                    self.replies.clear()
                    task = self.client_command(msg)
                    self.assertTrue(await asyncio.to_thread(reached.wait, 5))
                    victims = gateway._preempt_inflight(by, 902)
                    await asyncio.sleep(0)              # the cancel reached the handler
                    release.set()
                    with contextlib.suppress(asyncio.CancelledError):
                        await task
                    return victims, task.cancelled()
                with patches[0], patches[1]:
                    victims, cancelled = asyncio.run(run())
                self.assertEqual((victims, cancelled, self.io.loads), (1, True, 0), "its worker answers 'Preempted by …'")
                self.assertEqual((gateway._tool_write_seq, gateway._tool_write_job), (seq0, None))

    def test_waiting_for_the_lock_nothing_is_requested(self):
        self.hand_edit()
        msg = self.message()

        async def run():
            gateway._cmd_lock = None
            async with gateway._get_cmd_lock():
                task = self.client_command(msg)
                await asyncio.sleep(.01)
                gateway._preempt_inflight("abort", 902)
                with contextlib.suppress(asyncio.CancelledError):
                    await task
                return task.cancelled()
        self.assertTrue(asyncio.run(run()))
        self.assertEqual(self.io.loads, 0)

    def test_in_the_write_the_request_stands(self):
        # held inside the NML write itself: it has begun
        self.hand_edit()
        msg = self.message()
        reached, release = threading.Event(), threading.Event()
        self.io.immediate = False

        def then():
            reached.set()
            release.wait(5)
        self.io.then = then

        async def run():
            gateway._cmd_lock = None
            self.replies.clear()
            task = self.client_command(msg)
            self.assertTrue(await asyncio.to_thread(reached.wait, 5))
            gateway._preempt_inflight("abort", 902)
            await asyncio.sleep(0)
            gateway._preempt_inflight("estop", 902)     # a second one too
            await asyncio.sleep(0)
            release.set()
            await task
            job = gateway._tool_write_job
            running = not job.task.done()
            self.io.run()
            await job.task
            return running, job
        running, job = asyncio.run(run())
        r = self.replies[-1]
        self.assertEqual((r["ok"], r["load"], r["values"], r["basis"]), (True, "requested", "not awaited", "partial"), r)
        self.assertEqual((self.io.loads, running, job.load.values), (1, True, "shown"), "the job went on")

    def test_in_the_wait_the_client_is_answered_and_the_job_goes_on(self):
        for by in ("abort", "estop"):
            with self.subTest(by):
                self.fresh()
                self.hand_edit()
                msg = self.message()
                self.io.immediate = False

                async def run():
                    gateway._cmd_lock = None
                    self.replies.clear()
                    task = self.client_command(msg)
                    while gateway._tool_write_job is None or gateway._get_cmd_lock().locked():
                        await asyncio.sleep(.001)
                    victims, stop = await self.stop(by)
                    gateway._preempt_inflight(by, 902)          # twice
                    await task
                    job = gateway._tool_write_job
                    running = not job.task.done()
                    self.io.run()
                    await job.task
                    return victims, stop, running, job
                victims, stop, running, job = asyncio.run(run())
                r = self.replies[-1]
                self.assertEqual((victims, stop["ok"], running), (1, True, True))
                self.assertEqual((r["ok"], r["load"], r["values"]), (True, "requested", "not awaited"), r)
                self.assertEqual((self.io.loads, job.load.values), (1, "shown"))


# ---- the words ----------------------------------------------------------------------

class TestTheVocabulary(unittest.TestCase):
    """A request and what the values showed — no text, reply value or trace of
    TF-2 says LinuxCNC loaded (or confirmed) the file. An ordinary edit's own
    `reload: confirmed` is another statement (R479: its own step)."""

    OUTCOME = re.compile(r"\b(loaded|confirmed)\b", re.I)

    def test_the_gateways_words(self):
        src = Path(gateway.__file__).read_text()
        names = sorted(set(re.findall(r'"(tools\.load_[a-z_]+)"', src)))
        self.assertEqual(names, ["tools.load_observation_failed", "tools.load_refused", "tools.load_requested",
                                 "tools.load_values_not_shown", "tools.load_values_shown"])
        words = [v for k, v in vars(gateway).items() if k.startswith("TOOL_LOAD_") and isinstance(v, str)]
        words += [v for k, v in vars(tool_proof).items() if k.startswith(("LOAD_", "REMOVAL_")) and isinstance(v, str)]
        self.assertGreater(len(words), 14)
        for w in [*names, *words]:
            with self.subTest(w):
                # the operator's own confirmation of the tools; a scope the load is not offered for
                if w in (gateway.TOOL_LOAD_REMOVED_CHANGED, tool_proof.LOAD_RANDOM):
                    continue
                self.assertIsNone(self.OUTCOME.search(w))
                if not w.startswith("tools."):
                    self.assertLessEqual(len(w), REASON_MAX_CHARS)

    def test_the_replys_values(self):
        allowed = {"load": {"requested"}, "values": {"shown", "not shown", "not awaited"}, "basis": {"partial", "complete"},
                   "why": {"in time", "file changed", "controller changed", "superseded", "unknown"}}
        for values in (None, "shown", "not shown"):
            for why in (None, *allowed["why"]):
                out = gateway._tool_load_outcome(gateway._ToolLoad("0" * 64, "partial", values, why))
                for k, v in out.items():
                    self.assertIn(v, allowed[k])
        src = Path(gateway.__file__).read_text()
        body = src[src.index("async def _observe_tool_load"):src.index("def _tool_load_outcome")]
        self.assertEqual(set(re.findall(r'load\.why = "([a-z ]+)"', body)) - {"not shown"}, allowed["why"])


if __name__ == "__main__":
    unittest.main()
