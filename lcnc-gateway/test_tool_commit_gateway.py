"""The end of a tool-table write (P6 "tool files read", Codex R471):

- MT-I35 rest: the write admission decides the writer — and what it was
  read under — again AFTER its own controller and HAL reads, for the four
  edits, the full import, a program and a macro; nothing a commit reads
  itself stands between that decision and the file;
- MT-I41: the owner of a write — Link, instance, configuration, table path —
  travels through its reload and the confirmation of it: another Link is
  never asked to load, never proves it, never retried on;
- MT-I42: once the file IS replaced the rest has outcomes of its own: a
  reload refused, failed or unclear never skips the metadata, the reply says
  the table is written and names what is open — through a cancel too.

The real WS path and the real REST import; the table, the library and the
folders in temporary directories, LinuxCNC's table the fake STAT's."""
import asyncio
import contextlib
import gc
import io
import json
import threading
import time
import unittest
from unittest.mock import patch

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()
import gateway  # noqa: E402
import tool_proof  # noqa: E402
from fastapi import HTTPException, UploadFile  # noqa: E402
from command_policy import NOT_ARMED  # noqa: E402
from link_fixture import FakeConnection, current, swap_connection  # noqa: E402
from test_button_gates_b import _FakeUpload  # noqa: E402
from test_macros_gateway import FACE, _body, _Folder, rev  # noqa: E402
from test_tool_proof_gateway import INI, LIBRARY, TABLE, TestMTTF1TheBasisMustBeComplete, _Io, _Owner  # noqa: E402
from tool_io_fixture import at_rest, load_into  # noqa: E402
from tool_table import parse_tool_table  # noqa: E402
from ws_fanout import ClientState  # noqa: E402

EDITS = TestMTTF1TheBasisMustBeComplete.EDITS
#: edits that carry metadata of their own: what the library holds after each
WITH_METADATA = {
    "save_tool": (lambda s: {"cmd": "save_tool", "tool_number": 1, "z_offset": 49.0, "flutes": 5,
                             "expected": s.expect(1)},
                  {"1": {"type": "flat", "flutes": 5}, "2": {"type": "ball"}}),
    "add_tool": (lambda s: {"cmd": "add_tool", "tool_number": 7, "z_offset": 1.0, "flutes": 5},
                 {**LIBRARY, "7": {"flutes": 5}}),
    "delete_tool": (lambda s: {"cmd": "delete_tool", "tool_number": 1}, {"2": {"type": "ball"}}),
    "renumber_tool": (lambda s: {"cmd": "renumber_tool", "old_tool_number": 1, "tool_number": 9, "flutes": 5,
                                 "expected": s.expect(1)},
                      {"9": {"type": "flat", "flutes": 5}, "2": {"type": "ball"}}),
}
IMPORT = json.dumps({"data": [{"type": "flat end mill", "post-process": {"number": 1},
                               "geometry": {"DC": 6, "OAL": 60, "LB": 45}, "description": "imported"}]}).encode()


class _Commit(_Owner):
    """An edit through the client's command path, the import through its
    route; every other controller records what it is asked."""

    def setUp(self):
        super().setUp()
        self.others = []            # the command channels of every connection published meanwhile
        self.link0 = gateway._link
        for p in (patch.object(gateway, "get_ini_config", lambda: {"linear_units": "mm"}),
                  patch.object(gateway._trace, "emit_exc", lambda ev, *a, **k: self.events.append((ev, k)))):
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(gateway._tool_table_watch.update, dict(gateway._tool_table_watch))

    def fresh(self):
        self.restored()
        self.link0 = gateway._link
        self.table.write_text(TABLE)
        load_into(self.conn.stat, self.table)
        self.store.save(json.loads(json.dumps(LIBRARY)), ini_key=INI)
        gateway._clients[901] = self.writer
        self.writer.armed = True
        self.io.loads, self.others[:] = 0, []
        self.events.clear()

    def another(self, ini=INI, shows=True):
        """Another Link, the same configuration again unless said: its own
        command channel (recorded) and — `shows` — a table that reads exactly
        like the file as it stands (what a LinuxCNC started meanwhile holds)."""
        new = FakeConnection()
        new.stat.ini_filename = ini
        new.stat.interp_state = linuxcnc.INTERP_IDLE
        at_rest(new.stat)
        new.stat.tool_in_spindle = 0
        new.stat.tool_table = ()
        if shows:
            load_into(new.stat, self.table)
        new.cmd = _Io(new.stat, self.table)
        self.others.append(new.cmd)
        swap_connection(new)

    def changes(self):
        def rebound():
            gateway._bound_instance = (222, 222)

        def rebound_and_published():
            rebound()
            self.another()
        return {"revoked": lambda: swap_connection(None),
                "replaced, the same configuration": self.another,
                "replaced, another configuration": lambda: self.another("/cfg/other.ini"),
                "rebound, its Link not yet published": rebound,
                "rebound and published": rebound_and_published}

    def files(self):
        return self.table.read_bytes(), (self.dir / "tool_library.json").read_bytes()

    def libraries(self):
        return json.loads((self.dir / "tool_library.json").read_text())

    def tools(self):
        return {t["T"]: t["Z"] for t in parse_tool_table(str(self.table))}

    async def imported(self):
        return await gateway.apply_tool_library_import(
            UploadFile(file=io.BytesIO(IMPORT), filename="tools.json"), x_conn_key=self.writer.conn_key)

    def run_import(self):
        async def run():
            gateway._cmd_lock = None
            try:
                return await self.imported()
            except HTTPException as e:
                return {"ok": False, "http": e.status_code, "error": e.detail}
        return asyncio.run(run())


