"""The lifetime of a calculation in the gateway (P2b-3, plan v4 — Codex
R439–R442): the begin hook in _cmd_blocking's write thread, the publication
order against it, the observers past the handler's return, the mode switch by
its effect, the file writers' begin, the unload.

Real gateway module under the fake linuxcnc (pytest only)."""
import asyncio
import threading
import time
import types
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
            gateway._write_tool_table_admitted("/t.tbl", [], "k", lambda: None,   # the edit's check: passed
                                               gateway._tool_owner())
        self.assertEqual(len(seen), 1)
        self.assertNotEqual(seen[0], snap, "the generation moved BEFORE the file")
        self.assertFalse(gateway._bulk._publish_in_generation(snap, lambda: None, 1, "/p.ngc", "publish"))

    def test_a_load_is_a_new_program_and_an_action_that_wrote(self):
        """The native run named a load `refused_before_write`: its begin is a
        program change, and the action wrote (its end opens the decision)."""
        snap = self.gen.snapshot()

        async def handler():
            gateway._program_began("load")
        a = self.in_action("load_file", handler)
        self.assertEqual(self.gen.snapshot()[0], snap[0] + 1)
        self.assertEqual(a.outcome, "done")

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

    def test_a_new_round_of_the_same_generation_has_its_own_number(self):
        """Codex R446 MT-I26: an idle edge opens a decision without an input
        write — the same generation; its ROUND tells it from the last one, on
        every frame of it, and a decided round keeps its number."""
        gateway._dd_idle_edge(False)
        gateway._dd_idle_edge(True)
        first = gateway._drift_decision_status()
        gateway._dd_decide("none")
        decided = gateway._drift_decision_status()
        gateway._dd_idle_edge(False)
        gateway._dd_idle_edge(True)
        nxt = gateway._drift_decision_status()
        self.assertEqual(first["gen"], nxt["gen"], "no input write: the same generation")
        self.assertEqual(decided["round"], first["round"], "the decision stays in its round")
        self.assertGreater(nxt["round"], first["round"], "a new round")
        self.assertEqual(gateway._drift_decision_status()["round"], nxt["round"], "repeated frames: the same round")

    def test_the_decision_keeps_its_jobs_end_past_the_store(self):
        """Codex R446 MT-I27: the decision names job 7; sixteen and more
        other jobs end — the bounded store drops 7, the decision still says
        how 7 ended (published, and ended without a publication)."""
        for end, key, val in (({"version": 107}, "published", 107), ({"why": "cancelled:generation"}, "why", "cancelled:generation")):
            gateway._dd_pending("idle")
            gateway._dd_decide("parse", 7)
            gateway._bulk._note_job_end(7, end)
            for job in range(8, 8 + 3 * 16):
                gateway._bulk._note_job_end(job, {"version": 100 + job})
            self.assertNotIn(7, gateway._bulk.job_ends, "the store is bounded")
            self.assertEqual(gateway._drift_decision_status().get(key), val, end)

    def test_a_job_that_ended_before_the_decision_named_it(self):
        gateway._bulk._note_job_end(9, {"version": 33})
        gateway._dd_pending("idle")
        gateway._dd_decide("parse", 9)
        self.assertEqual(gateway._drift_decision_status()["published"], 33)

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
        # the program's parse was spawned under this program generation: a
        # schedule again is a restart (Codex R447 MT-I28 A — by identity)
        with patch.object(gateway._bulk, "reparse_pending_reason", "discarded:mode"), \
             patch.object(gateway._bulk, "spawned_program_gen", self.gen.snapshot()[0]):
            self.clock.t += 10      # no action, the debounce long past
            self.assertEqual(gateway._restart_wait(self.st(linuxcnc.INTERP_READING), False), "not_idle")
            self.assertEqual(gateway._restart_wait(self.st(linuxcnc.INTERP_IDLE, 5.0), False), "not_idle")
            self.assertIsNone(gateway._restart_wait(self.st(linuxcnc.INTERP_IDLE), False))
            # a first load whose parse was discarded unpublished stays
            # `file_changed` — repeating it is a restart, not a load (R446 MT-I28)
            self.assertEqual(gateway._restart_wait(self.st(linuxcnc.INTERP_READING), True), "not_idle")
            # whatever reason cancelled it — a rotary edge's too
            with patch.object(gateway._bulk, "reparse_pending_reason", "rotary:A"):
                self.assertEqual(gateway._restart_wait(self.st(linuxcnc.INTERP_READING, 1.0), True), "not_idle")
        # a new program generation whose parse was never spawned — a load THIS
        # process wrote: it skips the actions' quiet window, never the run or
        # a move (P2b-F1-1, Codex R450 MT450-01)
        with patch.object(gateway._bulk, "spawned_program_gen", None), \
             patch.object(gateway, "_own_load_unparsed", return_value=True):
            self.assertEqual(gateway._restart_wait(self.st(linuxcnc.INTERP_READING), True), "not_idle")
            self.assertEqual(gateway._restart_wait(self.st(linuxcnc.INTERP_IDLE, 1.0), True), "not_idle")
            self.assertIsNone(gateway._restart_wait(self.st(linuxcnc.INTERP_IDLE), True))
        # a restored program (no own load) is a restart: it waits for the quiet window too
        with patch.object(gateway._bulk, "spawned_program_gen", None), \
             patch.object(gateway, "_own_load_unparsed", return_value=False):
            a = self.ledger.hold("probe_run")
            self.assertEqual(gateway._restart_wait(self.st(linuxcnc.INTERP_IDLE), True), "held:probe_run")
            self.ledger.release(a, "refused")

    def test_no_parse_of_an_unloaded_program_starts_before_the_unload_settles(self):
        """Native p2b at 934ca971: between the unload's write and the status
        without the program, the file edge restarted the cancelled load parse
        (job 2). The unload's begin holds every schedule — a new file too —
        until no program is active; a load's begin or a failed unload ends it."""
        with patch.object(gateway._bulk, "unloading", False):
            gateway._program_began("unload")
            self.assertEqual(gateway._restart_wait(self.st(linuxcnc.INTERP_IDLE), True), "unloading")
            gateway._program_began("load")
            with patch.object(gateway, "_own_load_unparsed", return_value=True):
                self.assertIsNone(gateway._restart_wait(self.st(linuxcnc.INTERP_IDLE), True))
        src = open(gateway.__file__).read()
        self.assertIn("if _bulk.unloading and not st.active_file:\n                _bulk.unloading = False", src)
        self.assertEqual(src.count("_bulk.unloading = False"), 3, "settled, refused, cut short")

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


