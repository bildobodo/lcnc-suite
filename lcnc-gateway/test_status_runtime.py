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

    def test_joint_limits_ride_the_payload_live(self):
        # The viewer's machine-bounds box follows THESE (2026-09-12), not the
        # INI file: the TWP sim muxes its Z window by kins mode in HAL.
        stat = self._stat(joint=[
            {"min_position_limit": -5000.0, "max_position_limit": 5000.0},
            {"min_position_limit": -5000.0, "max_position_limit": 5000.0},
            {"min_position_limit": -2000.0, "max_position_limit": 0.01}])
        p = _runtime(stat=stat).poll_status()
        self.assertEqual(p.joint_limits, [[-5000.0, 5000.0], [-5000.0, 5000.0], [-2000.0, 0.01]])
        # a joint without limits is None INSIDE the list; no joint info → None
        stat = self._stat(joint=[{"min_position_limit": -1.0, "max_position_limit": 1.0}, {}, {}])
        self.assertEqual(_runtime(stat=stat).poll_status().joint_limits, [[-1.0, 1.0], None, None])
        self.assertIsNone(_runtime(stat=self._stat()).poll_status().joint_limits)

    def test_kins_type_rides_reader_snapshot_absent_is_none(self):
        # Live switchkins pin: raw float from the reader snapshot when the
        # gateway configured it (switchable kins), honest None otherwise —
        # never a synthetic default.
        p = _runtime(stat=self._stat(), snapshot={"kins_type": 1.0}).poll_status()
        self.assertEqual(p.kins_type, 1.0)
        p = _runtime(stat=self._stat()).poll_status()
        self.assertIsNone(p.kins_type)

    def test_policy_state_carries_the_touchoff_inputs(self):
        # The touch-off gates (2026-08-30) read kins mode × fixture × table
        # pose from the SAME snapshot the broadcast carries: raw pin rounded,
        # 1-based fixture, plane state, A within the provenance window. The
        # kins declaration is NOT a status field — unknown (closed) unless the
        # gateway wires it.
        stat = self._stat(g5x_index=6, actual_position=(0, 0, 0, 0.004, 0, 0, 0, 0, 0))
        p = _runtime(stat=stat, snapshot={"kins_type": 2.0, "twp_active": 1}).poll_status()
        ps = status_runtime.policy_state_from_payload(p, armed=True, kins_switchable=True)
        self.assertEqual((ps.kins_type, ps.g5x_index, ps.twp_active, ps.a_at_zero),
                         (2, 6, True, True))
        self.assertFalse(p.permissions["touchoff"] is False and False)  # sanity: key exists
        self.assertIn("touchoff", p.permissions)
        # Default builder = unknown machine = closed gates, even in G54.
        p2 = _runtime(stat=self._stat(g5x_index=1)).poll_status()
        self.assertFalse(p2.permissions["touchoff"])
        # Declared non-switchable: identity, certainly — open in G54.
        rt = _runtime(stat=self._stat(g5x_index=1))
        rt._get_kins_switchable = lambda: False
        p3 = rt.poll_status()
        self.assertTrue(p3.permissions["touchoff"])
        self.assertTrue(p3.permissions["touchoffRotary"])
        # Tilted table: a_at_zero False.
        stat = self._stat(actual_position=(0, 0, 0, 35.0, 0, 0, 0, 0, 0))
        ps = status_runtime.policy_state_from_payload(
            _runtime(stat=stat).poll_status(), armed=True, kins_switchable=False)
        self.assertFalse(ps.a_at_zero)

    def test_work_pos_uses_world_coords_under_nonzero_kins(self):
        # Kins mode 2 (TOOL/plane): joints != world. The DRO math must read
        # canonical actual_position (forward-kins output), not joint values —
        # a tip at the plane origin reads 0 (operator-caught: it did not).
        stat = self._stat(
            joint_actual_position=(111.0, 222.0, 333.0),      # joint space
            actual_position=(1.0, 2.0, 3.0, 0, 0, 0, 0, 0, 0),  # world
            g5x_offset=(1.0, 2.0, 3.0), g92_offset=(0.0,) * 9,
            tool_offset=(0.0, 0.0, 0.0))
        p = _runtime(stat=stat, snapshot={"kins_type": 2.0}).poll_status()
        self.assertEqual(p.work_pos[:3], [0.0, 0.0, 0.0])
        # machine_pos stays the joint truth (recorded limitation).
        self.assertEqual(p.machine_pos[:3], [111.0, 222.0, 333.0])

    def test_work_pos_keeps_joint_path_on_identity(self):
        # Identity (or unknown/non-switchable): encoder-live joints stay the
        # source — they update with the machine off, actual_position freezes.
        stat = self._stat(
            joint_actual_position=(11.0, 22.0, 33.0),
            actual_position=(99.0, 99.0, 99.0, 0, 0, 0, 0, 0, 0),
            g5x_offset=(1.0, 2.0, 3.0), g92_offset=(0.0,) * 9,
            tool_offset=(0.0, 0.0, 0.0))
        p = _runtime(stat=stat, snapshot={"kins_type": 0.0}).poll_status()
        self.assertEqual(p.work_pos[:3], [10.0, 20.0, 30.0])
        p2 = _runtime(stat=stat).poll_status()  # no kins pin sampled
        self.assertEqual(p2.work_pos[:3], [10.0, 20.0, 30.0])

    def test_work_pos_blank_when_world_missing_under_kins2(self):
        # No actual_position while kins != 0: DRO blank, never joint-frame
        # numbers posing as plane coordinates.
        stat = self._stat(joint_actual_position=(11.0, 22.0, 33.0),
                          actual_position=None)
        p = _runtime(stat=stat, snapshot={"kins_type": 2.0}).poll_status()
        self.assertIsNone(p.work_pos)

    def test_seed_wcs_row_xyz_writes_xyz_only_in_place(self):
        cache = [{"x": 1.0, "y": 2.0, "z": 3.0, "a": 4.0, "b": 5.0, "c": 6.0, "r": 7.0}
                 for _ in range(9)]
        same = cache
        status_runtime.seed_wcs_row_xyz(cache, 0, [10.0, 20.0, 30.0])
        self.assertIs(cache, same)                       # gateway holds the same list
        self.assertEqual((cache[0]["x"], cache[0]["y"], cache[0]["z"]), (10.0, 20.0, 30.0))
        self.assertEqual((cache[0]["a"], cache[0]["b"], cache[0]["c"], cache[0]["r"]),
                         (4.0, 5.0, 6.0, 7.0))            # rotary/R untouched
        self.assertEqual(cache[1]["x"], 1.0)               # other rows untouched

    def test_seed_wcs_row_xyz_refuses_non_finite_and_bad_index(self):
        cache = [{"x": 0.0, "y": 0.0, "z": 0.0} for _ in range(9)]
        with self.assertRaises(ValueError):
            status_runtime.seed_wcs_row_xyz(cache, 0, [float("nan"), 0.0, 0.0])
        with self.assertRaises(ValueError):
            status_runtime.seed_wcs_row_xyz(cache, 9, [0.0, 0.0, 0.0])
        with self.assertRaises(ValueError):
            status_runtime.seed_wcs_row_xyz(cache, 0, [1.0, 2.0])
        self.assertEqual(cache[0], {"x": 0.0, "y": 0.0, "z": 0.0})  # never a partial row

    def test_datum_changed_none_when_unreadable_true_past_eps_false_within(self):
        f = status_runtime.datum_changed
        self.assertIsNone(f(None, [0, 0, 0]))
        self.assertIsNone(f([0, 0, 0], None))
        self.assertIsNone(f([0, 0], [0, 0, 0]))
        self.assertFalse(f([1, 2, 3], [1, 2, 3 + 1e-7]))
        self.assertTrue(f([1, 2, 3], [1, 2, 3.5]))

    def test_datum_seq_advanced_none_when_unreadable_true_on_any_change(self):
        # The datum-write epoch: None = no claim (helper predates the pin),
        # any change counts (the counter wraps; the reader floats it).
        f = status_runtime.datum_seq_advanced
        self.assertIsNone(f(None, 5.0))
        self.assertIsNone(f(5.0, None))
        self.assertFalse(f(5.0, 5))
        self.assertTrue(f(5.0, 6.0))
        self.assertTrue(f(4294967295.0, 0.0))   # wrap

    def test_own_var_file_write_does_not_reseed_axis_rows(self):
        # The gateway writing provenance/probe vars bumps the var-file mtime;
        # mark_var_file_written adopts it so the next poll keeps the rows the
        # gateway seeded from the live datum (disk holds shutdown-stale values).
        rt = _runtime(stat=self._stat())
        with tempfile.NamedTemporaryFile("w", suffix=".var", delete=False) as f:
            f.write("5221\t0.0\n")
            path = f.name
        try:
            rt.mark_var_file_written(path)
            self.assertEqual(rt._wcs_var_file_mtime, os.path.getmtime(path))
            rt.mark_var_file_written(path + ".missing")
            self.assertIsNone(rt._wcs_var_file_mtime)
        finally:
            os.remove(path)

    def test_wcs_prov_a_rides_the_injected_getter_absent_is_none(self):
        p = _runtime(stat=self._stat()).poll_status()
        self.assertIsNone(p.wcs_prov_a)
        rt = _runtime(stat=self._stat())
        rt._get_prov_a = lambda: [0.0, None, 30.0] + [None] * 6
        p2 = rt.poll_status()
        self.assertEqual(p2.wcs_prov_a[:3], [0.0, None, 30.0])

    def test_capture_clean_helpers_closed_on_none(self):
        # Absent/short/malformed inputs read DIRTY — a gate that cannot see
        # the offsets refuses, never assumes clean.
        f = status_runtime.capture_rotary_offsets_clean
        g = status_runtime.capture_g92_xyz_clean
        self.assertFalse(f(None, None))
        self.assertFalse(f([], [0.0] * 9))
        self.assertFalse(f([{"x": 0}], [0.0] * 9))          # row missing a/b/c
        self.assertFalse(f([{"a": 0, "b": 0, "c": 0}], [0.0] * 3))  # short g92
        self.assertFalse(g(None))
        self.assertFalse(g([0.0, 0.0]))

    def test_capture_clean_helpers_read_the_offsets(self):
        f = status_runtime.capture_rotary_offsets_clean
        g = status_runtime.capture_g92_xyz_clean
        row = [{"x": 1.0, "y": 2.0, "z": 3.0, "a": 0.0, "b": 0.0, "c": 0.0}]
        self.assertTrue(f(row, [0.0] * 9))
        self.assertTrue(g([0.0] * 9))
        self.assertFalse(f([{"a": 5.0, "b": 0.0, "c": 0.0}], [0.0] * 9))
        self.assertFalse(f(row, [0, 0, 0, 0.5, 0, 0, 0, 0, 0]))  # G92 rotary
        self.assertFalse(g([1.0, 0, 0, 0, 0, 0, 0, 0, 0]))
        # Linear work offsets and a G92 rotary=0 tail are fine.
        self.assertTrue(g([0, 0, 0, 5.0, 0, 0, 0, 0, 0]))  # rotary g92 is not XYZ's business

    def test_policy_state_carries_the_capture_inputs(self):
        # twp_defined + the two clean flags ride the same snapshot the
        # broadcast carries. The default _stat has G92 X=0.5 — deliberately
        # used as the dirty case; a zeroed G92 with a clean G54 row is open.
        p = _runtime(stat=self._stat(),
                     snapshot={"kins_type": 0.0, "twp_defined": 1}).poll_status()
        ps = status_runtime.policy_state_from_payload(p, armed=True, kins_switchable=True)
        self.assertTrue(ps.twp_defined)
        self.assertFalse(ps.g92_xyz_clean)  # G92 X=0.5 in the default stat
        clean = self._stat(g92_offset=(0.0,) * 9)  # 9-wide like real STAT (short reads closed)
        p2 = _runtime(stat=clean, snapshot={"kins_type": 0.0}).poll_status()
        ps2 = status_runtime.policy_state_from_payload(p2, armed=True, kins_switchable=True)
        self.assertFalse(ps2.twp_defined)
        self.assertTrue(ps2.g92_xyz_clean)
        # rotary_offsets_clean reads the broadcast wcs_table's G54 row (the
        # var-file cache — zeros in these tests) + the G92 rotary tail.
        self.assertTrue(ps2.rotary_offsets_clean)
        # A partial payload (older envelope / test double) reads CLOSED.
        from types import SimpleNamespace
        bare = SimpleNamespace(estop=0, enabled=1, homed=True, paused=False,
                               interp_state=None, eoffset_enabled=False,
                               emc_enable_in=None, rotary_at_zero=True)
        psb = status_runtime.policy_state_from_payload(bare, armed=True,
                                                       kins_switchable=True)
        self.assertFalse(psb.twp_defined)
        self.assertFalse(psb.rotary_offsets_clean)
        self.assertFalse(psb.g92_xyz_clean)

    def test_twp_frame_pins_ride_the_snapshot_raw_and_absent_is_none(self):
        # The three TWP plane-frame pins reach the client UNCONVERTED, with
        # upstream's own unit asymmetry intact: pre-rot in RADIANS, the two
        # angles in DEGREES. That asymmetry is the convention the parse-time
        # markers already use, so both the live and the parsed frame feed
        # kinsForSegment identically — a tidy-up that "fixed" the units on
        # one path would silently put the sim on the wrong plane.
        snap = {"kins_pre_rot": -1.781762,
                "kins_primary_angle": 130.2455,
                "kins_secondary_angle": -40.8555}
        p = _runtime(stat=self._stat(), snapshot=snap).poll_status()
        self.assertEqual(p.kins_pre_rot, -1.781762)
        self.assertEqual(p.kins_primary_angle, 130.2455)
        self.assertEqual(p.kins_secondary_angle, -40.8555)
        # Not sampled (any non-trsrn config) — None, never a default. The
        # client treats a partial trio as no frame at all.
        p = _runtime(stat=self._stat()).poll_status()
        self.assertIsNone(p.kins_pre_rot)
        self.assertIsNone(p.kins_primary_angle)
        self.assertIsNone(p.kins_secondary_angle)

    def test_twp_pose_a_rides_the_snapshot_raw_including_the_sentinel(self):
        # The plane's assumed table pose. The remap's "no plane defined"
        # sentinel (-1e9) must reach the client UNTOUCHED — the client owns
        # the one place that decides what counts as "no pose", so a gateway
        # that mapped it to None here would give the same answer as "not
        # sampled" for two very different states.
        p = _runtime(stat=self._stat(), snapshot={"twp_pose_a": 20.0}).poll_status()
        self.assertEqual(p.twp_pose_a, 20.0)
        p = _runtime(stat=self._stat(), snapshot={"twp_pose_a": -1e9}).poll_status()
        self.assertEqual(p.twp_pose_a, -1e9)
        # Not sampled (any non-trsrn config) — None, never a default.
        p = _runtime(stat=self._stat()).poll_status()
        self.assertIsNone(p.twp_pose_a)

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


