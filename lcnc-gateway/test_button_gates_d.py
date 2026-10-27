"""Button gates package D (BG-03, BG-04, BG-10, BG-11, BG-13, Q1; Codex R202–R204).

The policy table first: loading a program needs arm and a known idle
interpreter, not AUTO, power or homing (BG-03); the task mode is judged per
target — MANUAL wherever task takes it, MDI / AUTO only where COORD is
reachable (BG-04); the recovery order is a directed rule with the trip as an
input (BG-11); the confirmed G30 read is its own class, closed where the synch
is refused (BG-13); the manual spindle runs before homing only on a machine
that declares it, in MANUAL (Q1)."""
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()

import gateway  # noqa: E402
from command_policy import COMMAND_GATES  # noqa: E402
from test_button_gates import _Handlers, _payload, _run, controller_reads  # noqa: E402
from command_policy import (  # noqa: E402
    G30_NOT_IN_AUTO, GATE_REQUIREMENTS, NOT_ARMED, STATE_UNKNOWN, TASK_MODE_AUTO,
    TASK_MODE_MANUAL, TASK_MODE_MDI, TRIP_UNACKED, UNHOMED_SPINDLE_MANUAL, MachineState,
    evaluate_permissions, permission_reasons,
)


def state(**over) -> MachineState:
    """Homed, idle, enabled, armed, standing, MANUAL, no trip — override per test."""
    base = dict(
        armed=True, is_estop=False, is_enabled=True, is_homed=True,
        is_idle=True, is_running=False, is_paused=False, eoffset_enabled=False,
        rotary_at_zero=True, kins_switchable=False, kins_type=None, g5x_index=1,
        twp_active=False, a_at_zero=True, interp_known=True, tool_change_pending=False,
        motion_still=True, task_mode=TASK_MODE_MANUAL, homing_active=False,
        trip_unacked=False,
    )
    base.update(over)
    return MachineState(**base)


def gate(name, **over):
    s = state(**over)
    return evaluate_permissions(s)[name], permission_reasons(s).get(name)


class TestProgramLoad(unittest.TestCase):
    """BG-03: PLAN_OPEN needs neither AUTO nor power nor homing."""

    def test_open_in_estop_off_and_unhomed(self):
        for over in ({"is_estop": True, "is_enabled": False}, {"is_enabled": False},
                     {"is_homed": False}, {"task_mode": TASK_MODE_MDI}):
            with self.subTest(**over):
                self.assertEqual(gate("programLoad", **over), (True, None))

    def test_closed_disarmed_running_or_unread(self):
        self.assertEqual(gate("programLoad", armed=False), (False, NOT_ARMED))
        self.assertFalse(gate("programLoad", is_idle=False, is_running=True)[0])
        self.assertEqual(gate("programLoad", interp_known=False, is_idle=False), (False, STATE_UNKNOWN))


class TestModePerTarget(unittest.TestCase):
    """BG-04: MANUAL wherever task takes it; MDI / AUTO where COORD is reachable."""

    def test_manual_open_in_estop_off_and_unhomed(self):
        for over in ({"is_estop": True, "is_enabled": False}, {"is_enabled": False}, {"is_homed": False}):
            with self.subTest(**over):
                self.assertEqual(gate("modeManual", **over), (True, None))

    def test_no_switch_while_moving_homing_or_unknown(self):
        self.assertEqual(gate("modeManual", motion_still=False), (False, "Machine moving — wait until it stands"))
        self.assertEqual(gate("modeManual", homing_active=True), (False, "Homing in progress — wait until it ends"))
        self.assertEqual(gate("modeManual", motion_still=None)[0], False)
        self.assertEqual(gate("modeManual", homing_active=None)[0], False)
        self.assertEqual(gate("modeCoord", motion_still=False)[0], False)

    def test_coord_needs_homing_unless_declared(self):
        self.assertEqual(gate("modeCoord", is_homed=False), (False, "Not homed — MDI and Auto need Home All"))
        self.assertEqual(gate("modeCoord", is_homed=False, coord_without_homing=True), (True, None))
        self.assertEqual(gate("modeCoord"), (True, None))

    def test_coord_homed_in_estop_and_off(self):
        # the matrix's H: homed although the power is off — COORD needs no enable
        self.assertEqual(gate("modeCoord", is_estop=True, is_enabled=False), (True, None))
        self.assertEqual(gate("modeCoord", is_enabled=False), (True, None))

    def test_disarmed_or_running_closes_both(self):
        for g in ("modeManual", "modeCoord"):
            self.assertEqual(gate(g, armed=False), (False, NOT_ARMED))
            self.assertFalse(gate(g, is_idle=False, is_running=True)[0])


