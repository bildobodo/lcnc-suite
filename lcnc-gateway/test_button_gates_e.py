"""Button gates package E (BG-07; Codex R202–R204, R218).

The stop contract first (Codex R218): a jog stop goes out in whatever mode
task is in — no switch to MANUAL, which could abort a fresh MDI and, refused,
would have suppressed the stop — addressed as the jog was STARTED, and the
jog counts as stopped only once its stop was written. Then the switch itself:
every mode write is admitted only onto an interpreter KNOWN idle, read in the
write's own thread."""
import asyncio
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()

import gateway  # noqa: E402
from link_fixture import connect_fake, current  # noqa: E402
from command_policy import evaluate_permissions, permission_reasons  # noqa: E402
from gateway_util import (GANTRY_AXIS, JOINT_ORDER_UNDECLARED, NO_JOINT_FOR_AXIS,  # noqa: E402
                          NO_JOINT_MAX_VEL, joint_jog_map, parse_joint_letters, trivkins_coordinates)
from test_button_gates import _payload, _run  # noqa: E402
from test_button_gates_d import _Ini, _Writer, state  # noqa: E402

MDI_RUNNING = {"task_mode": linuxcnc.MODE_MDI, "interp_state": linuxcnc.INTERP_READING}


class _Stops(_Writer):
    def setUp(self):
        super().setUp()
        self.takes_the_mode()
        gateway._active_jogs.clear()

    def jogs(self, **booked):
        """Jogs the gateway started: wire axis → (joint_flag, CMD.jog index)."""
        gateway._active_jogs.clear()
        gateway._active_jogs.update({int(k[1:]): v for k, v in booked.items()})

    def stops(self):
        return [a for n, a, _k in self.cmd.calls if n == "jog" and a[0] == linuxcnc.JOG_STOP]

    def disarm_stop(self):
        async def go():
            async with gateway._get_cmd_lock():
                await gateway._jog_stop_for_client()
        gateway._cmd_lock = None
        _run(go())


class TestAStopNeedsNoSwitch(_Stops):
    """2.9.4 task issues a jog stop in MANUAL, in MDI whatever the interpreter
    does, and in AUTO idle: the stop goes out directly, never behind a switch."""

    def test_jog_stop_in_mdi_idle_and_while_an_mdi_runs(self):
        for controller in ({"task_mode": linuxcnc.MODE_MDI}, MDI_RUNNING):
            with self.subTest(**controller):
                self.cmd.calls.clear()
                self.jogs(a2=(1, 2))
                r = self.send({"cmd": "jog_stop", "axis": 2}, controller=controller)
                self.assertEqual(r, {"ok": True})
                self.assertEqual(self.stops(), [(linuxcnc.JOG_STOP, 1, 2)])
                self.assertNotIn("mode", self.cmd.names())
                self.assertEqual(gateway._active_jogs, {})

    def test_jog_stop_multi(self):
        self.jogs(a0=(1, 0), a2=(1, 2))
        r = self.send({"cmd": "jog_stop_multi", "axes": [0, 2]}, controller=MDI_RUNNING)
        self.assertEqual(r, {"ok": True})
        self.assertEqual(self.stops(), [(linuxcnc.JOG_STOP, 1, 0), (linuxcnc.JOG_STOP, 1, 2)])
        self.assertNotIn("mode", self.cmd.names())

    def test_the_disarm_stop(self):
        self.jogs(a1=(1, 1))
        self.controller(**MDI_RUNNING)
        self.disarm_stop()
        self.assertEqual(self.stops(), [(linuxcnc.JOG_STOP, 1, 1)])
        self.assertNotIn("mode", self.cmd.names())
        self.assertEqual(gateway._active_jogs, {})

    def test_auto_running_sends_nothing(self):
        # task refuses a jog stop there, and no jog can run (unchanged)
        running = {"task_mode": linuxcnc.MODE_AUTO, "interp_state": linuxcnc.INTERP_READING}
        self.jogs(a1=(1, 1))
        r = self.send({"cmd": "jog_stop", "axis": 1}, controller=running)
        self.assertEqual(r, {"ok": True})
        self.controller(**running)
        self.disarm_stop()
        self.assertEqual(self.stops(), [])


