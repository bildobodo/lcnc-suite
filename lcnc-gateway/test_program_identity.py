"""P2b-F1-1 (Codex R449 MT449-02, R450 MT450-01/C1/C2, R451): the program
IDENTITY end to end on the gateway side.

- Every load is a new identity `<epoch>.<gen>` — the same path again and
  A→B→A too; none while no program is proven (the load window, a refused
  load, an unconfirmed file); a restored record is no own load.
- Every publication names the identity it was spawned under; "the same
  program" is that identity, never the path.
- The load edge is the identity: a reload of the same path parses its own.
- The own load's exception skips the quiet window only, never the run or a
  move; every unpinned job checks a CURRENT controller read at its begin.
- GET /preview serves ONE tuple and answers 409 for another pair.
- A connect never schedules a parse."""
import ast
import asyncio
import inspect
import os
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()
import gateway  # noqa: E402
from bulk_pipeline import BulkPipeline  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from gateway_util import LoadedProgram, preview_file_changed, preview_file_edge_action  # noqa: E402
from link_fixture import connect_fake, current  # noqa: E402


def _load(prog: LoadedProgram, path: str, gen: int, now: float = 0.0) -> None:
    """A load through LoadedProgram's own steps: requested, its generation
    noted in the write thread, the open observed in STAT.file."""
    prog.request_load(path, now, before=prog.loaded)
    prog.note_load_gen(gen)
    prog.confirm_open(True)
    prog.update(path, True, now + 0.1)


class TheLoadIdentity(unittest.TestCase):

    def test_every_load_is_a_new_identity_the_same_path_and_aba_too(self):
        p = LoadedProgram()
        p.update(None, True, 0.0)
        ids = []
        for gen, path in ((1, "/a.ngc"), (2, "/a.ngc"), (3, "/b.ngc"), (4, "/a.ngc")):
            _load(p, path, gen)
            ids.append(p.program_id("E"))
        self.assertEqual(ids, ["E.1", "E.2", "E.3", "E.4"], "A, A again, B, A: four loads")
        self.assertTrue(p.loaded_own)

    def test_no_identity_while_no_program_is_proven(self):
        p = LoadedProgram()
        p.update(None, True, 0.0)
        _load(p, "/a.ngc", 1)
        self.assertEqual(p.program_id("E"), "E.1")
        p.request_load("/b.ngc", 1.0, before="/a.ngc")
        p.note_load_gen(2)
        self.assertIsNone(p.program_id("E"), "the load window: no program proven")
        p.confirm_open(False)
        self.assertIsNone(p.program_id("E"), "a refused load")
        p2 = LoadedProgram()
        p2.update("/sub.ngc", True, 0.0)
        self.assertIsNone(p2.program_id("E"), "an unconfirmed open file")

    def test_a_restored_record_is_no_own_load(self):
        p = LoadedProgram()
        p.gen_now = lambda: 0
        p.restore("/a.ngc")
        p.update("/a.ngc", True, 0.0)
        self.assertEqual(p.program_id("E"), "E.0")
        self.assertFalse(p.loaded_own, "restored: its first parse is a restart")

    def test_unload_and_an_empty_interpreter_end_the_identity(self):
        p = LoadedProgram()
        p.update(None, True, 0.0)
        _load(p, "/a.ngc", 1)
        p.request_unload()
        self.assertIsNone(p.program_id("E"))
        _load(p, "/a.ngc", 2)
        p.update(None, True, 5.0)
        self.assertIsNone(p.program_id("E"))


class TheIdentityEdge(unittest.TestCase):

    def test_the_edge_is_the_identity_then_the_path_and_mtime(self):
        f = preview_file_changed
        self.assertTrue(f("/a.ngc", 1.0, "/a.ngc", 1.0, "E.2", "E.1"), "the same path reloaded: a new load")
        self.assertFalse(f("/a.ngc", 1.0, "/a.ngc", 1.0, "E.2", "E.2"), "its own publication: no edge")
        self.assertTrue(f("/a.ngc", 2.0, "/a.ngc", 1.0, "E.2", "E.2"), "within one program: the mtime edge")
        self.assertFalse(f("/a.ngc", 1.0, "/b.ngc", 1.0, None, "E.1"), "no program proven: no edge")
        self.assertFalse(f(None, None, "/a.ngc", 1.0, None, "E.1"))

    def test_the_load_window_schedules_nothing(self):
        # a reparse request standing while the load window runs: the edge
        # action sees no active file (gateway: st.active_file if st.program_id)
        self.assertIsNone(preview_file_edge_action(False, True, False, None, None, 1.0))

    def test_the_poller_passes_the_identity(self):
        src = inspect.getsource(gateway._status_poller)
        self.assertIn("preview_file_changed(st.active_file, _cur_mtime, _bulk.last_file, _bulk.last_mtime,\n"
                      "                                                _pid, _bulk.published_program)", src)
        self.assertIn("_bulk.inflight, st.active_file if st.program_id else None, _cur_mtime)", src)