def _file_edge_chain():
    """The poll loop's preview step from the file edge's decision through the
    branch chain (gateway.py, unchanged statements): `_fe = preview_file_
    edge_action(…)`, the restart gate, the settle gate and the If chain."""
    import ast
    import copy
    tree = ast.parse(open(gateway.__file__).read())
    for fn in ast.walk(tree):
        body = getattr(fn, "body", None)
        if not isinstance(body, list):
            continue
        for i, stmt in enumerate(body):
            if isinstance(stmt, ast.Assign) and ast.unparse(stmt).startswith("_fe = preview_file_edge_action("):
                j = next(k for k in range(i, len(body)) if isinstance(body[k], ast.If)
                         and ast.unparse(body[k].test) == "_fe is not None and st.active_file")
                root = copy.deepcopy(body[j])
                c = root
                while c.orelse and isinstance(c.orelse[0], ast.If):   # the chain up to the doom branches
                    if "inflight_doomed_reason(" in ast.unparse(c.test):
                        c.orelse = []
                        break
                    c = c.orelse[0]
                mod = ast.Module(body=copy.deepcopy(body[i:j]) + [root], type_ignores=[])
                return compile(ast.fix_missing_locations(mod), "gateway.py:file-edge-chain", "exec")
    raise AssertionError("the file edge's statements were not found")


