"""The switchable suite functions (settings split package 3, plan R335–R337).

A machine section `features` — probing, toolsetter, surfaceMap, camera,
macros, gamepad — each ON unless the server holds it OFF. Off is the suite's
operating function (OP2): its recognisable jobs and routes are refused, free
MDI and programs are not searched. Each switch: a refused direct call and an
allowed neighbour (Codex R334 SS334-01); a change only by an armed writer on
a machine that stands, with the function's own state ended (SS334-02); the
parameter writes by purpose, a set outside it refused whole (R335 rest A).
"""
import ast
import asyncio
import tempfile
import unittest
import unittest.mock
from pathlib import Path

import test_command_dispatch as td   # the fake binding first, then gateway
import gateway  # noqa: E402
import features  # noqa: E402
from linuxcnc import INTERP_IDLE, INTERP_READING, MODE_MDI  # noqa: E402
from settings_store import SettingsStore  # noqa: E402
from test_toolsetter_sync import SECTION as TOOLSETTER  # noqa: E402

ALL_ON = {f: True for f in features.FEATURES}


def off(*names):
    return {**ALL_ON, **{n: False for n in names}}


class _Store:
    """A store of its own per test, patched in as the gateway's."""

    def make_store(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.store = SettingsStore(Path(d.name, "settings.json"), lambda: "fs.ini")
        p = unittest.mock.patch.object(gateway, "_settings_store", self.store)
        p.start()
        self.addCleanup(p.stop)

    def put(self, section, data):
        """A machine section as the server holds it (no admission: setup)."""
        rev = self.store.view_for(None)["revs"].get(section, 0)
        self.store.save_section(section, data, base_rev=rev, writer="setup")


class TestTheSection(unittest.TestCase):
    def test_no_section_is_every_function_on(self):
        self.assertEqual(features.features_of(None), ALL_ON)
        self.assertEqual(features.features_of({"camera": False}), off("camera"))
        self.assertEqual(features.features_of({"camera": "no"}), ALL_ON)   # not a switch: as stored nothing

    def test_a_save_is_exactly_the_six_switches(self):
        features.validate_features(ALL_ON)
        for bad in ({**ALL_ON, "extra": True}, {"probing": True}, {**ALL_ON, "camera": 0}, [], None):
            with self.assertRaises(ValueError, msg=bad):
                features.validate_features(bad)

    def test_the_purposes_are_their_own_sets(self):
        self.assertIsNone(features.purpose_refusal("probe", ["3014", "3036"]))
        self.assertIsNone(features.purpose_refusal("surface", ["3050", "3059", "3014", "3021"]))
        self.assertIsNone(features.purpose_refusal("toolsetter", ["3004", "3013", "3100", "3115"]))
        self.assertIn("not a probe parameter", features.purpose_refusal("probe", ["3014", "3050"]))
        self.assertIn("not a surface parameter", features.purpose_refusal("surface", ["3015"]))
        self.assertIn("not a toolsetter parameter", features.purpose_refusal("toolsetter", ["3014"]))
        self.assertIn("not a toolsetter parameter", features.purpose_refusal("toolsetter", ["3116"]))
        self.assertIn("purpose", features.purpose_refusal("calibrate", ["3014"]))


class TestTheChangeIsAdmitted(_Store, unittest.TestCase):
    """SS334-02: an armed writer, a known idle interpreter, no start, no
    command, no jog, a machine that stands — and switching a function OFF
    needs its own state ended. Nothing sends a machine command."""

    def setUp(self):
        td.TestHandlerExecution.setUp(self)
        self.make_store()
        gateway.STAT.enabled = True
        fresh = {"z_eoffset_enable": False, "tool_change": False}
        self.reader = fresh
        p = unittest.mock.patch.object(gateway, "_reader_fresh_get", lambda k: self.reader.get(k))
        p.start()
        self.addCleanup(p.stop)
        jogs = dict(gateway._active_jogs)
        self.addCleanup(lambda: (gateway._active_jogs.clear(), gateway._active_jogs.update(jogs)))
        gateway._active_jogs.clear()

    def save(self, section, data, key=None):
        key = self.key if key is None else key
        rev = self.store.view_for(None)["revs"].get(section, 0)
        return asyncio.run(gateway._save_settings(section, data, gateway._settings_admission(section, key),
                                                  base_rev=rev, writer=key))

    def refused(self, section, data, key=None):
        with self.assertRaises(PermissionError) as cm:
            self.save(section, data, key)
        return str(cm.exception)

    def test_an_armed_writer_on_a_standing_idle_machine_switches(self):
        self.save("features", off("probing", "camera"))
        self.assertEqual(self.store.features(), off("probing", "camera"))
        self.save("features", ALL_ON)
        self.assertEqual(self.store.features(), ALL_ON)
        self.assertEqual(self.cmd.calls, [], "a switch sent a machine command")

    def test_not_armed_refused(self):
        gateway._clients[911].armed = False
        self.assertIn("Not armed", self.refused("features", off("camera")))
        self.assertEqual(self.store.features(), ALL_ON)

    def test_a_running_interpreter_refused(self):
        gateway.STAT.interp_state = INTERP_READING
        self.assertIn("runs", self.refused("features", off("macros")))

    def test_a_moving_machine_refused(self):
        gateway.STAT.inpos = False
        self.assertIn("Machine moving", self.refused("features", off("gamepad")))
        gateway.STAT.inpos, gateway.STAT.current_vel = True, 12.0
        self.assertIn("Machine moving", self.refused("features", off("gamepad")))
        gateway.STAT.current_vel = None
        self.assertIn("Motion state unknown", self.refused("features", off("gamepad")))

    def test_a_booked_jog_refused(self):
        gateway._active_jogs[0] = ("x", 0)
        self.assertIn("jog is active", self.refused("features", off("gamepad")))

    def test_an_open_start_claim_refused(self):
        gateway._source_claims.append(gateway._StartClaim("mdi"))
        self.assertIn("starting or running", self.refused("features", off("macros")))

    def test_a_command_in_flight_refused(self):
        async def held():
            async with gateway._get_cmd_lock():
                await gateway._save_settings("features", off("probing"),
                                             gateway._settings_admission("features", self.key),
                                             base_rev=0, writer=self.key)
        gateway._cmd_lock = None
        with self.assertRaises(PermissionError) as cm:
            asyncio.run(held())
        self.assertIn("command is running", str(cm.exception))

    def test_surface_off_needs_the_compensation_known_off(self):
        self.reader["z_eoffset_enable"] = True
        self.assertIn("compensation is on", self.refused("features", off("surfaceMap")))
        self.reader["z_eoffset_enable"] = None
        self.assertIn("Compensation state unknown", self.refused("features", off("surfaceMap")))
        # another switch is no surface change: admitted with the compensation unknown
        self.save("features", off("camera"))
        self.reader["z_eoffset_enable"] = False
        self.save("features", off("camera", "surfaceMap"))
        # switching it ON again needs nothing of the compensation
        self.reader["z_eoffset_enable"] = True
        self.save("features", ALL_ON)

    def test_toolsetter_off_with_m600_is_no_state_either_way(self):
        self.put("machine", {"toolChangeMode": "m600"})
        self.assertIn("choose another tool change mode", self.refused("features", off("toolsetter")))
        self.put("machine", {"toolChangeMode": "m6g43"})
        self.save("features", off("toolsetter"))
        self.assertIn("Toolsetter is off", self.refused("machine", {"toolChangeMode": "m600"}))
        self.save("machine", {"toolChangeMode": "m6g43", "runFromLine": True})   # another machine change passes

    def test_a_save_turning_the_camera_off_ends_its_streams(self):
        ended = []

        class Broker:
            async def end_epoch(self):
                ended.append(True)
                return 1
        with unittest.mock.patch.object(gateway, "_camera_broker", Broker()):
            self.save("features", off("probing"))
            self.assertEqual(ended, [], "the camera stays on: nothing ends")
            self.save("features", off("probing", "camera"))
            self.assertEqual(ended, [True])

    def test_an_invalid_section_is_refused_before_anything(self):
        with self.assertRaises(ValueError):
            self.save("features", {"probing": False})
        self.assertEqual(self.store.features(), ALL_ON)


class TestEachSwitch(_Store, unittest.TestCase):
    """Per switch a refused direct call and an allowed neighbour (SS334-01,
    R335 rest A/B)."""

    def setUp(self):
        td.TestHandlerExecution.setUp(self)
        self.make_store()
        self.cmd = td.TestHandlerExecution._rcs(self)
        p = unittest.mock.patch.object(gateway, "get_probe_macros",
                                       lambda: ["probe_cal_reset", "probe_z_minus_wco", "probe_cal_round_pocket"])
        p.start()
        self.addCleanup(p.stop)
        self.hal = []
        p = unittest.mock.patch.object(gateway, "_hal_send", lambda m: (self.hal.append(m), True)[1])
        p.start()
        self.addCleanup(p.stop)

    _send = td.TestHandlerExecution._send

    def mdis(self):
        return [a[0] for n, a, _k in self.cmd.calls if n == "mdi"]

    def switch(self, *names):
        self.put("features", off(*names))

    PROBE = {"3014": 99, "3015": 20, "3030": 1}
    SCAN = {"3050": 0, "3051": 10, "3014": 99, "3021": 2}

    def test_probing_off_refuses_its_routines_and_parameters_only(self):
        self.switch("probing")
        for msg in ({"cmd": "probe_run", "routine": "probe_z_minus_wco", "vars": self.PROBE},
                    {"cmd": "set_params", "purpose": "probe", "vars": self.PROBE}):
            r = self._send(msg)
            self.assertEqual(r, {"ok": False, "error": "Probing is off — Settings › Features"}, msg)
        self.assertEqual(self.mdis(), [])
        # its neighbours: the toolsetter's values, the surface scan, a WCS
        # write under the shared `probe` gate (no pauschal probe block)
        self.put("toolsetter", dict(TOOLSETTER))
        self.assertTrue(self._send({"cmd": "set_params", "purpose": "toolsetter", "vars": {"3102": -179}})["ok"])
        self.assertTrue(self._send({"cmd": "surface_scan_run", "vars": self.SCAN})["ok"])
        self.assertIn("O<surface_scan> CALL", self.mdis())
        self.assertTrue(self._send({"cmd": "tool_measure", "tool": 5})["ok"])
        self.assertIn("T5 M600", self.mdis())
        # set_wcs shares the `probe` gate: whatever else it meets, never the switch
        r = self._send({"cmd": "set_wcs", "target": "active", "x": 1})
        self.assertNotIn("Probing is off", str(r.get("error")), r)

    def test_surface_off_refuses_the_scan_and_switching_compensation_on(self):
        self.switch("surfaceMap")
        for msg in ({"cmd": "surface_scan_run", "vars": self.SCAN},
                    {"cmd": "set_params", "purpose": "surface", "vars": self.SCAN},
                    {"cmd": "set_compensation", "enable": True},
                    {"cmd": "set_compensation_method", "method": 1}):
            self.assertEqual(self._send(msg)["error"], "Surface map is off — Settings › Features", msg)
        self.assertEqual(self.hal, [])
        # switching the compensation OFF is always admitted (SS334-02)
        r = self._send({"cmd": "set_compensation", "enable": False})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.hal, [{"compensation_enable": False}])
        # probing stays: its routine runs
        self.assertTrue(self._send({"cmd": "probe_run", "routine": "probe_z_minus_wco", "vars": self.PROBE})["ok"])
        self.assertIn("O<probe_z_minus_wco> CALL", self.mdis())

    def test_toolsetter_off_refuses_m600_jobs_the_normal_tool_change_stays(self):
        self.put("toolsetter", dict(TOOLSETTER))
        self.switch("toolsetter")
        for msg in ({"cmd": "tool_measure", "tool": 5}, {"cmd": "tool_unload_measure"},
                    {"cmd": "set_params", "purpose": "toolsetter", "vars": {"3102": -179}}):
            self.assertEqual(self._send(msg)["error"], "Toolsetter is off — Settings › Features", msg)
        self.assertEqual(self.mdis(), [])
        # load and unload the normal way (m6g43)
        self.assertTrue(self._send({"cmd": "tool_change", "tool_number": 5})["ok"])
        self.assertTrue(self._send({"cmd": "tool_change", "tool_number": 0})["ok"])
        self.assertEqual(self.mdis(), ["T5 M6", "G43 H5", "T0 M6", "G49"])

    def test_toolsetter_off_refuses_run_from_lines_pre_measurement(self):
        self.switch("toolsetter")
        r = self._send({"cmd": "auto_run", "line": 4, "file": "/x.ngc", "version": 1, "source": "0" * 64,
                        "pre_tool": 5, "probe_vars": {"3102": -179}})
        self.assertEqual(r["error"], "Toolsetter is off — Settings › Features")

    def test_toolsetter_off_a_program_start_syncs_nothing(self):
        self.put("toolsetter", dict(TOOLSETTER))
        self.switch("toolsetter")
        basis = gateway._toolsetter_basis()
        self.assertTrue(basis["ok"])
        refused, note = asyncio.run(gateway._toolsetter_sync(True, basis))
        self.assertIsNone(refused)
        self.assertTrue(note["off"])
        self.assertEqual(self.mdis(), [])

    def test_macros_off_refuses_the_run_and_the_writes_mdi_stays(self):
        self.switch("macros")
        r = self._send({"cmd": "run_macro", "name": "m1", "args": [], "revision": "0" * 64})
        self.assertEqual(r["error"], "Macros are off — Settings › Features")
        gate = gateway._macro_write_gate({"dir": "/nowhere"}, "/nowhere/m1.ngc", "new", self.key)
        self.assertEqual(gate(), {"kind": "busy", "reason": "Macros are off — Settings › Features"})
        r = self._send({"cmd": "mdi", "text": "G0 X1"})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.mdis(), ["G0 X1"])

    def test_gamepad_off_refuses_what_the_gamepad_starts_never_its_stops(self):
        self.switch("gamepad")
        for msg in ({"cmd": "jog_cont", "axis": 0, "vel": 10, "via": "gamepad"},
                    {"cmd": "cycle_start", "via": "gamepad"},
                    {"cmd": "home_all", "via": "gamepad"},
                    {"cmd": "flood_on", "via": "gamepad"}):
            self.assertEqual(self._send(msg)["error"], "Gamepad is off — Settings › Features", msg)
        for msg in ({"cmd": "jog_stop", "axis": 0, "via": "gamepad"}, {"cmd": "abort", "via": "gamepad"},
                    {"cmd": "spindle_stop", "via": "gamepad"}, {"cmd": "cycle_pause", "via": "gamepad"}):
            self.assertNotIn("Gamepad is off", str(self._send(msg).get("error")), msg)
        # the screen's own jog (no via) runs
        r = self._send({"cmd": "jog_cont", "axis": 0, "vel": 10})
        self.assertTrue(r["ok"], r)

    def test_an_unknown_via_is_refused_by_the_bounds_or_the_dispatch(self):
        r = self._send({"cmd": "jog_cont", "axis": 0, "vel": 10, "via": "keyboard"})
        self.assertFalse(r["ok"])
        self.assertIn("via", r["error"])
        r = self._send({"cmd": "mdi", "text": "G0 X1", "via": "wheel"})
        self.assertEqual(r["error"], "Unknown input — reload the page")