class TestAStopAddressesTheJogAsStarted(_Stops):
    """The stop names the joint flag and index its jog was STARTED with — not
    a target recomputed from the motion mode read at the stop."""

    def test_a_teleop_jog_stops_as_teleop(self):
        limits = gateway._machine_limits      # the payload bounds per axis count
        gateway._machine_limits = None
        self.addCleanup(lambda: setattr(gateway, "_machine_limits", limits))
        current().stat.motion_mode = linuxcnc.TRAJ_MODE_TELEOP
        current().stat.axis_mask = 0b101111                 # XYZAC: C is wire 4, canonical 5
        r = self.send({"cmd": "jog_cont", "axis": 4, "vel": 1.0})
        self.assertTrue(r["ok"], r)
        self.assertEqual(gateway._active_jogs, {4: (0, 5)})
        current().stat.motion_mode = None   # read later: not teleop → joint flag 1
        self.cmd.calls.clear()
        self.send({"cmd": "jog_stop", "axis": 4}, controller={})
        self.assertEqual(self.stops(), [(linuxcnc.JOG_STOP, 0, 5)])


class TestAStopIsBookedOnlyOnceWritten(_Stops):
    """A failed stop write leaves its jog booked and says so; the disarm
    stop still stops the others."""

    def failing_stop(self, axis_arg):
        real = self.cmd.__getattr__("jog")

        def jog(*args):
            if args[0] == linuxcnc.JOG_STOP and args[2] == axis_arg:
                raise RuntimeError("NML write failed")
            return real(*args)
        self.cmd.jog = jog

    def test_jog_stop(self):
        self.jogs(a2=(1, 2))
        self.failing_stop(2)
        r = self.send({"cmd": "jog_stop", "axis": 2})
        self.assertFalse(r["ok"], r)
        self.assertEqual(gateway._active_jogs, {2: (1, 2)})

    def test_jog_stop_multi(self):
        self.jogs(a0=(1, 0), a2=(1, 2))
        self.failing_stop(0)
        r = self.send({"cmd": "jog_stop_multi", "axes": [0, 2]})
        self.assertFalse(r["ok"], r)
        self.assertIn("[0]", r["error"])
        self.assertEqual(gateway._active_jogs, {0: (1, 0)})
        self.assertEqual(self.stops(), [(linuxcnc.JOG_STOP, 1, 2)])

    def test_the_disarm_stop(self):
        self.jogs(a0=(1, 0), a2=(1, 2))
        self.failing_stop(0)
        self.disarm_stop()
        self.assertEqual(gateway._active_jogs, {0: (1, 0)})
        self.assertEqual(self.stops(), [(linuxcnc.JOG_STOP, 1, 2)])


class TestNoSwitchOntoARunningInterpreter(_Writer):
    """Codex R218's carry-over: every mode write is admitted in its own
    thread only onto an interpreter KNOWN idle — here an MDI starts while the
    switch waits in the executor queue (after every check before it)."""

    def setUp(self):
        super().setUp()
        self.takes_the_mode()
        self.cmd.wait_complete = lambda *a: linuxcnc.RCS_DONE

    def running(self):
        for k, v in MDI_RUNNING.items():
            setattr(current().stat, k, v)

    def test_handlers(self):
        cases = ((dict(task_mode=linuxcnc.MODE_MDI), {"cmd": "jog_cont", "axis": 0, "vel": 1.0}),
                 (dict(task_mode=linuxcnc.MODE_MDI), {"cmd": "jog_incr", "axis": 0, "vel": 1.0, "distance": 1.0}),
                 (dict(task_mode=linuxcnc.MODE_MANUAL), {"cmd": "mdi", "text": "G0 X1"}))
        for controller, msg in cases:
            with self.subTest(cmd=msg["cmd"]):
                self.cmd.calls.clear()
                self.controller(**controller)
                r = self.at_the_write(msg, self.running)
                self.assertEqual(r, {"ok": False, "error": "Machine busy — wait until it is idle"})
                self.assertEqual([n for n in self.cmd.names() if n in ("mode", "jog", "mdi")], [])

    def test_the_background_fixture_heal(self):
        self.controller()
        # the heal's own check on a current read passes (package 2b): G59.1
        # active, no plane (fresh reader), the snapshot ready — the MDI then
        # starts at the write, which its thread refuses
        current().stat.g5x_index = 7
        self.addCleanup(setattr, gateway, "_shared_status", gateway._shared_status)
        gateway._shared_status = _payload(inpos=True, current_vel=0.0)
        p = mock.patch.object(gateway, "_reader_fresh_get", lambda f: 0 if f == "twp_active" else None)
        p.start()
        self.addCleanup(p.stop)
        self.assertEqual(gateway._reserved_heal_check(), (None, ""), "the check before the write must pass")
        traced = []
        with mock.patch.object(gateway._trace, "emit", lambda tag, **kw: traced.append((tag, kw))):
            async def go():
                import asyncio
                loop = asyncio.get_running_loop()
                original = loop.run_in_executor

                def enqueue(executor, fn, *args):
                    def changed_then_run(*a):
                        self.running()
                        return fn(*a)
                    return original(executor, changed_then_run, *args)
                with mock.patch.object(loop, "run_in_executor", enqueue):
                    await gateway._reserved_fixture_heal()
            _run(go())
        self.assertEqual([n for n in self.cmd.names() if n in ("mode", "mdi")], [])
        self.assertIn("twp.reserved_fixture_heal_failed", [t for t, _ in traced])

    def test_an_idle_controller_switches(self):
        self.controller(task_mode=linuxcnc.MODE_MDI)
        r = self.at_the_write({"cmd": "jog_cont", "axis": 0, "vel": 1.0}, lambda: None)
        self.assertTrue(r["ok"], r)
        self.assertEqual([n for n in self.cmd.names() if n in ("mode", "jog")], ["mode", "jog"])