class TheFirstLoadsRestart(_Base):
    """Codex R446 MT-I28 through the poll call chain: a first load whose parse
    the switch to AUTO discarded unpublished stays `file_changed` (it compares
    with the last PUBLISHED file) — repeating that job is a restart: it waits
    for the actions, idle and the quiet window; a real load never waits."""

    def run_edge(self, *, reason, interp, vel, hold=False, published=False, spawned=True):
        from bulk_pipeline import BulkPipeline
        from gateway_util import preview_file_changed, preview_file_edge_action
        b = BulkPipeline(get_stat=lambda: None, get_machine_units=lambda: "mm", build_wcs_rotation_patches=lambda: {})
        b.reparse_pending, b.reparse_pending_reason = True, reason
        b.last_file, b.last_mtime = ("/p.ngc", 1.0) if published else (None, None)
        b.published_program = "e.1" if published else None
        # the first load's parse was spawned under this program generation (or not: a load)
        b.spawned_program_gen = self.gen.snapshot()[0] if spawned else None
        scheduled = []
        b.schedule_refresh = lambda *a, **kw: scheduled.append((a[0], a[1], kw.get("pinned", False))) or True
        if hold:
            self.ledger.hold("probe_run")
        self.clock.t += 10          # the debounce long past
        st = type("St", (), {"active_file": "/p.ngc", "program_id": "e.1", "interp_state": interp, "current_vel": vel,
                             "rotary_abc": [0, 0, 0]})
        ns = {"preview_file_edge_action": preview_file_edge_action, "rotary_hold_settled": lambda *a: True,
              "_restart_wait": gateway._restart_wait, "_bulk": b, "st": st, "_now": 0.0, "_cur_mtime": 1.0,
              "file_changed": preview_file_changed("/p.ngc", 1.0, b.last_file, b.last_mtime, st.program_id,
                                                   b.published_program),
              "_spawn_preview_task": lambda c: None, "_dd_decide": lambda *a: None, "_trace": type("T", (), {"emit": lambda *a, **k: None})()}
        # an own load (this process) whose generation spawned nothing yet
        with patch.object(gateway, "_bulk", b), patch.object(gateway, "_own_load_unparsed", return_value=not spawned):
            exec(_file_edge_chain(), ns)
        return scheduled, ns["file_changed"]

    def test_a_discarded_first_load_never_restarts_unpinned_under_the_run(self):
        for hold in (False, True):
            scheduled, changed = self.run_edge(reason="discarded:mode", interp=linuxcnc.INTERP_READING, vel=1.0, hold=hold)
            self.assertTrue(changed, "the first load is still `file_changed`")
            self.assertEqual(scheduled, [], f"no parse under the run (a held probe_run: {hold})")
            self.ledger = ActionLedger(self.clock)
            pa = patch.object(gateway, "_actions", self.ledger)
            pa.start()
            self.addCleanup(pa.stop)

    def test_after_the_run_and_the_quiet_window_it_restarts(self):
        scheduled, _ = self.run_edge(reason="discarded:mode", interp=linuxcnc.INTERP_IDLE, vel=0.0)
        self.assertEqual(scheduled, [("/p.ngc", "discarded:mode", False)])

    def test_a_real_load_never_waits_for_the_actions(self):
        scheduled, _ = self.run_edge(reason=None, interp=linuxcnc.INTERP_IDLE, vel=0.0, hold=True, spawned=False)
        self.assertEqual([s[1] for s in scheduled], ["file"], "a load's own parse, even beside a held action")

    def test_a_real_load_never_parses_under_a_run_or_a_move(self):
        """Codex R450 MT450-01: an own load whose first parse the rotary
        settle (or a late job begin) held, then Cycle Start — the load's
        exception skips the quiet window only, never the run or a move."""
        for interp, vel in ((linuxcnc.INTERP_READING, 1.0), (linuxcnc.INTERP_READING, 0.0), (linuxcnc.INTERP_IDLE, 1.0)):
            scheduled, changed = self.run_edge(reason=None, interp=interp, vel=vel, spawned=False)
            self.assertTrue(changed)
            self.assertEqual(scheduled, [], f"no unpinned parse under the run / a move ({interp}, {vel})")

    def test_a_load_clears_the_old_programs_discard(self):
        with patch.object(gateway._bulk, "reparse_pending", True), \
             patch.object(gateway._bulk, "reparse_pending_reason", "discarded:mode"), \
             patch.object(gateway._bulk, "unloading", False):
            gateway._program_began("load")
            self.assertEqual((gateway._bulk.reparse_pending, gateway._bulk.reparse_pending_reason), (False, None))