class TestTheJobs(_Store, unittest.TestCase):
    """The routines as jobs: their purpose's values only, the line the
    gateway builds, the server's toolsetter values, the switch at the write."""

    setUp = TestEachSwitch.setUp
    _send = TestEachSwitch._send
    mdis = TestEachSwitch.mdis
    PROBE, SCAN = TestEachSwitch.PROBE, TestEachSwitch.SCAN

    def test_a_probe_runs_its_values_then_its_routine(self):
        r = self._send({"cmd": "probe_run", "routine": "probe_z_minus_wco", "vars": self.PROBE})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.mdis(), ["#3014=99.000000 #3015=20.000000 #3030=1.000000 #3116=0.000000",
                                       "O<probe_z_minus_wco> CALL"])

    def test_a_set_outside_its_purpose_is_refused_whole(self):
        for msg in ({"cmd": "probe_run", "routine": "probe_z_minus_wco", "vars": {**self.PROBE, "3050": 1}},
                    {"cmd": "surface_scan_run", "vars": {**self.SCAN, "3015": 5}},
                    {"cmd": "set_params", "purpose": "probe", "vars": {"3014": 99, "3100": 1}},
                    {"cmd": "set_params", "purpose": "toolsetter", "vars": {"3102": -1, "3014": 99}}):
            r = self._send(msg)
            self.assertFalse(r["ok"], msg)
            self.assertIn("nothing written", r["error"], msg)
        self.assertEqual(self.mdis(), [])

    def test_an_unknown_purpose_or_routine_is_refused(self):
        r = self._send({"cmd": "set_params", "purpose": "calibrate", "vars": {"3014": 1}})
        self.assertFalse(r["ok"])
        for routine in ("surface_scan", "../probe_z", "probe_nonexistent"):
            r = self._send({"cmd": "probe_run", "routine": routine, "vars": self.PROBE})
            self.assertEqual(r["error"], "Not a probe routine — reload the page", routine)
        self.assertEqual(self.mdis(), [])

    def test_the_calibration_reset_runs_without_values_and_only_it(self):
        # Codex R343 SS-I08: the button's job ({routine: probe_cal_reset,
        # vars: {}}, recorded by the browser) was refused "Missing vars dict"
        r = self._send({"cmd": "probe_run", "routine": "probe_cal_reset", "vars": {}})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.mdis(), ["#3116=0.000000", "O<probe_cal_reset> CALL"])
        # it takes no values; every other routine needs its own
        r = self._send({"cmd": "probe_run", "routine": "probe_cal_reset", "vars": {"3032": 0}})
        self.assertEqual(r["error"], "probe_cal_reset takes no values — reload the page")
        r = self._send({"cmd": "probe_run", "routine": "probe_z_minus_wco", "vars": {}})
        self.assertEqual(r["error"], "Missing vars dict")
        self.assertEqual(self.mdis(), ["#3116=0.000000", "O<probe_cal_reset> CALL"])
        # and the switch holds it like every probe routine
        self.put("features", off("probing"))
        r = self._send({"cmd": "probe_run", "routine": "probe_cal_reset", "vars": {}})
        self.assertEqual(r["error"], "Probing is off — Settings › Features")

    def test_measuring_takes_the_servers_toolsetter_section(self):
        r = self._send({"cmd": "tool_measure", "tool": 5})
        self.assertFalse(r["ok"])                       # nothing set up: nothing starts
        self.assertEqual(self.mdis(), [])
        self.put("toolsetter", dict(TOOLSETTER))
        r = self._send({"cmd": "tool_measure", "tool": 5})
        self.assertTrue(r["ok"], r)
        values, line = self.mdis()[:-1], self.mdis()[-1]
        self.assertEqual(line, "T5 M600")
        self.assertIn("#3102=-179.000000", " ".join(values))
        self.assertIn("#3116=0.000000", " ".join(values))
        r = self._send({"cmd": "tool_unload_measure"})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.mdis()[-1], "T0 M600")

    def test_a_switch_turned_off_meanwhile_stops_the_job_at_its_write(self):
        # the values went in; the switch is off before the line — the line
        # never goes out (the switch is checked at every write, not only at
        # the dispatch)
        orig = self.cmd.wait_complete

        def flip(*a):
            self.store.save_section("features", off("probing"),
                                    base_rev=self.store.view_for(None)["revs"].get("features", 0), writer="other")
            return orig(*a)
        self.cmd.wait_complete = flip
        r = self._send({"cmd": "probe_run", "routine": "probe_z_minus_wco", "vars": self.PROBE})
        self.assertEqual(r, {"ok": False, "error": "Probing is off — Settings › Features"})
        self.assertNotIn("O<probe_z_minus_wco> CALL", self.mdis())


