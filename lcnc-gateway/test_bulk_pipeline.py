"""Unit tests for bulk_pipeline (M4) — publication contracts and file readers.

Temp dirs stand in for the LinuxCNC config dir; no gateway import. The parse
worker and fusion worker subprocesses have their own round-trip coverage in
test_command_dispatch (TestTerminateParseProc / TestFusionWorkerSubprocess).
"""
import asyncio
import json
import os
import tempfile
import types
import unittest

from bulk_pipeline import BulkPipeline, ctx_digest
from gateway_util import program_source


def _pipeline(ini_path=None):
    stat = types.SimpleNamespace(ini_filename=ini_path) if ini_path else None
    return BulkPipeline(
        get_stat=lambda: stat,
        get_machine_units=lambda: "mm",
        build_wcs_rotation_patches=lambda: {},
    )


class TestPreviewContract(unittest.TestCase):
    def test_preview_available_matrix(self):
        b = _pipeline()
        self.assertFalse(b.preview_available())
        b.preview_bytes = b"raw"
        self.assertTrue(b.preview_available())
        b.preview_bytes = None
        b.preview_bytes_gz = b"gz"
        self.assertTrue(b.preview_available())

    def test_clear_preview_drops_everything_then_bumps_once(self):
        b = _pipeline()
        b.preview_pending = {"file": "/x.ngc"}
        b.preview_bytes_gz = b"gz"
        b.last_file = "/x.ngc"
        b.last_mtime = 1.0
        b.published_schema = 1
        b.schema_reparse_attempted = ("/x.ngc", 1.0)
        b.published_tlo = {"table_mtime": 1.0, "tlos": []}
        v0 = b.preview_version
        b.clear_preview()
        self.assertIsNone(b.preview_pending)
        self.assertIsNone(b.preview_bytes)
        self.assertIsNone(b.preview_bytes_gz)
        self.assertIsNone(b.last_file)
        self.assertIsNone(b.last_mtime)
        self.assertIsNone(b.published_schema)
        self.assertIsNone(b.schema_reparse_attempted)
        self.assertIsNone(b.published_tlo)
        self.assertEqual(b.preview_version, v0 + 1)

    def test_versions_seeded_nonzero(self):
        # ?v= URLs must not collide across restarts — seeded from wall clock.
        b = _pipeline()
        self.assertGreater(b.preview_version, 0)
        self.assertGreater(b.surface_version, 0)
        self.assertGreater(b.grid_version, 0)