# ---- MT-I35 rest: the writer after the admission's own reads ------------------

def _held_poll(test, nth, admit="_write_admission_refusal"):
    """(reached, release, admissions, the patches): the STAT poll of the
    `nth` admission is held in the write's thread."""
    stat = current().stat
    real_admit, real_poll = getattr(gateway, admit), stat.poll
    phase, admissions = threading.local(), []
    reached, release = threading.Event(), threading.Event()

    def poll():
        if getattr(phase, "held", False) and not reached.is_set():
            reached.set()
            if not release.wait(5):
                raise AssertionError("the final poll was never released")
        return real_poll()

    def admission(*a, **kw):
        admissions.append(1)
        phase.held = len(admissions) == nth
        try:
            return real_admit(*a, **kw)
        finally:
            phase.held = False
    return reached, release, admissions, (patch.object(gateway, admit, admission), patch.object(stat, "poll", poll))


class TestMTI35TheWriterAfterTheAdmissionsReads(_Commit):
    """The admission polls STAT itself: what the event loop does to the
    writer during THAT poll refuses the write too — with its reason, nothing
    written. Held in the write's thread, changed on the event loop."""

    def held(self, nth, job, hook):
        """`job()`'s answer with the nth admission's poll held while the
        event loop runs `hook`."""
        reached, release, admissions, patches = _held_poll(self, nth)

        async def run():
            gateway._cmd_lock = gateway._source_lock = None
            task = asyncio.ensure_future(job())
            try:
                self.assertTrue(await asyncio.to_thread(reached.wait, 5), "the final admission's poll")
                hook()
            finally:
                release.set()
            return await task
        with patches[0], patches[1]:
            r = asyncio.run(run())
        self.assertEqual(len(admissions), nth)
        return r

    def refused(self, r, why):
        self.assertFalse(r["ok"], r)
        self.assertTrue(r["error"].endswith(why), r)

    def edit(self, msg, hook):
        self.replies.clear()
        self.held(2, lambda: gateway._execute_client_command(901, self.writer, None, dict(msg)), hook)
        return self.replies[-1]

    def import_(self, hook):
        async def job():
            try:
                return await self.imported()
            except HTTPException as e:
                return {"ok": False, "http": e.status_code, "error": e.detail}
        return self.held(1, job, hook)

    LOST = {"disarm": (lambda s: setattr(s.writer, "armed", False), NOT_ARMED),
            "disconnect": (lambda s: gateway._clients.pop(901, None), gateway.CONN_UNKNOWN)}

    def test_an_edit_whose_writer_is_lost_at_the_final_poll_writes_nothing(self):
        for what, (do, why) in self.LOST.items():
            for cmd, make in EDITS.items():
                with self.subTest(what, cmd=cmd):
                    self.fresh()
                    msg, before = make(self), self.files()
                    r = self.edit(msg, lambda: do(self))
                    self.refused(r, why)
                    self.assertEqual(self.files(), before, "table and library byte-identical")
                    self.assertEqual(self.io.loads, 0, "no reload")

    def test_the_import_whose_writer_is_lost_at_its_poll_replaces_nothing(self):
        for what, (do, why) in self.LOST.items():
            with self.subTest(what):
                self.fresh()
                before = self.files()
                r = self.import_(lambda: do(self))
                self.assertEqual(r, {"ok": False, "http": 409, "error": why})
                self.assertEqual(self.files(), before, "table and library byte-identical")
                self.assertEqual(self.io.loads, 0, "no reload")

    def test_the_other_admissions_in_memory_too(self):
        # a start claim, a run from line, a load, the owner: none is a read
        def claim():
            gateway._source_claims.append(gateway._StartClaim("mdi"))

        def loading():
            gateway._status_runtime._changing = True
        for what, do, why in (("a start", claim, "A program or macro is starting or running — wait"),
                              ("a load", loading, "A program is loading — wait"),
                              ("the owner", lambda: setattr(gateway, "_bound_instance", (5, 5)), gateway.LINK_CHANGED)):
            with self.subTest(what):
                self.fresh()
                gateway._source_claims.clear()
                gateway._status_runtime._changing = False
                msg, before = EDITS["add_tool"](self), self.files()
                r = self.edit(msg, do)
                self.refused(r, why)
                self.assertEqual(self.files(), before)

    def test_unchanged_it_commits(self):
        for cmd, make in EDITS.items():
            with self.subTest(cmd):
                self.fresh()
                msg, before = make(self), self.files()
                r = self.edit(msg, lambda: None)
                self.assertEqual((r["ok"], r["reload"]), (True, "confirmed"), r)
                self.assertNotEqual(self.files()[0], before[0])
        self.fresh()
        r = self.import_(lambda: None)
        self.assertEqual((r["ok"], list(self.tools())), (True, [1]), r)

    def test_the_early_writer_check_stays_first(self):
        self.writer.armed = False
        gateway._source_claims.append(gateway._StartClaim("mdi"))
        self.assertEqual(gateway._write_admission_refusal(self.writer.conn_key), NOT_ARMED)