class TestTheCamera(_Store, unittest.TestCase):
    """Camera off: no new stream, and every OPEN stream ends — with its next
    frame or without one (Codex R343 SS-I11: a camera that stopped giving
    frames kept its stream, the producer and the device) — and the shared
    producer and the device are released. The REAL broker and route."""

    def setUp(self):
        self.make_store()
        self.releases, self.tasks = [], []

    def broker(self, frames):
        from camera_broker import CameraBroker

        def register(t):
            self.tasks.append(t)
            return t
        b = CameraBroker(lambda: next(frames, None), lambda: True, lambda: self.releases.append(True), register)
        b._GRACE_S = 0.01
        p = unittest.mock.patch.object(gateway, "_camera_broker", b)
        p.start()
        self.addCleanup(p.stop)
        return b

    def switch_off(self):
        self.put("features", off("camera"))
        return gateway._camera_switched_off()     # what a features save runs after its commit

    def test_off_refuses_a_new_stream_and_the_status(self):
        b = self.broker(iter([]))
        self.put("features", off("camera"))
        r = asyncio.run(gateway.camera_stream())
        self.assertEqual(r.status_code, 403)
        self.assertEqual(b._subscribers, 0)
        r = asyncio.run(gateway.camera_status())
        self.assertEqual(r.status_code, 403)

    def _ends(self, frames):
        b = self.broker(frames)

        async def watch():
            resp = await gateway.camera_stream()
            it = resp.body_iterator
            first = await asyncio.wait_for(it.__anext__(), 1)
            waiter = asyncio.ensure_future(it.__anext__())
            await asyncio.sleep(0.05)
            await self.switch_off()
            done, _ = await asyncio.wait({waiter}, timeout=1)
            ended = bool(done) and isinstance(waiter.exception(), StopAsyncIteration)
            if not done:
                waiter.cancel()
            await asyncio.gather(waiter, return_exceptions=True)
            return first, ended
        first, ended = asyncio.run(watch())
        self.assertIn(b"jpeg", first)
        self.assertTrue(ended, "the open stream did not end")
        self.assertEqual(b._subscribers, 0)
        self.assertIsNone(b._task, "the producer still runs")
        self.assertEqual(self.releases, [True], "the device is not released")

    def test_an_open_stream_ends_when_the_camera_goes_off(self):
        self._ends(iter(lambda: b"jpeg", None))          # frames keep coming

    def test_a_stream_without_frames_ends_too(self):
        self._ends(iter([b"jpeg"]))                      # one frame, then none (a camera pulled)

    def test_a_subscription_that_read_the_switch_before_it_went_off_is_refused(self):
        b = self.broker(iter(lambda: b"jpeg", None))

        async def race():
            epoch = b.epoch
            await self.switch_off()                      # between the switch's read and the subscription
            return await b.subscribe(epoch)
        self.assertIsNone(asyncio.run(race()))
        self.assertEqual(b._subscribers, 0)

    def test_on_again_it_streams_again(self):
        b = self.broker(iter(lambda: b"jpeg", None))

        async def again():
            await self.switch_off()
            self.put("features", ALL_ON)
            resp = await gateway.camera_stream()
            chunk = await asyncio.wait_for(resp.body_iterator.__anext__(), 1)
            await resp.body_iterator.aclose()
            await b.aclose()
            return chunk
        self.assertIn(b"jpeg", asyncio.run(again()))


