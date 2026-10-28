"""Button gates package E (BG-07; Codex R202–R204, R218).

The stop contract first (Codex R218): a jog stop goes out in whatever mode
task is in — no switch to MANUAL, which could abort a fresh MDI and, refused,
would have suppressed the stop — addressed as the jog was STARTED, and the
jog counts as stopped only once its stop was written. Then the switch itself:
every mode write is admitted only onto an interpreter KNOWN idle, read in the
write's own thread."""
import unittest
from unittest import mock

import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()

import gateway  # noqa: E402
from test_button_gates import _run  # noqa: E402
from test_button_gates_d import _Writer  # noqa: E402

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
        gateway.STAT.motion_mode = linuxcnc.TRAJ_MODE_TELEOP
        gateway.STAT.axis_mask = 0b101111                 # XYZAC: C is wire 4, canonical 5
        r = self.send({"cmd": "jog_cont", "axis": 4, "vel": 1.0})
        self.assertTrue(r["ok"], r)
        self.assertEqual(gateway._active_jogs, {4: (0, 5)})
        gateway.STAT.motion_mode = None   # read later: not teleop → joint flag 1
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
            setattr(gateway.STAT, k, v)

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


if __name__ == "__main__":
    unittest.main()
