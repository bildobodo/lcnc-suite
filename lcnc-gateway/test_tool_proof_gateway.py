"""Tool files read in the gateway (P6, plan maschinentag.r465 v4 §4–§9,
Codex R465): get_tool_table's rule-R reply, the post-write job and its wait
OUTSIDE _cmd_lock (MT465-01) — bound to its write, preempted or simply not
in the way of a stop, on the WS path and the REAL REST import — and MT-TF1:
an edit's basis must be `complete` at its read AND in its write thread;
the Q465-1 switch. The real tool.tbl and tool_library.json in a temporary
folder; LinuxCNC's table is the fake STAT's, loaded by the test (or a fake
io, tool_io_fixture) when the test says so."""
import asyncio
import io
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()
import gateway  # noqa: E402
import tool_proof  # noqa: E402
from fastapi import HTTPException, UploadFile  # noqa: E402
from command_policy import NOT_ARMED  # noqa: E402
from link_fixture import FakeConnection, current, swap_connection, use  # noqa: E402
from test_button_gates import _payload  # noqa: E402
from test_button_gates_b import _Admission  # noqa: E402
from tool_expect_fixture import row_expect  # noqa: E402
from tool_io_fixture import entry, load_into, loaded_table, nonrandom, table_of  # noqa: E402
from tool_store import ToolLibraryStore  # noqa: E402
from tool_table import parse_tool_table  # noqa: E402
from ws_fanout import ClientState  # noqa: E402

TABLE = ("T1 P1 Z50 D6 ; first\n"
         "T2 P2 Z47.690467 D6 ; second\n"
         "T3 P3 Z22 D4 ; third\n")
LIBRARY = {"1": {"type": "flat"}, "2": {"type": "ball"}}


#: the configuration the fake controller runs with
INI = "/cfg/machine.ini"


class _Io:
    """The command channel: load_tool_table RECORDED, LinuxCNC's table
    loaded from the file only when `immediate` (a fake io that takes the
    command at once) — else the test shows it when it wants (show())."""

    def __init__(self, stat, path: Path, immediate=True):
        self.stat, self.path, self.immediate, self.loads = stat, path, immediate, 0

    def load_tool_table(self):
        self.loads += 1
        if self.immediate:
            self.show()

    def show(self):
        load_into(self.stat, self.path)

    def __getattr__(self, _name):
        return lambda *a, **k: None


class _Tools(_Admission):

    def setUp(self):
        super().setUp()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.table = self.dir / "tool.tbl"
        self.table.write_text(TABLE)
        # the store's key is the product's own (STAT's INI): a constant one
        # hides a write redirected to another configuration
        stat = current().stat
        stat.ini_filename = INI
        self.addCleanup(lambda: setattr(stat, "ini_filename", ""))
        self.store = ToolLibraryStore(self.dir / "tool_library.json", gateway._current_ini_path)
        self.store.save(json.loads(json.dumps(LIBRARY)))
        nonrandom(self)
        current().stat.tool_in_spindle = 0
        load_into(current().stat, self.table)          # LinuxCNC loaded the file
        self.io = _Io(current().stat, self.table)
        use(self, cmd=self.io)
        self.replies = []
        self.events = []

        async def reply(_ws, m):
            self.replies.append(m)
        for p in (patch.object(gateway, "get_tool_tbl_path", lambda: str(self.table)),
                  patch.object(gateway, "_tool_lib_store", self.store),
                  patch.object(gateway, "ws_send_json", reply),
                  patch.object(gateway._trace, "emit", lambda ev, *a, **k: self.events.append((ev, k)))):
            p.start()
            self.addCleanup(p.stop)
        gateway._cmd_lock = None
        gateway._shared_status = _payload()

    def library(self):
        return json.loads(json.dumps(self.store.load(ini_key=INI)))

    def expect(self, tool):
        return row_expect(str(self.table), parse_tool_table(str(self.table)), self.library(), tool)

    def read(self):
        gateway._cmd_lock = None
        return asyncio.run(gateway.handle_command({"cmd": "get_tool_table"}, False))

    def send(self, msg):
        """One WS command through the client's command path, to its reply."""
        gateway._cmd_lock = None
        self.replies.clear()
        asyncio.run(gateway._execute_client_command(901, self.writer, None, dict(msg)))
        return self.replies[-1]

    def event_names(self):
        return [e for e, _k in self.events]


# ---- get_tool_table: the reply ---------------------------------------------