class TestMTI35ProgramsAndMacros(_Folder):
    """The same for a program and a macro: the admission's own poll, and what
    their commit reads beside it (the macro names, the macro file) — the
    writer is decided after all of it."""

    def setUp(self):
        super().setUp()
        self.prog = self.nc / "part.ngc"
        self.prog.write_text("G0 X0\n")
        self.writer = next(c for c in gateway._clients.values() if c.conn_key == self.conn_key)
        for name, val in (("_source_lock", None), ("_rfl_task", None), ("_rfl_flag_task", None)):
            p = patch.object(gateway, name, val)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(gateway._status_runtime, "_changing", False)
        p.start()
        self.addCleanup(p.stop)

    async def save(self):
        return await gateway.save_gcode(_body("G0 X1\n"), path=str(self.prog), x_conn_key=self.conn_key)

    async def upload(self):
        return await gateway.upload_gcode(_FakeUpload(b"G0 X1\n", "new.ngc"), 0, x_conn_key=self.conn_key)

    async def macro(self):
        return await gateway.put_macro(_body(FACE + "(edit)\n"), name="face_top", base=rev(FACE),
                                       rename_from=None, rename_base=None, x_conn_key=self.conn_key)

    async def delete(self):
        return await gateway.delete_macro(name="face_top", base=rev(FACE), x_conn_key=self.conn_key)

    async def rename(self):
        return await gateway.put_macro(_body(FACE), name="side", base="new", rename_from="face_top",
                                       rename_base=rev(FACE), x_conn_key=self.conn_key)

    JOBS = ("save", "upload", "macro", "delete", "rename")

    def disk(self):
        return {str(p.relative_to(self.nc.parent)): p.read_bytes()
                for d in (self.nc, self.mdir) for p in sorted(d.iterdir())}

    def put_back(self, disk):
        for d in (self.nc, self.mdir):
            for p in d.iterdir():
                p.unlink()
        for name, data in disk.items():
            (self.nc.parent / name).write_bytes(data)

    def run_job(self, name):
        async def run():
            gateway._source_lock = None
            try:
                return await getattr(self, name)()
            except HTTPException as e:
                return {"http": e.status_code, "detail": e.detail}
        return asyncio.run(run())

    def polls_of(self, name, at=0, hook=None):
        """The job's answer and how many controller reads its commit made;
        `hook` runs in the `at`-th."""
        stat = current().stat
        polls, real = [], stat.poll

        def poll():
            polls.append(1)
            if len(polls) == at:
                hook()
            return real()
        with patch.object(stat, "poll", poll):
            return self.run_job(name), len(polls)

    def test_lost_at_the_last_poll(self):
        def disarm():
            self.writer.armed = False

        def disconnect():
            for k in [k for k, c in gateway._clients.items() if c is self.writer]:
                gateway._clients.pop(k)
        key = next(k for k, c in gateway._clients.items() if c is self.writer)
        for what, do, why in (("disarm", disarm, NOT_ARMED), ("disconnect", disconnect, gateway.CONN_UNKNOWN)):
            for name in self.JOBS:
                with self.subTest(what, job=name):
                    before = self.disk()
                    r, n = self.polls_of(name)         # unchanged: it commits, n controller reads
                    self.assertTrue(r.get("ok"), r)
                    self.put_back(before)
                    r, _n = self.polls_of(name, n, do)
                    after = self.disk()
                    self.put_back(before)
                    gateway._clients[key] = self.writer
                    self.writer.armed = True
                    self.assertEqual(after, before, (name, r))
                    self.assertEqual(r.get("http"), 409, (name, r))
                    self.assertIn(why, json.dumps(r["detail"], ensure_ascii=False))

    def lost_after(self, reader, name):
        """The job's answer with the writer disarmed by the LAST `reader` of
        its commit (a rename reads two files); the disk unchanged, put back."""
        before, real, calls = self.disk(), getattr(gateway, reader), []

        def read(*a, **k):
            got = real(*a, **k)
            calls.append(1)
            if len(calls) == (2 if name == "rename" else 1):
                self.writer.armed = False
            return got
        with patch.object(gateway, reader, read):
            r = self.run_job(name)
        after = self.disk()
        self.put_back(before)
        self.writer.armed = True
        self.assertEqual(after, before, (name, r))
        self.assertEqual(r.get("http"), 409, (name, r))
        self.assertIn(NOT_ARMED, json.dumps(r["detail"], ensure_ascii=False))

    def test_lost_while_the_commit_reads_its_files(self):
        for name, reader in (("save", "_program_name_refusal"), ("upload", "_program_name_refusal"),
                             ("macro", "_file_revision"), ("delete", "_file_revision"), ("rename", "_file_revision")):
            with self.subTest(name):
                self.lost_after(reader, name)

    def test_a_taken_old_name_hides_no_lost_writer(self):
        # a delete and a rename keep going past "the name is a program's":
        # the writer's refusal must not stand behind it
        (self.nc / "face_top.ngc").write_text("G0\n")
        for name in ("delete", "rename"):
            with self.subTest(name):
                self.lost_after("_file_revision", name)

    def test_no_path_read_between_the_decision_and_the_file(self):
        # which parse reads this file (its paths resolved) is asked before the
        # admission, not between it and the file
        order = []
        real_admit, real_effect = gateway._write_admission_refusal, gateway._file_publish_effect

        def admit(*a, **k):
            order.append("admission")
            return real_admit(*a, **k)

        def effect(path):
            order.append("paths")
            return real_effect(path)
        for name in self.JOBS:
            with self.subTest(name):
                before = self.disk()
                order.clear()
                with patch.object(gateway, "_write_admission_refusal", admit), \
                        patch.object(gateway, "_file_publish_effect", effect):
                    r = self.run_job(name)
                self.put_back(before)
                self.assertTrue(r.get("ok"), r)
                # (a rename's publish includes the old name's end, its own effect)
                self.assertEqual(order, ["paths"] + ["admission"] * order.count("admission")
                                 + (["paths"] if name == "rename" else []), name)

    def test_a_parse_that_begins_behind_the_path_reads_is_an_input(self):
        # the paths are read before the admission: a parse of this very file
        # that begins while the admission reads must still see its effect
        real = gateway._write_admission_refusal

        def admitted_then_parsed(*a, **k):
            why = real(*a, **k)
            gateway._bulk.inflight = {"file": str(self.prog)}
            return why
        for begins in (False, True):
            with self.subTest(begins=begins):
                before, gen = self.disk(), gateway._calc_gen.snapshot()
                with patch.object(gateway._bulk, "inflight", None), patch.object(gateway._bulk, "last_file", None), \
                        patch.object(gateway, "_write_admission_refusal", admitted_then_parsed if begins else real):
                    r = self.run_job("save")
                self.put_back(before)
                self.assertTrue(r.get("ok"), r)
                self.assertEqual(gateway._calc_gen.snapshot() != gen, begins, "the generation moved with the file")

    def test_unchanged_each_commits(self):
        for name in self.JOBS:
            with self.subTest(name):
                (self.mdir / "face_top.ngc").write_text(FACE)
                (self.mdir / "side.ngc").unlink(missing_ok=True)
                before = self.disk()
                r = self.run_job(name)
                self.assertTrue(r.get("ok"), r)
                self.assertNotEqual(self.disk(), before)