class TestRecoveryOrder(unittest.TestCase):
    """BG-11: trip → acknowledge → Arm → E-Stop Reset → On."""

    def test_arming_waits_for_the_acknowledgement(self):
        self.assertEqual(gate("armEnable", trip_unacked=True), (False, TRIP_UNACKED))
        self.assertEqual(gate("armEnable", armed=False), (True, None))

    def test_reset_needs_arm_and_the_acknowledgement(self):
        self.assertEqual(gate("estopReset", is_estop=True, trip_unacked=True), (False, TRIP_UNACKED))
        self.assertEqual(gate("estopReset", is_estop=True, armed=False), (False, NOT_ARMED))
        self.assertEqual(gate("estopReset", is_estop=True), (True, None))

    def test_an_unbuilt_trip_input_reads_tripped(self):
        # a builder that never says reads the CLOSED gate
        s = MachineState(armed=True, is_estop=True, is_enabled=False, is_homed=True, is_idle=True,
                         is_running=False, is_paused=False, eoffset_enabled=False)
        self.assertFalse(evaluate_permissions(s)["estopReset"])


class TestG30Read(unittest.TestCase):
    """BG-13: the confirming synch is refused with the machine ON in AUTO."""

    def test_read_open_off_estop_unhomed_and_in_manual_or_mdi(self):
        for over in ({"is_enabled": False, "task_mode": TASK_MODE_AUTO},
                     {"is_estop": True, "is_enabled": False}, {"is_homed": False},
                     {"task_mode": TASK_MODE_MDI}, {}):
            with self.subTest(**over):
                self.assertEqual(gate("parameterRead", **over), (True, None))

    def test_read_closed_on_in_auto_and_with_the_mode_unread(self):
        self.assertEqual(gate("parameterRead", task_mode=TASK_MODE_AUTO), (False, G30_NOT_IN_AUTO))
        self.assertEqual(gate("parameterRead", task_mode=None), (False, STATE_UNKNOWN))
        self.assertEqual(gate("parameterRead", armed=False), (False, NOT_ARMED))

    def test_capture_and_save_add_the_same_condition(self):
        for g in ("g30Capture", "g30Write"):
            with self.subTest(gate=g):
                self.assertEqual(gate(g), (True, None))
                self.assertEqual(gate(g, task_mode=TASK_MODE_AUTO), (False, G30_NOT_IN_AUTO))


class TestSpindleBeforeHoming(unittest.TestCase):
    """Q1: homed, or the declared exception in MANUAL."""

    def test_homed_is_open(self):
        self.assertEqual(gate("spindleManual"), (True, None))

    def test_unhomed_without_the_switch_keeps_the_homing_rule(self):
        self.assertEqual(gate("spindleManual", is_homed=False), (False, "Not homed — press Home All"))

    def test_the_switch_opens_manual_only(self):
        self.assertEqual(gate("spindleManual", is_homed=False, spindle_before_homing=True), (True, None))
        for mode in (TASK_MODE_MDI, TASK_MODE_AUTO, None):
            with self.subTest(mode=mode):
                self.assertEqual(gate("spindleManual", is_homed=False, spindle_before_homing=True, task_mode=mode),
                                 (False, UNHOMED_SPINDLE_MANUAL))

    def test_power_idle_and_arm_still_apply(self):
        self.assertEqual(gate("spindleManual", is_homed=False, spindle_before_homing=True, is_enabled=False),
                         (False, "Machine off — press Power on"))
        self.assertFalse(gate("spindleManual", is_homed=False, spindle_before_homing=True,
                              is_idle=False, is_running=True)[0])
        self.assertEqual(gate("spindleManual", armed=False), (False, NOT_ARMED))