class TestSchemaStampRecording(unittest.TestCase):
    """The published payload's wire-format stamp (P1) is parsed from the
    worker's `__SCHEMA__` stderr line — the stdout payload is passthrough
    bytes the pipeline must never decode. Absent/malformed lines record None
    (honest legacy signal for the poller edge and the client banner), never a
    guessed value."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ini = os.path.join(self.tmp.name, "m.ini")
        open(self.ini, "w").write("[EMC]\n")
        self.ngc = os.path.join(self.tmp.name, "p.ngc")
        open(self.ngc, "w").write("G0 X1\nM2\n")

    def tearDown(self):
        self.tmp.cleanup()

    def _refresh(self, stderr: bytes):
        b = _pipeline(self.ini)
        b._run_gcode_worker_blocking = (
            lambda ctx_bytes, timeout: (0, b"\x81\xa4file\xc0", stderr))
        asyncio.run(b.refresh_gcode_preview(self.ngc))
        return b

    def test_schema_line_recorded_at_publish(self):
        b = self._refresh(b"__SCHEMA__\t7\nworker total_ms=1\n")
        self.assertTrue(b.preview_available())
        self.assertEqual(b.published_schema, 7)
        self.assertEqual(b.last_file, self.ngc)

    def test_tlo_line_recorded_at_publish(self):
        b = self._refresh(
            b'__TLO__\t{"table_path": "/cfg/tool.tbl", "table_mtime": 5.0,'
            b' "tlos": [[3, 0.0, 0.0, 156.5596]]}\n__SCHEMA__\t3\n')
        self.assertEqual(b.published_tlo["table_mtime"], 5.0)
        self.assertEqual(b.published_tlo["tlos"], [[3, 0.0, 0.0, 156.5596]])

    def test_tlo_line_with_diameter_column_records_five_tuples(self):
        # Schema 8: parse_tlos rows carry a diameter column; the pipeline
        # passes rows through untouched (the drift edge indexes by position).
        b = self._refresh(
            b'__TLO__\t{"table_path": "/cfg/tool.tbl", "table_mtime": 5.0,'
            b' "tlos": [[3, 0.0, 0.0, 22.0, 6.0]]}\n__SCHEMA__\t8\n')
        self.assertEqual(b.published_tlo["tlos"], [[3, 0.0, 0.0, 22.0, 6.0]])
        self.assertEqual(b.published_schema, 8)

    def test_tlo_line_records_applied_and_loaded_tool(self):
        # TWP-09: the parse-time APPLIED offset + loaded tool ride the meta
        # (passthrough — the drift edge reads them by key).
        b = self._refresh(
            b'__TLO__\t{"table_path": "/cfg/tool.tbl", "table_mtime": 5.0,'
            b' "tlos": [[3, 0.0, 0.0, 22.0, 6.0]], "applied_tlo": [0.0, 0.0, 20.0],'
            b' "loaded_tool": 3}\n__SCHEMA__\t8\n')
        self.assertEqual(b.published_tlo["applied_tlo"], [0.0, 0.0, 20.0])
        self.assertEqual(b.published_tlo["loaded_tool"], 3)

    def test_rotcmd_line_recorded_at_publish(self):
        b = self._refresh(
            b'__ROTCMD__\t{"A": 12, "B": null, "C": null, "unknown": null,'
            b' "seed": {"A": 0.0, "B": 0.0, "C": 0.0}}\n__SCHEMA__\t8\n')
        self.assertEqual(b.published_rotary_cmd,
                         {"A": 12, "B": None, "C": None, "unknown": None,
                          "seed": {"A": 0.0, "B": 0.0, "C": 0.0}})

    def test_limits_line_recorded_at_publish(self):
        b = self._refresh(
            b'__LIMITS__\t{"source": "live", "limits": {"X": [-1500.0, 1500.0]}}\n__SCHEMA__\t8\n')
        self.assertEqual(b.published_limits, {"source": "live", "limits": {"X": [-1500.0, 1500.0]}})

    def test_malformed_limits_line_records_none_and_publishes(self):
        b = self._refresh(b"__LIMITS__\t{broken\n__SCHEMA__\t8\n")
        self.assertIsNone(b.published_limits)
        self.assertEqual(b.published_schema, 8)

    def test_malformed_rotcmd_line_records_none_and_publishes(self):
        b = self._refresh(b"__ROTCMD__\t{broken\n__SCHEMA__\t8\n")
        self.assertIsNone(b.published_rotary_cmd)
        self.assertEqual(b.published_schema, 8)

    def test_malformed_tlo_line_records_none(self):
        b = self._refresh(b"__TLO__\t{broken json\n")
        self.assertTrue(b.preview_available())
        self.assertIsNone(b.published_tlo)

    def test_absent_schema_line_records_none(self):
        b = self._refresh(b"worker total_ms=1\n")
        self.assertTrue(b.preview_available())   # legacy publish still lands
        self.assertIsNone(b.published_schema)

    def test_malformed_schema_line_records_none(self):
        b = self._refresh(b"__SCHEMA__\tnot-an-int\n")
        self.assertTrue(b.preview_available())
        self.assertIsNone(b.published_schema)

    def _refresh_recording(self, stderr: bytes):
        import lcnc_trace
        events = []
        real = lcnc_trace.emit

        def rec(tag, level="info", msg="", **fields):
            events.append((tag, dict(fields)))
            return real(tag, level, msg, **fields)
        lcnc_trace.emit = rec
        try:
            b = self._refresh(stderr)
        finally:
            lcnc_trace.emit = real
        return b, events

    def test_refused_line_traces_parse_refused(self):
        # A remap refusal in preview: the payload carries parse_refused (the
        # operator's banner); the __REFUSED__ stderr twin becomes the trace.
        b, ev = self._refresh_recording(
            b"__REFUSED__\t12\tG68.3 ERROR: Must be in G54 to define TWP.\n__SCHEMA__\t8\n")
        self.assertTrue(b.preview_available())   # an EMPTY success still publishes
        hits = [f for t, f in ev if t == "gcode.parse_refused"]
        self.assertEqual(len(hits), 1, ev)
        self.assertEqual(hits[0].get("line"), "12")
        self.assertEqual(hits[0].get("message"), "G68.3 ERROR: Must be in G54 to define TWP.")
        self.assertEqual(hits[0].get("file"), self.ngc)

    def test_partial_line_traces_parse_partial(self):
        b, ev = self._refresh_recording(b"__PARTIAL__\t7\tUnknown g code used\n__SCHEMA__\t8\n")
        self.assertTrue(b.preview_available())
        hits = [f for t, f in ev if t == "gcode.parse_partial"]
        self.assertEqual(len(hits), 1, ev)
        self.assertEqual((hits[0].get("error_line"), hits[0].get("error")), ("7", "Unknown g code used"))

    def test_failed_worker_leaves_prior_stamp(self):
        b = _pipeline(self.ini)
        b.published_schema = 3
        b._run_gcode_worker_blocking = (
            lambda ctx_bytes, timeout: (1, b"", b"__SCHEMA__\t9\n"))
        asyncio.run(b.refresh_gcode_preview(self.ngc))
        self.assertFalse(b.preview_available())
        self.assertEqual(b.published_schema, 3)  # nothing published, stamp untouched


class TestIniInvalidation(unittest.TestCase):
    def test_first_ini_only_records(self):
        b = _pipeline()
        sv, gv = b.surface_version, b.grid_version
        b.invalidate_caches_for_ini("/cfg/a.ini")
        self.assertEqual(b.caches_ini, "/cfg/a.ini")
        self.assertEqual((b.surface_version, b.grid_version), (sv, gv))

    def test_same_ini_is_noop(self):
        b = _pipeline()
        b.invalidate_caches_for_ini("/cfg/a.ini")
        sv, gv = b.surface_version, b.grid_version
        b.invalidate_caches_for_ini("/cfg/a.ini")
        self.assertEqual((b.surface_version, b.grid_version), (sv, gv))

    def test_ini_change_clears_and_bumps_both(self):
        b = _pipeline()
        b.invalidate_caches_for_ini("/cfg/a.ini")
        b.surface_pending, b.surface_bytes, b.surface_initialized = [[0, 0, 0]], b"s", True
        b.grid_pending, b.grid_bytes, b.grid_initialized = {"g": 1}, b"g", True
        sv, gv = b.surface_version, b.grid_version
        b.invalidate_caches_for_ini("/cfg/b.ini")
        self.assertIsNone(b.surface_pending)
        self.assertIsNone(b.surface_bytes)
        self.assertFalse(b.surface_initialized)
        self.assertIsNone(b.grid_pending)
        self.assertIsNone(b.grid_bytes)
        self.assertFalse(b.grid_initialized)
        self.assertEqual(b.surface_version, sv + 1)
        self.assertEqual(b.grid_version, gv + 1)
        self.assertEqual(b.caches_ini, "/cfg/b.ini")

    def test_none_ini_never_clobbers(self):
        b = _pipeline()
        b.invalidate_caches_for_ini("/cfg/a.ini")
        b.invalidate_caches_for_ini(None)
        self.assertEqual(b.caches_ini, "/cfg/a.ini")


class TestFileReaders(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ini = os.path.join(self.tmp.name, "m.ini")
        open(self.ini, "w").write("[EMC]\n")

    def tearDown(self):
        self.tmp.cleanup()

    def test_probe_results_parses_and_skips_bad_lines(self):
        with open(os.path.join(self.tmp.name, "probe-results.txt"), "w") as f:
            f.write("1.0 2.0 -0.5\nnot a point\n3.5 4.5 0.25 extra-ok\n1.0 nan-ish\n")
        pts = _pipeline(self.ini).read_probe_results_file()
        self.assertEqual(pts, [[1.0, 2.0, -0.5], [3.5, 4.5, 0.25]])

    def test_probe_results_absent_file_and_no_ini(self):
        self.assertEqual(_pipeline(self.ini).read_probe_results_file(), [])
        self.assertEqual(_pipeline(None).read_probe_results_file(), [])

    def test_comp_grid_valid_corrupt_absent(self):
        path = os.path.join(self.tmp.name, "probe-results-grid.json")
        with open(path, "w") as f:
            json.dump({"nx": 3, "ny": 2, "z": [[0, 0, 0], [1, 1, 1]]}, f)
        b = _pipeline(self.ini)
        self.assertEqual(b.read_comp_grid_file()["nx"], 3)
        open(path, "w").write("{broken json")
        self.assertIsNone(b.read_comp_grid_file())   # corrupt → None, loud trace
        os.unlink(path)
        self.assertIsNone(b.read_comp_grid_file())   # absent → None
        self.assertIsNone(_pipeline(None).read_comp_grid_file())


if __name__ == "__main__":
    unittest.main()


class TestScheduleRefresh(unittest.TestCase):
    """Single-flight scheduling (2026-08-30 reparse-hang wave): the flag has
    ONE setter, exception-safe, and an operator Reparse is a pending FLAG the
    poller honors after an in-flight parse — clearing cache keys was
    swallowed by the finishing parse rewriting them."""

    def test_schedule_sets_flag_and_clears_pending(self):
        b = _pipeline()
        b.reparse_pending = True
        spawned = []
        def spawn(coro):
            spawned.append(coro)
            return _FakeTask(coro)
        self.assertTrue(b.schedule_refresh("/p.ngc", "reparse", spawn))
        self.assertTrue(b.refresh_running)
        self.assertFalse(b.reparse_pending)
        self.assertEqual(len(spawned), 1)
        spawned[0].close()
        # second call while running is refused (single flight)
        self.assertFalse(b.schedule_refresh("/p.ngc", "file", spawn))
        self.assertEqual(len(spawned), 1)

    def test_spawn_failure_resets_flag(self):
        b = _pipeline()
        def spawn(coro):
            coro.close()
            raise RuntimeError("loop closed")
        self.assertFalse(b.schedule_refresh("/p.ngc", "file", spawn))
        self.assertFalse(b.refresh_running)   # was: latched True forever

    def test_cancel_before_start_resets_flag(self):
        b = _pipeline()
        holder = {}
        def spawn(coro):
            t = _FakeTask(coro); holder["t"] = t; return t
        b.schedule_refresh("/p.ngc", "file", spawn)
        self.assertTrue(b.refresh_running)
        holder["t"].cancel()   # never ran: the coroutine's finally never fires
        self.assertFalse(b.refresh_running)

    def test_refresh_without_stat_traces_skip(self):
        import lcnc_trace
        seen = []
        orig = lcnc_trace.emit
        lcnc_trace.emit = lambda tag, **kw: seen.append((tag, kw))
        try:
            b = _pipeline()   # stat None
            asyncio.run(b.refresh_gcode_preview("/p.ngc"))
        finally:
            lcnc_trace.emit = orig
        self.assertIn("gcode.refresh_skipped", [t for t, _ in seen])
        self.assertFalse(b.refresh_running)


class _FakeTask:
    """Minimal asyncio.Task stand-in: done callbacks + cancel()."""
    def __init__(self, coro):
        self._coro = coro
        self._cbs = []
        self._cancelled = False
    def add_done_callback(self, cb):
        self._cbs.append(cb)
    def cancelled(self):
        return self._cancelled
    def cancel(self):
        self._cancelled = True
        self._coro.close()
        for cb in self._cbs:
            cb(self)
    def close(self):
        self._coro.close()


class _FakeProc:
    """A parse worker handle that ends only when terminated."""
    def __init__(self):
        import threading
        self.terminated = threading.Event()
        self.killed = False
        self._rc = None

    def terminate(self):
        self._rc = -15
        self.terminated.set()

    def kill(self):
        self.killed = True
        self._rc = -9
        self.terminated.set()

    def poll(self):
        return self._rc


class TestCancelInflight(unittest.TestCase):
    """cancel-and-restart (2026-09-05): a running parse whose inputs went
    stale is cancelled instead of being waited out; its result is never
    published; the status wire says what runs and for how long."""

    def setUp(self):
        import tempfile
        self.td = tempfile.mkdtemp()
        self.ini = os.path.join(self.td, "m.ini")
        self.ngc = os.path.join(self.td, "big.ngc")
        with open(self.ini, "w") as f:
            f.write("[EMC]\nMACHINE = t\n")
        with open(self.ngc, "w") as f:
            f.write("G1 X1\n" * 20000)   # 120 KB -> size-based estimate

    def tearDown(self):
        import shutil
        shutil.rmtree(self.td, ignore_errors=True)

    def _recording(self):
        import lcnc_trace
        events = []
        real = lcnc_trace.emit

        def rec(tag, level="info", msg="", **fields):
            events.append((tag, dict(fields)))
            return real(tag, level, msg, **fields)
        lcnc_trace.emit = rec
        return events, (lambda: setattr(lcnc_trace, "emit", real))

    def test_cancel_before_any_parse_is_a_noop(self):
        b = _pipeline(self.ini)
        self.assertFalse(b.cancel_inflight("wcsoff:G54:x"))
        self.assertIsNone(b.preview_refresh_status())

    def test_cancel_terminates_worker_and_publishes_nothing(self):
        b = _pipeline(self.ini)
        proc = _FakeProc()

        def blocking(ctx_bytes, timeout):
            b.gcode_parse_proc = proc
            proc.terminated.wait(5.0)
            return (proc.poll(), b"", b"")
        b._run_gcode_worker_blocking = blocking
        events, restore = self._recording()
        try:
            async def scenario():
                self.assertTrue(b.schedule_refresh(self.ngc, "drift", asyncio.create_task))
                for _ in range(200):
                    await asyncio.sleep(0.005)
                    if b.gcode_parse_proc is not None:
                        break
                self.assertIsNotNone(b.gcode_parse_proc)
                st = b.preview_refresh_status()
                self.assertEqual((st["reason"], st["file"], st["queued"], st["superseded"]),
                                 ("drift", "big.ngc", False, 0))
                self.assertGreater(st["expected_ms"], 0)
                self.assertTrue(b.cancel_inflight("wcsoff:G54:x"))
                self.assertFalse(b.cancel_inflight("rotary:A"))   # idempotent per parse
                await asyncio.wait_for(asyncio.gather(*[t for t in asyncio.all_tasks()
                                                        if t is not asyncio.current_task()]), 5.0)
            asyncio.run(scenario())
        finally:
            restore()
        self.assertTrue(proc.terminated.is_set())
        self.assertFalse(proc.killed)
        self.assertFalse(b.refresh_running)
        self.assertIsNone(b.inflight)
        self.assertIsNone(b.preview_refresh_status())
        self.assertFalse(b.preview_available())
        self.assertEqual(b.superseded_total, 1)
        tags = [t for t, _ in events]
        self.assertIn("gcode.reparse_superseded", tags)
        self.assertIn("gcode.parse_cancelled", tags)
        self.assertNotIn("gcode.publish", tags)
        sup = [f for t, f in events if t == "gcode.reparse_superseded"][0]
        self.assertEqual((sup["reason"], sup["inflight_reason"], sup["file"]), ("wcsoff:G54:x", "drift", "big.ngc"))
        can = [f for t, f in events if t == "gcode.parse_cancelled"][0]
        self.assertEqual(can["reason"], "wcsoff:G54:x")
        spawn = [f for t, f in events if t == "gcode.spawn_start"][0]
        self.assertEqual(spawn["reason"], "drift")
        self.assertGreaterEqual(spawn["timeout_s"], 60.0)

    def test_expected_time_history_and_timeout_scale(self):
        b = _pipeline(self.ini)
        est = b.expected_parse_ms(self.ngc)
        self.assertGreaterEqual(est, 1500)          # floor for a small file
        self.assertEqual(b.parse_timeout_s(self.ngc), 60.0)   # floor
        b.parse_ms_by_file[self.ngc] = 30000
        self.assertEqual(b.expected_parse_ms(self.ngc), 30000)
        self.assertEqual(b.parse_timeout_s(self.ngc), 90.0)   # 3x expected
        self.assertEqual(b.expected_parse_ms(os.path.join(self.td, "missing.ngc")), 1500)

    def test_successful_parse_records_its_time_and_clears_inflight(self):
        b = _pipeline(self.ini)
        seen = {}

        def ok(ctx_bytes, timeout):
            seen["timeout"] = timeout
            seen["status"] = b.preview_refresh_status()
            return (0, b"x" * 8, b"__SCHEMA__\t8\n")
        b._run_gcode_worker_blocking = ok
        asyncio.run(b.refresh_gcode_preview(self.ngc, reason="file"))
        self.assertTrue(b.preview_available())
        self.assertIsNone(b.inflight)
        self.assertIn(self.ngc, b.parse_ms_by_file)
        self.assertGreaterEqual(seen["timeout"], 60.0)
        # refresh_running is the scheduler's flag: called directly, no status.
        self.assertIsNone(seen["status"])


class TestPublishedSource(unittest.TestCase):
    """Codex R17 XZ-07: a publication names the TEXT it was parsed from — a
    fingerprint taken before the worker and checked after it. A file that
    changed during the parse publishes no source: nothing can be bound to
    that version, the file edge re-parses."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ini = os.path.join(self.tmp.name, "m.ini")
        open(self.ini, "w").write("[EMC]\n")
        self.ngc = os.path.join(self.tmp.name, "p.ngc")
        open(self.ngc, "w").write("G0 X1\nM2\n")

    def tearDown(self):
        self.tmp.cleanup()

    def _refresh(self, during=None):
        b = _pipeline(self.ini)

        def worker(ctx_bytes, timeout):
            if during:
                during()
            return (0, b"x" * 8, b"__SCHEMA__\t8\n")
        b._run_gcode_worker_blocking = worker
        asyncio.run(b.refresh_gcode_preview(self.ngc))
        return b

    def test_an_unchanged_file_publishes_its_fingerprint(self):
        import hashlib
        b = self._refresh()
        self.assertTrue(b.preview_available())
        self.assertEqual(b.published_source, hashlib.sha256(b"G0 X1\nM2\n").hexdigest())

    def test_a_file_changed_during_the_parse_publishes_no_source(self):
        def edit():
            with open(self.ngc, "a") as f:
                f.write("G0 X2\n")
        b = self._refresh(during=edit)
        self.assertTrue(b.preview_available())
        self.assertIsNone(b.published_source)
        # … and the next parse is requested: the file edge sees only the
        # path and the mtime, which an edit can keep.
        self.assertTrue(b.reparse_pending)
        self.assertEqual(b.reparse_pending_reason, "file")

    def test_clearing_the_preview_clears_the_source(self):
        b = self._refresh()
        b.clear_preview()
        self.assertIsNone(b.published_source)


