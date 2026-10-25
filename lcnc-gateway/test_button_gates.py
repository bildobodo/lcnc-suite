"""Button gates, package A (review docs/reviews/button-gates.review.md,
Codex R202–R204): the policy and the handlers.

- BG-09: Step from idle is a START — it takes the `run` rule (the stranded
  Plane-kins state refused Cycle Start and let Step through).
- BG-12: unknown is never idle, never "no compensation", never "no tool
  change pending" — a stale HAL reader or an unread interpreter state closes
  the gates that need them; before the first status only the gates that need
  no state pass.
- BG-17: the manual tool-change confirmation has its own gate: armed and a
  FRESH pending request.
- BG-08 / BG-18: stops need no arm — Abort, Pause of a running sequence, the
  spindle stop at idle (no homing, no MANUAL switch on the way).
- BG-07 (part): the disarm jog-stop also stops an unhomed machine's jog.
"""
import asyncio
import unittest
from types import SimpleNamespace

import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()   # MUST precede `import gateway`
import gateway  # noqa: E402
from command_policy import (  # noqa: E402
    COMMAND_GATES,
    MachineState,
    check_command,
    evaluate_permissions,
    permission_reasons,
)


def state(**over) -> MachineState:
    """A homed, idle, enabled, armed plain machine with every input known."""
    base = dict(
        armed=True, is_estop=False, is_enabled=True, is_homed=True,
        is_idle=True, is_running=False, is_paused=False, eoffset_enabled=False,
        rotary_at_zero=True, kins_switchable=False, kins_type=None, g5x_index=1,
        twp_active=False, a_at_zero=True, interp_known=True, tool_change_pending=False,
    )
    base.update(over)
    return MachineState(**base)


def running(**over) -> MachineState:
    return state(is_idle=False, is_running=True, **over)


def paused(**over) -> MachineState:
    return state(is_idle=False, is_paused=True, **over)


def stranded_plane(**over) -> MachineState:
    """What a program's M2 leaves on the TWP machine: Plane kins, no plane."""
    base = dict(kins_switchable=True, twp_capable=True, kins_type=2, twp_active=False,
                g5x_index=1, twp_defined=True, twp_aligned=True)
    base.update(over)
    return state(**base)


class TestStepTakesTheStartRule(unittest.TestCase):
    """BG-09: Step from idle starts the program — the same rule as Start."""

    def test_step_from_idle_refuses_where_start_refuses(self):
        p = evaluate_permissions(stranded_plane())
        self.assertFalse(p["run"])
        self.assertFalse(p["step"], "Step from idle is a start")

    def test_the_denial_names_the_kinematics_reason(self):
        self.assertIn("without a plane", check_command("auto_step", stranded_plane()))
        self.assertIn("without a plane", permission_reasons(stranded_plane())["step"])

    def test_step_out_of_a_pause_continues_and_is_not_a_start(self):
        self.assertTrue(evaluate_permissions(paused(
            kins_switchable=True, twp_capable=True, kins_type=2, twp_active=False,
            g5x_index=1))["step"])

    def test_step_from_idle_still_needs_homing(self):
        self.assertIn("homed", permission_reasons(state(is_homed=False))["step"].lower())

    def test_a_ready_machine_steps(self):
        self.assertTrue(evaluate_permissions(state())["step"])


class TestUnknownIsClosed(unittest.TestCase):
    """BG-12: an unread interpreter state is not idle; an unknown eoffset is
    not "no compensation"; an unknown tool-change request is not pending."""

    STATE_GATES = ("idle", "jog", "ready", "run", "setup", "probe", "zero",
                   "resume", "step", "pause", "spindleStop")

    def test_unknown_interpreter_closes_every_gate_that_needs_it(self):
        s = state(interp_known=False, is_idle=False)
        p, why = evaluate_permissions(s), permission_reasons(s)
        for g in self.STATE_GATES:
            with self.subTest(gate=g):
                self.assertFalse(p[g])
                self.assertIn("unknown", why[g].lower())

    def test_unknown_interpreter_leaves_the_stateless_gates(self):
        p = evaluate_permissions(state(interp_known=False, is_idle=False))
        self.assertTrue(p["abort"])
        self.assertTrue(p["always"])
        self.assertTrue(p["override"])

    def test_unknown_eoffset_closes_the_eoffset_gates(self):
        s = state(eoffset_enabled=None)
        p, why = evaluate_permissions(s), permission_reasons(s)
        for g in ("probe", "zero", "touchoff", "touchoffRotary", "surfaceComp"):
            with self.subTest(gate=g):
                self.assertFalse(p[g])
                self.assertIn("unknown", why[g].lower())
        self.assertTrue(p["ready"], "ready carries no eoffset term")

    def test_unknown_tool_change_request_closes_the_confirmation(self):
        s = state(is_idle=False, is_running=True, tool_change_pending=None)
        self.assertFalse(evaluate_permissions(s)["toolChangeConfirm"])
        self.assertIn("unknown", permission_reasons(s)["toolChangeConfirm"].lower())