def _pipeline(tmp: str, admit=None):
    ini = os.path.join(tmp, "m.ini")
    Path(ini).write_text("[EMC]\n")
    b = BulkPipeline(get_stat=lambda: types.SimpleNamespace(ini_filename=ini),
                     get_machine_units=lambda: "mm", build_wcs_rotation_patches=lambda: {})
    b.generation = gateway_util_generation()
    b.epoch = "E"
    b.admit_begin = admit
    return b


def gateway_util_generation():
    from calc_lifetime import Generation
    return Generation()


def _worker(calls):
    def worker(ctx_bytes, timeout):
        calls.append(ctx_bytes)
        return (0, b"x" * 8, b"__SCHEMA__\t8\n")
    return worker


class ThePublicationNamesItsLoad(unittest.TestCase):

    def test_stamped_with_the_spawn_generation_and_foreign_after_a_reload(self):
        with tempfile.TemporaryDirectory() as tmp:
            ngc = os.path.join(tmp, "p.ngc")
            Path(ngc).write_text("G0 X1\nM2\n")
            b = _pipeline(tmp)
            b.generation.new_program("load")          # E.1
            active = {"id": "E.1"}
            b.get_active_program = lambda: active["id"]
            calls = []
            b._run_gcode_worker_blocking = _worker(calls)
            asyncio.run(b.refresh_gcode_preview(ngc))
            self.assertEqual(b.published_program, "E.1")
            self.assertEqual(b.preview_origin_status()["program_id"], "E.1")
            self.assertEqual(b.preview_served[:2], (b.preview_version, "E.1"))
            self.assertTrue(b.published_is_active())
            # the same path loaded again: E.2 — the old publication is foreign
            b.generation.new_program("load")
            active["id"] = "E.2"
            self.assertFalse(b.published_is_active())
            ok, why = b.run_start_check(ngc, types.SimpleNamespace(), "src")
            self.assertEqual((ok, why), (False, "no publication of this program"))
            self.assertIsNone(b.pinned_ctx(ngc))
            self.assertFalse(b.refreshes_published(ngc, b.last_mtime))
            active["id"] = None
            self.assertFalse(b.published_is_active(), "null never matches")
            b.clear_preview()
            self.assertIsNone(b.published_program)
            self.assertIsNone(b.preview_served)


class TheBeginAdmission(unittest.TestCase):
    """Codex R450 MT450-01: an unpinned job checks a CURRENT controller read
    after its async steps and before its first live-basis read — a job whose
    begin lands under a run (a late begin after its schedule, a start from
    AUTO that bumped no generation) ends unpublished, named, no worker."""

    def test_a_begin_under_a_run_reads_no_basis(self):
        for why in ("running", "moving", "unread"):
            with self.subTest(why=why), tempfile.TemporaryDirectory() as tmp:
                ngc = os.path.join(tmp, "p.ngc")
                Path(ngc).write_text("G0 X1\nM2\n")
                b = _pipeline(tmp, admit=lambda w=why: w)
                stat_reads = []
                b._get_stat = lambda: stat_reads.append(1)
                calls = []
                b._run_gcode_worker_blocking = _worker(calls)
                b.refresh_running = True
                asyncio.run(b.refresh_gcode_preview(ngc, reason="file", job=7))
                self.assertEqual(calls, [], "no worker")
                self.assertEqual(stat_reads, [], "no live-basis read")
                self.assertIsNone(b.published_program, "nothing published")
                self.assertEqual(b.job_ends[7], {"why": f"refused:{why}"})
                self.assertTrue(b.reparse_pending)
                self.assertEqual(b.reparse_pending_reason, "file")
                self.assertFalse(b.refresh_running)
                self.assertIsNotNone(b.spawned_program_gen, "spawned: the next schedule is a restart")

    def test_an_admitted_begin_and_a_pinned_parse_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            ngc = os.path.join(tmp, "p.ngc")
            Path(ngc).write_text("G0 X1\nM2\n")
            b = _pipeline(tmp, admit=lambda: None)
            calls = []
            b._run_gcode_worker_blocking = _worker(calls)
            asyncio.run(b.refresh_gcode_preview(ngc))
            self.assertEqual(len(calls), 1)
            self.assertIsNotNone(b.published_program)

    def test_the_gateway_admission_reads_the_controller_now(self):
        connect_fake(self)
        S = current().stat
        S.interp_state, S.inpos, S.current_vel = linuxcnc.INTERP_IDLE, True, 0.0
        self.assertIsNone(gateway._parse_begin_refusal())
        S.interp_state = linuxcnc.INTERP_READING
        self.assertEqual(gateway._parse_begin_refusal(), "running")
        S.interp_state, S.inpos, S.current_vel = linuxcnc.INTERP_IDLE, False, 2.0
        self.assertEqual(gateway._parse_begin_refusal(), "moving")
        S.inpos, S.current_vel = True, 0.0
        with patch.object(type(current().stat), "poll", side_effect=RuntimeError("no poll")):
            self.assertEqual(gateway._parse_begin_refusal(), "unread", "a failed poll is no read")
        self.assertIs(gateway._bulk.admit_begin, gateway._parse_begin_refusal)