class TheFileWritersOwnTheirEnd(_Base):
    """Codex R446 MT-I25 through the real entry paths: an HTTP writer (no
    queue hold) owns its action from before the file changes to its actual
    end — a slow commit is never quiet, its error ends it named, and the HTTP
    tool import (table, reload, metadata) is ONE action."""

    def setUp(self):
        super().setUp()
        self.ended = []
        p = patch.object(gateway, "_trace_ended_actions", lambda: self.ended.extend(self.ledger.take_ended()))
        p.start()
        self.addCleanup(p.stop)

    def all_ended(self):
        return self.ended + self.ledger.take_ended()

    def commit(self, fail=False):
        import os as _os
        import tempfile
        entered, release = threading.Event(), threading.Event()
        real_replace = _os.replace
        seen = {}
        folder = tempfile.mkdtemp()
        path = _os.path.join(folder, "macro.ngc")
        open(path, "w").write("old macro\n")

        def blocked(src, dst):
            if str(dst) == path:
                entered.set()
                release.wait(5)
                if fail:
                    raise OSError(28, "No space left on device")
            return real_replace(src, dst)

        async def chunks():
            yield b"new macro\n"

        async def scenario():
            task = asyncio.create_task(gateway._atomic_stream_write(chunks(), path, 1024, gate=lambda: None))
            await asyncio.to_thread(entered.wait, 5)
            self.clock.t += 2.1                       # well past the debounce, the file still old
            seen.update(busy=gateway._actions.busy(), quiet=gateway._actions_quiet(),
                        wait=gateway._restart_wait(type("S", (), {"interp_state": linuxcnc.INTERP_IDLE, "current_vel": 0})(), False),
                        file=open(path).read(), gen=self.gen.snapshot())
            self.clock.t += 1.0
            release.set()
            try:
                await task
            except Exception as e:  # noqa: BLE001 - the writer's own error is the case
                seen["error"] = type(e).__name__
        with patch.object(gateway, "_macro_folder_path", return_value=folder), \
             patch.object(gateway.os, "replace", side_effect=blocked), \
             patch.object(gateway._bulk, "unloading", False), \
             patch.object(gateway._bulk, "reparse_pending_reason", None):
            _run(scenario())
        return seen

    def test_a_slow_commit_is_never_quiet_and_its_end_starts_the_debounce(self):
        seen = self.commit()
        self.assertEqual(seen["file"], "old macro\n", "the probe stood inside the change")
        self.assertEqual(seen["busy"], "observed:macro_file", seen)
        self.assertFalse(seen["quiet"])
        self.assertIsNotNone(seen["wait"])
        self.assertNotEqual(seen["gen"], (0, 0), "begun before the change")
        self.assertIsNone(gateway._actions.busy(), "ended at the writer's end")
        self.assertEqual(gateway._actions.last_end, self.clock.t, "the debounce from the actual end")
        ended = self.all_ended()
        self.assertEqual([(a.what, a.outcome) for a in ended], [("macro_file", "done")])

    def test_a_failed_commit_ends_named_never_done(self):
        seen = self.commit(fail=True)
        self.assertEqual(seen["busy"], "observed:macro_file")
        self.assertIn("error", seen)
        self.assertIsNone(gateway._actions.busy())
        self.assertEqual([(a.what, a.outcome) for a in self.all_ended()], [("macro_file", "unknown")])

    def test_the_http_tool_import_is_one_action_to_its_metadata(self):
        import collections
        busy = collections.OrderedDict()

        def write(path, tools):
            busy["write"] = gateway._actions.busy()

        async def reload(_data):
            busy["reload"] = gateway._actions.busy()
            return types.SimpleNamespace(task=None)   # a write job with nothing to wait for

        def save(library):
            busy["metadata"] = gateway._actions.busy()
        with patch.object(gateway, "_write_admission_refusal", return_value=None), \
             patch.object(gateway, "write_tool_table", side_effect=write), \
             patch.object(gateway, "_reload_tool_table", side_effect=reload), \
             patch.object(gateway, "save_tool_library", side_effect=save):
            _run(gateway._persist_imported_tools("/t.tbl", [], {}, conn_key="k"))
        self.assertEqual(dict(busy), {"write": "held:tool_import", "reload": "held:tool_import", "metadata": "held:tool_import"})
        ended = self.all_ended()
        self.assertEqual([(a.what, a.outcome, [o.what for o in a.observers]) for a in ended],
                         [("tool_import", "done", ["tool_table_file"])])
        self.assertIsNone(gateway._actions.busy())

    def test_a_failed_import_ends_its_action(self):
        with patch.object(gateway, "_write_admission_refusal", return_value=None), \
             patch.object(gateway, "write_tool_table", side_effect=OSError(5, "I/O error")):
            with self.assertRaises(OSError):
                _run(gateway._persist_imported_tools("/t.tbl", [], {}, conn_key="k"))
        self.assertEqual([(a.what, a.outcome) for a in self.all_ended()], [("tool_import", "unknown")])
        self.assertIsNone(gateway._actions.busy())


