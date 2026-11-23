"""The lifetime of a calculation in the gateway (P2b-3, plan v4 — Codex
R439–R442): the begin hook in _cmd_blocking's write thread, the publication
order against it, the observers past the handler's return, the mode switch by
its effect, the file writers' begin, the unload.

Real gateway module under the fake linuxcnc (pytest only)."""
import asyncio
import threading
import time
import unittest
from unittest.mock import patch

import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()   # MUST precede `import gateway`
import gateway  # noqa: E402
from calc_lifetime import ActionLedger, Generation  # noqa: E402
from link_fixture import connect_fake, current, use  # noqa: E402

RCS_DONE, RCS_EXEC, RCS_ERROR = 1, 2, 3
EXEC_DONE = 2


def _run(coro):
    gateway._cmd_lock = None
    gateway._source_lock = None
    return asyncio.run(coro)


class Clock:
    def __init__(self):
        self.t = time.monotonic()

    def __call__(self):
        return self.t


class _Cmd:
    def __init__(self):
        self.calls = []
        self.serial = 0
        self.block = None        # an Event the next mdi waits on
        self.entered = threading.Event()
        self.fail_mdi = False

    def mdi(self, text):
        self.entered.set()
        if self.block is not None:
            self.block.wait(5)
        if self.fail_mdi:
            raise linuxcnc.error("NML write failed")
        self.serial += 1
        self.calls.append(("mdi", text))

    def mode(self, m):
        self.serial += 1
        self.calls.append(("mode", m))
        current().stat.task_mode = m

    def abort(self):
        self.serial += 1
        self.calls.append(("abort",))

    def wait_complete(self, *_a):
        return 1