# ---- MT-I41: the reload and its confirmation are the owner's ------------------

class TestMTI41TheReloadIsTheOwners(_Commit):

    def written(self, do):
        """`do` right after the table file was replaced."""
        real = gateway.write_tool_table

        def write(*a):
            data = real(*a)
            do()
            return data
        return patch.object(gateway, "write_tool_table", write)

    def before_the_nml(self, do, cut=None):
        """`do` right before the reload reaches its write thread (after its
        Link was taken); `cut` = inside the thread, at its admission."""
        real = gateway._cmd_blocking

        async def cmd(conn, command, *a, **kw):
            if command.name == "load_tool_table":
                do()
            return await real(conn, command, *a, **kw)
        return patch.object(gateway, "_cmd_blocking", cmd)

    def confirming(self, do):
        """`do` while the reload is being confirmed."""
        real, done = gateway._tool_job_compare, []

        def compare(job):
            if not done:
                done.append(1)
                do()
            return real(job)
        return patch.object(gateway, "_tool_job_compare", compare)

    def no_other_controller(self, r):
        self.assertEqual([c.loads for c in self.others], [0] * len(self.others), f"no other controller was asked: {r}")
        job = gateway._tool_write_job
        self.assertIsNot(job.link, None)
        self.assertIs(job.link, self.link0, "the job stays its own write's")
        self.assertEqual(set(self.libraries()), {INI}, "the metadata under the write's configuration")

    def not_sent(self, at, run, tools, library):
        for what, do in self.changes().items():
            with self.subTest(what):
                self.fresh()
                with at(do), patch.object(gateway, "TOOL_RELOAD_WAIT_S", .05), \
                        patch.object(gateway, "TOOL_RELOAD_POLL_S", .002):
                    r = run()
                self.assertEqual((r["ok"], r.get("reload")), (True, "reload not sent"), r)
                self.assertEqual(self.io.loads, 0, "nor the old one, gone or not named any more")
                self.no_other_controller(r)
                self.assertEqual(self.tools(), tools)
                self.assertEqual(self.libraries()[INI], library)
                self.assertIn("tools.reload_not_sent", self.event_names())

    def test_nothing_is_sent_again_after_a_reconnect(self):
        # the loop goes on past the answer (the watch too), the same instance
        # back on a Link: the reload that was not sent stays unsent; one that
        # was sent is not sent again
        async def run(job, sent):
            gateway._cmd_lock = None
            self.io.immediate = not sent
            seq0 = gateway._tool_write_seq
            watch = asyncio.ensure_future(gateway._tool_table_watch_loop())
            task = asyncio.ensure_future(job())
            if sent:                       # the job waits for LinuxCNC: the Link goes now
                while gateway._tool_write_seq == seq0 or gateway._get_cmd_lock().locked():
                    await asyncio.sleep(.001)
                swap_connection(None)
            await task
            await gateway._tool_write_job.task
            self.restored()
            await asyncio.sleep(.1)
            watch.cancel()

        async def edit():
            await gateway._execute_client_command(901, self.writer, None, WITH_METADATA["add_tool"][0](self))
        for job in (edit, self.imported):
            for sent in (False, True):
                with self.subTest(job.__name__, sent=sent):
                    self.fresh()
                    lost = contextlib.nullcontext() if sent else self.written(lambda: swap_connection(None))
                    with lost, patch.object(gateway, "TOOL_TABLE_WATCH_S", .01), \
                            patch.object(gateway, "TOOL_RELOAD_POLL_S", .002):
                        asyncio.run(run(job, sent))
                    self.io.immediate = True
                    self.assertEqual(gateway._tool_write_job.outcome, "controller changed" if sent else "reload not sent")
                    self.assertEqual(self.io.loads, int(sent), "no retry after a reconnect")

    def import_result(self):
        self.fresh()
        self.run_import()
        return self.tools(), self.libraries()[INI]

    def test_an_import_whose_link_changed_after_its_file_commit(self):
        self.not_sent(self.written, self.run_import, *self.import_result())

    def test_an_import_whose_link_changed_before_the_nml_write(self):
        self.not_sent(self.before_the_nml, self.run_import, *self.import_result())

    def edit(self):
        return self.send(WITH_METADATA["add_tool"][0](self))

    def test_an_edit_whose_link_changed_after_its_file_commit(self):
        self.not_sent(self.written, self.edit, {1: 50.0, 2: 47.690467, 3: 22.0, 7: 1.0}, WITH_METADATA["add_tool"][1])

    def test_an_edit_whose_link_changed_before_the_nml_write(self):
        self.not_sent(self.before_the_nml, self.edit, {1: 50.0, 2: 47.690467, 3: 22.0, 7: 1.0},
                      WITH_METADATA["add_tool"][1])

    def test_a_change_while_it_is_confirmed_proves_nothing(self):
        for run in (self.run_import, self.edit):
            for what, do in self.changes().items():
                with self.subTest(what, run=run.__name__):
                    self.fresh()
                    with self.confirming(do):
                        r = run()
                    self.assertEqual((r["ok"], r.get("reload")), (True, "controller changed"),
                                     f"never 'confirmed' by another controller's table: {r}")
                    self.assertEqual(self.io.loads, 1)
                    self.no_other_controller(r)

    def test_a_configuration_that_changed_on_the_same_link_proves_nothing(self):
        for run in (self.run_import, self.edit):
            with self.subTest(run.__name__):
                self.fresh()
                self.addCleanup(setattr, self.conn.stat, "ini_filename", INI)
                with self.confirming(lambda: setattr(self.conn.stat, "ini_filename", "/cfg/other.ini")):
                    r = run()
                self.conn.stat.ini_filename = INI
                self.assertEqual((r["ok"], r.get("reload")), (True, "controller changed"), r)

    def test_unchanged_it_is_confirmed_and_the_import_says_so(self):
        self.fresh()
        r = self.run_import()
        self.assertEqual(r, {"ok": True, "added": 1, "skipped": 0, "reload": "confirmed"})
        self.assertEqual(self.io.loads, 1)

    def test_the_import_names_an_unconfirmed_reload(self):
        self.fresh()
        self.io.immediate = False
        with patch.object(gateway, "TOOL_RELOAD_WAIT_S", .03), patch.object(gateway, "TOOL_RELOAD_POLL_S", .002):
            r = self.run_import()
        self.io.immediate = True
        self.assertEqual((r["ok"], r.get("reload")), (True, "unconfirmed"), r)

    def test_the_watch_baseline_is_the_owners(self):
        # after the commit the gateway names another configuration: its table
        # and its instance are none of this write's
        other = self.dir / "other.tbl"
        other.write_text("T99 P99 Z99 D9 ;\n")

        def swapped():
            stack.append(patch.object(gateway, "get_tool_tbl_path", lambda: str(other)))
            for p in stack:
                p.start()
            gateway._bound_instance = (222, 222)
        for run in (self.run_import, self.edit):
            with self.subTest(run.__name__):
                self.fresh()
                stack = []
                base = ("base",)
                gateway._tool_table_watch["sig"] = base
                try:
                    with self.written(swapped):
                        r = run()
                finally:
                    for p in stack:
                        p.stop()
                self.assertTrue(r["ok"], r)
                self.assertEqual(gateway._tool_table_watch["sig"], base, "never another configuration's baseline")

    def test_the_changer_is_the_owners(self):
        # whether rule R applies is the owner's configuration's, not the one
        # read when the reload is confirmed
        for run in (self.run_import, self.edit):
            with self.subTest(run.__name__):
                self.fresh()
                random = patch.object(gateway, "_tool_table_scope", lambda: tool_proof.SCOPE_RANDOM)
                try:
                    with self.written(random.start):
                        r = run()
                finally:
                    random.stop()
                self.assertEqual((r["ok"], r.get("reload")), (True, "confirmed"), f"the owner's changer: {r}")

    def test_an_unchanged_owners_write_is_the_watchs_baseline(self):
        for run in (self.run_import, self.edit):
            with self.subTest(run.__name__):
                self.fresh()
                gateway._tool_table_watch["sig"] = ("base",)
                self.assertTrue(run()["ok"])
                self.assertEqual(gateway._tool_table_watch["sig"], gateway._tool_table_file_sig(str(self.table)))