class TestFrontendGateNames(unittest.TestCase):
    """The policy and permissions.ts name the same classes: a class the client
    lacks is closed there (BG-15), one the gateway lacks closes with "restart"."""

    def test_gate_names_match(self):
        src = (Path(__file__).resolve().parent.parent / "lcnc-webui" / "src" / "permissions.ts").read_text()
        m = re.search(r"export const GATE_NAMES = \[(.*?)\] as const;", src, re.S)
        self.assertIsNotNone(m, "GATE_NAMES not found in permissions.ts")
        names = set(re.findall(r'"(\w+)"', m.group(1)))
        self.assertEqual(names, set(GATE_REQUIREMENTS))


class TestCommandGates(unittest.TestCase):
    """Each command names its D class (the dispatcher's check)."""

    def test_the_commands_name_their_classes(self):
        for cmd, g in (("load_file", "programLoad"), ("unload_file", "programLoad"),
                       ("reparse_preview", "programLoad"), ("set_mode", "modeManual"),
                       ("estop_reset", "estopReset"), ("read_g30", "parameterRead"),
                       ("capture_g30", "g30Capture"), ("set_g30", "g30Write"),
                       ("spindle_forward", "spindleManual"), ("spindle_reverse", "spindleManual"),
                       ("spindle_increase", "spindleManual"), ("spindle_decrease", "spindleManual")):
            self.assertEqual(COMMAND_GATES[cmd], g, cmd)


class _Writer(_Handlers):
    """The handlers, with THIS connection registered and armed (a load is
    admitted at its commit for the sending connection — the BG-14 rule)."""

    def setUp(self):
        super().setUp()
        clients, claims = dict(gateway._clients), list(gateway._source_claims)
        self.addCleanup(lambda: (gateway._clients.clear(), gateway._clients.update(clients),
                                 gateway._source_claims.__setitem__(slice(None), claims)))
        gateway._clients.clear()
        gateway._source_claims.clear()
        self.writer = gateway.ClientState(ip="d", ws=None, armed=True)
        gateway._clients[921] = self.writer
        p = mock.patch.object(gateway, "_unacked_trip", None)
        p.start()
        self.addCleanup(p.stop)
        self.controller()

    def controller(self, **now):
        """What STAT reads NOW (see controller_reads)."""
        controller_reads(gateway.STAT, **now)

    _MIRRORED = ("estop", "enabled", "interp_state", "paused", "task_mode", "inpos", "current_vel", "homed")

    def send(self, msg, controller=None, **over):
        """`msg` under the snapshot `over`; the controller reads the same
        unless `controller` says what it reads now. The snapshot stands
        unless `over` says otherwise."""
        gateway._shared_status = _payload(**{"inpos": True, "current_vel": 0.0, **over})
        if controller is None:
            controller = {k: over[k] for k in self._MIRRORED if k in over}
            if "homing_active" in over:
                controller["homing"] = over["homing_active"]
        self.controller(**controller)
        gateway._cmd_lock = None
        return _run(gateway.handle_command(msg, True, self.writer.conn_key))

    def takes_the_mode(self, then=None):
        """Task takes a mode switch (the recording CMD only records it);
        `then` changes the controller during the switch."""
        def mode(target):
            self.cmd.calls.append(("mode", (target,), {}))
            gateway.STAT.task_mode = target
            for k, v in (then or {}).items():
                setattr(gateway.STAT, k, v)
            return 0
        self.cmd.mode = mode

    def sent(self):
        return [(n, a) for n, a, _k in self.cmd.calls if n in ("mode", "spindle")]


