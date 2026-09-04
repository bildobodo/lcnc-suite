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
            "_rfl_active": gateway._rfl_active,
            "_rfl_status": gateway._rfl_status,
            "_errors_total": gateway._errors_total,
        }
        gateway._cmd_lock = None  # fresh lock per asyncio loop (test pattern)
        gateway._rfl_active = True  # sequence entered as the handler would set it
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
        self.assertFalse(gateway._rfl_active)

    async def test_tool_verification_failure_blocks_start(self):
        gateway.STAT.tool_in_spindle = 3      # wrong tool stayed in spindle
        gateway.STAT.tool_offset = (0, 0, 45.7, 0, 0, 0, 0, 0, 0)
        await gateway._rfl_sequence(120, pre_tool=5, safe_z=False,
                                    spindle_dir=None, spindle_speed=0)
        self.assertEqual(self.mdi_calls, ["T5 M600"])   # no flag armed
        self.assertEqual(self.auto_run_calls, [])        # no program start
        self.assertEqual(gateway._rfl_status["phase"], "measure_failed")
        self.assertFalse(gateway._rfl_active)

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
        # Flag was armed, AUTO_RUN failed → finally MUST clear the flag.
        self.assertEqual(self.mdi_calls, ["T5 M600", "#3116=5", "#3116=0"])
        self.assertEqual(gateway._rfl_status["phase"], "failed")
        self.assertFalse(gateway._rfl_active)

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