class TestTheJointMap(unittest.TestCase):
    """BG-07: the joint a jog before homing moves comes from a DECLARED joint
    order — the shipped orders, and a gantry, whose letter two joints carry,
    closed (the only gantry evidence: no gantry sim config exists)."""

    def rows(self, letters, axes, joints=None, max_vels=None):
        n = len(letters) if joints is None and letters is not None else joints
        rows, why = joint_jog_map(letters, n, axes, max_vels if max_vels is not None else [10.0] * (n or 0))
        return [(r["letter"], r["joint"], r["reason"]) for r in rows], why

    def test_the_shipped_orders(self):
        for letters in ("XYZ", "XYZAC", "XYZABC"):
            with self.subTest(letters=letters):
                rows, why = self.rows(list(letters), list(letters))
                self.assertIsNone(why)
                self.assertEqual(rows, [(L, j, None) for j, L in enumerate(letters)])

    def test_a_joint_order_unlike_the_axis_list(self):
        # joint 3 carries C, joint 4 A: the wire's axis index is no joint number
        rows, _ = self.rows(list("XYZCA"), list("XYZAC"))
        self.assertEqual([j for _L, j, _r in rows], [0, 1, 2, 4, 3])

    def test_a_gantry_letter_is_closed(self):
        rows, why = self.rows(list("XYYZ"), list("XYZ"))
        self.assertIsNone(why)
        self.assertEqual(rows, [("X", 0, None), ("Y", None, GANTRY_AXIS), ("Z", 3, None)])

    def test_the_whole_map_closes(self):
        self.assertEqual(self.rows(None, list("XYZ"), joints=3)[1], JOINT_ORDER_UNDECLARED)
        self.assertEqual(self.rows(list("XYZ"), list("XYZ"), joints=4)[1],
                         "Joint order names 3 joints, machine has 4")
        self.assertEqual(self.rows(list("XYA"), list("XYZ"))[1], "Joint order names A, not a machine axis")
        rows, why = self.rows(None, list("XY"), joints=2)
        self.assertEqual([j for _L, j, _r in rows], [None, None])

    def test_an_axis_without_a_joint_or_a_max_velocity(self):
        rows, _ = self.rows(list("XY"), list("XYZ"), joints=2)
        self.assertEqual(rows[2], ("Z", None, NO_JOINT_FOR_AXIS))
        rows, _ = self.rows(list("XYZ"), list("XYZ"), max_vels=[10.0, None, 0.0])
        self.assertEqual(rows, [("X", 0, None), ("Y", None, NO_JOINT_MAX_VEL), ("Z", None, NO_JOINT_MAX_VEL)])

    def test_the_declaration_forms(self):
        for raw in ("X Y Z A C", "X,Y,Z,A,C", "xyzac", " XYZAC "):
            with self.subTest(raw=raw):
                self.assertEqual(parse_joint_letters(raw), list("XYZAC"))
        self.assertIsNone(parse_joint_letters(None))
        self.assertIsNone(parse_joint_letters("  "))
        for raw in ("X Y Q", "X1 Y", "XY-Z"):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse_joint_letters(raw)
        self.assertEqual(trivkins_coordinates("trivkins coordinates=XYYZ"), list("XYYZ"))
        self.assertEqual(trivkins_coordinates("trivkins coordinates=xyz kinstype=BOTH"), list("XYZ"))
        self.assertIsNone(trivkins_coordinates("trivkins"), "the module's default is not guessed")
        self.assertIsNone(trivkins_coordinates("xyzac-trt-kins coordinates=XYZAC"))