class TestLoadWithoutAuto(_Writer):
    """BG-03: the load opens the program in whatever mode task is in."""

    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.prog = os.path.join(self.tmp.name, "part.ngc")
        Path(self.prog).write_text("G0 X1\nM2\n")
        p = mock.patch.object(gateway, "get_nc_files_dir", return_value=self.tmp.name)
        p.start()
        self.addCleanup(p.stop)

    def test_no_mode_switch_before_the_open(self):
        r = self.send({"cmd": "load_file", "path": self.prog})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.cmd.args_of("program_open"), (self.prog,))
        self.assertNotIn("mode", self.cmd.names(), "PLAN_OPEN needs no AUTO")

    def test_loads_in_estop_off_and_unhomed(self):
        for over in ({"estop": True, "enabled": False}, {"enabled": False}, {"homed": False}):
            with self.subTest(**over):
                self.cmd.calls.clear()
                gateway.STAT.enabled = over.get("enabled", True)
                r = self.send({"cmd": "load_file", "path": self.prog}, **over)
                self.assertTrue(r["ok"], r)
                self.assertEqual(self.cmd.args_of("program_open"), (self.prog,))

    def test_a_connection_disarmed_since_the_dispatch_loads_nothing(self):
        self.writer.armed = False
        r = self.send({"cmd": "load_file", "path": self.prog})
        self.assertEqual(r, {"ok": False, "error": NOT_ARMED})
        self.assertIsNone(self.cmd.args_of("program_open"))

    def test_a_start_in_progress_refuses_load_and_unload(self):
        gateway._source_claims.append(object())
        for msg in ({"cmd": "load_file", "path": self.prog}, {"cmd": "unload_file"}):
            r = self.send(msg)
            self.assertFalse(r["ok"], r)
            self.assertIn("starting or running", r["error"])
        self.assertEqual([self.cmd.args_of(n) for n in ("program_open", "abort")], [None, None])


class TestModePerTargetHandler(_Writer):
    """BG-04 at the handler: the payload picks the target's class."""

    def test_manual_in_estop_and_unhomed(self):
        gateway.STAT.task_mode = linuxcnc.MODE_MDI
        for over in ({"estop": True, "enabled": False}, {"homed": False}):
            with self.subTest(**over):
                self.cmd.calls.clear()
                self.send({"cmd": "set_mode", "mode": linuxcnc.MODE_MANUAL}, task_mode=linuxcnc.MODE_MDI,
                          inpos=True, current_vel=0.0, **over)
                self.assertEqual(self.cmd.args_of("mode"), (linuxcnc.MODE_MANUAL,))

    def test_mdi_unhomed_is_refused_with_its_reason(self):
        r = self.send({"cmd": "set_mode", "mode": linuxcnc.MODE_MDI}, homed=False, inpos=True, current_vel=0.0)
        self.assertEqual(r, {"ok": False, "error": "Not homed — MDI and Auto need Home All"})
        self.assertNotIn("mode", self.cmd.names())

    def test_mdi_unhomed_where_the_machine_declares_coord(self):
        with mock.patch.object(gateway, "_coord_without_homing", lambda: True):
            self.send({"cmd": "set_mode", "mode": linuxcnc.MODE_AUTO}, homed=False, inpos=True, current_vel=0.0)
        self.assertEqual(self.cmd.args_of("mode"), (linuxcnc.MODE_AUTO,))

    def test_no_switch_while_the_machine_moves(self):
        r = self.send({"cmd": "set_mode", "mode": linuxcnc.MODE_MANUAL}, inpos=False, current_vel=5.0)
        self.assertEqual(r, {"ok": False, "error": "Machine moving — wait until it stands"})


class TestRecoveryHandler(_Writer):
    """BG-11: E-Stop Reset waits for the acknowledgement — the policy says so."""

    def test_reset_with_an_unacknowledged_trip(self):
        with mock.patch.object(gateway, "_unacked_trip", {"reason": "hb"}):
            r = self.send({"cmd": "estop_reset"}, estop=True, enabled=False)
        self.assertEqual(r, {"ok": False, "error": TRIP_UNACKED})

    def test_reset_before_the_first_status_is_refused(self):
        gateway._shared_status = None
        r = _run(gateway.handle_command({"cmd": "estop_reset"}, True, self.writer.conn_key))
        self.assertFalse(r["ok"], r)


