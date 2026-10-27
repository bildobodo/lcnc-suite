"""Button gates package D (BG-03, BG-04, BG-10, BG-11, BG-13, Q1; Codex R202–R204).

The policy table first: loading a program needs arm and a known idle
interpreter, not AUTO, power or homing (BG-03); the task mode is judged per
target — MANUAL wherever task takes it, MDI / AUTO only where COORD is
reachable (BG-04); the recovery order is a directed rule with the trip as an
input (BG-11); the confirmed G30 read is its own class, closed where the synch
is refused (BG-13); the manual spindle runs before homing only on a machine
that declares it, in MANUAL (Q1)."""
import re
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
