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
    SPINDLE_OWNED,
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
                # the dimmed stop names the stops that do work (live R205 S2
                # read "Machine busy — wait until it is idle")
                self.assertEqual(permission_reasons(s)["spindleStop"], SPINDLE_OWNED)

    def test_spindle_stop_closed_off_and_in_estop(self):
        self.assertFalse(evaluate_permissions(state(is_enabled=False))["spindleStop"])
        self.assertFalse(evaluate_permissions(state(is_estop=True))["spindleStop"])


def _payload(**over):
    """A duck-typed status snapshot as the builder reads it."""
    base = dict(
        estop=False, enabled=True, emc_enable_in=True, homed=True,
        interp_state=linuxcnc.INTERP_IDLE, paused=False, eoffset_enabled=False,
        rotary_at_zero=True, reader_fresh=True, tool_change_requested=False,
        axis_mask=0b111, task_mode=linuxcnc.MODE_MANUAL, homing_active=False,
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

    def _strand_now(self):
        # the controller's current answer agrees with the broadcast (the
        # start re-reads it — TestStartChecksTheControllerNow)
        gateway._kins_is_switchable = lambda: True
        gateway._twp_capable = lambda: True
        gateway._reader_is_stale = lambda: False
        gateway._reader_get = {"kins_type": 2.0, "twp_active": 0}.get

    def test_auto_step_from_idle_refused_on_a_stranded_plane(self):
        self._strand_now()
        import unittest.mock
        with unittest.mock.patch.object(gateway, "check_command", lambda *_a: None):
            r = self._send({"cmd": "auto_step"}, kins_type=2.0, twp_active=False,
                           g5x_index=1, twp_defined=True)
        self.assertFalse(r["ok"])
        self.assertIn("without a plane", r["error"])
        self.assertNotIn("auto", self.cmd.names())

    def test_cycle_start_too(self):
        self._strand_now()
        import unittest.mock
        with unittest.mock.patch.object(gateway, "check_command", lambda *_a: None):
            r = self._send({"cmd": "cycle_start"}, kins_type=2.0, twp_active=False,
                           g5x_index=1, twp_defined=True)
        self.assertFalse(r["ok"])
        self.assertNotIn("auto", self.cmd.names())


class TestToolChangeConfirmHandler(_Handlers):
    """BG-12 / BG-17: the confirmation needs a FRESH pending request — and
    names the request it answers (Codex R205: a press begun on T7 confirmed
    the T9 request that replaced it)."""

    def setUp(self):
        super().setUp()
        rt = gateway._status_runtime
        saved = (rt.tool_change_seq, rt.tool_change_tool, gateway._tool_change_confirmed)
        rt.tool_change_seq, rt.tool_change_tool = 5, 7
        gateway._tool_change_confirmed = None

        def restore():
            rt.tool_change_seq, rt.tool_change_tool, gateway._tool_change_confirmed = saved
        self.addCleanup(restore)

    def _confirm(self, *, stale, pending, request=5, tool=7):
        gateway._reader_is_stale = lambda: stale
        gateway._reader_get = {"tool_change": pending, "tool_prep_number": tool}.get
        sent = []
        msg = {"cmd": "confirm_tool_change"}
        if request is not None:
            msg["request"] = request
        import unittest.mock
        # a delivered message, as watchdog_send reports it (BG-20)
        with unittest.mock.patch.object(gateway, "_hal_send", lambda m: sent.append(m) or True), \
                unittest.mock.patch.object(gateway, "check_command", lambda *_a: None):
            r = self._send(msg, interp_state=linuxcnc.INTERP_READING)
        return r, sent

    def test_a_fresh_pending_request_is_confirmed(self):
        r, sent = self._confirm(stale=False, pending=True)
        self.assertTrue(r["ok"], r)
        self.assertEqual(sent, [{"tool_changed": True}])

    def test_a_request_is_confirmed_once(self):
        self.assertTrue(self._confirm(stale=False, pending=True)[0]["ok"])
        r, sent = self._confirm(stale=False, pending=True)
        self.assertFalse(r["ok"])
        self.assertEqual(sent, [])

    def test_a_confirmation_for_an_earlier_request_refuses(self):
        r, sent = self._confirm(stale=False, pending=True, request=4)
        self.assertFalse(r["ok"])
        self.assertIn("changed", r["error"])
        self.assertEqual(sent, [])

    def test_a_tool_that_changed_since_the_last_poll_refuses(self):
        # the next request raised between two polls: same number, other tool
        r, sent = self._confirm(stale=False, pending=True, tool=9)
        self.assertFalse(r["ok"])
        self.assertEqual(sent, [])

    def test_a_confirmation_without_its_request_refuses(self):
        r, sent = self._confirm(stale=False, pending=True, request=None)
        self.assertFalse(r["ok"])
        self.assertEqual(sent, [])

    def test_a_stale_reader_refuses(self):
        r, sent = self._confirm(stale=True, pending=True)
        self.assertFalse(r["ok"])
        self.assertEqual(sent, [])

    def test_an_unknown_request_refuses(self):
        r, sent = self._confirm(stale=False, pending=None)
        self.assertFalse(r["ok"])
        self.assertEqual(sent, [])


class TestStartChecksTheControllerNow(_Handlers):
    """BG-09 / BG-12 (Codex R205): a program start re-reads the kinematics
    and the reader's freshness NOW — the broadcast's reader_fresh is the
    freshness when it was built. The source changes AFTER the broadcast."""

    def run_case(self, cmd, stale, current_kins, **snapshot):
        gateway._kins_is_switchable = lambda: True
        gateway._twp_capable = lambda: True
        gateway._reader_is_stale = lambda: stale
        gateway._reader_get = {"kins_type": current_kins, "twp_active": False,
                               "twp_defined": False}.get

        async def mode(value):
            self.cmd.calls.append(("mode", (value,), {}))
            gateway.STAT.task_mode = value
        old = dict(kins_type=0.0, twp_active=False, g5x_index=1, reader_fresh=True)
        old.update(snapshot)
        import unittest.mock
        with unittest.mock.patch.object(gateway, "set_mode", mode):
            return self._send({"cmd": cmd}, **old)

    def refused(self, cmd, stale, current_kins, **snapshot):
        r = self.run_case(cmd, stale, current_kins, **snapshot)
        self.assertFalse(r["ok"], r)
        self.assertNotIn("auto", self.cmd.names())
        return r

    def test_cycle_start_with_the_reader_stale_now(self):
        self.assertIn("unknown", self.refused("cycle_start", True, 0.0)["error"])

    def test_step_with_the_reader_stale_now(self):
        self.refused("auto_step", True, 0.0)

    def test_cycle_start_with_plane_kins_now(self):
        self.assertIn("without a plane", self.refused("cycle_start", False, 2.0)["error"])

    def test_step_with_plane_kins_now(self):
        self.refused("auto_step", False, 2.0)

    def test_control_a_runnable_start_and_step_go(self):
        for cmd in ("cycle_start", "auto_step"):
            with self.subTest(cmd=cmd):
                self.cmd.calls.clear()
                r = self.run_case(cmd, False, 0.0)
                self.assertTrue(r["ok"], r)
                self.assertIn("auto", self.cmd.names())

    def test_the_rfl_start_uses_the_same_check(self):
        # The run-from-line sequence starts minutes after its handler: its
        # final AUTO_RUN re-checks with the same controller read.
        import inspect
        src = inspect.getsource(gateway._rfl_sequence)
        self.assertIn("_program_start_refusal(", src)


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


# ---- R206 (Codex): the start's last check at the command write; an unread
# fixture under Plane; a confirmation that was not delivered is not booked.
# Codex's probe docs/reviews/button-gates.r206.backend.py, adopted as is
# (its classes) — the probe's prints feed nothing here.
import socket  # noqa: E402
from unittest.mock import patch  # noqa: E402
from hal_bridge import HalBridge  # noqa: E402


def _trace_probe(*_a, **_k):
    pass


class TestStartAfterPreparation(_Handlers):
    def setUp(self):
        super().setUp()
        self.now = {'kins_type': 0.0, 'twp_active': False}
        gateway._kins_is_switchable = lambda: True
        gateway._twp_capable = lambda: True
        gateway._reader_is_stale = lambda: False
        gateway._reader_get = self.now.get
        gateway.STAT.g5x_index = 1

    def run_after_mode(self, command, mutate):
        # Keep the real set_mode and _cmd_blocking. Simulate controller state
        # changing when the MODE_AUTO command is processed, before AUTO_RUN/STEP.
        original_mode = self.cmd.mode
        def mode(value):
            original_mode(value)
            gateway.STAT.task_mode = value
            if mutate:
                self.now.update(kins_type=2.0, twp_active=False)
        self.cmd.mode = mode
        reply = self._send({'cmd': command}, kins_type=0.0, twp_active=False,
                           g5x_index=1, reader_fresh=True)
        _trace_probe({'case':self.id().split('.')[-1], 'reply':reply,
               'now':self.now,'commands':self.cmd.names()})
        return reply

    def test_cycle_rechecks_after_mode(self):
        r = self.run_after_mode('cycle_start', True)
        self.assertFalse(r['ok'], 'The frame changed during awaited mode preparation')
        self.assertNotIn('auto', self.cmd.names())

    def test_step_rechecks_after_mode(self):
        r = self.run_after_mode('auto_step', True)
        self.assertFalse(r['ok'], 'The frame changed during awaited mode preparation')
        self.assertNotIn('auto', self.cmd.names())

    def test_control_unchanged_after_mode(self):
        self.assertTrue(self.run_after_mode('cycle_start', False)['ok'])
        self.assertIn('auto', self.cmd.names())

    def test_rfl_rechecks_after_its_final_mode_change(self):
        gateway._shared_status=_payload(kins_type=0.0,twp_active=False,g5x_index=1,reader_fresh=True)
        original_mode=self.cmd.mode
        def mode(value):
            original_mode(value)
            gateway.STAT.task_mode=value
            self.now.update(kins_type=2.0,twp_active=False)
        self.cmd.mode=mode
        phases=[]
        async def unchanged(_program):
            return None
        with patch.object(gateway,'_rfl_program_changed',unchanged), \
             patch.object(gateway,'_rfl_phase',lambda *args:phases.append(args)):
            _run(gateway._rfl_sequence(10,0,False,None,0,program=object()))
        _trace_probe({'case':self.id().split('.')[-1],'commands':self.cmd.names(),'phases':phases,'now':self.now})
        self.assertNotIn('auto',self.cmd.names(),'Final RFL mode preparation changed the frame')
        self.assertEqual(phases[-1][0],'failed')

    def test_cycle_rechecks_after_run_basis_await(self):
        # _cmd_blocking itself awaits capture/file IO before calling CMD.auto.
        # A check moved only below set_mode would still precede this boundary.
        gateway.STAT.task_mode=linuxcnc.MODE_AUTO
        original_auto=self.cmd.auto
        def auto(*args):
            return original_auto(*args)
        self.cmd.auto=auto  # the real method name selects the real start path
        saved_claims=list(gateway._source_claims)
        self.addCleanup(lambda: gateway._source_claims.__setitem__(slice(None), saved_claims))
        async def capture():
            self.now.update(kins_type=2.0,twp_active=False)
            return None
        with patch.object(gateway,'_begin_run_basis',capture), \
             patch.object(gateway,'_ts_program_writes',lambda:set()), \
             patch.object(gateway,'_ts_mark_assumed',lambda _:None):
            r=self._send({'cmd':'cycle_start'},kins_type=0.0,twp_active=False,g5x_index=1,reader_fresh=True)
        _trace_probe({'case':self.id().split('.')[-1],'reply':r,'commands':self.cmd.names(),'now':self.now})
        self.assertFalse(r['ok'],'The final write must follow all awaited preparation')
        self.assertNotIn('auto',self.cmd.names())

    def test_unknown_current_fixture_cannot_reuse_old_g59(self):
        self.now.update(kins_type=2.0, twp_active=True)
        gateway.STAT.task_mode = linuxcnc.MODE_AUTO
        gateway.STAT.g5x_index = None
        r = self._send({'cmd':'cycle_start'}, kins_type=2.0, twp_active=True,
                       g5x_index=6, reader_fresh=True)
        _trace_probe({'case':self.id().split('.')[-1], 'current_fixture':None,
               'broadcast_fixture':6,'reply':r,'commands':self.cmd.names()})
        self.assertFalse(r['ok'], 'An unread fixture at Plane must not reuse the old G59')
        self.assertNotIn('auto', self.cmd.names())

    def test_control_current_wrong_fixture_refuses(self):
        self.now.update(kins_type=2.0, twp_active=True)
        gateway.STAT.g5x_index = 1
        r = self._send({'cmd':'cycle_start'}, kins_type=2.0, twp_active=True,
                       g5x_index=6, reader_fresh=True)
        self.assertFalse(r['ok'])
        self.assertNotIn('auto',self.cmd.names())

    def test_control_failed_poll_refuses(self):
        with patch.object(gateway.STAT,'poll',side_effect=RuntimeError('test poll failure')):
            r = self._send({'cmd':'cycle_start'},kins_type=0.0,twp_active=False,
                           g5x_index=1,reader_fresh=True)
        self.assertFalse(r['ok'])
        self.assertNotIn('auto', self.cmd.names())

class SocketDouble:
    def __init__(self, timeout):
        self.timeout=timeout
        self.attempts=[]
        self.delivered=[]
    def sendall(self, data):
        self.attempts.append(data.decode().strip())
        if self.timeout:
            raise socket.timeout('review: this packet was not delivered')
        self.delivered.append(data.decode().strip())

class TestToolChangeDelivery(_Handlers):
    def setUp(self):
        super().setUp()
        rt=gateway._status_runtime
        saved=(rt.tool_change_seq, rt.tool_change_tool, gateway._tool_change_confirmed)
        rt.tool_change_seq,rt.tool_change_tool=41,7
        gateway._tool_change_confirmed=None
        def restore():
            rt.tool_change_seq,rt.tool_change_tool,gateway._tool_change_confirmed=saved
        self.addCleanup(restore)
        gateway._reader_is_stale=lambda:False
        gateway._reader_get={'tool_change':True,'tool_prep_number':7}.get
        self.bridge=HalBridge(set_phase=lambda _:None,on_reader_connect=lambda:None,hello=lambda:{},
                              watchdog_path='/tmp/r206-unused-watchdog',reader_path='/tmp/r206-unused-reader')
        # Socket already connected and accepted; no IO in reply-draining.
        self.bridge._wd_poll_reply=lambda:None

    def confirm(self):
        return self._send({'cmd':'confirm_tool_change','request':41},
                          tool_change_requested=True, tool_change_tool=7,
                          tool_change_seq=41, interp_state=linuxcnc.INTERP_WAITING)

    def test_dropped_send_is_not_a_permanently_confirmed_request(self):
        sock=SocketDouble(True)
        self.bridge._wd_sock=sock
        with patch.object(gateway,'_hal_send',self.bridge.watchdog_send):
            first=self.confirm()
            sock.timeout=False
            second=self.confirm()
        _trace_probe({'case':self.id().split('.')[-1], 'first':first, 'retry':second,
               'socket_attempts':sock.attempts,'delivered':sock.delivered,
               'booked_confirmed':gateway._tool_change_confirmed})
        self.assertFalse(first['ok'], 'A dropped packet cannot be reported as confirmed')
        self.assertTrue(second['ok'], 'The still-pending unchanged request must be recoverable')

    def test_control_delivered_only_once(self):
        sock=SocketDouble(False)
        self.bridge._wd_sock=sock
        with patch.object(gateway,'_hal_send',self.bridge.watchdog_send):
            first=self.confirm()
            second=self.confirm()
        self.assertTrue(first['ok'])
        self.assertFalse(second['ok'])
        self.assertEqual(len(sock.delivered),1)


# ---- R207 (Codex): the start's last check inside the write itself, past the
# executor queue; a partial timeout must not leave a frame open for the next
# message to join. Codex's probe docs/reviews/button-gates.r207.backend.py,
# adopted as is (its classes; the receiver is hal_watchdog's own parser).
import ast  # noqa: E402
import json  # noqa: E402
import threading  # noqa: E402
from concurrent.futures import ThreadPoolExecutor  # noqa: E402
from pathlib import Path  # noqa: E402

class TestStartWriteQueue(_Handlers):
    def setUp(self):
        super().setUp()
        gateway.STAT.task_mode = linuxcnc.MODE_AUTO
        gateway.STAT.g5x_index = 1
        gateway._shared_status = _payload(kins_type=0.0, twp_active=False,
                                               g5x_index=1, reader_fresh=True)
        self.now = {'kins_type': 0.0, 'twp_active': False}
        gateway._kins_is_switchable = lambda: True
        gateway._twp_capable = lambda: True
        gateway._reader_is_stale = lambda: False
        gateway._reader_get = self.now.get

    def exercise(self, command, change):
        log=[]
        async def run():
            loop=asyncio.get_running_loop()
            submitted=asyncio.Event()
            class ObservedExecutor(ThreadPoolExecutor):
                observe=False
                def submit(self,fn,*args,**kwargs):
                    future=super().submit(fn,*args,**kwargs)
                    if self.observe:
                        submitted.set()
                    return future
            executor=ObservedExecutor(max_workers=1,thread_name_prefix='r207-io')
            loop.set_default_executor(executor)
            entered, release = threading.Event(), threading.Event()
            def occupy():
                entered.set()
                if not release.wait(8):
                    raise TimeoutError('probe did not release the IO worker')
            occupied=loop.run_in_executor(None,occupy)
            while not entered.is_set():
                await asyncio.sleep(0)
            executor.observe=True
            actual=gateway._cmd_blocking
            async def observe(fn,*args,**kwargs):
                check=kwargs.get('admit')
                if check:
                    def observed_check():
                        reason=check()
                        log.append({'admit':reason,'thread':threading.current_thread().name,
                                    'state':dict(self.now)})
                        return reason
                    kwargs['admit']=observed_check
                return await actual(fn,*args,**kwargs)
            with patch.object(gateway,'_cmd_blocking',observe):
                task=asyncio.create_task(gateway.handle_command({'cmd':command},True))
                try:
                    await asyncio.wait_for(submitted.wait(),2)
                    # The real command cannot run yet: the worker is occupied.
                    self.assertNotIn('auto',self.cmd.names())
                    if change:
                        self.now.update(kins_type=2.0,twp_active=False)
                    log.append({'release_worker_with_state':dict(self.now)})
                finally:
                    release.set()
                await occupied
                reply=await asyncio.wait_for(task,3)
                log.append({'reply':reply,'commands':self.cmd.names()})
                return reply
        reply=_run(run())
        _trace_probe(json.dumps({'case':self.id().split('.')[-1],'trace':log}))
        return reply

    def test_cycle_refuses_a_frame_changed_while_write_queued(self):
        reply=self.exercise('cycle_start',True)
        self.assertFalse(reply['ok'],'Admission precedes the executor queue, not the write')
        self.assertNotIn('auto',self.cmd.names())

    def test_idle_step_refuses_a_frame_changed_while_write_queued(self):
        reply=self.exercise('auto_step',True)
        self.assertFalse(reply['ok'],'Admission precedes the executor queue, not the write')
        self.assertNotIn('auto',self.cmd.names())

    def test_control_queued_unchanged_start_succeeds(self):
        self.assertTrue(self.exercise('cycle_start',False)['ok'])
        self.assertIn('auto',self.cmd.names())


def receiver():
    # Execute only the repository's parser, no module startup / imports / HAL.
    tree=ast.parse((Path(__file__).resolve().parent / 'hal_watchdog.py').read_text())
    fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_consume_buf')
    warnings=[]
    state={'buf':'','comp':{},'json':json,'_wd_msgs_processed':0,
           '_trace':SimpleNamespace(emit=lambda *a,**kw:warnings.append((a,kw)))}
    exec(compile(ast.Module(body=[fn],type_ignores=[]),'hal_watchdog.py:actual-parser','exec'),state)
    state['warnings']=warnings
    return state

class PartialSocket:
    """Accepted stream: first send writes a JSON prefix and then times out.
    Later writes append their bytes to the SAME receiver stream, as TCP/Unix
    SOCK_STREAM does. _consume_buf is the production reader, not a facsimile.
    """
    def __init__(self,state,partial=True):
        self.state=state
        self.partial=partial
        self.closed=False
        self.fragments=[]
    def sendall(self,data):
        if self.closed:
            raise BrokenPipeError('closed')
        if self.partial:
            self.partial=False
            data=data[:10]
            self.feed(data)
            raise socket.timeout('probe: prefix delivered, remainder timed out')
        self.feed(data)
    def feed(self,data):
        self.fragments.append(data.decode())
        self.state['buf']+=data.decode()
        self.state['_consume_buf']()
    def close(self):
        self.closed=True

class TestPartialToolConfirmation(_Handlers):
    def setUp(self):
        super().setUp()
        rt=gateway._status_runtime
        saved=(rt.tool_change_seq,rt.tool_change_tool,gateway._tool_change_confirmed)
        rt.tool_change_seq,rt.tool_change_tool=41,7
        gateway._tool_change_confirmed=None
        def restore():
            rt.tool_change_seq,rt.tool_change_tool,gateway._tool_change_confirmed=saved
        self.addCleanup(restore)
        gateway._reader_is_stale=lambda:False
        gateway._reader_get={'tool_change':True,'tool_prep_number':7}.get
        self.bridge=HalBridge(set_phase=lambda _:None,on_reader_connect=lambda:None,hello=lambda:{},
            watchdog_path='/tmp/r207-never-connected',reader_path='/tmp/r207-never-connected-reader')
        self.bridge._wd_poll_reply=lambda:None
        self.bridge._wd_state='admitted'
        self.rx=receiver()
    def confirm(self):
        return self._send({'cmd':'confirm_tool_change','request':41},
            tool_change_requested=True,tool_change_tool=7,tool_change_seq=41,
            interp_state=linuxcnc.INTERP_WAITING)
    def test_partial_timeout_then_retry_cannot_book_a_dropped_message(self):
        sock=PartialSocket(self.rx)
        self.bridge._wd_sock=sock
        with patch.object(gateway,'_hal_send',self.bridge.watchdog_send):
            first=self.confirm()
            self.assertFalse(first['ok'])
            second=self.confirm()
            third=self.confirm()
        _trace_probe(json.dumps({'case':self.id().split('.')[-1], 'first':first,'second':second,'third':third,
            'written_fragments':sock.fragments,'pins':self.rx['comp'],'parser_warnings':self.rx['warnings'],
            'booked':gateway._tool_change_confirmed}))
        self.assertFalse(second['ok'] and not self.rx['comp'].get('tool-changed'),
            'Retry reported successful although the real receiver dropped the joined JSON')
        self.assertFalse(gateway._tool_change_confirmed==41 and not self.rx['comp'].get('tool-changed'),
            'No tool-changed pin, but all further confirmations permanently refused')
    def test_control_complete_message_sets_pin_and_is_booked_once(self):
        sock=PartialSocket(self.rx,partial=False)
        self.bridge._wd_sock=sock
        with patch.object(gateway,'_hal_send',self.bridge.watchdog_send):
            first=self.confirm();second=self.confirm()
        self.assertTrue(first['ok'])
        self.assertFalse(second['ok'])
        self.assertTrue(self.rx['comp']['tool-changed'])
        self.assertEqual(gateway._tool_change_confirmed,41)
        self.assertEqual(len(sock.fragments),1)


class TestAnInterruptedFrameIsNeverAppliedLate(unittest.TestCase):
    """BG-20 (Codex R207), against hal_watchdog's own parser: a frame cut by
    a timeout is ended INVALID by the next send — even one that arrived whole
    but for its newline is dropped, never applied late, and the next frame
    lands on a clean line."""

    class CutSocket:
        """The first send writes all but the frame's last `keep` bytes, then
        times out; later sends arrive whole."""
        def __init__(self, rx, keep):
            self.rx, self.keep, self.cut = rx, keep, True

        def sendall(self, data):
            if self.cut:
                self.cut = False
                self.feed(data[:-self.keep])
                raise socket.timeout("cut")
            self.feed(data)

        def feed(self, data):
            self.rx["buf"] += data.decode()
            self.rx["_consume_buf"]()

    def _bridge(self, sock):
        b = HalBridge(set_phase=lambda _: None, on_reader_connect=lambda: None, hello=lambda: {},
                      watchdog_path="/tmp/bg-unused-watchdog", reader_path="/tmp/bg-unused-reader")
        b._wd_poll_reply = lambda: None
        b._wd_sock = sock
        b._wd_state = "admitted"
        return b

    def test_a_frame_whole_but_for_its_newline_is_dropped(self):
        rx = receiver()
        b = self._bridge(self.CutSocket(rx, keep=1))
        self.assertIsNone(b.watchdog_send({"tool_changed": True}))
        self.assertIs(b.watchdog_send({"connected": True}), True)
        self.assertNotIn("tool-changed", rx["comp"], "the cut frame was applied late")
        self.assertIs(rx["comp"].get("connected"), True, "the next frame landed on a clean line")
        self.assertTrue(any(a and a[0] == "wd.bad_msg" for a, _k in rx["warnings"]))

    def test_a_heartbeat_between_repairs_and_the_retry_lands(self):
        rx = receiver()
        b = self._bridge(self.CutSocket(rx, keep=8))
        self.assertIsNone(b.watchdog_send({"tool_changed": True}))
        self.assertIs(b.watchdog_send({"connected": True}), True)     # the heartbeat path
        self.assertIs(b.watchdog_send({"tool_changed": True}), True)  # the retry
        self.assertIs(rx["comp"].get("tool-changed"), True)

    def test_a_new_connection_starts_clean(self):
        rx = receiver()
        b = self._bridge(self.CutSocket(rx, keep=8))
        b.watchdog_send({"tool_changed": True})
        b.watchdog_disconnect()
        self.assertFalse(b._wd_frame_open)


class TestWatchdogSendSaysWhatHappened(unittest.TestCase):
    """BG-20: watchdog_send returns True (written in full to a helper that
    is not still deciding), False (nothing written) or None (unclear)."""

    def _bridge(self, sock, state="admitted"):
        b = HalBridge(set_phase=lambda _: None, on_reader_connect=lambda: None, hello=lambda: {},
                      watchdog_path="/tmp/bg-unused-watchdog", reader_path="/tmp/bg-unused-reader")
        b._wd_poll_reply = lambda: None
        b._wd_sock = sock
        b._wd_state = state
        return b

    def test_written_in_full(self):
        self.assertIs(self._bridge(SocketDouble(False)).watchdog_send({"x": 1}), True)

    def test_a_timeout_is_unclear(self):
        self.assertIsNone(self._bridge(SocketDouble(True)).watchdog_send({"x": 1}))

    def test_a_helper_still_deciding_is_unclear(self):
        self.assertIsNone(self._bridge(SocketDouble(False), state="awaiting").watchdog_send({"x": 1}))

    def test_a_busy_stream_is_refused_bounded_and_writes_nothing(self):
        # Codex R208: one writer at a time; a second waits only briefly and
        # reports "nothing written" — the heartbeat on the event loop stays
        # bounded, nothing is queued for later.
        sock = SocketDouble(False)
        b = self._bridge(sock)
        held, release = threading.Event(), threading.Event()

        def hold():
            with b._wd_lock:
                held.set()
                release.wait(2)
        t = threading.Thread(target=hold)
        t.start()
        held.wait(2)
        import time as _time
        t0 = _time.monotonic()
        r = b.watchdog_send({"heartbeat": True})
        waited = _time.monotonic() - t0
        release.set()
        t.join(2)
        self.assertIs(r, False)
        self.assertLess(waited, 0.5)
        self.assertEqual(sock.delivered, [])

    def test_a_broken_socket_wrote_nothing(self):
        class Broken:
            def sendall(self, _d):
                raise BrokenPipeError()

            def close(self):
                pass
        self.assertIs(self._bridge(Broken()).watchdog_send({"x": 1}), False)


if __name__ == "__main__":
    unittest.main()