class _Base(unittest.TestCase):
    def setUp(self):
        self.cmd = _Cmd()
        connect_fake(self, cmd=self.cmd)
        S = current().stat
        S.interp_state = linuxcnc.INTERP_IDLE
        S.task_mode = linuxcnc.MODE_MDI
        S.enabled = True
        S.state = RCS_DONE
        S.echo_serial_number = 0
        S.queued_mdi_commands = 0
        S.exec_state = EXEC_DONE
        S.paused = False
        self.clock = Clock()
        self.gen = Generation()
        self.ledger = ActionLedger(self.clock)
        for name, value in (("_calc_gen", self.gen), ("_actions", self.ledger),
                            ("_drift_decision", {"state": "none", "gen": [0, 0], "why": "start"}),
                            ("_dd_prev_idle", None)):
            p = patch.object(gateway, name, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(gateway._bulk, "generation", self.gen)
        p.start()
        self.addCleanup(p.stop)
        gateway._source_claims.clear()
        self.addCleanup(gateway._source_claims.clear)

    def mdi(self, line="G10 L2 P1 X0", **kw):
        return gateway._cmd_blocking(gateway.link(), gateway.op(linuxcnc.command.mdi, line), **kw)

    def poll(self, dt=0.05, **values):
        """One status poll of the current Link, begun `dt` later."""
        for k, v in values.items():
            setattr(current().stat, k, v)
        self.clock.t += dt
        gateway._observe_actions(self.clock.t, gateway.link())

    def in_action(self, what, coro_fn):
        """Run `coro_fn()` as the handler of a held action (as the command
        worker does); the hold released by how it ends."""
        a = self.ledger.hold(what)

        async def go():
            ctx_token = gateway._current_action.set(a)
            try:
                await coro_fn()
                how = "ok"
            except Exception:
                how = "error"
            finally:
                gateway._current_action.reset(ctx_token)
            gateway._release_action(a, how)
        _run(go())
        return a


class TheBeginIsBeforeTheEffect(_Base):
    def test_a_publication_during_a_blocked_write_is_discarded(self):
        """Plan guard 1 (MT439-01): the parse ends after the begin, before the
        write returned → discarded, named, restarted after the action."""
        snap = self.gen.snapshot()
        self.cmd.block = threading.Event()
        applied = []

        async def go():
            t = asyncio.ensure_future(self.mdi(wait=None))
            await asyncio.to_thread(self.cmd.entered.wait, 5)
            ok = gateway._bulk._publish_in_generation(snap, lambda: applied.append(1), 7, "/p.ngc", "publish")
            self.cmd.block.set()
            await t
            return ok
        with patch.object(gateway._bulk, "reparse_pending", False):
            self.assertFalse(_run(go()))
            self.assertEqual(applied, [])
            self.assertTrue(gateway._bulk.reparse_pending, "the same program: a restart is asked for")
            self.assertEqual(gateway._bulk.reparse_pending_reason, "discarded:mdi")

    def test_a_refusal_before_the_write_invalidates_nothing(self):
        """Plan guard 6: the admission refuses → nothing written, the
        generation unchanged, the hold ends refused_before_write."""
        snap = self.gen.snapshot()

        async def handler():
            with self.assertRaises(gateway._WriteRefused):
                await self.mdi(wait=None, admit=lambda: "Machine busy")
        a = self.in_action("touchoff", handler)
        self.assertEqual(self.gen.snapshot(), snap)
        self.assertEqual((a.outcome, self.cmd.calls), ("refused_before_write", []))
        self.assertIsNone(self.ledger.busy())

    def test_a_write_that_raised_keeps_its_observer_unknown(self):
        self.cmd.fail_mdi = True

        async def handler():
            await self.mdi(wait=None)
        a = self.in_action("mdi", handler)
        self.assertEqual(self.ledger.busy(), "observed:mdi", "its effect unknown — never 'not written'")
        self.clock.t += 400
        self.poll()
        self.assertEqual(a.outcome, "unknown")


class TheObserverOwnsTheAction(_Base):
    def test_the_handler_return_is_no_end_and_the_proof_is(self):
        """Plan guards 10/11 (Rest A): the CALL goes with wait=None, the
        handler returns ok; an old idle status for longer than 2 s ends
        nothing; the proof does, and the debounce counts from it."""
        async def handler():
            await self.mdi("o<probe_z> call", wait=None)
        a = self.in_action("probe_run", handler)
        for _ in range(3):
            self.poll(dt=1.0, echo_serial_number=0)     # the old idle status
            self.assertFalse(gateway._actions_quiet())
        self.assertEqual(self.ledger.busy(), "observed:probe_run")
        self.poll(echo_serial_number=1)
        self.assertEqual(a.outcome, "done")
        self.assertFalse(gateway._actions_quiet(), "the debounce from the observed end")
        self.clock.t += gateway.ACTION_QUIET_S
        self.assertTrue(gateway._actions_quiet())

    def test_abort_after_the_return_is_aborted(self):
        """Plan guards 12/15: abort after the handler returned → aborted; the
        abort goes through — no command lock is held by the observer."""
        async def handler():
            await self.mdi("o<probe_z> call", wait=None)
        a = self.in_action("probe_run", handler)

        async def abort():
            self.assertFalse(gateway._get_cmd_lock().locked(), "the observer holds no lock")
            return await gateway._cmds_machine_state("abort", {}, True, None)
        self.assertEqual(_run(abort()), {"ok": True})
        self.assertEqual(a.outcome, "aborted")

    def test_a_lost_link_is_named(self):
        """Plan guards 5/12: the Link changes before the proof → link_lost
        (the quiet window on the new Link), never done."""
        async def handler():
            await self.mdi("o<probe_z> call", wait=None)
        a = self.in_action("probe_run", handler)
        use(self, cmd=_Cmd())
        S = current().stat
        S.interp_state, S.state, S.queued_mdi_commands, S.exec_state = linuxcnc.INTERP_IDLE, RCS_DONE, 0, EXEC_DONE
        S.echo_serial_number = 0
        self.poll()
        self.poll()
        self.assertEqual(a.outcome, "link_lost")

    def test_a_handler_error_after_its_write_keeps_the_observer(self):
        """Plan guard 14 (Rest A): the handler throws after the write → the
        observer and the booking stay; partial at its proof."""
        async def handler():
            await self.mdi(wait=None)
            raise RuntimeError("after the write")
        a = self.in_action("probe_run", handler)
        self.assertEqual(self.ledger.busy(), "observed:probe_run")
        self.poll(echo_serial_number=1)
        self.assertEqual(a.outcome, "partial")


class TheModeSwitchByItsEffect(_Base):
    def test_the_same_synch_two_ways(self):
        """Plan guard 16 (Rest B): MANUAL → MDI as a job's preparation and as
        the mode button alone — the same begin, the same publication ban."""
        for how in ("preparation", "button"):
            current().stat.task_mode = linuxcnc.MODE_MANUAL
            snap = self.gen.snapshot()

            async def handler():
                await gateway.set_mode(linuxcnc.MODE_MDI)
            self.in_action("probe_run" if how == "preparation" else "set_mode", handler)
            self.assertNotEqual(self.gen.snapshot(), snap, how)
            self.assertFalse(gateway._bulk._publish_in_generation(snap, lambda: None, 1, "/p.ngc", "publish"), how)

    def test_no_switch_and_manual_invalidate_nothing(self):
        """Plan guard 17: the mode task is in already → nothing written; a
        switch to MANUAL synchs nothing → no begin."""
        current().stat.task_mode = linuxcnc.MODE_MDI
        snap = self.gen.snapshot()

        async def same():
            await gateway.set_mode(linuxcnc.MODE_MDI)
        a = self.in_action("set_mode", same)
        self.assertEqual((self.gen.snapshot(), self.cmd.calls, a.outcome), (snap, [], "refused_before_write"))

        async def manual():
            await gateway.set_mode(linuxcnc.MODE_MANUAL)
        a = self.in_action("set_mode", manual)
        self.assertEqual(self.cmd.calls, [("mode", linuxcnc.MODE_MANUAL)])
        self.assertEqual((self.gen.snapshot(), a.outcome), (snap, "refused_before_write"))


class TheFileWritersBegin(_Base):
    def test_the_tool_table_begins_before_its_file_is_replaced(self):
        """Plan guard 2: the file replaced, the reload not begun — a parse
        ending in that gap is discarded."""
        snap = self.gen.snapshot()
        seen = []
        with patch.object(gateway, "_write_admission_refusal", return_value=None), \
             patch.object(gateway, "write_tool_table", lambda *_a: seen.append(self.gen.snapshot())):
            gateway._write_tool_table_admitted("/t.tbl", [], "k")
        self.assertEqual(len(seen), 1)
        self.assertNotEqual(seen[0], snap, "the generation moved BEFORE the file")
        self.assertFalse(gateway._bulk._publish_in_generation(snap, lambda: None, 1, "/p.ngc", "publish"))

    def test_the_parameter_file_begins(self):
        snap = self.gen.snapshot()
        with patch.object(gateway, "_write_var_file_updates", lambda *_a: None):
            gateway._var_file_write_began("var_file")("/v.var", {"3014": 1.0})
        self.assertNotEqual(self.gen.snapshot(), snap)


class TheUnload(_Base):
    def test_an_unload_during_a_parse_publishes_nothing_and_restarts_nothing(self):
        """Plan guard 9: a parse of the old program ends after the unload →
        discarded, and no restart is asked for (another program)."""
        snap = self.gen.snapshot()
        self.gen.new_program("unload")
        with patch.object(gateway._bulk, "reparse_pending", False):
            self.assertFalse(gateway._bulk._publish_in_generation(snap, lambda: None, 1, "/p.ngc", "publish"))
            self.assertFalse(gateway._bulk.reparse_pending)


if __name__ == "__main__":
    unittest.main()


class TheDriftDecision(_Base):
    """P2b-2 (plan v4 variant 1): the first drift decision after an idle
    transition or an input action's end — pending / none / parse {job} and
    the job's end — per generation."""

    def setUp(self):
        super().setUp()
        for name, value in (("job_ends", __import__("collections").OrderedDict()), ("refresh_running", False),
                            ("inflight", None)):
            p = patch.object(gateway._bulk, name, value)
            p.start()
            self.addCleanup(p.stop)

    def test_an_action_end_opens_a_decision_of_its_generation(self):
        async def handler():
            await self.mdi(wait=None)
        self.in_action("touchoff", handler)
        self.poll(echo_serial_number=1)
        d = gateway._drift_decision_status()
        self.assertEqual((d["state"], d["gen"]), ("pending", list(self.gen.snapshot())))

    def test_a_refused_action_opens_no_decision(self):
        before = gateway._drift_decision_status()

        async def handler():
            with self.assertRaises(gateway._WriteRefused):
                await self.mdi(wait=None, admit=lambda: "busy")
        self.in_action("touchoff", handler)
        self.assertEqual(gateway._drift_decision_status(), before, "nothing written: no decision opened")

    def test_the_idle_transition_opens_one_and_the_evaluation_closes_it(self):
        gateway._dd_idle_edge(True)
        self.assertNotEqual(gateway._drift_decision_status()["state"], "pending", "idle from the start opens none")
        gateway._dd_idle_edge(False)
        gateway._dd_idle_edge(True)
        self.assertEqual(gateway._drift_decision_status()["state"], "pending")
        gateway._dd_decide("none")
        self.assertEqual(gateway._drift_decision_status()["state"], "none")
        gateway._dd_decide("parse", 5)
        self.assertEqual(gateway._drift_decision_status()["state"], "none", "a decision stands until the next pending")

    def test_a_named_parse_carries_its_end(self):
        gateway._dd_pending("idle")
        gateway._dd_decide("parse", 7)
        self.assertNotIn("published", gateway._drift_decision_status())
        gateway._bulk._note_job_end(7, {"version": 12})
        self.assertEqual(gateway._drift_decision_status()["published"], 12)
        gateway._dd_pending("idle")
        gateway._dd_decide("parse", 8)
        gateway._bulk._note_job_end(8, {"why": "discarded"})
        self.assertEqual(gateway._drift_decision_status()["why"], "discarded")

    def test_a_parse_of_this_generation_already_running_is_the_decision(self):
        gateway._dd_pending("idle")
        gateway._bulk.refresh_running = True
        gateway._bulk.inflight = {"job": 4, "gen": tuple(self.gen.snapshot())}
        d = gateway._drift_decision_status()
        self.assertEqual((d["state"], d["job"]), ("parse", 4))

    def test_a_running_parse_of_an_older_generation_is_not(self):
        gateway._bulk.refresh_running = True
        gateway._bulk.inflight = {"job": 4, "gen": tuple(self.gen.snapshot())}
        self.gen.began("mdi")
        gateway._dd_pending("action:mdi")
        self.assertEqual(gateway._drift_decision_status()["state"], "pending")


class TheRestartWaits(_Base):
    """P2b-3 (Fable's check of the build): a parse discarded by a program
    start's switch to AUTO never restarts unpinned under the run; every
    restart waits for the actions' observed end."""

    def st(self, interp, vel=0.0):
        return type("St", (), {"interp_state": interp, "current_vel": vel})

    def test_a_discarded_parse_restarts_only_at_idle(self):
        with patch.object(gateway._bulk, "reparse_pending_reason", "discarded:mode"):
            self.clock.t += 10      # no action, the debounce long past
            self.assertEqual(gateway._restart_wait(self.st(linuxcnc.INTERP_READING), False), "not_idle")
            self.assertEqual(gateway._restart_wait(self.st(linuxcnc.INTERP_IDLE, 5.0), False), "not_idle")
            self.assertIsNone(gateway._restart_wait(self.st(linuxcnc.INTERP_IDLE), False))
            self.assertIsNone(gateway._restart_wait(self.st(linuxcnc.INTERP_READING), True), "a new file never waits")

    def test_every_restart_waits_for_the_actions(self):
        with patch.object(gateway._bulk, "reparse_pending_reason", "reparse"):
            a = self.ledger.hold("probe_run")
            self.assertEqual(gateway._restart_wait(self.st(linuxcnc.INTERP_IDLE), False), "held:probe_run")
            self.ledger.release(a, "refused")
            self.assertIsNone(gateway._restart_wait(self.st(linuxcnc.INTERP_IDLE), False))

    def test_the_start_discards_a_running_parse_and_the_poll_loop_ends_it(self):
        """The switch to AUTO begins a generation: a running parse of the
        older one is outdated — the poll loop's branch cancels it (static:
        the branch, its helper and its cancel)."""
        snap = self.gen.snapshot()
        current().stat.task_mode = linuxcnc.MODE_MANUAL

        async def start():
            await gateway.set_mode(linuxcnc.MODE_AUTO)
        self.in_action("cycle_start", start)
        from calc_lifetime import inflight_outdated
        self.assertTrue(inflight_outdated(snap, self.gen.snapshot()))
        src = open(gateway.__file__).read()
        i = src.find("and inflight_outdated(_bulk.inflight.get(\"gen\"), _calc_gen.snapshot())")
        self.assertGreater(i, 0)
        self.assertIn('_bulk.cancel_inflight("generation")', src[i:i + 600])