class TestTheJogGate(unittest.TestCase):
    """`jog` opens before homing only where the machine declares the joint jog."""

    def test_unhomed(self):
        s = state(is_homed=False)
        self.assertFalse(evaluate_permissions(s)["jog"])
        self.assertEqual(permission_reasons(s)["jog"], "Not homed — press Home All")
        self.assertTrue(evaluate_permissions(state(is_homed=False, joint_jog_before_homing=True))["jog"])
        self.assertTrue(evaluate_permissions(state(is_homed=True))["jog"])

    def test_the_rest_still_applies(self):
        for over in ({"armed": False}, {"is_estop": True}, {"is_enabled": False},
                     {"is_idle": False, "is_running": True}):
            with self.subTest(**over):
                self.assertFalse(evaluate_permissions(state(is_homed=False, joint_jog_before_homing=True, **over))["jog"])


class TestTheJointJogFacts(unittest.TestCase):
    """The switch, the cap and the joint order from the INI (operator E1/E2)."""

    def setUp(self):
        saved = gateway._joint_jog_cache
        self.addCleanup(lambda: setattr(gateway, "_joint_jog_cache", saved))
        connect_fake(self)
        current().stat.ini_filename = "/x/machine.ini"
        current().stat.joints = 3
        current().stat.axis_mask = 0b111
        p = mock.patch.object(gateway.linuxcnc, "ini", _Ini)
        p.start()
        self.addCleanup(p.stop)

    def facts(self, switch="1", fraction=None, axes=None, kins="trivkins coordinates=XYZ", joints=3):
        v = {("KINS", "KINEMATICS"): kins}
        v.update({(f"JOINT_{j}", "MAX_VELOCITY"): "20" for j in range(joints)})
        for key, val in (("WEBUI_JOINT_JOG_BEFORE_HOMING", switch), ("WEBUI_JOINT_JOG_MAX_FRACTION", fraction),
                         ("WEBUI_JOINT_AXES", axes)):
            if val is not None:
                v[("DISPLAY", key)] = val
        _Ini.values = v
        current().stat.joints = joints
        gateway._joint_jog_cache = None
        return gateway._joint_jog_facts()

    def test_the_switch(self):
        self.assertTrue(self.facts("1")["enabled"])
        self.assertTrue(self.facts(" 1 ")["enabled"])
        for raw in (None, "", "0", "yes", "true", "2"):
            with self.subTest(raw=raw):
                self.assertFalse(self.facts(raw)["enabled"])
        with mock.patch.object(gateway._trace, "emit") as emit:
            self.facts("yes")
        self.assertIn("policy.joint_jog_invalid", [c.args[0] for c in emit.call_args_list])

    def test_the_cap(self):
        self.assertEqual(self.facts()["fraction"], 0.1)
        self.assertEqual(self.facts(fraction="0.25")["fraction"], 0.25)
        self.assertEqual(self.facts(fraction="1")["fraction"], 1.0)
        for raw in ("0", "-0.1", "1.5", "ten", "nan", "inf"):
            with self.subTest(raw=raw):
                f = self.facts(fraction=raw)
                self.assertFalse(f["enabled"], "an invalid cap never opens the jog")
                self.assertIn("WEBUI_JOINT_JOG_MAX_FRACTION", f["reason"])

    def test_the_joint_order(self):
        f = self.facts()
        self.assertEqual([(r["letter"], r["joint"]) for r in f["axes"]], [("X", 0), ("Y", 1), ("Z", 2)])
        self.assertEqual(self.facts(axes="X Y Z")["axes"][2]["joint"], 2)
        f = self.facts(kins="xyzac-trt-kins")
        self.assertFalse(f["enabled"])
        self.assertEqual(f["reason"], JOINT_ORDER_UNDECLARED)
        self.assertFalse(self.facts(axes="X Y Q")["enabled"])
        f = self.facts(kins="trivkins coordinates=XYYZ", joints=4)
        self.assertTrue(f["enabled"])
        self.assertEqual([(r["letter"], r["joint"]) for r in f["axes"]], [("X", 0), ("Y", None), ("Z", 3)])

    def test_unread_before_the_connect(self):
        current().stat.ini_filename = None
        gateway._joint_jog_cache = None
        self.assertFalse(gateway._joint_jog_facts()["enabled"])
        self.assertIsNone(gateway._joint_jog_cache, "not cached")


