"""Integration tests for the command dispatch — backend policy enforcement
(issue #19) and the estop/enabled HAL-merge (issues #14 + #19).

Imports the REAL gateway module under a fake linuxcnc so handlers run
off-machine. Requires the gateway venv (fastapi/msgspec are real deps):

    .venv/bin/python3 -m unittest test_command_dispatch
"""
import asyncio
import unittest
from types import SimpleNamespace

import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()   # MUST precede `import gateway`
import gateway  # noqa: E402  (import after the fake is installed)
import fusion_import  # noqa: E402
import bulk_pipeline  # noqa: E402


def _run(coro):
    # Fresh cmd lock per call: it's a lazily-created asyncio.Lock and asyncio.run
    # spins a new loop each time, so a cached lock would bind to a stale loop.
    gateway._cmd_lock = None
    return asyncio.run(coro)


def _payload(**over):
    """Duck-typed status snapshot exposing only the fields the policy reads."""
    base = dict(
        estop=False, enabled=True, emc_enable_in=True, homed=True,
        interp_state=linuxcnc.INTERP_IDLE, paused=False, eoffset_enabled=False,
        rotary_at_zero=True,
    )
    base.update(over)
    return SimpleNamespace(**base)


# Reasons check_command/_deny_reason can return — used to assert a reply is (or
# is not) a policy denial without coupling to exact wording.
POLICY_DENIALS = {
    "Not armed", "E-stop active", "Machine not on", "Machine not homed",
    "Machine not idle",
}