class TestToolChangeConfirmGate(unittest.TestCase):
    """BG-17: armed + a pending request; the command maps to it."""

    def test_open_for_an_armed_client_with_a_pending_request(self):
        self.assertTrue(evaluate_permissions(running(tool_change_pending=True))["toolChangeConfirm"])

    def test_closed_without_a_request(self):
        s = running(tool_change_pending=False)
        self.assertFalse(evaluate_permissions(s)["toolChangeConfirm"])
        self.assertEqual(permission_reasons(s)["toolChangeConfirm"], "No tool change pending")

    def test_closed_disarmed(self):
        self.assertFalse(evaluate_permissions(running(armed=False, tool_change_pending=True))["toolChangeConfirm"])

    def test_command_maps_to_it(self):
        self.assertEqual(COMMAND_GATES["confirm_tool_change"], "toolChangeConfirm")


class TestStopsNeedNoArm(unittest.TestCase):
    """BG-08 / BG-18: a stop is never behind arm, homing or the machine
    being in a state that allows new motion."""

    def test_commands_map_to_the_stop_gates(self):
        self.assertEqual(COMMAND_GATES["abort"], "abort")
        self.assertEqual(COMMAND_GATES["cycle_pause"], "pause")
        self.assertEqual(COMMAND_GATES["spindle_stop"], "spindleStop")

    def test_abort_in_any_state(self):
        for s in (state(armed=False), state(is_estop=True, is_enabled=False),
                  state(interp_known=False, is_idle=False), running(armed=False)):
            with self.subTest(state=s):
                self.assertTrue(evaluate_permissions(s)["abort"])
                self.assertIsNone(check_command("abort", s))

    def test_pause_of_a_running_sequence_without_arm(self):
        self.assertTrue(evaluate_permissions(running(armed=False))["pause"])
        self.assertFalse(evaluate_permissions(state(armed=False))["pause"], "nothing running")

    def test_resume_still_needs_arm(self):
        self.assertFalse(evaluate_permissions(paused(armed=False))["resume"])
        self.assertTrue(evaluate_permissions(paused())["resume"])

    def test_spindle_stop_at_idle_without_arm_or_homing(self):
        self.assertTrue(evaluate_permissions(state(armed=False, is_homed=False))["spindleStop"])

    def test_spindle_stop_closed_while_the_program_owns_the_spindle(self):
        for s in (running(), paused()):
            with self.subTest(state=s):
                self.assertFalse(evaluate_permissions(s)["spindleStop"])

    def test_spindle_stop_closed_off_and_in_estop(self):
        self.assertFalse(evaluate_permissions(state(is_enabled=False))["spindleStop"])
        self.assertFalse(evaluate_permissions(state(is_estop=True))["spindleStop"])


def _payload(**over):
    """A duck-typed status snapshot as the builder reads it."""
    base = dict(
        estop=False, enabled=True, emc_enable_in=True, homed=True,
        interp_state=linuxcnc.INTERP_IDLE, paused=False, eoffset_enabled=False,
        rotary_at_zero=True, reader_fresh=True, tool_change_requested=False,
        axis_mask=0b111,
    )
    base.update(over)
    return SimpleNamespace(**base)


