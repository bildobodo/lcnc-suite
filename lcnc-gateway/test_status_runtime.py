"""Unit tests for status_runtime (M2) — scripted STAT/ERR/reader stubs, real
var files and INIs in a tempdir. No gateway import, no running LinuxCNC."""
import os
import tempfile
import unittest
from unittest import mock

import linuxcnc

import status_runtime
from status_runtime import StatusRuntime


class _Stat:
    """Sparse STAT stub: safe_get falls back to default for absent attrs."""
    def __init__(self, **attrs):
        self.polled = 0
        self.__dict__.update(attrs)

    def poll(self):
        self.polled += 1


def _runtime(stat=None, err=None, snapshot=None, tbl_path=None,
             library=None, fb_scale=60):
    snap = snapshot if snapshot is not None else {}
    return StatusRuntime(
        get_stat=lambda: stat,
        get_err=lambda: err,
        reader_get=snap.get,
        get_tool_tbl_path=lambda: tbl_path,
        load_tool_library=lambda: library or {},
        get_fb_scale=lambda: fb_scale,
    )


class TestProgramTimer(unittest.TestCase):
    def _drive(self, rt, mono, interp, paused=False):
        with mock.patch("status_runtime.time.monotonic", return_value=mono):
            return rt.update_program_timer(interp, paused)

    def test_full_run_lifecycle(self):
        rt = _runtime()
        IDLE, RUN = linuxcnc.INTERP_IDLE, linuxcnc.INTERP_READING
        # never run → None
        self.assertIsNone(self._drive(rt, 100.0, IDLE))
        # idle → active: clock starts
        self.assertEqual(self._drive(rt, 101.0, RUN), 0)
        self.assertEqual(self._drive(rt, 105.0, RUN), 4000)
        # running → paused: clock freezes at pause start
        self.assertEqual(self._drive(rt, 106.0, RUN, paused=True), 5000)
        self.assertEqual(self._drive(rt, 110.0, RUN, paused=True), 5000)
        # paused → running: pause segment excluded
        self.assertEqual(self._drive(rt, 112.0, RUN), 5000)
        self.assertEqual(self._drive(rt, 114.0, RUN), 7000)
        # active → idle: final value frozen
        self.assertEqual(self._drive(rt, 115.0, IDLE), 8000)
        self.assertEqual(self._drive(rt, 200.0, IDLE), 8000)
        # next run resets
        self.assertEqual(self._drive(rt, 300.0, RUN), 0)

    def test_interp_paused_state_counts_as_paused(self):
        # STAT.paused can lag; INTERP_PAUSED alone must open a pause segment.
        rt = _runtime()
        RUN, PAUSED = linuxcnc.INTERP_READING, linuxcnc.INTERP_PAUSED
        self._drive(rt, 10.0, RUN)
        self.assertEqual(self._drive(rt, 12.0, PAUSED), 2000)
        self.assertEqual(self._drive(rt, 20.0, PAUSED), 2000)


class TestVarFileAndWcs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.var = os.path.join(self.tmp.name, "test.var")
        self.ini = os.path.join(self.tmp.name, "test.ini")
        with open(self.ini, "w") as f:
            f.write("[RS274NGC]\nPARAMETER_FILE = test.var\n")
        # G54 (5221-5229 + 5230 rotation), G55 X (5241)
        with open(self.var, "w") as f:
            f.write("5221\t10.5\n5222\t-3.25\n5223\t2.0\n5230\t45.0\n5241\t99.0\n")

    def tearDown(self):
        self.tmp.cleanup()

    # The suite installs fake_linuxcnc process-wide (test_rfl_guard /
    # test_command_dispatch import it before us), so these tests stub the INI
    # parser explicitly instead of relying on the real linuxcnc.ini.
    class _IniStub:
        calls = 0

        def __init__(self, path):
            type(self).calls += 1
            self.path = path

        def find(self, section, key):
            assert (section, key) == ("RS274NGC", "PARAMETER_FILE")
            return "test.var"

    def _patch_ini(self):
        self._IniStub.calls = 0
        return mock.patch("status_runtime.linuxcnc.ini", self._IniStub)

    def test_resolve_memoized_per_ini(self):
        stat = _Stat(ini_filename=self.ini)
        rt = _runtime(stat=stat)
        with self._patch_ini():
            self.assertEqual(rt.resolve_var_file_path(), self.var)
            self.assertEqual(rt.resolve_var_file_path(), self.var)
            self.assertEqual(self._IniStub.calls, 1)  # parsed once, not per call
            rt.invalidate_var_file_path()
            self.assertEqual(rt.resolve_var_file_path(), self.var)
            self.assertEqual(self._IniStub.calls, 2)  # re-resolved after reconnect

    def test_seed_wcs_cache_and_mtime_invalidation(self):
        stat = _Stat(ini_filename=self.ini)
        rt = _runtime(stat=stat)
        with self._patch_ini():
            rt.seed_wcs_cache()
        self.assertEqual(rt.wcs_cache[0]["x"], 10.5)
        self.assertEqual(rt.wcs_cache[0]["y"], -3.25)
        self.assertEqual(rt.wcs_cache[0]["r"], 45.0)
        self.assertEqual(rt.wcs_cache[1]["x"], 99.0)
        # invalidate_wcs_mtime forces the poll-path reseed condition
        self.assertIsNotNone(rt._wcs_var_file_mtime)
        rt.invalidate_wcs_mtime()
        self.assertIsNone(rt._wcs_var_file_mtime)

    def test_write_var_file_updates_replaces_and_inserts_sorted(self):
        status_runtime.write_var_file_updates(
            self.var, {"5222": 7.0, "5301": 1.5})
        raw = status_runtime.read_var_file(self.var, {"5222", "5301", "5221"})
        self.assertEqual(raw["5222"], 7.0)
        self.assertEqual(raw["5301"], 1.5)
        self.assertEqual(raw["5221"], 10.5)  # untouched line intact
        with open(self.var) as f:
            nums = [int(line.split()[0]) for line in f if line.strip()]
        self.assertEqual(nums, sorted(nums))  # inserted in numeric order