class TestG30ReadGate(_Writer):
    """BG-13: the read is its own class — off and unhomed open, ON + AUTO not."""

    def test_on_in_auto_is_refused_before_the_synch(self):
        r = self.send({"cmd": "read_g30"}, task_mode=linuxcnc.MODE_AUTO)
        self.assertEqual(r, {"ok": False, "error": G30_NOT_IN_AUTO})

    def test_off_and_unhomed_reach_the_handler(self):
        for over in ({"enabled": False, "task_mode": linuxcnc.MODE_AUTO}, {"homed": False}):
            with self.subTest(**over), mock.patch.object(gateway, "_g30_command",
                                                         mock.AsyncMock(return_value={"ok": True, "seen": 1})):
                r = self.send({"cmd": "read_g30"}, **over)
                self.assertEqual(r, {"ok": True, "seen": 1})


class TestSpindleBeforeHomingHandler(_Writer):
    """Q1 at the handler and the INI switch's reading."""

    def test_unhomed_without_the_switch_is_refused(self):
        r = self.send({"cmd": "spindle_forward", "speed": 1000}, homed=False)
        self.assertEqual(r, {"ok": False, "error": "Not homed — press Home All"})

    def test_unhomed_with_the_switch_in_manual_runs(self):
        with mock.patch.object(gateway, "_spindle_before_homing", lambda: True):
            r = self.send({"cmd": "spindle_forward", "speed": 1000}, homed=False)
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.cmd.args_of("spindle"), (linuxcnc.SPINDLE_FORWARD, 1000.0))

    def test_unhomed_with_the_switch_in_mdi_is_refused(self):
        with mock.patch.object(gateway, "_spindle_before_homing", lambda: True):
            r = self.send({"cmd": "spindle_forward", "speed": 1000}, homed=False, task_mode=linuxcnc.MODE_MDI)
        self.assertEqual(r, {"ok": False, "error": UNHOMED_SPINDLE_MANUAL})


class TestModeOnTheCurrentRead(_Writer):
    """BG-04 rest (Codex R216): the target's class judged on the controller's
    CURRENT read before the first mode command. The published snapshot here is
    on, idle, MANUAL, standing, homed, not homing — one poll old; a current
    read that says otherwise refuses, and an input the current read lacks is
    unknown, never the published value."""

    def setUp(self):
        super().setUp()
        self.takes_the_mode()

    def refused(self, controller, mode=linuxcnc.MODE_MDI):
        self.cmd.calls.clear()
        r = self.send({"cmd": "set_mode", "mode": mode}, controller=controller)
        self.assertEqual(self.sent(), [], controller)
        return r["error"] if not r.get("ok") else r

    def test_homing_now(self):
        for mode in (linuxcnc.MODE_MANUAL, linuxcnc.MODE_MDI, linuxcnc.MODE_AUTO):
            with self.subTest(mode=mode):
                self.assertEqual(self.refused({"homing": True, "task_mode": linuxcnc.MODE_MDI}, mode),
                                 "Homing in progress — wait until it ends")

    def test_moving_now(self):
        self.assertEqual(self.refused({"inpos": False, "current_vel": 5.0}),
                         "Machine moving — wait until it stands")

    def test_unhomed_now(self):
        self.assertEqual(self.refused({"homed": False}), "Not homed — MDI and Auto need Home All")

    def test_an_input_the_current_read_lacks_is_unknown(self):
        for attr, why in (("joint", "Homing state unknown — wait for status"),
                          ("inpos", "Motion state unknown — wait for status"),
                          ("homed", "Not homed — MDI and Auto need Home All")):
            with self.subTest(attr=attr):
                self.cmd.calls.clear()
                self.controller()
                delattr(gateway.STAT, attr)
                gateway._shared_status = _payload(inpos=True, current_vel=0.0)   # published: all known
                gateway._cmd_lock = None
                r = _run(gateway.handle_command({"cmd": "set_mode", "mode": linuxcnc.MODE_MDI},
                                                True, self.writer.conn_key))
                self.assertEqual(r, {"ok": False, "error": why})
                self.assertEqual(self.sent(), [])

    def test_the_current_read_admits(self):
        r = self.send({"cmd": "set_mode", "mode": linuxcnc.MODE_MDI})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.sent(), [("mode", (linuxcnc.MODE_MDI,))])