class TestPolicyInputsFromTheSnapshot(unittest.TestCase):
    """BG-12 at the builder: the reader's values only while it is fresh."""

    def _state(self, **over):
        return gateway._policy_state_from_payload(_payload(**over), armed=True, kins_switchable=True)

    def test_a_stale_reader_leaves_its_inputs_unknown(self):
        s = self._state(reader_fresh=False, kins_type=0.0, eoffset_enabled=False,
                        tool_change_requested=True, twp_active=True, twp_defined=True)
        self.assertIsNone(s.kins_type)
        self.assertIsNone(s.eoffset_enabled)
        self.assertIsNone(s.tool_change_pending)
        self.assertFalse(s.twp_active)
        self.assertFalse(s.twp_defined)

    def test_a_fresh_reader_passes_them_through(self):
        s = self._state(kins_type=0.0, eoffset_enabled=False, tool_change_requested=True)
        self.assertEqual(s.kins_type, 0)
        self.assertIs(s.eoffset_enabled, False)
        self.assertIs(s.tool_change_pending, True)

    def test_a_snapshot_without_freshness_is_stale(self):
        p = _payload(kins_type=0.0)
        del p.reader_fresh
        s = gateway._policy_state_from_payload(p, armed=True, kins_switchable=True)
        self.assertIsNone(s.kins_type)

    def test_an_unread_interpreter_is_unknown_not_idle(self):
        s = self._state(interp_state=None)
        self.assertFalse(s.interp_known)
        self.assertFalse(s.is_idle)
        self.assertFalse(s.is_running)
        self.assertFalse(s.is_paused)

    def test_a_read_interpreter_is_known(self):
        self.assertTrue(self._state().interp_known)

    def test_an_absent_eoffset_pin_on_a_machine_without_z_is_off(self):
        # No Z axis, no axis.z.eoffset-enable pin: compensation cannot be on.
        self.assertIs(self._state(eoffset_enabled=None, axis_mask=0b011).eoffset_enabled, False)

    def test_an_absent_eoffset_pin_on_a_machine_with_z_is_unknown(self):
        self.assertIsNone(self._state(eoffset_enabled=None).eoffset_enabled)


def _run(coro):
    gateway._cmd_lock = None
    return asyncio.run(coro)


class _RecordingCmd:
    def __init__(self):
        self.calls = []

    def __getattr__(self, name):
        def record(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            return 0
        return record

    def names(self):
        return [n for n, _a, _k in self.calls]

    def args_of(self, name):
        for n, a, _k in self.calls:
            if n == name:
                return a
        return None


class _Handlers(unittest.TestCase):
    def setUp(self):
        gateway.lcnc_connected = True
        gateway.STAT = linuxcnc.stat()
        gateway.STAT.enabled = True
        gateway.STAT.task_mode = linuxcnc.MODE_MANUAL
        gateway.STAT.interp_state = linuxcnc.INTERP_IDLE
        gateway.STAT.paused = False
        self.cmd = _RecordingCmd()
        gateway.CMD = self.cmd
        saved = dict(shared=gateway._shared_status, reader_get=gateway._reader_get,
                     stale=gateway._reader_is_stale, switchable=gateway._kins_is_switchable,
                     capable=gateway._twp_capable, jogs=set(gateway._active_jogs),
                     skip=gateway._skip_flag_unknown)
        gateway._kins_is_switchable = lambda: False
        gateway._skip_flag_unknown = False

        def restore():
            gateway._shared_status = saved["shared"]
            gateway._reader_get = saved["reader_get"]
            gateway._reader_is_stale = saved["stale"]
            gateway._kins_is_switchable = saved["switchable"]
            gateway._twp_capable = saved["capable"]
            gateway._active_jogs.clear()
            gateway._active_jogs.update(saved["jogs"])
            gateway._skip_flag_unknown = saved["skip"]
        self.addCleanup(restore)

    def _send(self, msg, armed=True, **over):
        gateway._shared_status = _payload(**over)
        return _run(gateway.handle_command(msg, armed))


class TestStopHandlersWithoutArm(_Handlers):
    """BG-08 / BG-18 at the handlers."""

    def test_abort_disarmed_reaches_the_controller(self):
        r = self._send({"cmd": "abort"}, armed=False)
        self.assertTrue(r["ok"], r)
        self.assertIn("abort", self.cmd.names())

    def test_pause_disarmed_pauses_a_running_program(self):
        gateway.STAT.task_mode = linuxcnc.MODE_AUTO
        gateway.STAT.interp_state = linuxcnc.INTERP_READING
        r = self._send({"cmd": "cycle_pause"}, armed=False, interp_state=linuxcnc.INTERP_READING)
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.cmd.args_of("auto"), (linuxcnc.AUTO_PAUSE,))

    def test_resume_disarmed_is_refused(self):
        r = self._send({"cmd": "cycle_resume"}, armed=False,
                       interp_state=linuxcnc.INTERP_PAUSED, paused=True)
        self.assertFalse(r["ok"])
        self.assertNotIn("auto", self.cmd.names())

    def test_spindle_stop_disarmed_and_unhomed_stops_without_a_mode_switch(self):
        gateway.STAT.task_mode = linuxcnc.MODE_MDI
        r = self._send({"cmd": "spindle_stop"}, armed=False, homed=False)
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.cmd.args_of("spindle"), (linuxcnc.SPINDLE_OFF,))
        self.assertNotIn("mode", self.cmd.names(), "no MANUAL switch on the way")

    def test_spindle_stop_refused_when_a_fresh_poll_shows_a_run(self):
        # The snapshot said idle (gate open); the handler's own poll sees the
        # program that started meanwhile — the program owns the spindle.
        gateway.STAT.task_mode = linuxcnc.MODE_AUTO
        gateway.STAT.interp_state = linuxcnc.INTERP_READING
        r = self._send({"cmd": "spindle_stop"}, armed=False)
        self.assertFalse(r["ok"])
        self.assertNotIn("spindle", self.cmd.names())