class TestJoggingBeforeHoming(_Writer):
    """BG-07 at the handlers: before homing each axis moves its DECLARED
    joint, at most the cap; a closed axis refuses the whole command, nothing
    sent; the jog is booked as sent, and its stop addresses exactly that."""

    def setUp(self):
        super().setUp()
        self.takes_the_mode()
        self.cmd.wait_complete = lambda *a: linuxcnc.RCS_DONE
        gateway._active_jogs.clear()
        self.order(list("XYZ"))

    def order(self, letters, axes="XYZ", fraction=0.1, max_vel=20.0, enabled=True):
        rows, why = joint_jog_map(letters, len(letters), list(axes), [max_vel] * len(letters))
        facts = {"enabled": enabled and why is None, "fraction": fraction, "axes": rows, "reason": why}
        p = mock.patch.object(gateway, "_joint_jog_facts", lambda: facts)
        p.start()
        self.addCleanup(p.stop)

    def unhomed(self, msg, **controller):
        return self.send(msg, controller={"homed": False, **controller}, homed=False)

    def jogs(self):
        return [a for n, a, _k in self.cmd.calls if n == "jog"]

    def test_a_joint_jog_at_the_cap(self):
        r = self.unhomed({"cmd": "jog_cont", "axis": 1, "vel": -5.0})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.jogs(), [(linuxcnc.JOG_CONTINUOUS, 1, 1, -2.0)])   # 10 % of 20
        self.assertEqual(gateway._active_jogs, {1: (1, 1)})
        self.cmd.calls.clear()
        self.unhomed({"cmd": "jog_cont", "axis": 0, "vel": 1.5})               # below the cap
        self.assertEqual(self.jogs(), [(linuxcnc.JOG_CONTINUOUS, 1, 0, 1.5)])

    def test_an_increment(self):
        r = self.unhomed({"cmd": "jog_incr", "axis": 2, "vel": 9.0, "distance": -1.0})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.jogs(), [(linuxcnc.JOG_INCREMENT, 1, 2, 2.0, -1.0)])

    def test_the_declared_joint_not_the_index(self):
        self.order(list("XZY"))       # joint 1 carries Z, joint 2 Y
        self.unhomed({"cmd": "jog_cont", "axis": 1, "vel": 1.0})        # wire 1 = Y
        self.assertEqual(self.jogs(), [(linuxcnc.JOG_CONTINUOUS, 1, 2, 1.0)])
        self.cmd.calls.clear()
        self.send({"cmd": "jog_stop", "axis": 1}, controller={"homed": False}, homed=False)
        self.assertEqual(self.jogs(), [(linuxcnc.JOG_STOP, 1, 2)])

    def test_a_gantry_axis_refuses_the_whole_command(self):
        self.order(list("XYYZ"))
        for msg in ({"cmd": "jog_cont", "axis": 1, "vel": 1.0},
                    {"cmd": "jog_cont_multi", "axes": [{"axis": 0, "vel": 1.0}, {"axis": 1, "vel": 1.0}]},
                    {"cmd": "jog_incr_multi", "axes": [{"axis": 2, "vel": 1.0, "distance": 1.0},
                                                       {"axis": 1, "vel": 1.0, "distance": 1.0}]}):
            with self.subTest(cmd=msg["cmd"]):
                self.cmd.calls.clear()
                current().stat.joints = 4
                r = self.send(msg, controller={"homed": False, "joints": 4}, homed=False)
                self.assertEqual(r, {"ok": False, "error": "Gantry axis — jog it after Home All"})
                self.assertEqual([n for n in self.cmd.names() if n in ("mode", "jog")], [])

    def test_a_diagonal_is_refused_before_homing(self):
        # package F (operator 2026-10-28): the diagonals' multi-jogs start two
        # joints at once — no single joint, like a coordinated move; AXIS and
        # gmoccapy have no diagonals in joint mode
        for msg in ({"cmd": "jog_cont_multi", "axes": [{"axis": 0, "vel": 1.0}, {"axis": 1, "vel": 1.0}]},
                    {"cmd": "jog_incr_multi", "axes": [{"axis": 0, "vel": 1.0, "distance": 1.0},
                                                       {"axis": 1, "vel": 1.0, "distance": -1.0}]}):
            with self.subTest(cmd=msg["cmd"]):
                self.cmd.calls.clear()
                r = self.unhomed(msg)
                self.assertEqual(r, {"ok": False, "error": "Diagonal jog after Home All"})
                self.assertEqual([n for n in self.cmd.names() if n in ("mode", "jog")], [])

    def test_a_diagonal_homed_is_unchanged(self):
        current().stat.motion_mode = linuxcnc.TRAJ_MODE_TELEOP
        r = self.send({"cmd": "jog_cont_multi", "axes": [{"axis": 0, "vel": 1.0}, {"axis": 1, "vel": 1.0}]})
        self.assertTrue(r["ok"], r)
        self.assertEqual([a[2] for a in self.jogs()], [0, 1])

    def test_partially_homed_is_before_homing(self):
        # joints 0 and 1 homed, 2 not: joint mode, the cap on every joint
        # (over-strict for the homed ones, which their soft limits protect)
        self.controller()
        current().stat.homed = (1, 1, 0) + (0,) * 13
        gateway._shared_status = _payload(homed=False, inpos=True, current_vel=0.0)
        gateway._cmd_lock = None
        r = _run(gateway.handle_command({"cmd": "jog_cont", "axis": 0, "vel": 9.0}, True, self.writer.conn_key))
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.jogs(), [(linuxcnc.JOG_CONTINUOUS, 1, 0, 2.0)])

    def test_without_the_switch_unhomed_is_refused(self):
        self.order(list("XYZ"), enabled=False)
        r = self.unhomed({"cmd": "jog_cont", "axis": 0, "vel": 1.0})
        self.assertEqual(r, {"ok": False, "error": "Not homed — press Home All"})
        self.assertEqual(self.jogs(), [])

    def test_homed_is_unchanged(self):
        current().stat.motion_mode = linuxcnc.TRAJ_MODE_TELEOP
        r = self.send({"cmd": "jog_cont", "axis": 1, "vel": 9.0})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.jogs(), [(linuxcnc.JOG_CONTINUOUS, 0, 1, 9.0)])   # teleop, no cap

    def test_the_jog_is_admitted_at_its_write(self):
        def running():
            current().stat.task_mode, current().stat.interp_state = linuxcnc.MODE_MDI, linuxcnc.INTERP_READING
        self.controller(homed=False)                 # MANUAL already: the first write is the jog
        current().stat.homed = (0,) * 16
        r = self.at_the_write({"cmd": "jog_cont", "axis": 0, "vel": 1.0}, running)
        self.assertFalse(r["ok"], r)
        self.assertEqual(self.jogs(), [])