# ---- MT-I42: the rest of a written table --------------------------------------

class TestMTI42TheRestOfAWrittenTable(_Commit):

    def failures(self):
        """What a reload can end as: (its patch, the outcome's word, sent)."""
        real = gateway._cmd_blocking

        def lost(do):
            async def cmd(conn, command, *a, **kw):
                if command.name == "load_tool_table":
                    do()
                return await real(conn, command, *a, **kw)
            return lambda: patch.object(gateway, "_cmd_blocking", cmd)

        async def no_thread(conn, command, *a, **kw):
            if command.name == "load_tool_table":
                raise RuntimeError("cannot schedule new futures after shutdown")
            return await real(conn, command, *a, **kw)

        def raising(e):
            return lambda: patch.object(self.io, "load_tool_table", side_effect=e)
        return {"refused: the Link went before the NML write": (lost(lambda: swap_connection(None)), "reload not sent"),
                "refused: another Link": (lost(self.another), "reload not sent"),
                "an error before the NML write": (lambda: patch.object(gateway, "_cmd_blocking", no_thread),
                                                  "reload not sent"),
                "the NML write raised": (raising(linuxcnc.error("reload write failed")), "reload failed"),
                "anything else raised in it": (raising(RuntimeError("boom")), "reload failed")}

    def jobs(self):
        out = {cmd: (lambda make=make: self.send(make(self)), library)
               for cmd, (make, library) in WITH_METADATA.items()}
        out["import"] = (self.run_import, None)
        return out

    def test_a_reload_that_did_not_happen_drops_no_metadata_and_is_said(self):
        for cmd, (run, library) in self.jobs().items():
            for what, (cut, word) in self.failures().items():
                with self.subTest(cmd, what=what):
                    self.fresh()
                    v0, before = gateway._tool_table_version, self.files()
                    with cut():
                        r = run()
                    self.assertEqual((r["ok"], r.get("reload"), r.get("metadata")), (True, word, None),
                                     f"the table IS written; its reload is named: {r}")
                    self.assertNotEqual(self.files()[0], before[0])
                    lib = self.libraries()
                    self.assertEqual(set(lib), {INI})
                    if library is not None:
                        self.assertEqual(lib[INI], library, "the edit's metadata")
                    else:
                        self.assertEqual(lib[INI]["1"]["oal"], 60, "the import's metadata")
                    self.assertEqual(gateway._tool_table_version - v0, 1, "the clients read again, once")
                    self.assertEqual(gateway._tool_write_job.outcome, word)
                    self.assertIn("tools.reload_not_sent" if word == "reload not sent" else "tools.reload_failed",
                                  self.event_names())

    def test_metadata_that_are_not_saved_are_said(self):
        for cmd, (run, _library) in self.jobs().items():
            for what, (cut, word) in {**self.failures(), "reloaded": (None, "confirmed")}.items():
                with self.subTest(cmd, what=what):
                    self.fresh()
                    v0, before = gateway._tool_table_version, self.files()
                    with patch.object(gateway, "save_tool_library", side_effect=OSError(28, "No space left on device")):
                        if cut is None:
                            r = run()
                        else:
                            with cut():
                                r = run()
                    self.assertEqual((r["ok"], r.get("reload"), r.get("metadata")), (True, word, "not saved"),
                                     f"never as if nothing was saved: {r}")
                    after = self.files()
                    self.assertNotEqual(after[0], before[0], "the table stays written — nothing is put back")
                    self.assertEqual(after[1], before[1])
                    self.assertEqual(gateway._tool_table_version - v0, 1)
                    self.assertIn("tools.metadata_not_saved", self.event_names())

    def test_a_baseline_that_is_not_read_drops_nothing(self):
        # the watch's signature of our own write stands between the reload
        # and the metadata: it is no reason to skip them
        self.fresh()
        with patch.object(gateway, "_tool_table_file_sig", side_effect=RuntimeError("boom")):
            r = self.send(WITH_METADATA["save_tool"][0](self))
        self.assertEqual((r["ok"], r.get("reload"), r.get("metadata")), (True, "confirmed", None), r)
        self.assertEqual(self.libraries(), {INI: WITH_METADATA["save_tool"][1]})

    def test_the_import_with_an_unreadable_library_says_what_is_not_saved(self):
        self.fresh()
        (self.dir / "tool_library.json").write_text("[]")
        r = self.run_import()
        self.assertEqual((r["ok"], r.get("reload"), r.get("metadata")), (True, "confirmed", "not saved"), r)
        self.assertEqual((self.dir / "tool_library.json").read_text(), "[]")

    def test_metadata_that_cannot_be_prepared_write_nothing(self):
        # an entry that is no object fails while the metadata are prepared —
        # before the table is replaced, not between it and its reload
        for cmd in ("save_tool", "renumber_tool"):
            with self.subTest(cmd):
                self.fresh()
                msg = WITH_METADATA[cmd][0](self)
                real = self.store.load

                def load(strict=False, **k):
                    got = real(strict, **k)
                    return {**got, "1": 5} if strict else got
                before = self.files()
                with patch.object(self.store, "load", load):
                    r = self.send(msg)
                self.assertFalse(r["ok"], r)
                self.assertEqual(self.files(), before, "nothing written")
                self.assertEqual(self.io.loads, 0)

    def test_the_ping_follows_the_metadata(self):
        # the version tells the clients to read: never before the library is
        # what it will be
        for what, immediate in (("loaded at once", True), ("reload failed", False)):
            with self.subTest(what):
                self.fresh()
                seen, v0 = [], gateway._tool_table_version
                real = gateway.save_tool_library

                def save(*a, **k):
                    time.sleep(0.05)
                    seen.append(gateway._tool_table_version - v0)
                    return real(*a, **k)
                with patch.object(gateway, "save_tool_library", save):
                    if immediate:
                        r = self.send(WITH_METADATA["add_tool"][0](self))
                    else:
                        with patch.object(self.io, "load_tool_table", side_effect=linuxcnc.error("x")):
                            r = self.send(WITH_METADATA["add_tool"][0](self))
                self.assertTrue(r["ok"], r)
                self.assertEqual((seen, gateway._tool_table_version - v0), ([0], 1))

    def test_the_next_read_names_the_difference_where_there_is_one(self):
        # what the Tools tab shows after it: LinuxCNC still holds the old
        # value — the read's own note names it with its way out
        self.fresh()
        with patch.object(self.io, "load_tool_table", side_effect=linuxcnc.error("x")):
            r = self.send(WITH_METADATA["save_tool"][0](self))
        self.assertEqual((r["ok"], r["reload"]), (True, "reload failed"))
        read = self.read()
        self.assertEqual((read["proof"]["state"], read["edit_refusal"]),
                         ("partial", "T1 differs from LinuxCNC — a restart loads the file"))
        self.assertEqual(next(t for t in read["tools"] if t["T"] == 1)["flutes"], 5)

    def test_a_pocket_alone_is_not_in_the_reads_proof(self):
        # why the reply's outcome needs its own words: rule R carries no
        # pocket — the read is complete while LinuxCNC holds the old one
        self.fresh()
        with patch.object(self.io, "load_tool_table", side_effect=linuxcnc.error("x")):
            r = self.send({"cmd": "save_tool", "tool_number": 1, "pocket": 8, "expected": self.expect(1)})
        self.assertEqual((r["ok"], r["reload"]), (True, "reload failed"))
        self.assertEqual(self.read()["proof"]["state"], "complete")

    # -- a cancel while the failing rest runs ------------------------------------

    def cancelled(self, job, cancels, why):
        """`job` cancelled (`cancels` times) while its reload is failing in
        its thread: (the task, the lock at each cancel, what the other
        client's stop got)."""
        reached, release = threading.Event(), threading.Event()
        other = ClientState(ip="b", ws=None, armed=True)
        gateway._clients[902] = other

        def load():
            reached.set()
            if not release.wait(5):
                raise AssertionError("never released")
            raise linuxcnc.error("reload write failed")

        async def run():
            gateway._cmd_lock = None
            task = asyncio.ensure_future(job())
            self.writer.cmd_inflight, self.writer.cmd_inflight_task = "save_tool", task
            self.writer.cmd_inflight_since_mono = time.monotonic()
            try:
                self.assertTrue(await asyncio.to_thread(reached.wait, 5))
                locked = []
                stop = None
                for i in range(cancels):
                    if i == 0 and why:
                        gateway._preempt_inflight(why, 902)
                        stop = asyncio.ensure_future(gateway.handle_command({"cmd": why}, True, other.conn_key))
                    else:
                        task.cancel()
                    await asyncio.sleep(0.02)
                    locked.append(gateway._get_cmd_lock().locked())
                self.assertTrue(stop is None or not stop.done(), "behind the section, not inside it")
            finally:
                release.set()
            t0 = time.monotonic()
            got = await asyncio.wait_for(stop, 4.0) if stop is not None else None
            took = time.monotonic() - t0
            await asyncio.wait({task})
            return task, locked, got, took
        with patch.object(self.io, "load_tool_table", load), \
                patch.object(gateway, "TOOL_RELOAD_WAIT_S", 5.0), \
                patch.object(gateway, "_hal_send", lambda *_a, **_k: None), \
                patch.object(gateway, "_estop_hold", gateway._estop_hold):
            out = asyncio.run(run())
        gateway._clients.pop(902, None)
        return out

    def test_an_abort_of_another_client_and_a_second_cancel(self):
        for cancels in (1, 2):
            with self.subTest(cancels=cancels):
                self.fresh()
                self.replies.clear()
                msg, v0 = WITH_METADATA["save_tool"][0](self), gateway._tool_table_version
                task, locked, stop, took = self.cancelled(
                    lambda: gateway._execute_client_command(901, self.writer, None, msg), cancels, "abort")
                self.assertEqual(locked, [True] * cancels, "the lock until the section ended")
                self.assertTrue(stop["ok"], stop)
                self.assertLess(took, 2.0, "the stop right behind it — no wait for LinuxCNC under the lock")
                self.assertFalse(task.cancelled(), "a written table never answers 'Preempted'")
                r = self.replies[-1]
                self.assertEqual((r["ok"], r["reload"]), (True, "reload failed"), r)
                self.assertEqual(self.tools()[1], 49.0)
                self.assertEqual(self.libraries(), {INI: WITH_METADATA["save_tool"][1]}, "the metadata of the edit")
                self.assertEqual(gateway._tool_table_version - v0, 1)

    def test_a_cancelled_import_request(self):
        for cancels in (1, 2):
            with self.subTest(cancels=cancels):
                self.fresh()
                v0 = gateway._tool_table_version
                task, locked, _stop, _took = self.cancelled(self.imported, cancels, None)
                self.assertEqual(locked, [True] * cancels, "the lock until the section ended")
                self.assertTrue(task.cancelled(), "the request is gone: nobody to answer")
                self.assertEqual(self.libraries()[INI]["1"]["oal"], 60, "the metadata of the import")
                self.assertEqual(gateway._tool_table_version - v0, 1)

    def test_an_abort_in_a_refused_edit_answers_preempted(self):
        # nothing was written: the cancel goes on as before
        self.fresh()
        reached, release = threading.Event(), threading.Event()
        real = gateway._stat_tool_table
        calls = []

        def table(*a, **k):
            calls.append(1)
            if len(calls) == 2:
                reached.set()
                release.wait(5)
                self.writer.armed = False
            return real(*a, **k)

        async def run():
            gateway._cmd_lock = None
            task = asyncio.ensure_future(gateway._execute_client_command(
                901, self.writer, None, WITH_METADATA["save_tool"][0](self)))
            self.assertTrue(await asyncio.to_thread(reached.wait, 5))
            task.cancel()
            await asyncio.sleep(0.02)
            release.set()
            await asyncio.wait({task})
            return task
        before = self.files()
        with patch.object(gateway, "_stat_tool_table", table):
            task = asyncio.run(run())
        self.assertTrue(task.cancelled())
        self.assertEqual(self.files(), before)

    def test_a_disconnect_while_the_table_is_written_ends_quietly(self):
        # the client is gone: its section ends (table, reload, metadata, job),
        # the answer it would have got goes nowhere — and nothing is left
        # unretrieved (the worker's own done-callback)
        self.fresh()
        reached, release = threading.Event(), threading.Event()
        real, lost = gateway.write_tool_table, []

        def write(*a):
            reached.set()
            release.wait(5)
            return real(*a)

        async def gone(_ws, _m):
            raise gateway.WebSocketDisconnect()

        async def run():
            gateway._cmd_lock = None
            asyncio.get_running_loop().set_exception_handler(lambda _l, ctx: lost.append(ctx))
            task = asyncio.ensure_future(gateway._execute_client_command(
                901, self.writer, None, WITH_METADATA["save_tool"][0](self)))
            task.add_done_callback(gateway._retrieve_task_exc)
            self.assertTrue(await asyncio.to_thread(reached.wait, 5))
            gateway._clients.pop(901)              # the cleanup's first step, then the worker's cancel
            task.cancel()
            await asyncio.sleep(0.02)
            self.assertTrue(gateway._get_cmd_lock().locked())
            release.set()
            await asyncio.wait({task})
            job = gateway._tool_write_job
            await job.task
            del task
            gc.collect()
            await asyncio.sleep(0)
            return job, gateway._get_cmd_lock().locked()
        with patch.object(gateway, "write_tool_table", write), patch.object(gateway, "ws_send_json", gone):
            job, locked = asyncio.run(run())
        self.assertEqual((locked, job.outcome, lost), (False, "confirmed", []))
        self.assertEqual((self.tools()[1], self.libraries()), (49.0, {INI: WITH_METADATA["save_tool"][1]}))

    def test_a_cancel_while_the_table_is_written_answers_the_write(self):
        # the cancel lands in the section before LinuxCNC was asked: the
        # section goes on, and the answer is the written table's
        self.fresh()
        self.replies.clear()
        reached, release = threading.Event(), threading.Event()
        real = gateway.write_tool_table

        def write(*a):
            reached.set()
            release.wait(5)
            return real(*a)

        async def run():
            gateway._cmd_lock = None
            task = asyncio.ensure_future(gateway._execute_client_command(
                901, self.writer, None, WITH_METADATA["save_tool"][0](self)))
            self.assertTrue(await asyncio.to_thread(reached.wait, 5))
            task.cancel()
            await asyncio.sleep(0.02)
            release.set()
            await asyncio.wait({task})
            job = gateway._tool_write_job
            await job.task
            return task, job
        with patch.object(gateway, "write_tool_table", write):
            task, job = asyncio.run(run())
        self.assertFalse(task.cancelled())
        self.assertEqual((self.replies[-1]["ok"], self.replies[-1]["reload"]), (True, "not awaited"))
        self.assertEqual((self.io.loads, job.outcome), (1, "confirmed"), "the job goes on")
        self.assertEqual(self.libraries(), {INI: WITH_METADATA["save_tool"][1]})


if __name__ == "__main__":
    unittest.main()
