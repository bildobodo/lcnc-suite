"""RFL × M600 guard (run-from-line toolchange): the background sequence must
measure via MDI first, verify tool + applied offset + error-free window before
arming the one-shot #3116 flag, refuse to start on any failure, never leave a
stale flag behind, and verify the safe-Z step leaves Z at or above machine
zero — never lowering it (a retract never lowers Z, 2026-09-04)."""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import fake_linuxcnc  # noqa: E402

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`
import gateway  # noqa: E402


class _Stat:
    """Scriptable STAT stub: attrs are plain fields; poll() advances a script."""
    def __init__(self, **kw):
        self.task_state = linuxcnc.STATE_ON
        self.interp_state = linuxcnc.INTERP_IDLE
        self.tool_in_spindle = 0
        self.tool_offset = (0.0,) * 9
        self.position = (0.0, 0.0, 0.0)
        self.__dict__.update(kw)
        self._script = []   # list of dicts applied successively on poll()

    def poll(self):
        if self._script:
            self.__dict__.update(self._script.pop(0))


class _SeqHarness(unittest.IsolatedAsyncioTestCase):
    """Common monkeypatching for _rfl_sequence tests."""

    def setUp(self):
        self.mdi_calls = []
        self.auto_run_calls = []
        self._orig = {
            "STAT": gateway.STAT, "CMD": gateway.CMD,
            "_rfl_mdi_step": gateway._rfl_mdi_step,
            "set_mode": gateway.set_mode,
            "_cmd_blocking": gateway._cmd_blocking,
            "_rfl_task": gateway._rfl_task,
            "_rfl_flag_task": gateway._rfl_flag_task,
            "_rfl_status": gateway._rfl_status,
            "_errors_total": gateway._errors_total,
        }
        gateway._cmd_lock = None  # fresh lock per asyncio loop (test pattern)
        gateway._rfl_task = gateway._rfl_flag_task = None
        gateway._rfl_status = None
        gateway.STAT = _Stat()
        gateway.CMD = type("C", (), {"auto": lambda *a: None,
                                     "spindle": lambda *a: None,
                                     "mode": lambda *a: None})()

        test = self

        async def _fake_mdi_step(text, timeout_s):
            test.mdi_calls.append(text)
            return (True, "")

        async def _fake_set_mode(mode):
            return None

        async def _fake_cmd_blocking(fn, *args, wait=None):
            if args and args[0] == linuxcnc.AUTO_RUN:
                test.auto_run_calls.append(args)
            return 0

        gateway._rfl_mdi_step = _fake_mdi_step
        gateway.set_mode = _fake_set_mode
        gateway._cmd_blocking = _fake_cmd_blocking

    def tearDown(self):
        for k, v in self._orig.items():
            setattr(gateway, k, v)
        gateway._cmd_lock = None


class TestRflSequence(_SeqHarness):
    async def test_happy_path_measures_flags_and_runs(self):
        gateway.STAT.tool_in_spindle = 5
        gateway.STAT.tool_offset = (0, 0, 45.7, 0, 0, 0, 0, 0, 0)
        await gateway._rfl_sequence(120, pre_tool=5, safe_z=False,
                                    spindle_dir=None, spindle_speed=0)
        self.assertEqual(self.mdi_calls, ["T5 M600", "#3116=5"])
        self.assertEqual(len(self.auto_run_calls), 1)
        self.assertEqual(self.auto_run_calls[0][1], 120)  # start line
        self.assertEqual(gateway._rfl_status["phase"], "running")
        self.assertFalse(gateway._rfl_busy())

    async def test_tool_verification_failure_blocks_start(self):
        gateway.STAT.tool_in_spindle = 3      # wrong tool stayed in spindle
        gateway.STAT.tool_offset = (0, 0, 45.7, 0, 0, 0, 0, 0, 0)
        await gateway._rfl_sequence(120, pre_tool=5, safe_z=False,
                                    spindle_dir=None, spindle_speed=0)
        self.assertEqual(self.mdi_calls, ["T5 M600"])   # no flag armed
        self.assertEqual(self.auto_run_calls, [])        # no program start
        self.assertEqual(gateway._rfl_status["phase"], "measure_failed")
        self.assertFalse(gateway._rfl_busy())

    async def test_zero_applied_offset_blocks_start(self):
        gateway.STAT.tool_in_spindle = 5
        gateway.STAT.tool_offset = (0.0,) * 9   # G43 never applied
        await gateway._rfl_sequence(120, pre_tool=5, safe_z=False,
                                    spindle_dir=None, spindle_speed=0)
        self.assertEqual(self.auto_run_calls, [])
        self.assertEqual(gateway._rfl_status["phase"], "measure_failed")

    async def test_errors_during_measurement_block_start(self):
        gateway.STAT.tool_in_spindle = 5
        gateway.STAT.tool_offset = (0, 0, 45.7, 0, 0, 0, 0, 0, 0)
        test = self

        async def _mdi_with_error(text, timeout_s):
            test.mdi_calls.append(text)
            if "M600" in text:
                gateway._errors_total += 1   # abort → "probe interrupted" error
            return (True, "")

        gateway._rfl_mdi_step = _mdi_with_error
        await gateway._rfl_sequence(120, pre_tool=5, safe_z=False,
                                    spindle_dir=None, spindle_speed=0)
        self.assertEqual(self.mdi_calls, ["T5 M600"])   # refused before flag
        self.assertEqual(self.auto_run_calls, [])
        self.assertEqual(gateway._rfl_status["phase"], "measure_failed")

    async def test_failure_after_flag_clears_it(self):
        gateway.STAT.tool_in_spindle = 5
        gateway.STAT.tool_offset = (0, 0, 45.7, 0, 0, 0, 0, 0, 0)
        test = self

        async def _cmd_blocking_boom(fn, *args, wait=None):
            if args and args[0] == linuxcnc.AUTO_RUN:
                raise RuntimeError("NML rejected")
            return 0

        gateway._cmd_blocking = _cmd_blocking_boom
        await gateway._rfl_sequence(120, pre_tool=5, safe_z=False,
                                    spindle_dir=None, spindle_speed=0)
        # Flag was armed, AUTO_RUN failed → finally MUST clear the flag (its
        # own task since R17 XZ-10).
        await asyncio.wait_for(gateway._rfl_flag_task, 2)
        self.assertEqual(self.mdi_calls, ["T5 M600", "#3116=5", "#3116=0"])
        self.assertEqual(gateway._rfl_status["phase"], "failed")
        self.assertFalse(gateway._rfl_busy())

    async def test_safe_z_position_verified(self):
        gateway.STAT.position = (0.0, 0.0, -42.0)   # abort left Z down
        await gateway._rfl_sequence(120, pre_tool=0, safe_z=True,
                                    spindle_dir=None, spindle_speed=0)
        self.assertEqual(self.mdi_calls, ["G53 G0 Z0"])
        self.assertEqual(self.auto_run_calls, [])    # refused: still below safe height
        self.assertEqual(gateway._rfl_status["phase"], "safe_z_failed")

    async def test_safe_z_reached_from_below_starts(self):
        gateway.STAT.position = (0.0, 0.0, -42.0)
        # poll 1 (decide) leaves Z at -42 → the retract is sent; poll 2 (verify)
        # sees the move landed at machine zero.
        gateway.STAT._script = [{}, {"position": (0.0, 0.0, 0.0)}]
        await gateway._rfl_sequence(7, pre_tool=0, safe_z=True,
                                    spindle_dir=None, spindle_speed=0)
        self.assertEqual(self.mdi_calls, ["G53 G0 Z0"])
        self.assertEqual(len(self.auto_run_calls), 1)
        self.assertEqual(gateway._rfl_status["phase"], "running")

    async def test_safe_z_at_zero_skips_mdi_and_starts(self):
        gateway.STAT.position = (0.0, 0.0, 0.0)
        await gateway._rfl_sequence(7, pre_tool=0, safe_z=True,
                                    spindle_dir=None, spindle_speed=0)
        self.assertEqual(self.mdi_calls, [])          # already at safe height
        self.assertEqual(len(self.auto_run_calls), 1)
        self.assertEqual(gateway._rfl_status["phase"], "running")

    async def test_safe_z_above_zero_skips_mdi(self):
        # A config whose Z window extends above machine zero: "retract" must
        # never LOWER Z to reach Z0.
        gateway.STAT.position = (0.0, 0.0, 50.0)
        await gateway._rfl_sequence(7, pre_tool=0, safe_z=True,
                                    spindle_dir=None, spindle_speed=0)
        self.assertEqual(self.mdi_calls, [])
        self.assertEqual(len(self.auto_run_calls), 1)
        self.assertEqual(gateway._rfl_status["phase"], "running")


class TestWaitInterpIdle(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._orig_stat = gateway.STAT

    def tearDown(self):
        gateway.STAT = self._orig_stat

    async def test_started_then_idle_completes(self):
        st = _Stat(interp_state=linuxcnc.INTERP_READING)
        st._script = [{}, {}, {"interp_state": linuxcnc.INTERP_IDLE}]
        gateway.STAT = st
        ok, why = await gateway._rfl_wait_interp_idle(5.0, grace_s=0.05)
        self.assertTrue(ok, why)

    async def test_instant_command_completes_after_grace(self):
        gateway.STAT = _Stat()   # never leaves idle (assignment finished between polls)
        ok, why = await gateway._rfl_wait_interp_idle(5.0, grace_s=0.15)
        self.assertTrue(ok, why)

    async def test_estop_fails(self):
        st = _Stat(interp_state=linuxcnc.INTERP_READING)
        st._script = [{}, {"task_state": linuxcnc.STATE_ESTOP}]
        gateway.STAT = st
        ok, why = await gateway._rfl_wait_interp_idle(5.0, grace_s=0.05)
        self.assertFalse(ok)
        self.assertIn("estop", why)

    async def test_timeout_while_busy(self):
        gateway.STAT = _Stat(interp_state=linuxcnc.INTERP_READING)
        ok, why = await gateway._rfl_wait_interp_idle(0.3, grace_s=0.05)
        self.assertFalse(ok)
        self.assertIn("timeout", why)


if __name__ == "__main__":
    unittest.main()


class TestRflEntry(unittest.TestCase):
    """Position-preamble helpers: MDI composition + landed-position verification."""

    def test_mdi_composition_full(self):
        mdi = gateway._rfl_entry_mdi({"x": 12.5, "y": -3.0, "wcs": "G55", "units": "G21"})
        self.assertEqual(mdi, "G21 G55 G90 G0 X12.5000 Y-3.0000")

    def test_mdi_composition_partial_axes(self):
        self.assertEqual(gateway._rfl_entry_mdi({"x": 7.0, "y": None}), "G90 G0 X7.0000")
        self.assertEqual(gateway._rfl_entry_mdi({"x": None, "y": 2.0}), "G90 G0 Y2.0000")

    def test_reached_with_g5x_offset(self):
        orig = gateway.STAT
        try:
            gateway.STAT = _Stat()
            gateway.STAT.g5x_offset = (100.0, 50.0) + (0.0,) * 7
            gateway.STAT.g92_offset = (0.0,) * 9
            gateway.STAT.position = (112.5, 47.0, 0.0)
            ok, why = gateway._rfl_entry_reached({"x": 12.5, "y": -3.0})
            self.assertTrue(ok, why)
            # off by 5mm in Y → refused
            gateway.STAT.position = (112.5, 42.0, 0.0)
            ok, why = gateway._rfl_entry_reached({"x": 12.5, "y": -3.0})
            self.assertFalse(ok)
            self.assertIn("Y", why)
        finally:
            gateway.STAT = orig


class TestRflSequenceEntry(_SeqHarness):
    async def test_entry_positions_then_runs(self):
        gateway.STAT.position = (12.5, -3.0, -100.0)   # below safe height → retract sent
        gateway.STAT._script = [{}, {"position": (12.5, -3.0, 0.0)}]
        gateway.STAT.g5x_offset = (0.0,) * 9
        gateway.STAT.g92_offset = (0.0,) * 9
        await gateway._rfl_sequence(50, pre_tool=0, safe_z=True,
                                    spindle_dir=None, spindle_speed=0,
                                    entry={"x": 12.5, "y": -3.0, "wcs": None, "units": None})
        self.assertEqual(self.mdi_calls, ["G53 G0 Z0", "G90 G0 X12.5000 Y-3.0000"])
        self.assertEqual(len(self.auto_run_calls), 1)
        self.assertEqual(gateway._rfl_status["phase"], "running")

    async def test_entry_position_mismatch_blocks_start(self):
        gateway.STAT.position = (99.0, -3.0, 0.0)   # abort left X short
        gateway.STAT.g5x_offset = (0.0,) * 9
        gateway.STAT.g92_offset = (0.0,) * 9
        await gateway._rfl_sequence(50, pre_tool=0, safe_z=True,
                                    spindle_dir=None, spindle_speed=0,
                                    entry={"x": 12.5, "y": -3.0, "wcs": None, "units": None})
        self.assertEqual(self.auto_run_calls, [])
        self.assertEqual(gateway._rfl_status["phase"], "positioning_failed")


class TestRflSequenceBinding(_SeqHarness):
    """Codex R16 XZ-07: the sequence runs for minutes (the measurement alone)
    — the program Run from line was confirmed on must still be the loaded
    one, unchanged on disk, before every step that moves; and an abort from
    any client ends it (it is no in-flight handler _preempt_inflight saw)."""

    def setUp(self):
        super().setUp()
        self._orig_program = gateway._status_runtime.program
        self.fresh_program()

    def fresh_program(self):
        """A loaded, unchanged program — per case, without re-patching
        (a second super().setUp() would record the fakes as originals)."""
        import tempfile
        import time as _time
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.prog = os.path.join(tmp.name, "a.ngc")
        with open(self.prog, "w") as f:
            f.write("T5 M600\nG0 X10 Y20\nG1 X11\nM2\n")
        self.program = gateway._status_runtime.program = gateway._status_runtime_mod.LoadedProgram()
        self.program.update(None, True, _time.monotonic())
        self.program.request_load(self.prog, _time.monotonic())
        self.program.update(self.prog, True, _time.monotonic())
        gateway.STAT.tool_in_spindle = 5
        gateway.STAT.tool_offset = (0, 0, 45.7, 0, 0, 0, 0, 0, 0)
        gateway.STAT.position = (0.0, 0.0, -100.0)

    def tearDown(self):
        gateway._status_runtime.program = self._orig_program
        super().tearDown()

    async def test_a_program_change_during_the_measurement_starts_nothing(self):
        import time as _time
        def load_other():
            other = self.prog + ".b.ngc"
            with open(other, "w") as f:
                f.write("T8 M600\nG0 X80 Y90\nM2\n")
            self.program.request_load(other, _time.monotonic())
            self.program.update(other, True, _time.monotonic())

        def rewrite():
            with open(self.prog, "a") as f:
                f.write("(edited)\n")

        def rewrite_keeping_size_and_mtime():
            # Codex R17 XZ-07: a stat is no text identity — timestamps can be
            # preserved (and a write inside one kernel tick keeps them).
            st = os.stat(self.prog)
            with open(self.prog, "r+") as f:
                f.write("T8")
            os.utime(self.prog, ns=(st.st_atime_ns, st.st_mtime_ns))

        for change in (load_other, rewrite, rewrite_keeping_size_and_mtime):
            with self.subTest(change=change.__name__):
                self.fresh_program()
                identity = self.bound()
                self.mdi_calls.clear()
                self.auto_run_calls.clear()

                async def step(text, timeout_s, change=change):
                    self.mdi_calls.append(text)
                    if text == "T5 M600":
                        change()
                    return True, ""
                gateway._rfl_mdi_step = step
                await gateway._rfl_sequence(4, pre_tool=5, safe_z=True, spindle_dir=None,
                                            spindle_speed=0, program=identity)
                self.assertEqual(self.auto_run_calls, [])
                self.assertEqual(self.mdi_calls, ["T5 M600"], "no flag, no retract, no start")
                self.assertEqual(gateway._rfl_status["phase"], "program_changed")
                self.assertFalse(gateway._rfl_busy())

    def bound(self):
        """What the handler binds the sequence to: the path and the text's
        fingerprint (Codex R17 XZ-07)."""
        return (self.prog, gateway.program_source(self.prog))

    async def test_a_republish_without_a_text_change_keeps_it_going(self):
        # The pre-measurement changes the TLO — the preview re-parses and its
        # version moves on; the text did not change, the run goes on.
        async def step(text, timeout_s):
            self.mdi_calls.append(text)
            if text == "T5 M600":
                gateway._bulk.preview_version += 1
            return True, ""
        gateway._rfl_mdi_step = step
        gateway.STAT._script = [{}, {}, {"position": (0.0, 0.0, 0.0)}]
        await gateway._rfl_sequence(4, pre_tool=5, safe_z=True, spindle_dir=None,
                                    spindle_speed=0, program=self.bound())
        self.assertEqual(len(self.auto_run_calls), 1)
        self.assertEqual(gateway._rfl_status["phase"], "running")

    async def test_the_unchanged_program_runs(self):
        identity = self.bound()
        gateway.STAT._script = [{}, {}, {"position": (0.0, 0.0, 0.0)}]
        await gateway._rfl_sequence(4, pre_tool=5, safe_z=True, spindle_dir=None,
                                    spindle_speed=0, program=identity)
        self.assertEqual(self.mdi_calls, ["T5 M600", "#3116=5", "G53 G0 Z0"])
        self.assertEqual(len(self.auto_run_calls), 1)

    async def test_an_abort_from_any_client_ends_the_sequence(self):
        started, hold = asyncio.Event(), asyncio.Event()

        async def step(text, timeout_s):
            self.mdi_calls.append(text)
            started.set()
            await hold.wait()
            return True, ""
        gateway._rfl_mdi_step = step
        task = asyncio.ensure_future(gateway._rfl_sequence(
            4, pre_tool=5, safe_z=True, spindle_dir=None, spindle_speed=0,
            program=self.bound()))
        gateway._rfl_task = task
        await started.wait()
        gateway._preempt_inflight(by="abort", from_client=99)
        done, _ = await asyncio.wait({task}, timeout=2)
        self.assertTrue(done, "the abort did not end the sequence")
        self.assertTrue(task.cancelled())
        self.assertEqual(self.mdi_calls, ["T5 M600"])
        self.assertEqual(self.auto_run_calls, [])
        self.assertEqual(gateway._rfl_status["phase"], "aborted")
        self.assertFalse(gateway._rfl_busy())


class TestRflLifecycle(_SeqHarness):
    """Codex R17 XZ-10: the latch and the end report follow the TASK — a
    cancel before the first step never entered the body's finally, and a
    second abort during the #3116 clear skipped every release after it: the
    latch stayed set, load/unload and every later sequence were refused."""

    def setUp(self):
        super().setUp()
        gateway.STAT.tool_in_spindle = 5
        gateway.STAT.tool_offset = (0, 0, 45.7, 0, 0, 0, 0, 0, 0)
        gateway.STAT.position = (0.0, 0.0, -100.0)
        self.cleared = []

    def start(self):
        return gateway._rfl_start(4, 5, True, None, 0)

    async def settle(self):
        for _ in range(200):
            if not gateway._rfl_busy():
                return
            await asyncio.sleep(0.01)
        self.fail("the run-from-line latch stayed set")

    def blocking_steps(self, *, clear=None):
        """MDI steps: the measurement and the flag go through, the retract
        blocks until cancelled; the clear runs `clear` (default: completes)."""
        self.retracting = asyncio.Event()

        async def step(text, timeout_s):
            self.mdi_calls.append(text)
            if text == "G53 G0 Z0":
                self.retracting.set()
                await asyncio.Event().wait()
            if text == "#3116=0":
                if clear is not None:
                    await clear()
                self.cleared.append(text)
            return True, ""
        gateway._rfl_mdi_step = step

    async def test_an_abort_before_the_first_step(self):
        task = self.start()
        gateway._preempt_inflight(by="abort", from_client=1)   # same tick: the body never ran
        await self.settle()
        self.assertTrue(task.cancelled())
        self.assertEqual((self.mdi_calls, self.auto_run_calls), ([], []))
        self.assertEqual(gateway._rfl_status["phase"], "aborted")
        self.assertIsNone(gateway._rfl_task)

    async def test_one_abort_during_the_retract(self):
        self.blocking_steps()
        self.start()
        await asyncio.wait_for(self.retracting.wait(), 2)
        gateway._preempt_inflight(by="abort", from_client=1)
        await self.settle()
        self.assertEqual(self.mdi_calls, ["T5 M600", "#3116=5", "G53 G0 Z0", "#3116=0"])
        self.assertEqual(self.cleared, ["#3116=0"])
        self.assertEqual(self.auto_run_calls, [])
        self.assertEqual(gateway._rfl_status["phase"], "aborted")

    async def test_a_second_abort_during_the_flag_clear(self):
        clearing, release = asyncio.Event(), asyncio.Event()

        async def clear():
            clearing.set()
            await release.wait()
        self.blocking_steps(clear=clear)
        self.start()
        await asyncio.wait_for(self.retracting.wait(), 2)
        gateway._preempt_inflight(by="abort", from_client=1)
        await asyncio.wait_for(clearing.wait(), 2)
        gateway._preempt_inflight(by="abort", from_client=2)
        await asyncio.sleep(0.05)
        self.assertTrue(gateway._rfl_busy(), "no new sequence while the old flag is being cleared")
        release.set()
        await self.settle()
        self.assertEqual(self.cleared, ["#3116=0"], "the second abort did not cut the clear short")
        self.assertEqual(self.auto_run_calls, [])
        self.assertEqual(gateway._rfl_status["phase"], "aborted")

    async def test_a_failing_flag_clear_is_told_and_releases(self):
        async def clear():
            raise RuntimeError("machine off")
        self.blocking_steps(clear=clear)
        self.start()
        await asyncio.wait_for(self.retracting.wait(), 2)
        gateway._preempt_inflight(by="estop", from_client=1)
        await self.settle()
        self.assertEqual(self.cleared, [])
        self.assertEqual(gateway._rfl_status["phase"], "flag_clear_failed")
        self.assertFalse(gateway._rfl_status["ok"])
        self.assertIn("#3116", gateway._rfl_status["error"])

    async def test_the_flag_clear_waits_until_the_abort_stopped_the_interpreter(self):
        # Live 2026-09-27 (R17 check): the clear ran the instant the sequence
        # was cancelled — the aborted positioning move still ran, the MDI was
        # refused ("MDI command in progress"), #3116 stayed armed and the next
        # pre-measurement of that tool was skipped (2.2 s, no probe trip).
        seen = []

        async def clear():
            seen.append(gateway.STAT.interp_state)
            if gateway.STAT.interp_state != linuxcnc.INTERP_IDLE:
                raise AssertionError("MDI command in progress — command rejected")
        self.blocking_steps(clear=clear)
        self.start()
        await asyncio.wait_for(self.retracting.wait(), 2)
        gateway.STAT.interp_state = linuxcnc.INTERP_READING    # the aborted move still runs
        gateway._preempt_inflight(by="abort", from_client=1)
        await asyncio.sleep(0.4)
        gateway.STAT.interp_state = linuxcnc.INTERP_IDLE       # the abort took effect
        await self.settle()
        self.assertEqual(seen, [linuxcnc.INTERP_IDLE], "cleared only once the interpreter was idle")
        self.assertEqual(self.cleared, ["#3116=0"])
        self.assertEqual(gateway._rfl_status["phase"], "aborted")

    async def test_a_moment_of_idle_before_the_abort_lands_is_not_trusted(self):
        # The interpreter reads idle for an instant between two blocks (or
        # before task handled the abort): the clear waits for an idle that
        # holds, not for the first idle sample.
        stages = []
        self.stage = "early"

        async def clear():
            stages.append(self.stage)
        self.blocking_steps(clear=clear)
        self.start()
        await asyncio.wait_for(self.retracting.wait(), 2)
        gateway.STAT.interp_state = linuxcnc.INTERP_IDLE
        gateway._preempt_inflight(by="abort", from_client=1)
        await asyncio.sleep(0.1)
        gateway.STAT.interp_state = linuxcnc.INTERP_READING     # it was still running
        await asyncio.sleep(0.4)
        self.stage = "late"
        gateway.STAT.interp_state = linuxcnc.INTERP_IDLE
        await self.settle()
        self.assertEqual(stages, ["late"])

    async def test_a_machine_that_went_off_is_told_not_waited_for(self):
        self.blocking_steps()
        self.start()
        await asyncio.wait_for(self.retracting.wait(), 2)
        gateway.STAT.task_state = linuxcnc.STATE_ESTOP
        gateway._preempt_inflight(by="estop", from_client=1)
        await self.settle()
        self.assertEqual(self.cleared, [], "no MDI with the machine off")
        self.assertEqual(gateway._rfl_status["phase"], "flag_clear_failed")
        self.assertIn("#3116", gateway._rfl_status["error"])

    async def test_an_old_task_never_releases_a_newer_one(self):
        old = self.start()
        gateway._preempt_inflight(by="abort", from_client=1)
        await self.settle()
        self.blocking_steps()
        new = self.start()
        old_status = dict(gateway._rfl_status)
        gateway._rfl_finished(old)                  # a late callback of the old task
        self.assertIs(gateway._rfl_task, new)
        self.assertEqual(gateway._rfl_status, old_status)
        self.assertTrue(gateway._rfl_busy())
        new.cancel()
        await self.settle()