class TheRunningFileWriterHoldsToItsEnd(_Base):
    """Codex R447 MT-I25 A/B through the real `_atomic_stream_write` (his
    cases): a controller abort and the observer's limit never release a file
    writer that still runs; the publish, after_publish and a rollback are ONE
    held commit; the actual end — the thread's — starts the quiet window."""

    def writer(self, kind):
        import os as _os
        import tempfile
        from types import SimpleNamespace
        entered, release = threading.Event(), threading.Event()
        real_replace, real_unlink = _os.replace, _os.unlink
        seen = {}
        folder = tempfile.mkdtemp()
        old, dest = _os.path.join(folder, "old.ngc"), _os.path.join(folder, "new.ngc")
        open(old, "w").write("old macro\n")
        if kind != "rollback":
            open(dest, "w").write("old macro\n")

        def blocked_replace(src, dst):
            if str(dst) == dest:
                entered.set()
                release.wait(10)
            return real_replace(src, dst)

        def unlink(path, *a, **kw):
            if str(path) == old:
                raise OSError(5, "simulated old-name unlink failure")
            if str(path) == dest and kind == "rollback":
                entered.set()
                release.wait(10)
            return real_unlink(path, *a, **kw)

        async def chunks():
            yield b"new macro\n"

        async def scenario():
            task = asyncio.create_task(gateway._atomic_stream_write(
                chunks(), dest, 1024, replace=kind != "rollback", gate=lambda: None,
                after_publish=(lambda: gateway._unlink_renamed(old)) if kind == "rollback" else None))
            await asyncio.to_thread(entered.wait, 5)
            if kind == "timeout":
                self.poll(dt=301)
            elif kind == "abort":
                seen["abort"] = await gateway.handle_command({"cmd": "abort"}, False)
            self.poll(dt=2.1)
            seen.update(busy=self.ledger.busy(), quiet=gateway._actions_quiet(),
                        wait=gateway._restart_wait(SimpleNamespace(interp_state=linuxcnc.INTERP_IDLE, current_vel=0), False),
                        file=open(dest).read() if _os.path.exists(dest) else None)
            self.clock.t += 1.0
            seen["release_at"] = self.clock.t
            release.set()
            try:
                await task
            except gateway.HTTPException as e:
                seen["error"] = e.detail
        with patch.object(gateway, "_macro_folder_path", return_value=folder), \
             patch.object(gateway.os, "replace", side_effect=blocked_replace), \
             patch.object(gateway.os, "unlink", side_effect=unlink), \
             patch.object(gateway._bulk, "unloading", False), \
             patch.object(gateway._bulk, "reparse_pending_reason", None):
            _run(scenario())
        return seen

    def check(self, seen):
        self.assertTrue(str(seen["busy"]).startswith("observed:macro_file"), seen)
        self.assertFalse(seen["quiet"], seen)
        self.assertIsNotNone(seen["wait"], seen)
        self.assertIsNone(self.ledger.busy(), "free at the thread's end")
        self.assertEqual(self.ledger.last_end, seen["release_at"], "the quiet window from the ACTUAL end")

    def test_a_controller_abort_never_ends_a_running_file_writer(self):
        seen = self.writer("abort")
        self.assertEqual(seen["abort"]["ok"], True)
        self.check(seen)

    def test_the_observer_limit_never_releases_a_running_file_writer(self):
        seen = self.writer("timeout")
        self.check(seen)

    def test_publish_rename_and_rollback_are_one_held_commit(self):
        seen = self.writer("rollback")
        self.assertIn("Not renamed", str(seen.get("error")))
        self.assertEqual(seen["file"], "new macro\n", "the probe stood inside the rollback")
        self.check(seen)