class TestTheReadReply(_Tools):

    def test_a_complete_read(self):
        r = self.read()
        self.assertTrue(r["ok"], r)
        self.assertEqual([t["T"] for t in r["tools"]], [1, 2, 3])
        p = r["proof"]
        self.assertEqual((p["state"], p["proven"], p["attempts"], p["why"]), ("complete", [1, 2, 3], 1, None))
        self.assertEqual(r["unread"], [])
        self.assertEqual(r["rev"]["table"], tool_proof.content_rev(self.table.read_bytes()))
        self.assertEqual(r["rev"]["library"], tool_proof.library_rev(LIBRARY))
        self.assertEqual(r["version"], gateway._tool_table_version)
        self.assertEqual(r["table"], gateway._tool_table_identity(str(self.table)))

    def test_partial_after_the_attempts_with_the_tools_named(self):
        current().stat.tool_table = table_of([entry(1, Z=50, D=6), entry(2, Z=47.690467, D=6),
                                              entry(3, Z=23, D=4), entry(4, Z=1)])
        slept = []

        async def sleep(s):
            slept.append(s)
        with patch.object(gateway.asyncio, "sleep", sleep):
            r = self.read()
        p = r["proof"]
        self.assertTrue(r["ok"], "partial is no error: the rows go out")
        self.assertEqual((p["state"], p["attempts"], p["proven"]), ("partial", 3, [1, 2]))
        self.assertEqual((p["differs"], p["missing"]), ([{"T": 3, "fields": ["Z"]}], [4]))
        self.assertEqual(slept, [gateway.TOOL_READ_RETRY_S] * 2)
        self.assertEqual([t["T"] for t in r["tools"]], [1, 2, 3], "the file's rows, named in the proof")
        self.assertIn("tools.read_partial", self.event_names())

    def test_a_read_partial_at_first_complete_at_the_second_attempt(self):
        good = current().stat.tool_table
        current().stat.tool_table = table_of([entry(1, Z=50, D=6)])
        calls = []
        real = gateway._tool_files_attempt

        def attempt(*a):
            calls.append(1)
            if len(calls) == 2:
                current().stat.tool_table = good
            return real(*a)
        with patch.object(gateway, "_tool_files_attempt", attempt):
            r = self.read()
        self.assertEqual((r["proof"]["state"], r["proof"]["attempts"]), ("complete", 2))

    def test_an_empty_controller_table_is_not_read_never_no_tools(self):
        current().stat.tool_table = ()
        self.table.write_text("")
        r = self.read()
        self.assertTrue(r["ok"])
        self.assertEqual((r["tools"], r["proof"]["state"], r["proof"]["why"]),
                         ([], "unchecked", tool_proof.NOT_READ))

    def test_a_random_changer_reads_unchecked_with_its_rows(self):
        with patch.object(gateway, "_tool_table_scope", lambda: tool_proof.SCOPE_RANDOM):
            r = self.read()
        self.assertEqual((r["proof"]["state"], r["proof"]["why"]), ("unchecked", tool_proof.SCOPE_RANDOM))
        self.assertEqual(len(r["tools"]), 3)

    def test_unread_lines_carry_their_t_or_none(self):
        self.table.write_text(TABLE + "T7 P7 E1 ;\nT P8 Z1 ;\n")
        r = self.read()
        self.assertEqual(r["unread"], [{"line": 4, "T": 7}, {"line": 5, "T": None}])
        self.assertEqual(r["proof"]["state"], "partial")

    def test_a_corrupt_library_is_no_read_never_cached_rows(self):
        self.assertTrue(self.read()["ok"])            # the library cached by a good read
        (self.dir / "tool_library.json").write_text("{not json")
        r = self.read()
        self.assertEqual(r["ok"], False)
        self.assertIn("Tool library not JSON", r["error"])
        self.assertNotIn("tools", r)

    def test_the_file_gone_is_no_read(self):
        self.table.unlink()
        r = self.read()
        self.assertEqual(r["ok"], False)
        self.assertIn("Tool table not read", r["error"])

    def test_a_metadata_only_save_changes_only_the_library_rev(self):
        a = self.read()
        self.store.save({**LIBRARY, "3": {"type": "drill"}})
        b = self.read()
        self.assertEqual(a["rev"]["table"], b["rev"]["table"])
        self.assertNotEqual(a["rev"]["library"], b["rev"]["library"])

    def test_an_in_place_rewrite_of_the_same_size_is_a_new_table_rev(self):
        a = self.read()
        with open(self.table, "r+b") as f:     # in place, like io: the same inode and size
            data = f.read()
            f.seek(0)
            f.write(data.replace(b"Z22 D4", b"Z23 D4"))
        b = self.read()
        self.assertNotEqual(a["rev"]["table"], b["rev"]["table"])

    def test_a_file_changed_under_the_read_proves_nothing(self):
        real_fstat = os.fstat
        n = []

        def fstat(fd):
            st = real_fstat(fd)
            n.append(1)
            if len(n) % 2 == 0:        # the second fstat of each attempt: the file moved on
                return os.stat_result((st.st_mode, st.st_ino, st.st_dev, st.st_nlink, st.st_uid, st.st_gid,
                                       st.st_size + 1, st.st_atime, st.st_mtime, st.st_ctime))
            return st

        async def sleep(_s):
            pass
        with patch.object(gateway.os, "fstat", fstat), patch.object(gateway.asyncio, "sleep", sleep):
            r = self.read()
        self.assertEqual((r["proof"]["state"], r["proof"]["proven"], r["proof"]["why"]),
                         ("partial", [], tool_proof.CHANGED))


class TestGW1TheReadSeesAWritersAfterState(_Tools):
    """Regression (variant A, Codex R465): a writer section stalled between
    its table write and its library write — the read, under _cmd_lock like
    the section, gets the after-state only; also when the writer's handler is
    cancelled twice while stalled."""

    def case(self, cancels):
        async def run():
            stall, release = asyncio.Event(), asyncio.Event()
            real_save = gateway.save_tool_library

            def save(library, **k):
                fut.get_loop().call_soon_threadsafe(stall.set)
                asyncio.run_coroutine_threadsafe(release.wait(), fut.get_loop()).result(5)
                real_save(library, **k)
            fut = asyncio.get_running_loop().create_future()
            with patch.object(gateway, "save_tool_library", save):
                writer = asyncio.ensure_future(gateway.handle_command(
                    {"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "flutes": 3,
                     "expected": self.expect(1)}, True, self.writer.conn_key))
                await stall.wait()
                reader = asyncio.ensure_future(gateway.handle_command({"cmd": "get_tool_table"}, False))
                for _ in range(cancels):
                    writer.cancel()
                    await asyncio.sleep(0.01)
                await asyncio.sleep(0.05)
                self.assertFalse(reader.done(), "the read waits behind the section")
                release.set()
                r = await reader
                try:
                    await writer
                except asyncio.CancelledError:
                    pass
            return r
        gateway._cmd_lock = None
        r = asyncio.run(run())
        t1 = next(t for t in r["tools"] if t["T"] == 1)
        self.assertEqual((t1["Z"], t1["flutes"]), (49.0, 3), "the new table WITH its new library")
        self.assertEqual(r["proof"]["state"], "complete")

    def test_the_read_waits_for_the_section(self):
        self.case(0)

    def test_two_cancels_of_the_writer_too(self):
        self.case(2)


# ---- the post-write job (MT465-01) -----------------------------------------