class _RecordingCmd:
    """A CMD spy: records every call so a happy-path test can assert the handler
    reached LinuxCNC with the parsed arguments. wait_complete() returns 0
    (success), matching the real binding."""
    def __init__(self):
        self.calls = []

    def __getattr__(self, name):
        def record(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            return 0
        return record

    def args_of(self, name):
        """Positional args of the first recorded call to `name`, or None."""
        for n, a, _k in self.calls:
            if n == name:
                return a
        return None


class TestPolicyStateMerge(unittest.TestCase):
    """_policy_state_from_payload — the estop/enabled merge that moved
    server-side from the frontend isEstop/isEnabled computeds (issue #14)."""

    def test_safety_chain_open_forces_estop_and_disables(self):
        s = gateway._policy_state_from_payload(
            _payload(estop=False, enabled=True, emc_enable_in=False), armed=True)
        self.assertTrue(s.is_estop)     # estop OR chain-open
        self.assertFalse(s.is_enabled)  # enabled AND emc is not False

    def test_stat_estop_alone_is_estop(self):
        self.assertTrue(
            gateway._policy_state_from_payload(_payload(estop=True), armed=True).is_estop)

    def test_emc_none_is_not_chain_open(self):
        # None (reader stale / pin unavailable) must NOT read as a chain trip.
        s = gateway._policy_state_from_payload(_payload(emc_enable_in=None), armed=True)
        self.assertFalse(s.is_estop)
        self.assertTrue(s.is_enabled)

    def test_running_and_paused_derivation(self):
        run = gateway._policy_state_from_payload(
            _payload(interp_state=linuxcnc.INTERP_READING), armed=True)
        self.assertTrue(run.is_running)
        self.assertFalse(run.is_idle)
        self.assertFalse(run.is_paused)
        paused = gateway._policy_state_from_payload(
            _payload(interp_state=linuxcnc.INTERP_READING, paused=True), armed=True)
        self.assertTrue(paused.is_paused)
        self.assertFalse(paused.is_running)

    def test_interp_paused_counts_as_paused_even_if_flag_lags(self):
        # review #1: INTERP_PAUSED with STAT.paused momentarily False must still
        # read as paused, so the resume gate stays open during that transient.
        s = gateway._policy_state_from_payload(
            _payload(interp_state=linuxcnc.INTERP_PAUSED, paused=False), armed=True)
        self.assertTrue(s.is_paused)
        self.assertFalse(s.is_running)
        self.assertFalse(s.is_idle)

    def test_armed_passthrough(self):
        self.assertTrue(gateway._policy_state_from_payload(_payload(), armed=True).armed)
        self.assertFalse(gateway._policy_state_from_payload(_payload(), armed=False).armed)


class TestDispatchEnforcement(unittest.TestCase):
    """handle_command rejects forbidden commands BEFORE they reach a handler."""

    def setUp(self):
        gateway.lcnc_connected = True

    def _send(self, msg, armed=True, **state):
        gateway._shared_status = _payload(**state)
        return _run(gateway.handle_command(msg, armed))

    def test_cycle_start_denied_unhomed(self):
        r = self._send({"cmd": "cycle_start"}, homed=False)
        self.assertFalse(r["ok"])
        self.assertIn("homed", r["error"].lower())

    def test_mdi_denied_while_running(self):
        r = self._send({"cmd": "mdi", "text": "G0X0"}, interp_state=linuxcnc.INTERP_READING)
        self.assertFalse(r["ok"])

    def test_touchoff_denied_with_eoffset(self):
        r = self._send({"cmd": "set_wcs"}, eoffset_enabled=True)
        self.assertFalse(r["ok"])
        self.assertIn("compensation", r["error"].lower())

    def test_tool_edit_denied_while_running(self):
        r = self._send({"cmd": "save_tool", "tool_number": 1},
                       interp_state=linuxcnc.INTERP_READING)
        self.assertFalse(r["ok"])

    def test_not_armed_denied(self):
        r = self._send({"cmd": "cycle_start"}, armed=False)
        self.assertFalse(r["ok"])
        self.assertEqual(r["error"], "Not armed")

    def test_machine_on_denied_in_estop(self):
        r = self._send({"cmd": "machine_on"}, estop=True)
        self.assertFalse(r["ok"])

    def test_auto_step_rejects_when_fresh_poll_shows_running(self):
        # review #3: the gate sees a snapshot (idle -> step allowed) but the
        # handler re-polls and finds the program running -> it must REJECT, not
        # fall through and re-start the program.
        gateway._shared_status = _payload()        # idle snapshot -> gate allows
        class _RunningStat:
            task_mode = linuxcnc.MODE_AUTO
            interp_state = linuxcnc.INTERP_READING
            paused = False
            def poll(self):
                pass
        gateway.STAT = _RunningStat()
        spy = _RecordingCmd()
        gateway.CMD = spy
        r = _run(gateway.handle_command({"cmd": "auto_step"}, True))
        self.assertFalse(r["ok"])
        self.assertIn("running", r["error"].lower())
        self.assertIsNone(spy.args_of("auto"), "must not start/step a running program")


class TestNotOverBlocked(unittest.TestCase):
    """The enforcement must not reject a conforming command on a ready machine.
    Verified at the gateway's policy seam (merge + check_command together) so no
    LinuxCNC-touching handler has to run."""

    def test_ready_machine_passes_every_common_command(self):
        # A plain (non-switchable) machine, as the gateway's own call sites
        # say via kins_switchable=_kins_is_switchable(); the builder's default
        # (True + no kins reading) is the CLOSED "unknown" state, which the
        # run / machineFrame gates refuse by design.
        st = gateway._policy_state_from_payload(_payload(), armed=True, kins_switchable=False)
        for cmd in ("mdi", "cycle_start", "jog_cont", "save_tool", "set_wcs",
                    "home", "spindle_forward", "set_feed_override"):
            self.assertIsNone(
                gateway.check_command(cmd, st),
                f"{cmd} wrongly denied on a fully-ready machine")

    def test_jog_stop_never_policy_denied(self):
        # Safety: stopping must pass even fully disarmed / estopped.
        st = gateway._policy_state_from_payload(
            _payload(estop=True), armed=False)
        self.assertIsNone(gateway.check_command("jog_stop", st))


class TestHandlerExecution(unittest.TestCase):
    """Happy path: a valid command on a ready machine runs the REAL handler body
    to completion and reaches CMD.* with the parsed arguments — not just the
    policy seam. set_mode/_cmd_blocking are fire-and-forget here (no wait loop),
    so a recording CMD spy + fake STAT suffice; no stateful linkage needed."""

    def setUp(self):
        gateway.lcnc_connected = True
        gateway.STAT = linuxcnc.stat()
        self.cmd = _RecordingCmd()
        gateway.CMD = self.cmd

    def _send(self, msg):
        gateway._shared_status = _payload()   # ready -> passes policy
        return _run(gateway.handle_command(msg, True))

    def test_jog_cont_reaches_cmd_jog_with_parsed_args(self):
        r = self._send({"cmd": "jog_cont", "axis": 2, "vel": 3.5})
        self.assertTrue(r["ok"])
        args = self.cmd.args_of("jog")
        self.assertIsNotNone(args, "CMD.jog was never called")
        self.assertEqual(args[0], linuxcnc.JOG_CONTINUOUS)
        self.assertEqual(args[2], 2)      # axis (jf is args[1])
        self.assertEqual(args[3], 3.5)    # velocity

    def test_teleop_jog_translates_list_index_to_canonical_axis(self):
        # XYZAC machine (axis_mask 0b101111): the wire index is the position
        # in the machine's axis list; teleop CMD.jog wants the CANONICAL
        # axis number. C = list index 4 but canonical 5 — untranslated, the
        # gateway jogged nonexistent B and the machine silently sat still
        # (WS-D 5-axis user smoke).
        gateway.STAT.axis_mask = 0b101111
        gateway.STAT.motion_mode = linuxcnc.TRAJ_MODE_TELEOP
        r = self._send({"cmd": "jog_cont", "axis": 4, "vel": 2.0})
        self.assertTrue(r["ok"])
        args = self.cmd.args_of("jog")
        self.assertEqual(args[1], 0)      # jf: teleop -> Cartesian axis jog
        self.assertEqual(args[2], 5)      # canonical C, not list index 4
        # jog_stop for the same axis must translate identically (a stop
        # aimed at the wrong axis leaves the real one moving).
        self.cmd.calls.clear()
        r = self._send({"cmd": "jog_stop", "axis": 4})
        self.assertTrue(r["ok"])
        args = self.cmd.args_of("jog")
        self.assertEqual(args[0], linuxcnc.JOG_STOP)
        self.assertEqual(args[2], 5)

    def test_joint_mode_jog_passes_list_index_through(self):
        # No motion_mode attr -> _jog_joint_flag defaults to joint jog (1):
        # the list index IS the joint number (trivkins follows COORDINATES).
        gateway.STAT.axis_mask = 0b101111
        if hasattr(gateway.STAT, "motion_mode"):
            del gateway.STAT.motion_mode
        r = self._send({"cmd": "jog_cont", "axis": 4, "vel": 2.0})
        self.assertTrue(r["ok"])
        args = self.cmd.args_of("jog")
        self.assertEqual(args[1], 1)      # joint jog
        self.assertEqual(args[2], 4)      # joint number untouched

    def test_mdi_reaches_cmd_mdi_with_text(self):
        r = self._send({"cmd": "mdi", "text": "G0 X1"})
        self.assertTrue(r["ok"])
        self.assertEqual(self.cmd.args_of("mdi"), ("G0 X1",))

    def test_home_reaches_cmd_home_with_joint(self):
        r = self._send({"cmd": "home", "joint": 2})
        self.assertTrue(r["ok"])
        self.assertEqual(self.cmd.args_of("home"), (2,))

    def test_mode_switched_before_motion(self):
        # set_mode runs first: CMD.mode(MODE_MANUAL) is recorded before CMD.jog.
        self._send({"cmd": "jog_cont", "axis": 0, "vel": 1.0})
        names = [n for n, _a, _k in self.cmd.calls]
        self.assertIn("mode", names)
        self.assertIn("jog", names)
        self.assertLess(names.index("mode"), names.index("jog"))


class TestPayloadValidation(unittest.TestCase):
    """Bad numeric payloads return a bounded {ok:false} via the dispatch, rather
    than crashing the socket or (the #27 bug) silently flowing a non-finite
    value into the machine. Runs on a ready machine so the policy passes and the
    handler reaches its casts; rejection happens before any CMD.* call."""

    def setUp(self):
        gateway.lcnc_connected = True
        # Some handlers call STAT.poll() directly (e.g. reject_if_auto_running),
        # not the None-safe safe_get — give them a fake stat with a no-op poll().
        gateway.STAT = linuxcnc.stat()

    def _send(self, msg):
        gateway._shared_status = _payload()   # ready -> passes policy
        return _run(gateway.handle_command(msg, True))

    def _assert_validation_rejection(self, r, contains):
        # Guard against passing for the wrong reason: the reply must come from a
        # validation layer, not an incidental AttributeError/crash, AND carry
        # the specific reason.
        #
        # TWO layers can legitimately produce it, and which one fires depends on
        # the field (#27): COMMAND_SCHEMA bounds run first and return a message
        # prefixed with the command name; a field with no schema entry falls
        # through to the handler's finite_int/finite_float, whose raise is
        # formatted by the recv-loop catch as "ValueError: …".
        self.assertFalse(r["ok"])
        err = r["error"].lower()
        cmd_prefixed = err.startswith(("jog_", "add_tool", "save_tool", "set_", "home", "mdi"))
        self.assertTrue(
            "valueerror" in err or cmd_prefixed,
            f"not a validation rejection: {r['error']!r}")
        self.assertIn(contains, err, f"wrong reason: {r['error']!r}")

    def test_jog_garbage_axis_rejected(self):
        r = self._send({"cmd": "jog_cont", "axis": "x", "vel": 1.0})
        self._assert_validation_rejection(r, "must be a number")

    def test_jog_negative_axis_rejected(self):
        r = self._send({"cmd": "jog_cont", "axis": -1, "vel": 1.0})
        self._assert_validation_rejection(r, "minimum")

    def test_jog_non_finite_velocity_rejected(self):
        # The motion-value guard: Infinity must not reach CMD.jog.
        r = self._send({"cmd": "jog_cont", "axis": 0, "vel": "Infinity"})
        self._assert_validation_rejection(r, "finite")

    def test_add_tool_garbage_number_rejected(self):
        r = self._send({"cmd": "add_tool", "tool_number": "abc"})
        self._assert_validation_rejection(r, "must be a number")

    def test_add_tool_negative_number_rejected(self):
        r = self._send({"cmd": "add_tool", "tool_number": -5})
        self._assert_validation_rejection(r, "minimum")


class TestToolPersistenceLock(unittest.TestCase):
    """#24: the REST tool-import path persists tool.tbl + tool_library.json under
    _cmd_lock (serialized with the WS tool handlers, which hold it via
    handle_command) and off the event loop — closing the prior race + unlocked
    NML reload."""

    def test_import_persist_holds_cmd_lock_for_both_writes(self):
        seen = {}
        orig_w, orig_s = gateway.write_tool_table, gateway.save_tool_library
        # Spy: record whether _cmd_lock is held at the moment each file is written.
        gateway.write_tool_table = lambda p, t: seen.__setitem__("table", gateway._cmd_lock.locked())
        gateway.save_tool_library = lambda lib: seen.__setitem__("lib", gateway._cmd_lock.locked())
        try:
            _run(gateway._persist_imported_tools("/tmp/ignored.tbl", [], {}))
        finally:
            gateway.write_tool_table, gateway.save_tool_library = orig_w, orig_s
        self.assertTrue(seen.get("table"), "_cmd_lock not held during tool-table write")
        self.assertTrue(seen.get("lib"), "_cmd_lock not held during tool-library write")


class _FakeUpload:
    """Minimal stand-in for Starlette UploadFile: async chunked read."""
    def __init__(self, data: bytes):
        import io
        self._buf = io.BytesIO(data)

    async def read(self, n: int = -1) -> bytes:
        return self._buf.read(n)


class TestFusionDecode(unittest.TestCase):
    """B2: the off-loop Fusion blob decode (machine_unit passed in, no NML)."""

    def test_parses_minimal_library(self):
        lib = ('{"data":[{"type":"flat end mill","unit":"millimeters",'
               '"post-process":{"number":3},"geometry":{"DC":6.0},'
               '"description":"6mm endmill"}]}')
        parsed, skipped = fusion_import.decode_fusion_blob(lib.encode(), "mm")
        self.assertEqual(parsed[0]["T"], 3)
        self.assertEqual(parsed[0]["D"], 6.0)
        self.assertEqual(parsed[0]["type"], "endmill")

    def test_unit_conversion_uses_passed_machine_unit(self):
        # inch tool on an mm machine → DC scaled ×25.4 (no get_ini_config call)
        lib = ('{"data":[{"type":"drill","unit":"inches",'
               '"post-process":{"number":1},"geometry":{"DC":1.0}}]}')
        parsed, _ = fusion_import.decode_fusion_blob(lib.encode(), "mm")
        self.assertAlmostEqual(parsed[0]["D"], 25.4, places=3)

    def test_bad_json_raises_valueerror(self):
        with self.assertRaises(ValueError):
            fusion_import.decode_fusion_blob(b"{ not json", "mm")

    def test_missing_data_array_raises_valueerror(self):
        with self.assertRaises(ValueError):
            fusion_import.decode_fusion_blob(b'{"nope":1}', "mm")


class TestStreamUpload(unittest.TestCase):
    """B1: bounded, atomic, off-loop streaming upload (#35)."""

    def setUp(self):
        import tempfile
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _parts(self):
        import os
        return [n for n in os.listdir(self.tmp) if n.endswith(".part")]

    def test_writes_atomically(self):
        import os
        dest = os.path.join(self.tmp, "prog.ngc")
        data = b"G1 X1\n" * 5000
        n = _run(gateway._atomic_stream_upload(_FakeUpload(data), dest, 10 << 20, chunk_size=1024))
        self.assertEqual(n, len(data))
        with open(dest, "rb") as f:
            self.assertEqual(f.read(), data)
        self.assertEqual(self._parts(), [], "left a .part temp behind")

    def test_rejects_oversized_no_partial_file(self):
        import os
        from fastapi import HTTPException
        dest = os.path.join(self.tmp, "big.ngc")
        with self.assertRaises(HTTPException) as cm:
            _run(gateway._atomic_stream_upload(_FakeUpload(b"x" * 5000), dest, 1000, chunk_size=256))
        self.assertEqual(cm.exception.status_code, 413)
        self.assertFalse(os.path.exists(dest), "published a partial/oversized file")
        self.assertEqual(self._parts(), [], "left a .part temp behind after rejection")

    def test_cancel_midstream_leaves_no_dest_or_temp(self):
        # Review finding #3: a client disconnect cancels the upload coroutine. The
        # atomic-replace runs only on full success (not reached here), and the temp
        # is unlinked in the finally — so a cancelled upload must leave neither a
        # dest file nor a stray .part temp.
        import os
        import asyncio
        dest = os.path.join(self.tmp, "cancelled.ngc")

        class _SlowUpload:
            def __init__(self):
                self._reads = 0

            async def read(self, n: int = -1) -> bytes:
                self._reads += 1
                if self._reads <= 2:
                    return b"G1 X1\n" * 100   # write a couple of real chunks first
                await asyncio.sleep(10)        # then hang, giving a window to cancel
                return b""

        async def _drive():
            task = asyncio.ensure_future(
                gateway._atomic_stream_upload(_SlowUpload(), dest, 10 << 20, chunk_size=512)
            )
            await asyncio.sleep(0.05)          # let the first chunks land, then hang
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        _run(_drive())
        self.assertFalse(os.path.exists(dest), "published a dest file on cancel")
        self.assertEqual(self._parts(), [], "left a .part temp behind on cancel")

    def test_cancel_during_write_runs_close_after_the_write(self):
        # Review #5: cancel while a disk WRITE is in flight and prove close/unlink
        # happen only AFTER the write completes (the single-thread io executor
        # serializes them) — not the earlier test's cancel-during-read.
        import os
        import asyncio
        import threading
        dest = os.path.join(self.tmp, "midwrite.ngc")
        holder = {}
        orig_opener = gateway._upload_file_opener

        class _BlockingFile:
            def __init__(self, fd):
                self._fd = fd
                self.ops = []
                self.write_started = threading.Event()
                self.write_release = threading.Event()

            def write(self, data):
                self.ops.append("write_start")
                self.write_started.set()
                self.write_release.wait(timeout=5)  # block until the test releases it
                self.ops.append("write_end")
                return len(data)

            def flush(self):
                self.ops.append("flush")

            def fileno(self):
                return self._fd

            def close(self):
                self.ops.append("close")
                try:
                    os.close(self._fd)
                except OSError:
                    pass

        def _opener(fd, mode):
            holder["f"] = _BlockingFile(fd)
            return holder["f"]

        class _OneChunk:
            def __init__(self):
                self._n = 0

            async def read(self, n=-1):
                self._n += 1
                return (b"x" * 256) if self._n == 1 else b""

        async def _drive():
            task = asyncio.ensure_future(
                gateway._atomic_stream_upload(_OneChunk(), dest, 10 << 20, chunk_size=256))
            while "f" not in holder:
                await asyncio.sleep(0.005)
            bf = holder["f"]
            await asyncio.to_thread(bf.write_started.wait, 5)  # write is now in flight
            task.cancel()
            await asyncio.sleep(0.05)                          # let cancel queue the close
            self.assertNotIn("close", bf.ops, "close ran while the write was still in flight")
            bf.write_release.set()                            # let the write finish
            try:
                await task
            except asyncio.CancelledError:
                pass
            return bf.ops

        try:
            gateway._upload_file_opener = _opener
            ops = _run(_drive())
        finally:
            gateway._upload_file_opener = orig_opener
        self.assertIn("write_end", ops)
        self.assertIn("close", ops)
        self.assertLess(ops.index("write_end"), ops.index("close"),
                        "close must run only after the in-flight write completes")
        self.assertFalse(os.path.exists(dest), "published a dest file on mid-write cancel")
        self.assertEqual(self._parts(), [], "left a .part temp behind on mid-write cancel")


class TestTerminateParseProc(unittest.TestCase):
    """Review #1: shutdown must terminate an in-flight parse child, bounded, with a
    SIGKILL fallback if it ignores SIGTERM — and no-op a child that already exited."""

    def test_terminates_a_live_child(self):
        class _Proc:
            def __init__(self):
                self.terminated = False
                self.killed = False
                self.returncode = None

            def poll(self):
                return None if not self.terminated else self.returncode

            def terminate(self):
                self.terminated = True
                self.returncode = -15

            def kill(self):
                self.killed = True

            def wait(self):
                return self.returncode

        p = _Proc()
        _run(bulk_pipeline.terminate_parse_proc(p))
        self.assertTrue(p.terminated)
        self.assertFalse(p.killed)  # exited on SIGTERM → no kill needed

    def test_noop_for_already_exited_child(self):
        class _Dead:
            returncode = 0

            def poll(self):
                return 0

            def terminate(self):
                raise AssertionError("must not signal an already-exited child")

            def kill(self):
                raise AssertionError("must not kill an already-exited child")

            def wait(self):
                return 0

        _run(bulk_pipeline.terminate_parse_proc(_Dead()))  # no exception == clean no-op

    def test_kills_a_child_that_ignores_sigterm(self):
        import threading
        class _Stubborn:
            def __init__(self):
                self.killed = False
                self.returncode = None
                self._released = threading.Event()

            def poll(self):
                return None  # alive until killed

            def terminate(self):
                pass  # ignores SIGTERM → forces the wait_for timeout

            def kill(self):
                self.killed = True
                self.returncode = -9
                self._released.set()  # unblock the hung wait()

            def wait(self):
                self._released.wait(timeout=5)  # blocks until kill() (5 s safety)
                return self.returncode

        p = _Stubborn()
        _run(bulk_pipeline.terminate_parse_proc(p))
        self.assertTrue(p.killed)

    def test_shutdown_reaps_child_after_owner_cancel(self):
        # Review #2: lifespan must capture the parse handle BEFORE cancelling
        # background tasks. Cancelling the owner runs its finally (which clears the
        # global) while the subprocess keeps running — so reading the global in
        # step 6 would see None and orphan the child. This models the fixed order
        # (capture → cancel owner → terminate captured) with a REAL subprocess and
        # proves the child is actually reaped.
        import subprocess
        import sys
        import asyncio

        proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        gateway._bulk.gcode_parse_proc = proc
        try:
            async def _owner():
                try:
                    await asyncio.sleep(30)          # mimic awaiting the parse worker
                finally:
                    gateway._bulk.gcode_parse_proc = None  # _refresh's finally clears it

            async def _drive():
                task = gateway.register_bg_task(asyncio.ensure_future(_owner()))
                await asyncio.sleep(0.02)             # let the owner reach its await
                captured = gateway._bulk.gcode_parse_proc  # <-- capture BEFORE cancel (the fix)
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                self.assertIsNone(gateway._bulk.gcode_parse_proc)  # owner cleared the global
                await bulk_pipeline.terminate_parse_proc(captured)  # captured handle still reaps it

            _run(_drive())
            self.assertIsNotNone(proc.poll(), "orphaned parse child was not reaped on shutdown")
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            gateway._bg_tasks.clear()
            gateway._bulk.gcode_parse_proc = None


if __name__ == "__main__":
    unittest.main()


class TestPayloadBoundsReachCmd(unittest.TestCase):
    """#27 end to end: an out-of-range payload must be refused at the dispatch
    boundary and NEVER reach CMD.*, and a clamped continuous input must reach it
    at the machine's declared ceiling rather than the operator's number.

    Runs the real handler bodies under the fake linuxcnc, with MachineLimits
    forced so the assertions do not depend on whatever INI the dev box has."""

    LIMITS = gateway.MachineLimits(
        n_axes=5, n_joints=5, max_jog_velocity=50.0, max_spindle_speed=3000.0,
        max_feed_override=1.5, min_spindle_override=0.5, max_spindle_override=1.2,
        max_linear_velocity=100.0, declared_vars=frozenset({3014, 3100}),
    )

    def setUp(self):
        gateway.lcnc_connected = True
        gateway.STAT = linuxcnc.stat()
        self.cmd = _RecordingCmd()
        gateway.CMD = self.cmd
        self._saved_limits = gateway._machine_limits
        gateway._machine_limits = self.LIMITS

    def tearDown(self):
        gateway._machine_limits = self._saved_limits

    def _send(self, msg):
        gateway._shared_status = _payload()   # ready -> passes policy
        return _run(gateway.handle_command(msg, True))

    def _refused(self, msg, *never_called):
        r = self._send(msg)
        self.assertFalse(r["ok"], f"{msg['cmd']} should have been refused: {r}")
        for name in never_called:
            self.assertIsNone(self.cmd.args_of(name),
                              f"{msg['cmd']} reached CMD.{name} despite refusal")
        return r["error"]

    def test_infinite_wcs_word_never_reaches_the_mdi(self):
        err = self._refused({"cmd": "set_wcs", "target": "active", "x": float("inf")}, "mdi")
        self.assertIn("finite", err.lower())

    def test_out_of_range_joint_never_reaches_cmd_home(self):
        self._refused({"cmd": "home", "joint": 99}, "home")

    def test_out_of_range_axis_never_reaches_cmd_jog(self):
        self._refused({"cmd": "jog_cont", "axis": 7, "vel": 1.0}, "jog")

    def test_oversized_jog_multi_list_never_reaches_cmd_jog(self):
        self._refused({"cmd": "jog_cont_multi",
                       "axes": [{"axis": 0, "vel": 1.0}] * 10_000}, "jog")

    def test_overlong_mdi_never_reaches_cmd_mdi(self):
        err = self._refused({"cmd": "mdi", "text": "G1 X1 " * 60}, "mdi")
        self.assertIn("truncat", err.lower())

    def test_negative_spindle_speed_reaches_cmd_clamped_to_zero(self):
        r = self._send({"cmd": "spindle_forward", "speed": -5000})
        self.assertTrue(r["ok"])
        args = self.cmd.args_of("spindle")
        self.assertIsNotNone(args, "CMD.spindle was never called")
        self.assertGreaterEqual(args[-1], 0, "negative RPM reached CMD.spindle")

    def test_feed_override_clamped_to_the_ini_ceiling(self):
        # The handler used to hardcode 2.0; this machine declares 1.5.
        r = self._send({"cmd": "set_feed_override", "scale": 2.0})
        self.assertTrue(r["ok"])
        self.assertAlmostEqual(r["scale"], 1.5)
        self.assertAlmostEqual(self.cmd.args_of("feedrate")[0], 1.5)

    def test_conforming_command_still_reaches_cmd_unchanged(self):
        # The bounds pass must not disturb a valid payload.
        r = self._send({"cmd": "set_feed_override", "scale": 1.2})
        self.assertTrue(r["ok"])
        self.assertAlmostEqual(self.cmd.args_of("feedrate")[0], 1.2)


class TestFusionWorkerSubprocess(unittest.TestCase):
    """The harness proved in-thread decode trips the watchdog at the cap — large
    imports now run in a real subprocess (own GIL). Round-trip a blob through it."""

    def test_worker_roundtrip(self):
        lib = ('{"data":[{"type":"flat end mill","unit":"millimeters",'
               '"post-process":{"number":3},"geometry":{"DC":6.0},'
               '"description":"6mm endmill"}]}').encode()
        parsed, skipped = gateway._bulk._run_fusion_worker_blocking(lib, "mm", timeout=30.0)
        self.assertEqual(parsed[0]["T"], 3)
        self.assertEqual(parsed[0]["D"], 6.0)
        self.assertEqual(skipped, [])

    def test_worker_invalid_library_maps_to_valueerror(self):
        with self.assertRaises(ValueError):
            gateway._bulk._run_fusion_worker_blocking(b'{"nope":1}', "mm", timeout=30.0)


class TestGoToZeroAndJogStopDispatch(unittest.TestCase):
    """2026-09-04: the → Zero handler through the REAL payload shape, and the
    jog-stop / mode-switch holes that made it 'sometimes work'."""

    def setUp(self):
        gateway.lcnc_connected = True
        gateway.STAT = linuxcnc.stat()
        self.cmd = _RecordingCmd()
        gateway.CMD = self.cmd
        self._switchable = gateway._kins_is_switchable
        self._prov = dict(gateway._prov_cache)
        gateway._prov_cache.clear()

    def tearDown(self):
        gateway._kins_is_switchable = self._switchable
        gateway._prov_cache.clear()
        gateway._prov_cache.update(self._prov)

    def _send(self, msg, **state):
        gateway._shared_status = _payload(**state)
        return _run(gateway.handle_command(msg, True))

    def _mdi_lines(self):
        return [a[0] for n, a, _k in self.cmd.calls if n == "mdi"]

    def test_machine_frame_calls_the_subroutine_at_the_stamp_angle(self):
        gateway._kins_is_switchable = lambda: True
        gateway._prov_cache[1] = {"kins": 0.0, "a": 20.0, "x": 0.0, "y": 0.0, "z": 0.0}
        r = self._send({"cmd": "go_to_zero"}, kins_type=0, twp_active=False, g5x_index=1)
        self.assertTrue(r["ok"], r)
        self.assertEqual(self._mdi_lines(), ["O<go_to_zero> CALL [20.0000]"])

    def test_plane_frame_reads_work_pos_from_the_payload_object(self):
        # The payload is an OBJECT (attribute access): the first cut read it
        # as a dict and refused every press with "Plane position unknown".
        gateway._kins_is_switchable = lambda: True
        r = self._send({"cmd": "go_to_zero"}, kins_type=2, twp_active=True, g5x_index=6,
                       work_pos=[1.0, 2.0, -5.0])
        self.assertTrue(r["ok"], r)
        self.assertEqual(self._mdi_lines(), ["G0 Z25.0000", "G0 X0 Y0"])

    def test_plane_frame_without_work_pos_is_the_only_unknown_path(self):
        gateway._kins_is_switchable = lambda: True
        r = self._send({"cmd": "go_to_zero"}, kins_type=2, twp_active=True, g5x_index=6)
        self.assertFalse(r["ok"])
        self.assertIn("position unknown", r["error"])
        self.assertEqual(self._mdi_lines(), [])

    def test_tcp_is_refused_with_its_reason(self):
        gateway._kins_is_switchable = lambda: True
        r = self._send({"cmd": "go_to_zero"}, kins_type=1, twp_active=False, g5x_index=1)
        self.assertFalse(r["ok"])
        self.assertIn("TCP", r["error"])

    def test_jog_stop_during_an_executing_mdi_never_switches_mode(self):
        # Releasing the A jog while → Zero moves used to force MANUAL and
        # abort the MDI wherever it was.
        gateway.STAT.task_mode = linuxcnc.MODE_MDI
        gateway.STAT.interp_state = linuxcnc.INTERP_READING
        r = self._send({"cmd": "jog_stop", "axis": 3})
        self.assertTrue(r["ok"])
        self.assertIsNone(self.cmd.args_of("mode"), "mode switch would abort the MDI")
        self.assertIsNone(self.cmd.args_of("jog"))
        r = self._send({"cmd": "jog_stop_multi", "axes": [0, 3]})
        self.assertTrue(r["ok"])
        self.assertIsNone(self.cmd.args_of("mode"))

    def test_jog_stop_still_stops_a_real_jog_in_manual(self):
        gateway.STAT.task_mode = linuxcnc.MODE_MANUAL
        gateway.STAT.interp_state = linuxcnc.INTERP_IDLE
        r = self._send({"cmd": "jog_stop", "axis": 3})
        self.assertTrue(r["ok"])
        self.assertIsNotNone(self.cmd.args_of("jog"))

    def test_refused_mode_switch_is_a_loud_reply_not_a_silent_mdi(self):
        class _RefusingCmd(_RecordingCmd):
            def __getattr__(self, name):
                if name == "mode":
                    def refuse(*a, **k):
                        self.calls.append(("mode", a, k)); return None
                    return refuse
                if name == "wait_complete":
                    return lambda *a, **k: getattr(linuxcnc, "RCS_ERROR", 3)
                return super().__getattr__(name)
        gateway.CMD = self.cmd = _RefusingCmd()
        gateway.STAT.task_mode = linuxcnc.MODE_MANUAL
        gateway.STAT.interp_state = linuxcnc.INTERP_IDLE
        r = self._send({"cmd": "mdi", "text": "G0 X0"})
        self.assertFalse(r["ok"])
        self.assertIn("refused the mode switch", r["error"])
        self.assertEqual(self._mdi_lines(), [])