class TestTheJogHoldsAtItsWrite(_Writer):
    """Codex R219: what a jog was prepared under holds at its write. BG-33 —
    homing lost while the write waits (a homed beyond-limit joint jog,
    uncapped; a homed gantry axis): refused, never the old favourable state.
    BG-35 — no new jog while homing runs (native motion rejects it, and a
    booked jog's later stop would cancel the homing). BG-34 — a jog whose
    write happened stays booked through a cancel, so the disconnect stop
    reaches it."""

    LOST = "Homing state changed — jog again"

    def setUp(self):
        super().setUp()
        self.takes_the_mode()
        self.cmd.wait_complete = lambda *a: linuxcnc.RCS_DONE
        gateway._active_jogs.clear()
        self.order("XYZ")

    def order(self, letters, joints=None):
        rows, why = joint_jog_map(list(letters), len(letters), list("XYZ"), [20.0] * len(letters))
        facts = {"enabled": True, "fraction": 0.1, "axes": rows, "reason": why}
        p = mock.patch.object(gateway, "_joint_jog_facts", lambda: facts)
        p.start()
        self.addCleanup(p.stop)

    def jogs(self):
        return [a for n, a, _k in self.cmd.calls if n == "jog"]

    def lose_homing(self):
        current().stat.homed = (0,) * 16

    def beyond_limit(self, axis_letter, joints=3):
        # homed, one joint past its soft limit: the supported joint-mode jog
        self.controller(joints=joints)
        current().stat.homed = (1,) * joints + (0,) * (16 - joints)
        current().stat.motion_mode = None          # joint (free) mode
        gateway._shared_status = _payload(homed=True, inpos=True, current_vel=0.0,
                                          joints_beyond_limit=[axis_letter])

    def test_homing_lost_while_queued_keeps_no_uncapped_speed(self):
        self.beyond_limit("X")
        r = self.at_the_write({"cmd": "jog_cont", "axis": 0, "vel": 9.0}, self.lose_homing,
                              snapshot=gateway._shared_status)
        self.assertEqual(r, {"ok": False, "error": self.LOST})
        self.assertEqual(self.jogs(), [])

    def test_homing_lost_while_queued_opens_no_gantry_joint(self):
        self.order("XYYZ")
        self.beyond_limit("Y", joints=4)
        r = self.at_the_write({"cmd": "jog_cont", "axis": 1, "vel": 1.0}, self.lose_homing,
                              snapshot=gateway._shared_status)
        self.assertEqual(r, {"ok": False, "error": self.LOST})
        self.assertEqual(self.jogs(), [])

    def test_a_multi_jog_holds_between_its_axes(self):
        # the second axis' write meets the lost homing
        self.beyond_limit("X")
        r = self.at_the_write({"cmd": "jog_cont_multi", "axes": [{"axis": 0, "vel": 9.0}, {"axis": 1, "vel": 9.0}]},
                              self.lose_homing, at=2, snapshot=gateway._shared_status)
        self.assertEqual(r, {"ok": False, "error": self.LOST})
        self.assertEqual([a[2] for a in self.jogs()], [0], "only the first axis was written")
        self.assertEqual(set(gateway._active_jogs), {0}, "and it is booked for its stop")

    def test_no_new_jog_while_homing_runs(self):
        self.controller(homed=False, homing=True)
        r = self.send({"cmd": "jog_cont", "axis": 0, "vel": 1.0},
                      controller={"homed": False, "homing": True}, homed=False, homing_active=True)
        self.assertEqual(r, {"ok": False, "error": "Homing in progress — wait until it ends"})
        self.assertEqual(self.jogs(), [])
        self.assertEqual(gateway._active_jogs, {})

    def test_no_jog_when_homing_starts_in_the_queue(self):
        self.controller(homed=False)
        current().stat.homed = (0,) * 16

        def homing():
            current().stat.joint = tuple({"homing": 1} for _ in range(16))
        r = self.at_the_write({"cmd": "jog_cont", "axis": 0, "vel": 1.0}, homing,
                              snapshot=_payload(homed=False, inpos=True, current_vel=0.0))
        self.assertEqual(r, {"ok": False, "error": "Homing in progress — wait until it ends"})
        self.assertEqual(self.jogs(), [])

    def test_unchanged_unhomed_is_capped_and_stops(self):
        self.controller(homed=False)
        current().stat.homed = (0,) * 16
        r = self.at_the_write({"cmd": "jog_cont", "axis": 0, "vel": 9.0}, lambda: None,
                              snapshot=_payload(homed=False, inpos=True, current_vel=0.0))
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.jogs(), [(linuxcnc.JOG_CONTINUOUS, 1, 0, 2.0)])

    def test_a_written_jog_survives_a_cancel(self):
        self.controller(homed=False)
        current().stat.homed = (0,) * 16
        gateway._shared_status = _payload(homed=False, inpos=True, current_vel=0.0)

        async def go():
            loop = asyncio.get_running_loop()
            pool = ThreadPoolExecutor(max_workers=1)
            loop.set_default_executor(pool)
            release = threading.Event()
            blocker = loop.run_in_executor(None, release.wait, 5)
            submitted = asyncio.Event()
            original = loop.run_in_executor

            def enqueue(executor, fn, *args):
                fut = original(executor, fn, *args)
                submitted.set()
                return fut
            try:
                with mock.patch.object(loop, "run_in_executor", enqueue):
                    task = asyncio.create_task(gateway.handle_command(
                        {"cmd": "jog_cont", "axis": 0, "vel": 1.0}, True, self.writer.conn_key))
                    await asyncio.wait_for(submitted.wait(), 2)
                    self.assertEqual(self.jogs(), [])
                    task.cancel()             # the disconnect, while the write waits
                    await asyncio.sleep(0)
                    release.set()
                    await blocker
                    result = await asyncio.gather(task, return_exceptions=True)
                self.assertIsInstance(result[0], asyncio.CancelledError)
                booked = dict(gateway._active_jogs)
                async with gateway._get_cmd_lock():
                    await gateway._jog_stop_for_client()
                return booked
            finally:
                release.set()
                pool.shutdown(wait=False)
        gateway._cmd_lock = None
        booked = _run(go())
        self.assertEqual(self.jogs()[0], (linuxcnc.JOG_CONTINUOUS, 1, 0, 1.0), "the write happened")
        self.assertEqual(booked, {0: (1, 0)}, "booked as sent, through the cancel")
        self.assertEqual(self.jogs()[-1], (linuxcnc.JOG_STOP, 1, 0), "and the disconnect stop reaches it")


