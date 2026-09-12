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

from bulk_pipeline import BulkPipeline


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