class TestPinnedReparse(unittest.TestCase):
    """The mid-run tool-table edge (operator 2026-09-29): a re-parse DURING a
    run with the PUBLISHED parse's start state pinned — its ctx (fixture,
    WCS patches, kins), rotary seed and tool seed — niced, on a longer
    leash, and never an estimate for the next idle parse. Only the tool
    table is read live, inside the worker."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ini = os.path.join(self.tmp.name, "m.ini")
        open(self.ini, "w").write("[EMC]\n")
        self.ngc = os.path.join(self.tmp.name, "p.ngc")
        open(self.ngc, "w").write("G0 X1\nM2\n")
        # the machine as the operator loaded the program …
        self.live = types.SimpleNamespace(ini_filename=self.ini, g5x_index=1, axis_mask=0b111111,
                                          actual_position=[0.0] * 9)
        self.patches = {"5221": "10.0"}
        self.kins = (0, None)
        self.b = BulkPipeline(get_stat=lambda: self.live, get_machine_units=lambda: "mm",
                              build_wcs_rotation_patches=lambda: dict(self.patches),
                              get_live_kins=lambda: self.kins,
                              get_wcs_off_flat=lambda: [1.0, 2.0])
        self.sent = []
        self.refuse_pin = False
        self.params_line = (b'__PARAMS__\t{"text": "5181 10.0\\n5211 0.0\\n", '
                            b'"g92": [0, 0, 0, 0, 0, 0, 0, 0, 0]}\n')

        def worker(ctx_bytes, timeout):
            import msgspec
            import time
            ctx = msgspec.msgpack.decode(ctx_bytes)
            self.sent.append((ctx, timeout))
            if ctx.get("nice"):
                time.sleep(0.08)   # a niced mid-run parse is measurably slower
            if self.refuse_pin and ctx.get("seed_tool"):
                return (4, b"", b"__PIN_UNSUPPORTED__\trandom toolchanger\n")
            return (0, b"x" * 8, b'__SCHEMA__\t8\n__ABCSEED__\t{"A": 0.0, "C": 0.0}\n'
                                 b'__TLO__\t{"table_path": "/cfg/tool.tbl", "table_mtime": 5.0, '
                                 b'"tlos": [[13, 0.0, 0.0, 48.2, 8.0]], "applied_tlo": [0.0, 0.0, 0.0], '
                                 b'"loaded_tool": 1, "start_known": true, "tlo_start": [0.0, 0.0, 41.5], '
                                 b'"start_mode": 430, "start_reason": null}\n' + self.params_line)
        self.b._run_gcode_worker_blocking = worker

    def tearDown(self):
        self.tmp.cleanup()

    def _load(self):
        asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason="file"))

    def test_a_published_parse_without_a_start_seed_pins_none(self):
        # an older worker's meta (no start fields) or an unknown start: the
        # pinned parse gets no start state, so it is unknown too (VP-I20)
        self._load()
        for meta in ({"applied_tlo": [0.0, 0.0, 9.0], "loaded_tool": 1},
                     {"applied_tlo": [0.0, 0.0, 9.0], "loaded_tool": 1, "start_known": False,
                      "tlo_start": None, "start_mode": None, "start_reason": "x"}):
            self.b.published_tlo = meta
            self.b.tool_basis = BulkPipeline.basis_of(meta)
            self.assertIsNone(self.b.tool_basis)
            self.assertEqual(self.b.pinned_ctx(self.ngc)["seed_tool"],
                             {"applied_tlo": None, "start_mode": None, "loaded_tool": 1})

    def test_the_published_ctx_is_what_the_worker_was_sent(self):
        self._load()
        self.assertEqual(self.b.published_ctx, self.sent[0][0])
        self.assertEqual(self.b.published_ctx["g5x_index"], 1)

    def test_a_pinned_parse_sends_the_published_start_state_not_the_running_one(self):
        self._load()
        expected_ms = self.b.parse_ms_by_file[self.ngc]
        # … and mid-run: the program switched fixture, rewrote G54 (G10 L2),
        # entered TCP and turned the table
        self.live.g5x_index = 2
        self.patches = {"5221": "99.0"}
        self.kins = (1, None)
        self.live.actual_position = [0.0, 0.0, 0.0, 30.0, 0.0, 90.0, 0.0, 0.0, 0.0]
        asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason="midrun:table_mtime", pinned=True))
        first, pinned = self.sent[0], self.sent[1]
        ctx = pinned[0]
        for k in ("file", "ini_path", "units", "var_patches", "g5x_index", "kins_type", "kins_frame"):
            self.assertEqual(ctx[k], first[0][k], k)
        self.assertEqual(ctx["rotary_pose"], {"A": 0.0, "C": 0.0})
        # the START tool state it was seeded with (VP-I20), not its reported
        # live offset and not the running program's
        self.assertEqual(ctx["seed_tool"], {"applied_tlo": [0.0, 0.0, 41.5], "start_mode": 430,
                                            "loaded_tool": 1})
        self.assertEqual(ctx["nice"], BulkPipeline.PINNED_NICE)
        # the parameter basis the published parse ran on (MR-I02): G30,
        # G92 and every other numbered parameter — not re-read live
        self.assertEqual(ctx["param_text"], "5181 10.0\n5211 0.0\n")
        self.assertEqual(ctx["g92_offset"], [0] * 9)
        self.assertAlmostEqual(pinned[1], first[1] * 3.0)
        # a niced mid-run duration never becomes the next idle estimate
        self.assertEqual(self.b.parse_ms_by_file[self.ngc], expected_ms)
        # consecutive measurements in one run keep the SAME start state
        asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason="midrun:table_mtime", pinned=True))
        again = self.sent[2][0]
        self.assertEqual({k: again[k] for k in ("g5x_index", "var_patches", "kins_type", "rotary_pose")},
                         {k: ctx[k] for k in ("g5x_index", "var_patches", "kins_type", "rotary_pose")})

    def test_the_inflight_snapshot_is_the_pinned_one(self):
        self._load()
        self.live.actual_position = [0.0, 0.0, 0.0, 30.0, 0.0, 90.0, 0.0, 0.0, 0.0]
        seen = {}
        orig = self.b._run_gcode_worker_blocking

        def worker(ctx_bytes, timeout):
            seen["inflight"] = dict(self.b.inflight)
            return orig(ctx_bytes, timeout)
        self.b._run_gcode_worker_blocking = worker
        asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason="midrun:table_mtime", pinned=True))
        inf = seen["inflight"]
        self.assertTrue(inf["pinned"])
        self.assertEqual(inf["rotary_seed"], {"A": 0.0, "C": 0.0})
        self.assertEqual(inf["wcs_off"], None)   # the fake worker reported no __WCSOFF__

    def test_nothing_published_for_the_file_skips_loudly(self):
        import lcnc_trace
        seen = []
        orig = lcnc_trace.emit
        lcnc_trace.emit = lambda tag, **kw: seen.append((tag, kw))
        try:
            asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason="midrun:table_mtime", pinned=True))
        finally:
            lcnc_trace.emit = orig
        self.assertEqual(self.sent, [])
        self.assertIn(("gcode.refresh_skipped", "no-published-ctx"),
                      [(t, kw.get("reason")) for t, kw in seen])

    def test_no_published_parameter_basis_refuses_the_pin(self):
        # a worker that reported no basis: a pinned parse must not fall back
        # to the live file (the MR-I02 class) — it refuses, loudly
        self.params_line = b""
        self._load()
        self.assertIsNone(self.b.pinned_ctx(self.ngc))

    def test_a_random_toolchanger_refuses_once_and_the_edge_stops_asking(self):
        import lcnc_trace
        self._load()
        version = self.b.preview_version
        self.refuse_pin = True
        seen = []
        orig = lcnc_trace.emit
        lcnc_trace.emit = lambda tag, **kw: seen.append(tag)
        try:
            asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason="midrun:table_mtime", pinned=True))
        finally:
            lcnc_trace.emit = orig
        self.assertTrue(self.b.pin_unsupported)
        self.assertIn("gcode.pinned_unsupported", seen)
        self.assertEqual(self.b.preview_version, version)   # no new payload …
        # … and the viewer is TOLD the payload's table is stale until idle
        # (MR-I04) — whichever tool changed
        self.assertEqual(self.b.table_stale, {"reason": "table_mtime", "why": "unsupported"})
        self.assertIn("gcode.table_stale_midrun", seen)
        # the idle edge's parse publishes: the mark goes
        self.refuse_pin = False
        asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason="table_mtime"))
        self.assertIsNone(self.b.table_stale)

    def test_the_stale_mark_ends_with_the_program(self):
        self._load()
        self.b.mark_table_stale("table_row", "no-basis")
        self.b.clear_preview()
        self.assertIsNone(self.b.table_stale)

    def test_unload_forgets_the_ctx(self):
        self._load()
        self.b.clear_preview()
        self.assertIsNone(self.b.published_ctx)
        self.assertIsNone(self.b.published_params)
        self.assertIsNone(self.b.pinned_ctx(self.ngc))


class TestRunBinding(unittest.TestCase):
    """The run's start and the pinned parse that belongs to it (plan „Prüfung
    im Lauf“ 1a/1b, Codex R112–R115): a start is verified only by a direct
    comparison with the published parse's start basis; a pinned parse during
    the run is built from the run's START context — never from a publication
    made since — and names the run only when it is that context, checked
    again at the publish."""

    def setUp(self):
        TestPinnedReparse.setUp(self)
        self.table = os.path.join(self.tmp.name, "tool.tbl")
        open(self.table, "w").write("T13 P1 Z48.2 D8\n")
        os.utime(self.table, (5.0, 5.0))
        self.live.axis_mask = 0b101111                      # X Y Z A C
        self.live.g92_offset = [0.0] * 9
        self.live.tool_offset = (0.0, 0.0, 41.5) + (0.0,) * 6
        self.live.gcodes = (0, 10, 170, 430)
        self.live.tool_in_spindle = 1
        self.live.tool_table = [types.SimpleNamespace(id=13, zoffset=48.2, diameter=8.0)]
        self.run = None
        self.b._get_run_basis = lambda: self.run
        self.on_pinned = None
        tlo = (b'__TLO__\t{"table_path": "' + self.table.encode() + b'", "table_mtime": 5.0, '
               b'"tlos": [[13, 0.0, 0.0, 48.2, 8.0]], "applied_tlo": [0.0, 0.0, 41.5], '
               b'"loaded_tool": 1, "start_known": true, "tlo_start": [0.0, 0.0, 41.5], '
               b'"start_mode": 430, "start_reason": null}\n')

        self.pinned_start = None

        def worker(ctx_bytes, timeout):
            import msgspec
            ctx = msgspec.msgpack.decode(ctx_bytes)
            self.sent.append((ctx, timeout))
            if ctx.get("nice") and self.on_pinned:
                self.on_pinned()
            t = tlo
            if ctx.get("nice") and self.pinned_start:
                t = t.replace(b'"tlo_start": [0.0, 0.0, 41.5]', b'"tlo_start": [0.0, 0.0, ' + self.pinned_start + b']')
            return (0, b"x" * 8, b'__SCHEMA__\t8\n__ABCSEED__\t{"A": 0.0, "C": 0.0}\n'
                    + t + self.params_line)
        self.b._run_gcode_worker_blocking = worker

    def tearDown(self):
        self.tmp.cleanup()

    def _load(self, reason="file"):
        asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason=reason))

    def _check(self, **kw):
        return self.b.run_start_check(self.ngc, self.live, program_source(self.ngc), **kw)

    def _run(self, run_id=1):
        ctx = self.b.start_ctx(self.ngc)
        return {"run_id": run_id, "state": "sent", "file": self.ngc,
                "source": program_source(self.ngc), "ctx": ctx, "ctx_digest": ctx_digest(ctx),
                "tool_basis_rev": self.b.tool_basis_rev, "verified": True}

    def test_the_published_start_is_verified(self):
        self._load()
        self.assertEqual(self._check(), (True, None))

    def test_every_difference_from_the_published_start_is_not_verified(self):
        self._load()

        def text():
            open(self.ngc, "w").write("G0 X2\nM2\n")

        def table_time():
            os.utime(self.table, (6.0, 6.0))

        def table_gone():
            os.remove(self.table)
        cases = {
            "text": text,
            "fixture": lambda: setattr(self.live, "g5x_index", 2),
            "fixture table": lambda: self.patches.update({"5221": "11.0"}),
            "G92": lambda: setattr(self.live, "g92_offset", [0.0, 0.0, 0.001] + [0.0] * 6),
            "kins": lambda: setattr(self, "kins", (1, None)),
            "rotary": lambda: setattr(self.live, "actual_position", [0.0] * 3 + [0.02] + [0.0] * 5),
            "rotary set": lambda: setattr(self.live, "axis_mask", 0b111111),
            "tool start": lambda: setattr(self.live, "tool_offset", (0.0, 0.0, 41.6) + (0.0,) * 6),
            "tool mode": lambda: setattr(self.live, "gcodes", (0, 10, 170, 490)),
            "tool in spindle": lambda: setattr(self.live, "tool_in_spindle", 2),
            "table row": lambda: setattr(self.live, "tool_table",
                                         [types.SimpleNamespace(id=13, zoffset=48.3, diameter=8.0)]),
            "table time": table_time,
            "table unreadable": table_gone,
            "parse running": lambda: setattr(self.b, "refresh_running", True),
            "parse pending": lambda: setattr(self.b, "reparse_pending", True),
            "WCS snapshot": lambda: setattr(self.b, "published_wcs_off", [1.0, 2.5]),
            "limits": lambda: (setattr(self.b, "published_limits",
                                       {"source": "live", "limits": {"X": [-100.0, 100.0]}}),
                               setattr(self.live, "joint",
                                       [{"min_position_limit": -100.0, "max_position_limit": 99.0}])),
        }
        for name, change in cases.items():
            with self.subTest(name):
                saved = (open(self.ngc).read(), dict(vars(self.live)), dict(self.patches), self.kins,
                         self.b.refresh_running, self.b.reparse_pending, self.b.published_wcs_off,
                         self.b.published_limits)
                change()
                ok, why = self._check()
                self.assertFalse(ok)
                self.assertTrue(why)
                (text_was, live_was, patches_was, self.kins, self.b.refresh_running,
                 self.b.reparse_pending, self.b.published_wcs_off, self.b.published_limits) = saved
                open(self.ngc, "w").write(text_was)
                vars(self.live).clear()
                vars(self.live).update(live_was)
                self.patches = patches_was
                open(self.table, "w").write("T13 P1 Z48.2 D8\n")
                os.utime(self.table, (5.0, 5.0))
                self.assertEqual(self._check(), (True, None))   # restored: the control
        with self.subTest("another program"):
            self.assertFalse(self.b.run_start_check(self.ngc + "x", self.live, program_source(self.ngc))[0])
        with self.subTest("no status"):
            self.assertFalse(self.b.run_start_check(self.ngc, None, program_source(self.ngc))[0])
        with self.subTest("the caller's open edge"):
            self.assertEqual(self._check(open_drift="toolsetter"), (False, "drift open: toolsetter"))
        with self.subTest("nothing published"):
            self.b.clear_preview()
            self.assertFalse(self._check()[0])

    def test_the_start_ctx_is_a_copy(self):
        self._load()
        ctx = self.b.start_ctx(self.ngc)
        ctx["var_patches"]["5221"] = "77.0"
        ctx["rotary_pose"]["A"] = 5.0
        again = self.b.start_ctx(self.ngc)
        self.assertEqual(again["var_patches"], {"5221": "10.0"})
        self.assertEqual(again["rotary_pose"], {"A": 0.0, "C": 0.0})
        self.assertEqual(ctx_digest(again), ctx_digest(self.b.pinned_ctx(self.ngc)))
        # nice is a priority, not an input
        self.assertEqual(ctx_digest(dict(again, nice=19)), ctx_digest(again))
        self.assertNotEqual(ctx_digest(dict(again, g5x_index=2)), ctx_digest(again))

    def test_a_pinned_parse_for_a_run_is_built_from_the_runs_start(self):
        # R114: verified run A → an ordinary publication B of the same text
        # (another fixture table) → the table edge's pinned parse: its context
        # is A's, and it names run A
        self._load()
        self.run = self._run()
        a_patches = dict(self.patches)
        self.patches = {"5221": "20.0"}
        self._load(reason="wcsoff:G54:x")                   # publication B
        self.assertEqual(self.b.published_ctx["var_patches"], {"5221": "20.0"})
        # the control first: without the run the pinned parse is B's, and no run's
        asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason="midrun:table_mtime", pinned=True))
        self.assertEqual(self.sent[-1][0]["var_patches"], {"5221": "20.0"})
        self.assertIsNone(self.b.published_origin["for_run"])
        asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason="midrun:table_mtime",
                                                 pinned=True, run=self.run))
        ctx = self.sent[-1][0]
        self.assertEqual(ctx["var_patches"], a_patches)
        self.assertEqual(ctx_digest(ctx), self.run["ctx_digest"])
        self.assertEqual(self.b.published_origin["for_run"],
                         {"run_id": 1, "ctx_digest": self.run["ctx_digest"],
                          "tool_basis_rev": self.run["tool_basis_rev"]})
        self.assertTrue(self.b.published_origin["pinned"])
        self.assertEqual(self.b.published_origin["reason"], "midrun:table_mtime")

    def test_a_context_that_is_not_the_runs_names_no_run(self):
        self._load()
        for name, change in (("digest", lambda r: r.update(ctx_digest="0" * 64)),
                             ("file", lambda r: r["ctx"].update(file=self.ngc + "x")),
                             ("no ctx", lambda r: r.update(ctx=None))):
            with self.subTest(name):
                self.run = self._run()
                change(self.run)
                asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason="midrun:table_mtime",
                                                         pinned=True, run=self.run))
                self.assertIsNone(self.b.published_origin["for_run"])

    def test_the_binding_is_checked_again_at_the_publish(self):
        self._load()
        for name, change in (
                ("another run", lambda: setattr(self, "run", dict(self.run, run_id=2))),
                ("no run", lambda: setattr(self, "run", None)),
                ("another basis revision", lambda: setattr(self, "run", dict(self.run, tool_basis_rev=-1))),
                ("the text changed", lambda: open(self.ngc, "w").write("G0 X3\nM2\n"))):
            with self.subTest(name):
                open(self.ngc, "w").write("G0 X1\nM2\n")
                self._load()
                self.run = self._run()
                run = self.run
                self.on_pinned = change
                asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason="midrun:table_mtime",
                                                         pinned=True, run=run))
                self.on_pinned = None
                self.assertIsNone(self.b.published_origin["for_run"])
        with self.subTest("the parse's own start moved the basis"):
            open(self.ngc, "w").write("G0 X1\nM2\n")
            self._load()
            self.run = self._run()
            self.pinned_start = b"41.6"
            asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason="midrun:table_mtime",
                                                     pinned=True, run=self.run))
            self.pinned_start = None
            self.assertNotEqual(self.b.tool_basis_rev, self.run["tool_basis_rev"])
            self.assertIsNone(self.b.published_origin["for_run"])
        with self.subTest("the control: the same run"):
            open(self.ngc, "w").write("G0 X1\nM2\n")
            self._load()
            self.run = self._run()
            asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason="midrun:table_mtime",
                                                     pinned=True, run=self.run))
            self.assertEqual(self.b.published_origin["for_run"]["run_id"], 1)

    def test_the_tool_basis_revision_counts_changes_only(self):
        rev0 = self.b.tool_basis_rev
        self._load()
        rev1 = self.b.tool_basis_rev
        self.assertEqual(rev1, rev0 + 1)
        self._load()                                         # the same basis again
        self.assertEqual(self.b.tool_basis_rev, rev1)
        self.b._set_tool_basis({"xyz": [0.0, 0.0, 50.0], "mode": 430})
        self.assertEqual(self.b.tool_basis_rev, rev1 + 1)    # a verify without a new version
        self.b.clear_preview()
        self.assertEqual(self.b.tool_basis_rev, rev1 + 2)

    def test_every_publication_says_where_it_comes_from(self):
        import hashlib
        self.assertIsNone(self.b.preview_origin_status())
        self._load()
        o = self.b.preview_origin_status()
        rows = hashlib.sha256(json.dumps([[13, 0.0, 0.0, 48.2, 8.0]]).encode()).hexdigest()[:16]
        self.assertEqual(o, {"version": self.b.preview_version, "file": self.ngc,
                             "source": program_source(self.ngc), "reason": "file", "pinned": False,
                             "for_run": None, "table": {"mtime": 5.0, "rows": rows},
                             "tool_basis_rev": self.b.tool_basis_rev,
                             "tool_basis_rev_now": self.b.tool_basis_rev})
        self.b._set_tool_basis({"xyz": [0.0, 0.0, 50.0], "mode": 430})
        o2 = self.b.preview_origin_status()
        self.assertEqual(o2["tool_basis_rev_now"], o["tool_basis_rev"] + 1)
        self.assertEqual(o2["tool_basis_rev"], o["tool_basis_rev"])
        self.b.clear_preview()
        self.assertIsNone(self.b.preview_origin_status())


class TestVerifyAtTheActualOffset(unittest.TestCase):
    """VP-I20, plan Fassungen 4–6: an actual change of the start tool state is
    VERIFIED by a parse at it; the published payload stays when every
    consumer would get the same inputs from it, normalised to the new start
    — no version bump, no transfer — and only the tool basis moves."""

    META = (b'__TLO__\t{"table_path": null, "table_mtime": 5.0, "tlos": [], "applied_tlo": [0.0, 0.0, %s], '
            b'"loaded_tool": 13, "start_known": true, "tlo_start": [0.0, 0.0, %s], "start_mode": 430, '
            b'"start_reason": null}\n')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ini = os.path.join(self.tmp.name, "m.ini")
        open(self.ini, "w").write("[EMC]\n")
        self.ngc = os.path.join(self.tmp.name, "p.ngc")
        open(self.ngc, "w").write("G53 G0 Z0\nG43 H13\nG0 Z5\nM2\n")
        self.live = types.SimpleNamespace(ini_filename=self.ini, g5x_index=1, axis_mask=0b111,
                                          actual_position=[0.0] * 9, gcodes=(430,),
                                          tool_offset=(0.0, 0.0, 65.0512) + (0.0,) * 6)
        self.b = BulkPipeline(get_stat=lambda: self.live, get_machine_units=lambda: "mm",
                              build_wcs_rotation_patches=lambda: {})
        self.sent = []
        self.reply = None

        def worker(ctx_bytes, timeout):
            import msgspec
            ctx = msgspec.msgpack.decode(ctx_bytes)
            path = ctx.get("verify_against")
            self.sent.append({"ctx": ctx, "blob": open(path, "rb").read() if path else None,
                              "inflight": dict(self.b.inflight)})
            z = b"%.4f" % self.live.tool_offset[2]
            meta = self.META % (z, z)
            return self.reply(meta) if self.reply else (0, b"payload@" + z, b"__SCHEMA__\t9\n" + meta)
        self.b._run_gcode_worker_blocking = worker

    def tearDown(self):
        self.tmp.cleanup()

    def _parse(self, reason):
        asyncio.run(self.b.refresh_gcode_preview(self.ngc, reason=reason))

    def test_a_publish_sets_the_tool_basis_to_its_own_start(self):
        self._parse("file")
        self.assertEqual(self.b.tool_basis, {"xyz": [0.0, 0.0, 65.0512], "mode": 430})
        self.assertIsNone(self.b.tool_basis_status(), "equal to tlo_start: nothing to say")
        self.assertNotIn("verify_against", self.sent[0]["ctx"])
        self.assertEqual(self.sent[0]["inflight"]["tlo_seed"]["xyz"], [0.0, 0.0, 65.0512])

    def test_same_keeps_the_payload_and_moves_only_the_basis(self):
        self._parse("file")
        version, published = self.b.preview_version, (self.b.preview_bytes, self.b.preview_bytes_gz)
        self.live.tool_offset = (0.0, 0.0, 65.0562) + (0.0,) * 6
        self.reply = lambda meta: (0, b"", b"__SCHEMA__\t9\n" + meta
                                   + b'__VERIFY__\t{"same": true, "why": "same"}\n__SAME__\n')
        self._parse("tool_offset")
        sent = self.sent[-1]
        # the worker got the published bytes to compare with …
        self.assertEqual(sent["blob"], published[0] or published[1])
        self.assertFalse(os.path.exists(sent["ctx"]["verify_against"]), "temp file removed")
        # … and nothing was published
        self.assertEqual(self.b.preview_version, version)
        self.assertEqual((self.b.preview_bytes, self.b.preview_bytes_gz), published)
        self.assertEqual(self.b.tool_basis, {"xyz": [0.0, 0.0, 65.0562], "mode": 430})
        self.assertEqual(self.b.tool_basis_status(),
                         {"file": self.ngc, "version": version, "xyz": [0.0, 0.0, 65.0562], "mode": 430})
        # the pinned parse of the next run starts from the verified start
        self.b.published_params = {"text": "", "g92": None}
        self.b.published_ctx = dict(self.b.published_ctx, file=self.ngc)
        self.assertEqual(self.b.pinned_ctx(self.ngc)["seed_tool"]["applied_tlo"], [0.0, 0.0, 65.0562])

    def test_a_difference_publishes_the_verify_parse_itself(self):
        self._parse("file")
        version = self.b.preview_version
        self.live.tool_offset = (0.0, 0.0, 66.0512) + (0.0,) * 6
        self._parse("tool_offset")
        self.assertIn("verify_against", self.sent[-1]["ctx"])
        self.assertEqual(self.b.preview_version, version + 1)
        self.assertEqual(self.b.preview_bytes, b"payload@66.0512")
        self.assertEqual(self.b.tool_basis, {"xyz": [0.0, 0.0, 66.0512], "mode": 430})
        self.assertIsNone(self.b.tool_basis_status())

    def test_only_a_published_payload_is_verified(self):
        self._parse("tool_offset")      # nothing published yet: an ordinary parse
        self.assertNotIn("verify_against", self.sent[-1]["ctx"])
        self.assertEqual(self.b.preview_version % 1, 0)
        self.assertEqual(self.b.preview_bytes, b"payload@65.0512")

    def test_unload_drops_the_basis(self):
        self._parse("file")
        self.b.clear_preview()
        self.assertIsNone(self.b.tool_basis)
        self.assertIsNone(self.b.tool_basis_status())