class TestThePostWriteWait(_Tools):

    def test_the_reply_follows_linuxcnc_showing_the_write(self):
        self.io.immediate = False
        polls = []
        real = gateway._stat_tool_table

        def stat_table(owner=None):
            if owner is not None:                  # the job's polls (the basis reads pass no owner)
                polls.append(gateway._get_cmd_lock().locked())
                if polls.count(False) == 3:
                    self.io.show()                 # io took the reload: LinuxCNC shows the rows
            return real(owner)
        v0 = gateway._tool_table_version
        with patch.object(gateway, "_stat_tool_table", stat_table), \
                patch.object(gateway, "TOOL_RELOAD_POLL_S", 0.001):
            r = self.send({"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "expected": self.expect(1)})
        self.assertGreaterEqual(polls.count(False), 3,
                                "the reply waited for LinuxCNC with _cmd_lock FREE (the wait is outside it)")
        self.assertEqual((r["ok"], r["reload"]), (True, "confirmed"), r)
        self.assertEqual(self.io.loads, 1)
        self.assertEqual(gateway._tool_table_version - v0, 1, "ONE ping, at the job's end")
        self.assertEqual(self.read()["proof"]["attempts"], 1, "the read after an edit is complete at once")

    def test_the_bound_ends_it_unconfirmed_and_traced(self):
        self.io.immediate = False
        v0 = gateway._tool_table_version
        t0 = time.monotonic()
        with patch.object(gateway, "TOOL_RELOAD_WAIT_S", 0.05), patch.object(gateway, "TOOL_RELOAD_POLL_S", 0.005):
            r = self.send({"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "expected": self.expect(1)})
        self.assertLess(time.monotonic() - t0, 2.0)
        self.assertEqual((r["ok"], r["reload"]), (True, "unconfirmed"))
        ev = dict(self.events)["tools.reload_unconfirmed"]
        self.assertEqual(ev["differs"], [1])
        self.assertEqual(gateway._tool_table_version - v0, 1)

    def test_a_newer_write_supersedes_an_old_wait_which_writes_nothing_back(self):
        self.io.immediate = False

        async def run():
            gateway._cmd_lock = None
            with patch.object(gateway, "TOOL_RELOAD_WAIT_S", 5.0), patch.object(gateway, "TOOL_RELOAD_POLL_S", 0.002):
                first = asyncio.ensure_future(gateway.handle_command(
                    {"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "expected": self.expect(1)},
                    True, self.writer.conn_key))
                while gateway._tool_write_seq == seq0:
                    await asyncio.sleep(0.001)
                job1_seq = gateway._tool_write_seq
                await asyncio.sleep(0.02)
                self.assertFalse(first.done(), "job 1 waits: LinuxCNC does not show it")
                self.io.show()                     # LinuxCNC loads job 1's table …
                self.io.immediate = True           # … and the next one at once
                v_mid = gateway._tool_table_version
                second = await gateway.handle_command(
                    {"cmd": "save_tool", "tool_number": 2, "z_offset": 40.0, "expected": self.expect(2)},
                    True, self.writer.conn_key)
                r1 = await first
                return job1_seq, v_mid, r1, second
        seq0 = gateway._tool_write_seq
        v0 = gateway._tool_table_version
        # job 1's polls (the job reads its own Link: `owner`) see nothing
        # while it is the newest job — job 2 must be what ends it
        real = gateway._stat_tool_table

        def stat_table(owner=None):
            return None if owner is not None and gateway._tool_write_seq == seq0 + 1 else real(owner)
        with patch.object(gateway, "_stat_tool_table", stat_table):
            job1_seq, v_mid, r1, r2 = asyncio.run(run())
        self.assertEqual(r2["reload"], "confirmed")
        self.assertEqual(r1["reload"], "superseded", "bound to ITS write: a newer job ends it")
        self.assertEqual(gateway._tool_write_seq, job1_seq + 1)
        self.assertEqual(gateway._tool_table_version - v0, 1, "the old job published nothing")
        self.assertEqual(v_mid, v0)
        rows = {t["T"]: t for t in parse_tool_table(str(self.table))}
        self.assertEqual((rows[1]["Z"], rows[2]["Z"]), (49.0, 40.0), "the newer edit stands")
        self.assertEqual(self.io.loads, 2, "no reload replayed by a wait")

    def test_another_controller_ends_the_wait(self):
        self.io.immediate = False

        async def run():
            gateway._cmd_lock = None
            with patch.object(gateway, "TOOL_RELOAD_WAIT_S", 5.0), patch.object(gateway, "TOOL_RELOAD_POLL_S", 0.002):
                t = asyncio.ensure_future(gateway.handle_command(
                    {"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "expected": self.expect(1)},
                    True, self.writer.conn_key))
                while gateway._tool_write_seq == seq0:
                    await asyncio.sleep(0.001)
                await asyncio.sleep(0.01)
                use(self, cmd=self.io)             # a NEW Link (a reconnect)
                return await t
        seq0, v0 = gateway._tool_write_seq, gateway._tool_table_version
        r = asyncio.run(run())
        self.assertEqual(r["reload"], "controller changed")
        self.assertEqual(gateway._tool_table_version - v0, 1, "the ping goes: the edit is committed, the clients read")

    def test_a_controller_that_changes_during_the_comparison_confirms_nothing(self):
        # the comparison runs in a thread: what it found belongs to the Link
        # it read — judged again after it
        real = gateway._tool_job_compare

        def compare(job):
            proof = real(job)
            use(self, cmd=self.io)                 # a NEW Link while the thread compares
            return proof
        with patch.object(gateway, "_tool_job_compare", compare):
            r = self.send({"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "expected": self.expect(1)})
        self.assertEqual(r["reload"], "controller changed", "never 'confirmed' by another controller's wait")

    def test_a_newer_write_during_the_comparison_supersedes(self):
        real = gateway._tool_job_compare

        def compare(job):
            proof = real(job)
            if job.seq == seq0 + 1:
                gateway._tool_write_seq += 1       # a newer write booked while the thread compares
            return proof
        seq0, v0 = gateway._tool_write_seq, gateway._tool_table_version
        with patch.object(gateway, "_tool_job_compare", compare):
            r = self.send({"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "expected": self.expect(1)})
        self.assertEqual((r["reload"], gateway._tool_table_version - v0), ("superseded", 0), "judged after the comparison")

    def test_a_wait_that_fails_answers_no_error_for_a_committed_write(self):
        def boom(_job):
            raise RuntimeError("STAT read exploded")
        v0 = gateway._tool_table_version
        with patch.object(gateway, "_tool_job_compare", boom), \
                patch.object(gateway._trace, "emit_exc", lambda ev, *a, **k: self.events.append((ev, k))):
            r = self.send({"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "flutes": 5, "expected": self.expect(1)})
            gateway._cmd_lock = None
            asyncio.run(gateway._persist_imported_tools(str(self.table), [{"T": 4, "P": 4, "Z": 1.0, "D": 2.0}], {},
                                                        self.writer.conn_key, owner=gateway._tool_owner()))   # the REST import's wait: no 500 either
        self.assertEqual((r["ok"], r["reload"]), (True, "failed"), r)
        self.assertEqual(self.event_names().count("tools.reload_wait_failed"), 2, "named, never silent")
        self.assertEqual(gateway._tool_table_version - v0, 2, "and both pinged")
        self.assertEqual([t["T"] for t in parse_tool_table(str(self.table))], [4])

    def test_no_reload_sent_ends_the_job_at_once(self):
        with patch.object(gateway, "_cmd_now", lambda: None):
            r = self.send({"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "expected": self.expect(1)})
        self.assertEqual(r["reload"], "reload not sent")
        self.assertIn("tools.reload_not_sent", self.event_names())


class TestTheWaitIsNotInAStopsWay(_Tools):
    """MT465-01 (Codex R465's probe, on the built code): during the wait
    _cmd_lock is FREE; the unchanged _preempt_inflight with an abort / E-Stop
    from ANOTHER client: the WS edit's handler is a victim and still answers
    its committed write ok; the REST import is no victim — and needs not be:
    the stop's own command enters the lock at once in both. Nothing half:
    the table, the reload and the library are written; the job goes on and
    pings when LinuxCNC shows the table."""

    def setUp(self):
        super().setUp()
        self.io.immediate = False
        self.other = ClientState(ip="b", ws=None, armed=True)
        gateway._clients[902] = self.other
        for p in (patch.object(gateway, "TOOL_RELOAD_WAIT_S", 5.0),
                  patch.object(gateway, "TOOL_RELOAD_POLL_S", 0.002),
                  patch.object(gateway, "_hal_send", lambda *_a, **_k: None),
                  patch.object(gateway, "_estop_hold", gateway._estop_hold)):
            p.start()
            self.addCleanup(p.stop)

    async def until_waiting(self, seq0):
        """The write booked its job (its section wrote the table and sent the
        reload); then up to 4 s (inside the job's patched 5 s bound) for its
        section to end — the lock's state after that is the test's to judge."""
        t0 = time.monotonic()
        while gateway._tool_write_seq == seq0:
            if time.monotonic() - t0 > 5:
                raise AssertionError("the write never booked its job")
            await asyncio.sleep(0.001)
        t0 = time.monotonic()
        while gateway._get_cmd_lock().locked() and time.monotonic() - t0 < 4.0:
            await asyncio.sleep(0.001)

    async def stop_from_the_other_client(self, by):
        """What the other client's reader and worker do with a stop: the
        fan-out, then the stop's own command under _cmd_lock."""
        victims = gateway._preempt_inflight(by, 902)
        t0 = time.monotonic()
        r = await asyncio.wait_for(gateway.handle_command({"cmd": by}, True, self.other.conn_key), 4.0)
        return victims, r, time.monotonic() - t0

    def check_nothing_half(self, z_of_t1):
        rows = {t["T"]: t for t in parse_tool_table(str(self.table))}
        self.assertEqual(rows[1]["Z"], z_of_t1, "the table written")
        self.assertEqual(self.io.loads, 1, "the reload sent")

    def ws_case(self, by):
        async def run():
            gateway._cmd_lock = None
            seq0 = gateway._tool_write_seq
            msg = {"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "flutes": 4, "expected": self.expect(1)}
            task = asyncio.ensure_future(gateway._execute_client_command(901, self.writer, None, msg))
            self.writer.cmd_inflight, self.writer.cmd_inflight_task = "save_tool", task
            self.writer.cmd_inflight_since_mono = time.monotonic()
            await self.until_waiting(seq0)
            job = next(iter(t for t in gateway._bg_tasks if not t.done() and
                            getattr(t.get_coro(), "__name__", "") == "_confirm_tool_write"))
            lock_free = not gateway._get_cmd_lock().locked()
            self.assertTrue(lock_free, "the wait holds no _cmd_lock")
            victims, stop_reply, stop_s = await self.stop_from_the_other_client(by)
            try:
                await task
            except asyncio.CancelledError:
                pass
            self.assertFalse(task.cancelled(), "a committed write answers ok — never 'Preempted'")
            still_waiting = not job.done()
            v_before = gateway._tool_table_version
            self.io.show()                         # LinuxCNC loads it now: the job confirms and pings
            await job
            return lock_free, victims, stop_reply, stop_s, still_waiting, gateway._tool_table_version - v_before
        lock_free, victims, stop_reply, stop_s, still_waiting, pinged = asyncio.run(run())
        self.assertTrue(lock_free, "the wait holds no _cmd_lock")
        self.assertEqual(victims, 1, "the WS handler in its wait is preempted")
        self.assertTrue(stop_reply["ok"], stop_reply)
        self.assertLess(stop_s, 4.0, "the stop entered the lock inside the job's bound")
        r = self.replies[-1]
        self.assertEqual((r["ok"], r["reload"]), (True, "not awaited"), "a committed write answers ok")
        self.assertTrue(still_waiting, "the job goes on past the preemption")
        self.assertEqual(pinged, 1, "and pings when LinuxCNC shows the table")
        self.check_nothing_half(49.0)
        self.assertEqual(self.library()["1"].get("flutes"), 4, "the library written")

    def test_a_ws_edit_abort_from_another_client(self):
        self.ws_case("abort")

    def test_a_ws_edit_e_stop_from_another_client(self):
        self.ws_case("estop")

    def rest_case(self, by):
        raw = json.dumps({"data": [{"type": "flat end mill", "post-process": {"number": 1},
                                    "geometry": {"DC": 6, "OAL": 60, "LB": 45}, "description": "imported"}]}).encode()

        async def run():
            gateway._cmd_lock = None
            seq0 = gateway._tool_write_seq
            req = asyncio.ensure_future(gateway.apply_tool_library_import(
                UploadFile(file=io.BytesIO(raw), filename="tools.json"), x_conn_key=self.writer.conn_key))
            await self.until_waiting(seq0)
            lock_free = not gateway._get_cmd_lock().locked()
            self.assertTrue(lock_free, "the import's wait holds no _cmd_lock")
            victims, stop_reply, stop_s = await self.stop_from_the_other_client(by)
            waiting = not req.done()
            self.io.show()
            r = await req
            return lock_free, victims, stop_reply, stop_s, waiting, r
        with patch.object(gateway, "get_ini_config", lambda: {"linear_units": "mm"}):
            lock_free, victims, stop_reply, stop_s, waiting, r = asyncio.run(run())
        self.assertTrue(lock_free, "the import's wait holds no _cmd_lock")
        self.assertEqual(victims, 0, "the REST import is no WS command: _preempt_inflight does not reach it …")
        self.assertTrue(stop_reply["ok"], stop_reply)
        self.assertLess(stop_s, 4.0, "… and needs not: the stop entered the lock inside the job's bound")
        self.assertTrue(waiting, "the import's request still waited for LinuxCNC")
        self.assertEqual(r["ok"], True)
        rows = parse_tool_table(str(self.table))
        self.assertEqual([t["T"] for t in rows], [1])
        self.assertEqual(self.io.loads, 1)
        self.assertEqual(self.library()["1"]["oal"], 60, "the library written")

    def test_a_rest_import_abort_from_another_client(self):
        self.rest_case("abort")

    def test_a_rest_import_e_stop_from_another_client(self):
        self.rest_case("estop")


# ---- MT-TF1: the edit's basis ----------------------------------------------

class TestMTTF1TheBasisMustBeComplete(_Tools):

    EDITS = {
        "save_tool": lambda s: {"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "expected": s.expect(1)},
        "add_tool": lambda s: {"cmd": "add_tool", "tool_number": 7, "z_offset": 1.0},
        "delete_tool": lambda s: {"cmd": "delete_tool", "tool_number": 3},
        "renumber_tool": lambda s: {"cmd": "renumber_tool", "old_tool_number": 1, "tool_number": 9,
                                    "expected": s.expect(1)},
    }

    def refused(self, msg, why, what="refused"):
        before, lib = self.table.read_bytes(), self.library()
        r = self.send(msg)
        self.assertEqual((r["ok"], r.get("error")), (False, why), f"{what}: {r}")
        self.assertEqual(self.table.read_bytes(), before, "nothing written")
        self.assertEqual(self.io.loads, 0, "no reload — never a repair by load_tool_table")
        self.assertEqual(self.library(), lib)

    def test_a_clean_prefix_is_refused_at_the_basis_read(self):
        # a paused io: T1, T2 whole and the last line gone — the strict parse
        # passes, the rewrite would lose T3
        self.table.write_text(TABLE.rsplit("T3", 1)[0])
        for cmd, make in self.EDITS.items():
            with self.subTest(cmd):
                self.refused(make(self), "T3 not in the file — restore it; restart drops it")

    def test_the_basis_changed_in_the_write_thread_is_refused_there(self):
        # io between the edit's basis read and its write, at the moment only
        # rule R sees: its memory already holds T3's new length (tooldata_put),
        # the file not yet truncated — the file still EQUALS the edit's base,
        # so the base compare passes; a rewrite would put T3's old length back
        # and the reload would make LinuxCNC forget the new one
        for cmd, make in self.EDITS.items():
            with self.subTest(cmd):
                self.table.write_text(TABLE)
                load_into(current().stat, self.table)
                msg = make(self)
                real = gateway._write_admission_refusal

                def admit(*a, **k):
                    current().stat.tool_table = loaded_table(TABLE.replace("Z22 D4", "Z21 D4"))
                    return real(*a, **k)
                before_lib = self.library()
                with patch.object(gateway, "_write_admission_refusal", admit):
                    r = self.send(msg)
                self.assertEqual((r["ok"], r.get("error")), (False, tool_proof.EDIT_CHANGED),
                                 f"old file, new memory: refused in the write thread — {r}")
                self.assertEqual(self.table.read_text(), TABLE, "nothing written")
                self.assertEqual((self.io.loads, self.library()), (0, before_lib))

    def test_a_paused_save_in_the_write_thread_writes_nothing(self):
        # the save already truncated the file to a clean prefix: refused too
        # (here the base compare would see it as well)
        for cmd, make in self.EDITS.items():
            with self.subTest(cmd):
                self.table.write_text(TABLE)
                load_into(current().stat, self.table)
                msg = make(self)
                real = gateway._write_admission_refusal

                def admit(*a, **k):
                    current().stat.tool_table = loaded_table(TABLE.replace("Z22 D4", "Z21 D4"))
                    with open(self.table, "r+b") as f:
                        f.truncate(len(TABLE.split("T3")[0]))
                    return real(*a, **k)
                with patch.object(gateway, "_write_admission_refusal", admit):
                    r = self.send(msg)
                self.assertFalse(r["ok"], r)
                self.assertEqual(self.table.read_text(), TABLE.split("T3")[0], "nothing written")
                self.assertEqual(self.io.loads, 0)

    def test_an_early_check_alone_is_not_the_admission(self):
        # the basis read admitted, the write thread's re-read refused: the
        # second check is its own (a stub basis read cannot open the write)
        calls = []
        real = gateway._tool_edit_basis

        def basis(path):
            calls.append(1)
            if len(calls) == 2:
                current().stat.tool_table = table_of([entry(1, Z=1)])
            return real(path)
        with patch.object(gateway, "_tool_edit_basis", basis):
            self.refused(self.EDITS["save_tool"](self), tool_proof.EDIT_CHANGED,
                         "the write thread's own admission")
        self.assertEqual(len(calls), 2, "the basis read AND the write thread's")

    def test_an_add_or_delete_compares_its_base_in_the_write_thread(self):
        # io measured T2 between the basis read and the write (memory and
        # file whole: complete) — a rewrite from the older read would put the
        # old length back
        for cmd in ("add_tool", "delete_tool"):
            with self.subTest(cmd):
                self.table.write_text(TABLE)
                load_into(current().stat, self.table)
                real = gateway._write_admission_refusal

                def admit(*a, **k):
                    measured = TABLE.replace("Z47.690467", "Z47.5")
                    self.table.write_text(measured)
                    load_into(current().stat, self.table)
                    return real(*a, **k)
                with patch.object(gateway, "_write_admission_refusal", admit):
                    r = self.send(self.EDITS[cmd](self))
                self.assertEqual((r["ok"], r.get("conflict"), r.get("fields")), (False, True, ["table"]), r)
                self.assertIn("Z47.5", self.table.read_text(), "io's write stands")
                self.assertEqual(self.io.loads, 0)

    def test_an_unread_controller_refuses_with_its_reason(self):
        current().stat.tool_table = ()
        self.refused(self.EDITS["save_tool"](self), tool_proof.edit_unchecked(tool_proof.NOT_READ))

    def test_a_complete_basis_edits(self):
        for cmd, make in self.EDITS.items():
            with self.subTest(cmd):
                self.table.write_text(TABLE)
                load_into(current().stat, self.table)
                self.store.save(json.loads(json.dumps(LIBRARY)))
                r = self.send(make(self))
                self.assertEqual((r["ok"], r["reload"]), (True, "confirmed"), r)


    def test_the_refusal_and_the_read_name_the_same_cause(self):
        # Codex R468 TF-1: the edit's refusal and the read's `edit_refusal`
        # (the Tools tab's note) are one function's words; nothing is written
        # in any of them
        twice = table_of([entry(1, Z=50, D=6), entry(2, Z=47.690467, D=6), entry(3, Z=22, D=4), entry(3, Z=9)])
        cases = [
            ("Last line has no line end — add it in an editor", TABLE[:-1], loaded_table(TABLE)),
            ("T3 twice in the file — remove one, restart LinuxCNC", TABLE + "T3 P4 Z9 ; again\n", twice),
            ("LinuxCNC holds T3 twice — restart it", TABLE, twice),
            ("Line 4 not readable — fix it in an editor", TABLE + "T7 P7 E1 ;\n", loaded_table(TABLE)),
            ("T3 differs from LinuxCNC — a restart loads the file", TABLE.replace("Z22", "Z23"), loaded_table(TABLE)),
            ("File incomplete — read again; if it stays, fix the file", "", loaded_table(TABLE)),
        ]
        async def sleep(_s):
            pass
        for why, text, stat_table in cases:
            with self.subTest(why):
                self.table.write_text(text)
                current().stat.tool_table = stat_table
                with patch.object(gateway.asyncio, "sleep", sleep):
                    r = self.read()
                self.assertEqual((r["proof"]["state"], r["edit_refusal"]), ("partial", why))
                self.refused({"cmd": "add_tool", "tool_number": 8, "z_offset": 1.0}, why)

    def test_a_complete_read_names_no_refusal_an_unchecked_one_its_own(self):
        self.assertIsNone(self.read()["edit_refusal"])
        current().stat.tool_table = ()
        self.assertEqual(self.read()["edit_refusal"], tool_proof.edit_unchecked(tool_proof.NOT_READ))

    def test_while_linuxcnc_still_loads_the_last_write_the_refusal_says_so(self):
        # another client's edit inside LinuxCNC's load of the last one (the
        # reply of the first waits, the lock is free): not "restart LinuxCNC"
        self.io.immediate = False

        async def run():
            gateway._cmd_lock = None
            with patch.object(gateway, "TOOL_RELOAD_WAIT_S", 5.0), patch.object(gateway, "TOOL_RELOAD_POLL_S", 0.002):
                first = asyncio.ensure_future(gateway.handle_command(
                    {"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "expected": self.expect(1)},
                    True, self.writer.conn_key))
                while gateway._tool_write_seq == seq0:
                    await asyncio.sleep(0.001)
                during = await gateway.handle_command(
                    {"cmd": "add_tool", "tool_number": 8, "z_offset": 1.0}, True, self.writer.conn_key)
                self.io.show()
                return during, await first
        seq0 = gateway._tool_write_seq
        during, first = asyncio.run(run())
        self.assertEqual((during["ok"], during.get("error")), (False, tool_proof.EDIT_LOADING))
        self.assertEqual(first["reload"], "confirmed")
        self.io.immediate = True
        # the load never shown: once the wait ended the difference is named
        load_into(current().stat, self.table)
        self.io.immediate = False
        with patch.object(gateway, "TOOL_RELOAD_WAIT_S", 0.02), patch.object(gateway, "TOOL_RELOAD_POLL_S", 0.002):
            self.send({"cmd": "save_tool", "tool_number": 1, "z_offset": 48.0, "expected": self.expect(1)})
        r = self.send({"cmd": "add_tool", "tool_number": 8, "z_offset": 1.0})
        self.assertEqual(r["error"], "T1 differs from LinuxCNC — a restart loads the file")


# ---- Codex R468 MT-I35: the admission again, after the check ----------------

class TestMTI35TheAdmissionAfterTheCheck(_Tools):
    """The write thread's check reads the table, STAT and the library: what
    the event loop does to the writer meanwhile (a disarm, a lost
    connection) — and any other admission that fell — refuses the write,
    with ITS reason: table and library byte-identical, no reload. The real
    WS path; the moment is the SECOND rule-R read (the write thread's)."""

    EDITS = TestMTTF1TheBasisMustBeComplete.EDITS

    def at_the_second_read(self, hook, msg, *, held=False):
        """The reply of `msg` with `hook` run while the write thread's check
        reads — in that thread, or (`held`) on the event loop while the
        thread waits."""
        real, calls = gateway._stat_tool_table, []
        reached, release = threading.Event(), threading.Event()

        def table(*a, **kw):
            got = real(*a, **kw)
            calls.append(1)
            if len(calls) == 2:
                if held:
                    reached.set()
                    if not release.wait(5):
                        raise AssertionError("never released")
                else:
                    hook()
            return got

        async def run():
            gateway._cmd_lock = None
            self.replies.clear()
            task = asyncio.ensure_future(gateway._execute_client_command(901, self.writer, None, dict(msg)))
            if held:
                try:
                    self.assertTrue(await asyncio.to_thread(reached.wait, 5))
                    hook()
                finally:
                    release.set()
            await task
        before = (self.table.read_bytes(), (self.dir / "tool_library.json").read_bytes())
        with patch.object(gateway, "_stat_tool_table", table):
            asyncio.run(run())
        return self.replies[-1], before, len(calls)

    def refused(self, hook, why, *, held=False):
        for cmd, make in self.EDITS.items():
            with self.subTest(cmd, held=held):
                gateway._clients[901] = self.writer
                self.writer.armed = True
                r, before, reads = self.at_the_second_read(hook, make(self), held=held)
                self.assertGreaterEqual(reads, 2, "the write thread's check ran")
                self.assertEqual((r["ok"], r.get("error")), (False, why), r)
                self.assertEqual((self.table.read_bytes(), (self.dir / "tool_library.json").read_bytes()), before,
                                 "table and library byte-identical")
                self.assertEqual(self.io.loads, 0, "no reload")
                self.assertIn("tools.edit_admission_lost", self.event_names())

    def test_a_disarm_while_the_check_reads(self):
        self.refused(lambda: setattr(self.writer, "armed", False), NOT_ARMED)

    def test_a_disarm_by_the_event_loop_while_the_check_thread_waits(self):
        self.refused(lambda: setattr(self.writer, "armed", False), NOT_ARMED, held=True)

    def test_a_connection_lost_while_the_check_reads(self):
        self.refused(lambda: gateway._clients.pop(901, None), gateway.CONN_UNKNOWN, held=True)

    def test_a_program_started_while_the_check_reads(self):
        stat = current().stat
        self.addCleanup(setattr, stat, "interp_state", linuxcnc.INTERP_IDLE)

        def started():
            stat.interp_state = linuxcnc.INTERP_READING
        for cmd, make in self.EDITS.items():
            with self.subTest(cmd):
                stat.interp_state = linuxcnc.INTERP_IDLE
                r, before, _n = self.at_the_second_read(started, make(self))
                self.assertEqual((r["ok"], r.get("error")), (False, "A program or MDI runs — wait"), r)
                self.assertEqual(self.table.read_bytes(), before[0])
                self.assertEqual(self.io.loads, 0)

    def test_the_early_admission_stays_no_reads_for_a_refused_writer(self):
        real, calls = gateway._stat_tool_table, []

        def table(*a, **kw):
            calls.append(1)
            self.writer.armed = False          # during the BASIS read, the first one
            return real(*a, **kw)
        with patch.object(gateway, "_stat_tool_table", table):
            r = self.send(self.EDITS["save_tool"](self))
        self.assertEqual((r["ok"], r["error"], len(calls)), (False, NOT_ARMED, 1), "refused before the check's reads")

    def test_an_unchanged_admission_commits(self):
        for cmd, make in self.EDITS.items():
            with self.subTest(cmd):
                self.table.write_text(TABLE)
                load_into(current().stat, self.table)
                self.store.save(json.loads(json.dumps(LIBRARY)))
                r, before, _n = self.at_the_second_read(lambda: None, make(self), held=True)
                self.assertEqual((r["ok"], r.get("reload")), (True, "confirmed"), r)
                self.assertNotEqual(self.table.read_bytes(), before[0])

    def test_a_write_begun_is_not_taken_back(self):
        # disarmed once the file write began: the section runs to its end —
        # reload and metadata (BG-22), the reply ok
        real = gateway.write_tool_table

        def write(path, tools):
            self.writer.armed = False
            return real(path, tools)
        with patch.object(gateway, "write_tool_table", write):
            r = self.send({"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "flutes": 7, "expected": self.expect(1)})
        self.assertEqual((r["ok"], r["reload"]), (True, "confirmed"), r)
        self.assertEqual((self.io.loads, self.library()["1"]["flutes"]), (1, 7))


# ---- Codex R468 MT-I37: a read and an edit are ONE owner's -------------------

class _Owner(_Tools):

    def setUp(self):
        super().setUp()
        saved = gateway._bound_instance
        self.addCleanup(setattr, gateway, "_bound_instance", saved)
        gateway._bound_instance = (111, 111)
        self.conn = current()

    def changes(self):
        """What another thread does to the gateway's connection: revoked,
        replaced by one whose table reads the same / is unread, rebound (the
        instance is set BEFORE its Link is published)."""
        def replaced(table):
            def do():
                new = FakeConnection()
                new.stat.tool_table = table
                new.stat.interp_state = linuxcnc.INTERP_IDLE
                swap_connection(new)
            return do

        def rebound():
            gateway._bound_instance = (222, 222)

        def rebound_and_published():
            rebound()
            replaced(())()
        return {"revoked": lambda: swap_connection(None),
                "replaced, the same table": replaced(loaded_table(TABLE)),
                "replaced, unread": replaced(()),
                "rebound, its Link not yet published": rebound,
                "rebound and published": rebound_and_published}

    def restored(self):
        gateway._bound_instance = (111, 111)
        swap_connection(FakeConnection(stat=self.conn.stat, cmd=self.io, err=self.conn.err))


class TestMTI37TheReadIsOneOwners(_Owner):

    def check(self, patch_at):
        """Each change at the moment `patch_at(do)` (a patch context): the
        result is discarded with its reason."""
        for what, do in self.changes().items():
            with self.subTest(what):
                self.restored()
                with patch_at(do):
                    r = self.read()
                self.assertEqual(r, {"ok": False, "error": gateway.LINK_CHANGED}, "discarded, named")
                self.assertIn("tools.read_owner_changed", self.event_names())

    def test_before_the_stat_read(self):
        real = gateway._stat_tool_table

        def at(do):
            def table(*a, **k):
                do()
                return real(*a, **k)
            return patch.object(gateway, "_stat_tool_table", table)
        self.check(at)

    def test_after_the_stat_read(self):
        real = gateway._stat_tool_table

        def at(do):
            def table(*a, **k):
                got = real(*a, **k)
                do()
                return got
            return patch.object(gateway, "_stat_tool_table", table)
        self.check(at)

    def test_during_the_library_read(self):
        real = self.store.load

        def at(do):
            def load(strict=False, **k):
                got = real(strict, **k)
                if strict:
                    do()
                return got
            return patch.object(self.store, "load", load)
        self.check(at)

    def test_while_the_reply_is_built(self):
        # the last read before the reply: judged after it
        real = gateway._merge_tool_data

        def at(do):
            def merge(*a):
                do()
                return real(*a)
            return patch.object(gateway, "_merge_tool_data", merge)
        self.check(at)

    def test_a_read_begun_without_a_connection_is_no_later_ones(self):
        swap_connection(None)
        real = self.store.load

        def load(strict=False, **k):
            got = real(strict, **k)
            self.restored()                    # LinuxCNC connects meanwhile
            return got
        with patch.object(self.store, "load", load):
            r = self.read()
        self.assertEqual(r, {"ok": False, "error": gateway.LINK_CHANGED})

    def test_outside_a_command_too(self):
        # not only the command's pin: the job judges its own owner
        real = self.store.load

        def load(strict=False, **k):
            got = real(strict, **k)
            swap_connection(FakeConnection(stat=self.conn.stat, cmd=self.io, err=self.conn.err))
            return got
        with patch.object(self.store, "load", load):
            r = asyncio.run(gateway._read_tool_files(str(self.table)))
        self.assertEqual(r, {"ok": False, "error": gateway.LINK_CHANGED})

    def test_another_configurations_library_is_none_of_this_read(self):
        # the library's section is the configuration's (STAT.ini_filename):
        # another one at the end is another assignment
        stat = current().stat
        real = self.store.load

        def load(strict=False, **k):
            got = real(strict, **k)
            stat.ini_filename = "/cfg/other.ini"
            return got
        with patch.object(self.store, "load", load):
            r = self.read()
        self.assertEqual(r, {"ok": False, "error": gateway.LINK_CHANGED})

    def test_an_unchanged_owner_publishes_under_its_name(self):
        r = self.read()
        self.assertEqual((r["ok"], r["proof"]["state"]), (True, "complete"))
        self.assertEqual(r["table"]["instance"], "111:111")

    def test_without_a_connection_throughout_it_reads_unchecked(self):
        swap_connection(None)
        r = self.read()
        self.assertEqual((r["ok"], r["proof"]["state"], r["proof"]["why"], r["current_tool"]),
                         (True, "unchecked", tool_proof.NOT_READ, None))


class TestMTI37TheEditIsOneOwners(_Owner):
    """A compare under one connection, the write under another: refused in
    the write's thread, nothing written (no second lock: the owner is
    captured with the basis and asked again right before the write)."""

    EDITS = TestMTTF1TheBasisMustBeComplete.EDITS

    def check(self, nth):
        for what, do in self.changes().items():
            for cmd, make in self.EDITS.items():
                with self.subTest(what, cmd=cmd):
                    self.restored()
                    msg = make(self)
                    real, calls = gateway._stat_tool_table, []

                    def table(*a, **k):
                        got = real(*a, **k)
                        calls.append(1)
                        if len(calls) == nth:
                            do()
                        return got
                    before = (self.table.read_bytes(), self.library())
                    with patch.object(gateway, "_stat_tool_table", table):
                        r = self.send(msg)
                    self.assertEqual((r["ok"], r.get("error")), (False, gateway.LINK_CHANGED), r)
                    self.assertEqual((self.table.read_bytes(), self.library()), before, "nothing written")
                    self.assertEqual(self.io.loads, 0)

    def test_after_the_basis_compare(self):
        self.check(1)

    def test_after_the_write_threads_compare(self):
        self.check(2)

    def test_at_the_admissions_own_poll(self):
        # the last thing before the write: the poll succeeded, then it changed
        for what, do in self.changes().items():
            with self.subTest(what):
                self.restored()
                msg = self.EDITS["add_tool"](self)
                before = self.table.read_bytes()
                real, calls = gateway._reader_fresh_get, []

                def fresh(key):
                    calls.append(key)
                    if calls.count("tool_change") == 2:     # the second admission, after its poll
                        do()
                    return real(key)
                with patch.object(gateway, "_reader_fresh_get", fresh):
                    r = self.send(msg)
                self.assertEqual((r["ok"], r.get("error")), (False, gateway.LINK_CHANGED), r)
                self.assertEqual(self.table.read_bytes(), before)

    def at_the_table_write(self, do):
        """`do` right after the table file was replaced: the edit is committed,
        its metadata still to come."""
        real = gateway.write_tool_table

        def write(*a):
            data = real(*a)
            do()
            return data
        return patch.object(gateway, "write_tool_table", write)

    def all_libraries(self):
        return json.loads((self.dir / "tool_library.json").read_text())

    def test_the_metadata_follows_the_table_under_the_edits_configuration(self):
        # the Link goes AFTER the table was replaced: the metadata belongs to
        # the same edit — never read and saved as "default", never another
        # configuration's section
        for what, do in self.changes().items():
            with self.subTest(what):
                self.restored()
                self.table.write_text(TABLE)
                load_into(self.conn.stat, self.table)
                self.store.save(json.loads(json.dumps(LIBRARY)), ini_key=INI)
                with self.at_the_table_write(do):
                    r = self.send({"cmd": "add_tool", "tool_number": 7, "z_offset": 1.0, "flutes": 5})
                self.assertTrue(r["ok"], r)
                self.assertIn(7, [x["T"] for x in parse_tool_table(str(self.table))])
                self.assertEqual(self.all_libraries(), {INI: {**LIBRARY, "7": {"flutes": 5}}})

    def test_an_imports_metadata_too(self):
        for what, do in self.changes().items():
            with self.subTest(what):
                self.restored()
                self.store.save(json.loads(json.dumps(LIBRARY)), ini_key=INI)
                gateway._cmd_lock = None
                with self.at_the_table_write(do):
                    asyncio.run(gateway._persist_imported_tools(
                        str(self.table), [{"T": 4, "P": 4, "Z": 1.0, "D": 2.0}], {"4": {"flutes": 3}},
                        self.writer.conn_key, owner=gateway._tool_owner()))
                self.assertEqual(self.all_libraries(), {INI: {"4": {"flutes": 3}}})

    def test_an_import_whose_owner_changed_before_its_write_replaces_nothing(self):
        for what, do in self.changes().items():
            with self.subTest(what):
                self.restored()
                gateway._cmd_lock = None
                owner, before = gateway._tool_owner(), (self.table.read_bytes(), self.all_libraries())
                do()
                with self.assertRaises(HTTPException) as e:
                    asyncio.run(gateway._persist_imported_tools(
                        str(self.table), [{"T": 4, "P": 4, "Z": 1.0, "D": 2.0}], {},
                        self.writer.conn_key, owner=owner))
                self.assertEqual((e.exception.status_code, e.exception.detail), (409, gateway.LINK_CHANGED))
                self.assertEqual((self.table.read_bytes(), self.all_libraries()), before)

    def test_an_unreadable_library_refuses_before_the_table_is_replaced(self):
        for cmd, make in self.EDITS.items():
            for text in ("{", "[]", '{"%s": 5}' % INI):
                with self.subTest(cmd, library=text):
                    path = self.dir / "tool_library.json"
                    path.write_text(json.dumps({INI: LIBRARY}))
                    msg = make(self)
                    path.write_text(text)
                    before = self.table.read_bytes()
                    r = self.send(msg)
                    self.assertFalse(r["ok"], r)
                    if cmd in ("add_tool", "delete_tool"):     # (an edit of a row is refused by its row's compare)
                        self.assertTrue(r["error"].startswith("Tool library ") and "tool_library.json" in r["error"], r)
                    self.assertEqual(self.table.read_bytes(), before, "nothing written")
                    self.assertEqual(((self.dir / "tool_library.json").read_text(), self.io.loads), (text, 0))

    def test_an_unchanged_owner_commits(self):
        for cmd, make in self.EDITS.items():
            with self.subTest(cmd):
                self.table.write_text(TABLE)
                load_into(current().stat, self.table)
                self.store.save(json.loads(json.dumps(LIBRARY)))
                r = self.send(make(self))
                self.assertEqual((r["ok"], r["reload"]), (True, "confirmed"), r)


class TestQ4651TheSwitchPoint(_Tools):
    """Q465-1 (operator, pending): ONE switch, tool_proof.UNCHECKED_EDITS_BLOCKED.
    Default: an edit on a random changer / a tool database is refused with
    its reason, the read stays possible; switched off, it edits as before."""

    def setUp(self):
        super().setUp()
        p = patch.object(gateway, "_tool_table_scope", lambda: tool_proof.SCOPE_RANDOM)
        p.start()
        self.addCleanup(p.stop)

    def test_blocked_by_default_reading_stays(self):
        r = self.send({"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "expected": self.expect(1)})
        self.assertEqual((r["ok"], r["error"]), (False, "Table not checked (random tool changer) — nothing written"))
        self.assertEqual(self.io.loads, 0)
        self.assertEqual(self.read()["proof"]["state"], "unchecked")

    def test_switched_off_it_edits(self):
        with patch.object(tool_proof, "UNCHECKED_EDITS_BLOCKED", False):
            r = self.send({"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "expected": self.expect(1)})
        self.assertEqual((r["ok"], r["reload"]), (True, "not checked"), r)
        self.assertEqual({t["T"]: t["Z"] for t in parse_tool_table(str(self.table))}[1], 49.0)


class TestTheScopeFromTheIni(unittest.TestCase):

    def scope(self, values):
        class Ini:
            def __init__(self, _path):
                pass

            def find(self, section, key):
                return values.get((section, key))
        gateway._tool_scope_cache = None
        with patch.dict(os.environ, {"LCNC_INI_FILE": "/cfg/m.ini"}), \
                patch.object(gateway.linuxcnc, "ini", Ini), \
                patch.object(gateway._trace, "emit", lambda *a, **k: None):
            try:
                return gateway._tool_table_scope()
            finally:
                gateway._tool_scope_cache = None

    def test_the_scopes(self):
        self.assertIsNone(self.scope({}))
        self.assertIsNone(self.scope({("EMCIO", "RANDOM_TOOLCHANGER"): "0"}))
        self.assertEqual(self.scope({("EMCIO", "RANDOM_TOOLCHANGER"): "1"}), tool_proof.SCOPE_RANDOM)
        self.assertEqual(self.scope({("EMCIO", "RANDOM_TOOLCHANGER"): "yes"}), tool_proof.SCOPE_UNKNOWN,
                         "a value that does not read is never nonrandom")
        self.assertEqual(self.scope({("EMCIO", "DB_PROGRAM"): "db.py"}), tool_proof.SCOPE_DATABASE)
        self.assertEqual(self.scope({("EMCIO", "DB_PROGRAM"): ""}), tool_proof.SCOPE_DATABASE)

    def test_no_ini_is_unknown(self):
        gateway._tool_scope_cache = None
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(gateway._tool_table_scope(), tool_proof.SCOPE_UNKNOWN)


if __name__ == "__main__":
    unittest.main()