class TestManualSpindleOnTheCurrentRead(_Writer):
    """BG-31 (Codex R216): Fwd / Rev / ± judge spindleManual on the current
    read BEFORE their switch to MANUAL, and again after it before the spindle
    command. The switch would otherwise abort an MDI that started since the
    snapshot (emcTaskSetMode → abort), and the Q1 exception would make the
    MANUAL it needs instead of finding it."""

    CMDS = ({"cmd": "spindle_forward", "speed": 1000}, {"cmd": "spindle_reverse", "speed": 1000},
            {"cmd": "spindle_increase"}, {"cmd": "spindle_decrease"})

    def each(self, controller, **snapshot):
        """Each command refused under `controller`: (cmd, what reached CMD)."""
        out = []
        for msg in self.CMDS:
            self.cmd.calls.clear()
            r = self.send(msg, controller=controller, **snapshot)
            self.assertFalse(r.get("ok"), (msg["cmd"], r))
            out.append((msg["cmd"], self.sent()))
        return out

    def test_an_mdi_started_since_the_snapshot(self):
        self.takes_the_mode()
        for homed in (True, False):
            with self.subTest(homed=homed), mock.patch.object(gateway, "_spindle_before_homing", lambda: True):
                for cmd, sent in self.each({"homed": homed, "task_mode": linuxcnc.MODE_MDI,
                                            "interp_state": linuxcnc.INTERP_READING}, homed=homed):
                    self.assertEqual(sent, [], cmd)

    def test_the_exception_finds_manual_never_makes_it(self):
        self.takes_the_mode()
        with mock.patch.object(gateway, "_spindle_before_homing", lambda: True):
            for cmd, sent in self.each({"homed": False, "task_mode": linuxcnc.MODE_MDI}, homed=False):
                self.assertEqual(sent, [], cmd)
            r = self.send(self.CMDS[0], controller={"homed": False, "task_mode": linuxcnc.MODE_MDI}, homed=False)
        self.assertEqual(r, {"ok": False, "error": UNHOMED_SPINDLE_MANUAL})

    def test_a_start_during_the_switch(self):
        # homed, MDI idle: the switch to MANUAL is admitted — and a program
        # another display starts while it is under way gets no spindle command
        self.takes_the_mode(then={"interp_state": linuxcnc.INTERP_READING})
        for cmd, sent in self.each({"task_mode": linuxcnc.MODE_MDI}):
            self.assertEqual(sent, [("mode", (linuxcnc.MODE_MANUAL,))], cmd)

    def test_no_read_no_command(self):
        self.controller()
        gateway.STAT.poll = mock.Mock(side_effect=OSError("nml"))
        gateway._shared_status = _payload()
        gateway._cmd_lock = None
        r = _run(gateway.handle_command(self.CMDS[0], True, self.writer.conn_key))
        self.assertEqual(r, {"ok": False, "error": "Machine status not read — try again"})
        self.assertEqual(self.sent(), [])

    def test_the_current_read_admits(self):
        self.takes_the_mode()
        r = self.send(self.CMDS[0], controller={"task_mode": linuxcnc.MODE_MDI})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.sent(), [("mode", (linuxcnc.MODE_MANUAL,)),
                                       ("spindle", (linuxcnc.SPINDLE_FORWARD, 1000.0))])


