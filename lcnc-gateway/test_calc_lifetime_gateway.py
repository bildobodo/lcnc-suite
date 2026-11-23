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
        for name, value in (("_calc_gen", self.gen), ("_actions", self.ledger)):
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