class TheRestoredProgramIsARestart(unittest.TestCase):

    def st(self, interp, vel=0.0):
        return types.SimpleNamespace(interp_state=interp, current_vel=vel)

    def test_a_restored_program_under_a_run_waits(self):
        prog = LoadedProgram()
        prog.gen_now = lambda: 0
        prog.restore("/a.ngc")
        prog.update("/a.ngc", False, 0.0)
        from calc_lifetime import ActionLedger
        with patch.object(gateway._status_runtime, "program", prog), \
             patch.object(gateway, "_actions", ActionLedger()), \
             patch.object(gateway._bulk, "spawned_program_gen", None), \
             patch.object(gateway._bulk, "unloading", False):
            self.assertFalse(gateway._own_load_unparsed(), "restored: no own load")
            self.assertEqual(gateway._restart_wait(self.st(linuxcnc.INTERP_READING, 1.0), True), "not_idle")

    def test_an_own_load_unparsed_is_named_by_its_generation(self):
        prog = LoadedProgram()
        prog.update(None, True, 0.0)
        _load(prog, "/a.ngc", 5)
        with patch.object(gateway._status_runtime, "program", prog), \
             patch.object(gateway._bulk, "spawned_program_gen", 4):
            self.assertTrue(gateway._own_load_unparsed())
        with patch.object(gateway._status_runtime, "program", prog), \
             patch.object(gateway._bulk, "spawned_program_gen", 5):
            self.assertFalse(gateway._own_load_unparsed(), "its parse spawned: a restart")


class ThePreviewRouteServesOneTuple(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(gateway.app)
        p = patch.object(gateway._bulk, "preview_served", (41, "E.3", None, b"payload-41"))
        p.start()
        self.addCleanup(p.stop)

    def test_the_asked_pair_or_409(self):
        r = self.client.get("/preview", params={"v": 41, "p": "E.3"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.headers["X-Preview-Version"], r.headers["X-Preview-Program"]), ("41", "E.3"))
        self.assertEqual(r.content, b"payload-41")
        for v, prog in ((40, "E.3"), (41, "E.2")):
            r = self.client.get("/preview", params={"v": v, "p": prog})
            self.assertEqual(r.status_code, 409, (v, prog))
            self.assertEqual(r.headers["Cache-Control"], "no-store")

    def test_a_publication_during_the_request_never_relabels_it(self):
        real_enter = gateway._fanout_enter

        def enter(kind):
            gateway._bulk.preview_served = (42, "E.4", None, b"payload-42")   # published meanwhile
            return real_enter(kind)
        with patch.object(gateway, "_fanout_enter", side_effect=enter):
            r = self.client.get("/preview", params={"v": 41, "p": "E.3"})
        self.assertEqual((r.status_code, r.headers["X-Preview-Version"], r.headers["X-Preview-Program"], r.content),
                         (200, "41", "E.3", b"payload-41"))

    def test_nothing_published_is_404(self):
        with patch.object(gateway._bulk, "preview_served", None):
            self.assertEqual(self.client.get("/preview", params={"v": 1}).status_code, 404)


class TheConnectNeverSchedules(unittest.TestCase):

    def test_the_websocket_endpoint_plans_no_parse(self):
        tree = ast.parse(inspect.getsource(gateway.ws_endpoint))
        calls = [ast.unparse(n) for n in ast.walk(tree)
                 if isinstance(n, ast.Call) and getattr(n.func, "attr", None) == "schedule_refresh"]
        self.assertEqual(calls, [], "the poller's edge, under its restart wait, is the one scheduler")
        src = inspect.getsource(gateway.ws_endpoint)
        self.assertIn("and _bulk.published_is_active()", src, "only the active program's publication is announced")


class TheLoadReplyNamesItsLoad(unittest.TestCase):

    def test_the_reply_names_the_generation_its_load_began_under(self):
        src = inspect.getsource(gateway._cmds_files_and_probing)
        self.assertIn('"program_id": f"{_TRIP_EPOCH}.{_lg}" if _lg is not None else None', src)
        self.assertIn("_status_runtime.program.note_load_gen(gen[0])", inspect.getsource(gateway._program_began))


if __name__ == "__main__":
    unittest.main()