class TestRotaryAtZero(unittest.TestCase):
    """The surface-map rotary gate's input (W6). Surface-map Z compensation is
    a 3-axis feature; probing or applying it tilted is directionally wrong."""

    XYZ = 0b000000111
    XYZAC = 0b000101111        # A = canonical slot 3, C = slot 5
    NINE = [0.0] * 9

    def _pos(self, **over):
        p = list(self.NINE)
        for slot, val in over.items():
            p[int(slot[1:])] = val
        return p

    def test_three_axis_machine_is_always_at_zero(self):
        self.assertTrue(status_runtime.rotary_at_zero(self.NINE, self.XYZ))
        # Junk in an UNCONFIGURED rotary slot must not close the gate on a
        # machine that has no rotary at all.
        self.assertTrue(status_runtime.rotary_at_zero(self._pos(s3=90.0), self.XYZ))

    def test_configured_rotary_off_zero_is_detected(self):
        self.assertFalse(status_runtime.rotary_at_zero(self._pos(s3=10.0), self.XYZAC))
        self.assertFalse(status_runtime.rotary_at_zero(self._pos(s5=90.0), self.XYZAC))

    def test_servo_dither_tolerated_but_a_real_tilt_is_not(self):
        tol = status_runtime.ROTARY_ZERO_TOL_DEG
        self.assertTrue(status_runtime.rotary_at_zero(self._pos(s3=tol / 2), self.XYZAC))
        self.assertFalse(status_runtime.rotary_at_zero(self._pos(s3=tol * 10), self.XYZAC))

    def test_unreadable_position_is_none_not_zero(self):
        # The caller must refuse on None — a gate that cannot see the rotaries
        # must not assume they are parked.
        self.assertIsNone(status_runtime.rotary_at_zero(None, self.XYZAC))
        self.assertIsNone(status_runtime.rotary_at_zero([1.0, 2.0, 3.0], self.XYZAC))

    def test_reads_canonical_slots_not_joint_order(self):
        # On XYZAC the joint-ordered array has C at index 4, the canonical one
        # at index 5. Feeding a canonical array with C=90 must be detected;
        # reading index 4 (canonical B, unconfigured) would have missed it.
        canonical = self._pos(s5=90.0)
        self.assertEqual(canonical[4], 0.0)      # canonical B, unconfigured
        self.assertFalse(status_runtime.rotary_at_zero(canonical, self.XYZAC))


if __name__ == "__main__":
    unittest.main()