class TestAWriteOutlastsEveryCancel(_Writer):
    """Codex R220 (BG-34 rest): a SECOND cancel — the abort preemption, then
    the disconnect — must not let the command lock go while a write still
    waits or runs; the lock is released, and the cancel propagates, only once
    the write and its booking are done, so the disconnect stop that takes the
    lock next reaches the jog."""

    def setUp(self):
        super().setUp()
        self.takes_the_mode()
        gateway._active_jogs.clear()
        rows, why = joint_jog_map(list("XYZ"), 3, list("XYZ"), [20.0] * 3)
        facts = {"enabled": True, "fraction": 0.1, "axes": rows, "reason": why}
        p = mock.patch.object(gateway, "_joint_jog_facts", lambda: facts)
        p.start()
        self.addCleanup(p.stop)
        self.controller(homed=False)
        current().stat.homed = (0,) * 16
        gateway._shared_status = _payload(homed=False, inpos=True, current_vel=0.0)

    def jogs(self):
        return [a for n, a, _k in self.cmd.calls if n == "jog"]

    def test_two_cancels_keep_the_lock_until_the_write_is_done(self):
        async def go():
            loop = asyncio.get_running_loop()
            pool = ThreadPoolExecutor(max_workers=1)
            loop.set_default_executor(pool)
            release = threading.Event()
            blocker = loop.run_in_executor(None, release.wait, 5)
            submitted = asyncio.Event()
            original = loop.run_in_executor

            def enqueue(executor, fn, *args):
                fut = original(executor, fn, *args)
                submitted.set()
                return fut
            task = None
            try:
                with mock.patch.object(loop, "run_in_executor", enqueue):
                    task = asyncio.create_task(gateway.handle_command(
                        {"cmd": "jog_cont", "axis": 0, "vel": 1.0}, True, self.writer.conn_key))
                    await asyncio.wait_for(submitted.wait(), 2)
                    self.writer.cmd_inflight = "jog_cont"
                    self.writer.cmd_inflight_task = task
                    self.assertEqual(gateway._preempt_inflight("abort", 923), 1)   # the first cancel
                    await asyncio.sleep(0)
                    task.cancel()                                                # the disconnect's
                    for _ in range(6):
                        await asyncio.sleep(0)
                    held = gateway._get_cmd_lock().locked()
                    release.set()
                    await blocker
                    result = await asyncio.gather(task, return_exceptions=True)
                booked = dict(gateway._active_jogs)
                async with gateway._get_cmd_lock():
                    await gateway._jog_stop_for_client()
                return held, result[0], booked
            finally:
                release.set()
                if task and not task.done():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
                pool.shutdown(wait=False)
        gateway._cmd_lock = None
        held, result, booked = _run(go())
        self.assertTrue(held, "the command lock never escapes under an unfinished write")
        self.assertIsInstance(result, asyncio.CancelledError, "the cancel still propagates, after the write")
        self.assertEqual(booked, {0: (1, 0)})
        self.assertEqual(self.jogs(), [(linuxcnc.JOG_CONTINUOUS, 1, 0, 1.0), (linuxcnc.JOG_STOP, 1, 0)])


if __name__ == "__main__":
    unittest.main()