class TestNoStatusYet(_Handlers):
    """BG-12: before the first status only the stateless gates pass."""

    def _send_without_status(self, msg, armed=True):
        gateway._shared_status = None
        return _run(gateway.handle_command(msg, armed))

    def test_a_machine_command_is_refused(self):
        r = self._send_without_status({"cmd": "mdi", "text": "G0 X0"})
        self.assertFalse(r["ok"])
        self.assertIn("status", r["error"].lower())
        self.assertNotIn("mdi", self.cmd.names())

    def test_abort_passes(self):
        r = self._send_without_status({"cmd": "abort"}, armed=False)
        self.assertTrue(r["ok"], r)
        self.assertIn("abort", self.cmd.names())


class TestStepHandlerChecksTheStartRule(_Handlers):
    """BG-09 at the handler: _start_guard refuses a stranded kinematics state
    even when the dispatcher's check was passed (a snapshot that changed
    between the check and the handler)."""

    def test_auto_step_from_idle_refused_on_a_stranded_plane(self):
        gateway._kins_is_switchable = lambda: True
        gateway._twp_capable = lambda: True
        import unittest.mock
        with unittest.mock.patch.object(gateway, "check_command", lambda *_a: None):
            r = self._send({"cmd": "auto_step"}, kins_type=2.0, twp_active=False,
                           g5x_index=1, twp_defined=True)
        self.assertFalse(r["ok"])
        self.assertIn("without a plane", r["error"])
        self.assertNotIn("auto", self.cmd.names())

    def test_cycle_start_too(self):
        gateway._kins_is_switchable = lambda: True
        gateway._twp_capable = lambda: True
        import unittest.mock
        with unittest.mock.patch.object(gateway, "check_command", lambda *_a: None):
            r = self._send({"cmd": "cycle_start"}, kins_type=2.0, twp_active=False,
                           g5x_index=1, twp_defined=True)
        self.assertFalse(r["ok"])
        self.assertNotIn("auto", self.cmd.names())


class TestToolChangeConfirmHandler(_Handlers):
    """BG-12 / BG-17: the confirmation needs a FRESH pending request."""

    def _confirm(self, *, stale, pending):
        gateway._reader_is_stale = lambda: stale
        gateway._reader_get = {"tool_change": pending}.get
        sent = []
        import unittest.mock
        with unittest.mock.patch.object(gateway, "_hal_send", lambda m: sent.append(m)), \
                unittest.mock.patch.object(gateway, "check_command", lambda *_a: None):
            r = self._send({"cmd": "confirm_tool_change"}, interp_state=linuxcnc.INTERP_READING)
        return r, sent

    def test_a_fresh_pending_request_is_confirmed(self):
        r, sent = self._confirm(stale=False, pending=True)
        self.assertTrue(r["ok"], r)
        self.assertEqual(sent, [{"tool_changed": True}])

    def test_a_stale_reader_refuses(self):
        r, sent = self._confirm(stale=True, pending=True)
        self.assertFalse(r["ok"])
        self.assertEqual(sent, [])

    def test_an_unknown_request_refuses(self):
        r, sent = self._confirm(stale=False, pending=None)
        self.assertFalse(r["ok"])
        self.assertEqual(sent, [])


class TestDisarmJogStopUnhomed(_Handlers):
    """BG-07 (part): the disarm jog-stop stops a jog on an unhomed machine."""

    def test_an_unhomed_machine_s_jog_is_stopped(self):
        gateway.STAT.homed = [0, 0, 0]
        gateway.STAT.joints = 3
        gateway._active_jogs.clear()
        gateway._active_jogs.add(1)

        async def go():
            async with gateway._get_cmd_lock():
                await gateway._jog_stop_for_client()
        _run(go())
        args = self.cmd.args_of("jog")
        self.assertIsNotNone(args, "the jog was never stopped")
        self.assertEqual(args[0], linuxcnc.JOG_STOP)
        self.assertEqual(gateway._active_jogs, set())


if __name__ == "__main__":
    unittest.main()