class TheRotaryCancelOfTheFirstLoad(_Base):
    """Codex R447 MT-I28 A (his case) through the unchanged poll statements
    from the file edge through the generation branch: the first load's parse,
    the generation bumped by the switch to AUTO, A 0 -> 10 under the run — the
    rotary branch cancels first with `rotary:A`; the restart still waits."""

    def test_a_rotary_cancel_does_not_hide_the_restart(self):
        import ast
        import copy
        from types import SimpleNamespace
        from bulk_pipeline import BulkPipeline
        from calc_lifetime import inflight_outdated
        from gateway_util import (inflight_doomed_reason, preview_file_changed, preview_file_edge_action,
                                  rotary_hold_settled, rotary_hold_update)
        tree = ast.parse(open(gateway.__file__).read())
        code = None
        for node in ast.walk(tree):
            body = getattr(node, "body", None)
            if not isinstance(body, list):
                continue
            for i, s in enumerate(body):
                if not isinstance(s, ast.Assign) or not ast.unparse(s).startswith("_fe = preview_file_edge_action("):
                    continue
                j = next(k for k in range(i, len(body)) if isinstance(body[k], ast.If)
                         and ast.unparse(body[k].test) == "_fe is not None and st.active_file")
                root = copy.deepcopy(body[j])
                c = root
                while c.orelse and isinstance(c.orelse[0], ast.If):
                    if "inflight_outdated(" in ast.unparse(c.test):
                        c.orelse = []
                        break
                    c = c.orelse[0]
                code = compile(ast.fix_missing_locations(ast.Module(body=copy.deepcopy(body[i:j]) + [root], type_ignores=[])),
                               "gateway.py:poll-chain", "exec")
        self.assertIsNotNone(code)
        b = BulkPipeline(get_stat=lambda: None, get_machine_units=lambda: "mm", build_wcs_rotation_patches=lambda: {})
        b.refresh_running = True
        b.inflight = {"file": "/p.ngc", "mtime": 1.0, "rotary_seed": {"A": 0, "B": 0, "C": 0}, "gen": self.gen.snapshot()}
        b.spawned_program_gen = self.gen.snapshot()[0]      # the first load's parse runs
        self.gen.began("mode")                               # the switch to AUTO
        st = SimpleNamespace(active_file="/p.ngc", program_id="e.1", interp_state=linuxcnc.INTERP_READING, current_vel=1.0,
                             rotary_abc=[10, 0, 0])
        b.rotary_hold = rotary_hold_update(None, st.rotary_abc, 100)
        calls = []

        def cancel(why):
            calls.append(("cancel", why))
            b.refresh_running, b.inflight = False, None
            return True
        b.cancel_inflight = cancel
        b.schedule_refresh = lambda *a, **kw: calls.append(("schedule", a[1], kw.get("pinned", False))) or True
        self.clock.t += 10
        ns = {"_bulk": b, "st": st, "_now": 100, "_cur_mtime": 1.0,
              "file_changed": preview_file_changed(st.active_file, 1.0, b.last_file, b.last_mtime, st.program_id,
                                                   b.published_program),
              "preview_file_edge_action": preview_file_edge_action, "rotary_hold_settled": rotary_hold_settled,
              "_restart_wait": gateway._restart_wait, "inflight_doomed_reason": inflight_doomed_reason,
              "inflight_outdated": inflight_outdated, "_calc_gen": self.gen,
              "_spawn_preview_task": lambda c: None, "_dd_decide": lambda *a: None,
              "_trace": SimpleNamespace(emit=lambda *a, **k: None)}
        with patch.object(gateway, "_bulk", b):
            exec(code, ns)          # rotary and generation invalidation compete
            ns["_now"] = 101.1
            exec(code, ns)          # cancelled, the pose settled, the program still runs
        self.assertEqual(calls[0][0], "cancel")
        self.assertFalse(any(c[0] == "schedule" for c in calls), calls)
        # at the run's end, still: it restarts
        st.interp_state, st.current_vel = linuxcnc.INTERP_IDLE, 0.0
        with patch.object(gateway, "_bulk", b):
            ns["_now"] = 103.0
            exec(code, ns)
        self.assertEqual([c for c in calls if c[0] == "schedule"], [("schedule", "rotary:A", False)])