class TestPollStatus(unittest.TestCase):
    def _stat(self, **over):
        base = dict(
            ini_filename=None,  # skip var-file path in these tests
            estop=0, enabled=1,
            axis_mask=0b111,  # XYZ — canonical→joint re-indexing needs it
            joints=3, homed=(1, 1, 1, 0, 0),
            g5x_index=1,
            g5x_offset=(1.0, 2.0, 3.0),
            g92_offset=(0.5, 0.0, 0.0),
            rotation_xy=0.0,
            joint_actual_position=(10.0, 20.0, 30.0),
            tool_offset=(0.0, 0.0, 5.0),
            interp_state=linuxcnc.INTERP_IDLE,
            paused=False,
            current_vel=0.0,
            spindle=({"speed": 1200.0, "direction": 1, "override": 1.0},),
            tool_in_spindle=3,
            tool_table=(),
        )
        base.update(over)
        return _Stat(**base)

    def test_payload_core_fields_and_work_pos(self):
        rt = _runtime(stat=self._stat())
        p = rt.poll_status()
        self.assertFalse(p.estop)
        self.assertTrue(p.enabled)
        self.assertTrue(p.homed)              # first 3 joints homed
        self.assertEqual(p.homed_joints, [True, True, True])
        # work = machine − g5x − tool_offset − g92 (rotation 0)
        self.assertAlmostEqual(p.work_pos[0], 10.0 - 1.0 - 0.0 - 0.5)
        self.assertAlmostEqual(p.work_pos[1], 20.0 - 2.0 - 0.0 - 0.0)
        self.assertAlmostEqual(p.work_pos[2], 30.0 - 3.0 - 5.0 - 0.0)
        self.assertEqual(p.spindle_speed, 1200.0)
        self.assertEqual(p.spindle_direction, 1)
        self.assertEqual(p.tool_length, 5.0)  # from tool_offset[2] fallback

    def test_reader_absence_propagates_none(self):
        # No reader snapshot → every reader-sourced field is None, never a default.
        rt = _runtime(stat=self._stat(), snapshot={})
        p = rt.poll_status()
        for f in ("emc_enable_in", "tool_change_requested", "spindle_load",
                  "probe_input", "eoffset_z", "eoffset_enabled",
                  "comp_method", "comp_grid_version", "spindle_speed_actual"):
            self.assertIsNone(getattr(p, f), f)

    def test_spindle_actual_scaled_by_fb_scale(self):
        rt = _runtime(stat=self._stat(), snapshot={"spindle_speed_in": 100.0},
                      fb_scale=60)
        self.assertEqual(rt.poll_status().spindle_speed_actual, 6000.0)
        rt = _runtime(stat=self._stat(), snapshot={"spindle_speed_in": 100.0},
                      fb_scale=1)
        self.assertEqual(rt.poll_status().spindle_speed_actual, 100.0)

    def test_safety_merge_emc_enable_overrides(self):
        # HAL chain LOW (emc_enable_in False) forces is_estop even when STAT
        # says estop clear (issue #14).
        rt = _runtime(stat=self._stat(), snapshot={"emc_enable_in": False})
        p = rt.poll_status()
        self.assertTrue(p.is_estop)
        self.assertFalse(p.is_enabled)
        self.assertIsInstance(p.permissions, dict)
        self.assertFalse(p.permissions.get("safety"))

    def test_wcs_table_rows_are_copies(self):
        rt = _runtime(stat=self._stat())
        p = rt.poll_status()
        p.wcs_table[0]["x"] = 12345.0
        self.assertNotEqual(rt.wcs_cache[0]["x"], 12345.0)

    def test_active_slot_overwritten_from_stat(self):
        rt = _runtime(stat=self._stat(g5x_index=2, g5x_offset=(7.0, 8.0, 9.0)))
        p = rt.poll_status()
        self.assertEqual(rt.wcs_cache[1]["x"], 7.0)  # G55 (index 2 → slot 1)
        self.assertEqual(p.wcs_table[1]["x"], 7.0)

    def test_poll_and_serialize_shallow_dict(self):
        rt = _runtime(stat=self._stat())
        st, out = rt.poll_and_serialize()
        self.assertEqual(out["enabled"], st.enabled)
        self.assertIn("permissions", out)

    def test_disconnected_raises(self):
        rt = _runtime(stat=None)
        with self.assertRaises(RuntimeError):
            rt.poll_status()


class TestErrors(unittest.TestCase):
    def test_read_errors_caps_and_drains(self):
        class _Err:
            def __init__(self):
                self.n = 0
            def poll(self):
                self.n += 1
                return (11, f"e{self.n}") if self.n <= 3 else None
        rt = _runtime(err=_Err())
        self.assertEqual(len(rt.read_errors_nonblocking()), 3)
        self.assertEqual(rt.read_errors_nonblocking(), [])

    def test_poll_failure_warns_once_until_reset(self):
        class _Boom:
            def poll(self):
                raise RuntimeError("NML invalid")
        rt = _runtime(err=_Boom())
        with mock.patch("status_runtime._trace.emit") as emit:
            rt.read_errors_nonblocking()
            rt.read_errors_nonblocking()
            self.assertEqual(emit.call_count, 1)  # warn-once
            rt.reset_warn_flags()
            rt.read_errors_nonblocking()
            self.assertEqual(emit.call_count, 2)  # re-armed after reconnect


if __name__ == "__main__":
    unittest.main()