class TestHomeOnTheCurrentRead(_Writer):
    """The same class as BG-31 (Codex R216's rule, answer 4): Home, Home All,
    Unhome and Unhome All switch to MANUAL first — an MDI started since the
    snapshot meets neither the switch (it would abort it) nor the homing."""

    CMDS = ({"cmd": "home_all"}, {"cmd": "home", "joint": 0},
            {"cmd": "unhome_all"}, {"cmd": "unhome", "joint": 0})
    ISSUED = ("mode", "home", "unhome", "teleop_enable")

    def issued(self):
        return [n for n, _a, _k in self.cmd.calls if n in self.ISSUED]

    def test_an_mdi_started_since_the_snapshot(self):
        self.takes_the_mode()
        for msg in self.CMDS:
            with self.subTest(cmd=msg["cmd"]):
                self.cmd.calls.clear()
                r = self.send(msg, controller={"task_mode": linuxcnc.MODE_MDI,
                                               "interp_state": linuxcnc.INTERP_READING})
                self.assertEqual(r, {"ok": False, "error": "Machine busy — wait until it is idle"})
                self.assertEqual(self.issued(), [])

    def test_a_start_during_the_switch(self):
        self.takes_the_mode(then={"interp_state": linuxcnc.INTERP_READING})
        for msg in self.CMDS:
            with self.subTest(cmd=msg["cmd"]):
                self.cmd.calls.clear()
                r = self.send(msg, controller={"task_mode": linuxcnc.MODE_MDI})
                self.assertFalse(r.get("ok"), r)
                self.assertEqual(self.issued(), ["mode"])

    def test_the_current_read_admits(self):
        self.takes_the_mode()
        for msg, then in zip(self.CMDS, (["home"], ["home"], ["teleop_enable", "unhome"], ["teleop_enable", "unhome"])):
            with self.subTest(cmd=msg["cmd"]):
                self.cmd.calls.clear()
                r = self.send(msg, controller={"task_mode": linuxcnc.MODE_MDI})
                self.assertTrue(r["ok"], r)
                self.assertEqual(self.issued(), ["mode"] + then)


class _Ini:
    values = {}

    def __init__(self, _path):
        pass

    def find(self, section, key):
        return self.values.get((section, key))


class TestIniFacts(unittest.TestCase):
    """The two INI facts: exactly "1" switches on; anything else is off."""

    def setUp(self):
        saved = (gateway.STAT, gateway._spindle_before_homing_cache, gateway._coord_without_homing_cache)
        self.addCleanup(lambda: (setattr(gateway, "STAT", saved[0]),
                                 setattr(gateway, "_spindle_before_homing_cache", saved[1]),
                                 setattr(gateway, "_coord_without_homing_cache", saved[2])))
        gateway.STAT = linuxcnc.stat()
        gateway.STAT.ini_filename = "/x/machine.ini"
        p = mock.patch.object(gateway.linuxcnc, "ini", _Ini)
        p.start()
        self.addCleanup(p.stop)

    def _spindle(self, raw):
        _Ini.values = {} if raw is None else {("DISPLAY", "WEBUI_SPINDLE_BEFORE_HOMING"): raw}
        gateway._spindle_before_homing_cache = None
        return gateway._spindle_before_homing()

    def test_spindle_switch(self):
        self.assertTrue(self._spindle("1"))
        self.assertTrue(self._spindle(" 1 "))
        for raw in (None, "", "0", "yes", "true", "2", "on"):
            with self.subTest(raw=raw):
                self.assertFalse(self._spindle(raw))

    def test_an_invalid_value_is_said(self):
        with mock.patch.object(gateway._trace, "emit") as emit:
            self.assertFalse(self._spindle("yes"))
        self.assertIn("policy.spindle_before_homing_invalid", [c.args[0] for c in emit.call_args_list])

    def _coord(self, kins_type, nfh):
        _Ini.values = {} if nfh is None else {("TRAJ", "NO_FORCE_HOMING"): nfh}
        gateway.STAT.kinematics_type = kins_type
        gateway._coord_without_homing_cache = None
        return gateway._coord_without_homing()

    def test_coord_without_homing(self):
        self.assertTrue(self._coord(linuxcnc.KINEMATICS_IDENTITY, "1"))
        self.assertFalse(self._coord(linuxcnc.KINEMATICS_IDENTITY, None))
        self.assertFalse(self._coord(linuxcnc.KINEMATICS_IDENTITY, "0"))
        self.assertFalse(self._coord(linuxcnc.KINEMATICS_BOTH, "1"), "COORD refuses unhomed non-identity kins")
        self.assertFalse(self._coord(None, "1"), "unread kins type: closed")


class TestTaskModeConstants(unittest.TestCase):
    def test_the_policy_names_the_bindings_modes(self):
        self.assertEqual((TASK_MODE_MANUAL, TASK_MODE_AUTO, TASK_MODE_MDI),
                         (linuxcnc.MODE_MANUAL, linuxcnc.MODE_AUTO, linuxcnc.MODE_MDI))


if __name__ == "__main__":
    unittest.main()