class TestTheNativeDriver(_Store, unittest.TestCase):
    """Codex R343 SS-I12: the native stage's driver sent the removed
    `set_probe_vars` three times. Every command it names is one the gateway
    handles, and its parameter writes pass the real dispatcher."""

    NATIVE = Path(__file__).resolve().parents[1] / "scripts/native_run.py"

    def calls(self):
        tree = ast.parse(self.NATIVE.read_text())
        out = []
        for n in ast.walk(tree):
            if not isinstance(n, ast.Call):
                continue
            f = n.func
            if isinstance(f, ast.Name) and f.id == "_when_free" and len(n.args) > 1:
                arg = n.args[1]
            elif isinstance(f, ast.Attribute) and f.attr == "request" and n.args:
                arg = n.args[0]
            else:
                continue
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                out.append((arg.value, {k.arg: k.value for k in n.keywords if k.arg}))
        return out

    def test_every_command_it_names_is_handled(self):
        from test_command_policy import ALL_HANDLED_COMMANDS
        names = {c for c, _ in self.calls()}
        self.assertIn("set_params", names)
        self.assertEqual(sorted(names - ALL_HANDLED_COMMANDS), [])

    def test_its_parameter_writes_are_the_toolsetters_and_pass_the_dispatcher(self):
        writes = [kw for c, kw in self.calls() if c == "set_params"]
        self.assertEqual(len(writes), 3)
        for kw in writes:
            self.assertIsInstance(kw.get("purpose"), ast.Constant)
            self.assertEqual(kw["purpose"].value, "toolsetter")
        td.TestHandlerExecution.setUp(self)
        self.make_store()
        td.TestHandlerExecution._rcs(self)
        r = td.TestHandlerExecution._send(self, {"cmd": "set_params", "purpose": "toolsetter",
                                                 "vars": {"3102": -179.0, "3005": 20.0}})
        self.assertTrue(r["ok"], r)
        self.assertTrue(r["mdi_set"], r)


class TestTheTablesAgree(unittest.TestCase):
    def test_every_job_has_a_gate_and_a_bound(self):
        import command_policy as cp
        for c in ("set_params", "probe_run", "surface_scan_run", "tool_measure", "tool_unload_measure"):
            self.assertIn(c, cp.COMMAND_GATES, c)
        self.assertNotIn("set_probe_vars", cp.COMMAND_GATES)
        for c in features.COMMAND_FEATURES:
            self.assertIn(c, cp.COMMAND_GATES, c)
        for c in features.GAMEPAD_COMMANDS:
            self.assertIn("via", cp.COMMAND_SCHEMA[c], c)

    def test_the_gamepads_stops_are_the_gateways_stops(self):
        self.assertEqual(features.GAMEPAD_COMMANDS & gateway._WS_STOP_CMDS,
                         {"jog_stop", "jog_stop_multi", "abort", "estop", "cycle_pause", "spindle_stop"})


if __name__ == "__main__":
    unittest.main()
