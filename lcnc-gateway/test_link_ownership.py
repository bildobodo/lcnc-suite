"""One write belongs to ONE connection (package 2b, plan vor-maschine R352/R353
VM352-02 — Codex R352's probe `vor-maschine.r352.codex-connection.py` as the
acceptance): the admission read, the write, the serial the start claim books
and every wait slice go to the connection the write was prepared on. A
connection replaced before the write thread runs refuses the write — nothing
reaches either channel; one replaced during the wait never confirms the old
write with the new channel's answer.

Before the Link (package 2b) the gateway's _cmd_blocking read the module's
STAT / CMD at each step: the probe saw the admission poll the NEW status, the
write go to the OLD channel and the claim book the NEW channel's serial —
these tests are expected failures until then."""
import asyncio
import types
import unittest
from unittest import mock

import fake_linuxcnc

fake_linuxcnc.install()

import gateway  # noqa: E402
import linuxcnc  # noqa: E402
from link_fixture import FakeConnection, connect_fake, current, disconnect, swap_connection  # noqa: E402


class _Chan:
    """A command channel that books what reached it."""

    def __init__(self, name: str, serial: int, events: list, waits_running: int = 0):
        self.name, self.serial, self.events = name, serial, events
        self.waits_running = waits_running   # slices answered "still running" (-1) first
        self.on_wait = None

    def mdi(self, text, /):
        self.serial += 1
        self.events.append(("write", self.name, text, self.serial))

    def wait_complete(self, timeout=5.0, /):
        self.events.append(("wait", self.name, self.serial))
        if self.on_wait is not None:
            hook, self.on_wait = self.on_wait, None
            hook()
        if self.waits_running > 0:
            self.waits_running -= 1
            return -1
        return linuxcnc.RCS_DONE


class _Stat:
    def __init__(self, name: str, events: list):
        self.name, self.events = name, events

    def poll(self):
        self.events.append(("admit_poll", self.name))


def _claim():
    return types.SimpleNamespace(serial=None, state="pending", sent_t=None)


class LinkOwnership(unittest.TestCase):

    def setUp(self):
        self.events: list = []
        self.old = FakeConnection(stat=_Stat("old", self.events), cmd=_Chan("old", 40, self.events))
        self.new = FakeConnection(stat=_Stat("new", self.events), cmd=_Chan("new", 80, self.events))
        connect_fake(self, stat=self.old.stat, cmd=self.old.cmd)

    def _admit(self):
        current().stat.poll()   # the admission reads the controller in the write's thread
        return None

    def _write(self, claim, wait=1.0):
        async def go():
            async with gateway._get_cmd_lock():
                return await gateway._cmd_blocking(gateway.link(), gateway.op(linuxcnc.command.mdi, "G4 P0"), wait=wait,
                                                   claim=claim, admit=self._admit)
        return asyncio.run(go())

    def test_a_connection_replaced_before_the_thread_refuses_the_write(self):
        real = asyncio.to_thread

        async def replaced_at_dispatch(fn, /, *args, **kwargs):
            swap_connection(self.new)
            return await real(fn, *args, **kwargs)

        claim = _claim()
        with mock.patch.object(asyncio, "to_thread", replaced_at_dispatch):
            with self.assertRaises(PermissionError):
                self._write(claim)
        self.assertEqual([e for e in self.events if e[0] in ("write", "wait")], [],
                         "nothing may reach either channel")
        self.assertEqual((self.old.cmd.serial, self.new.cmd.serial), (40, 80))
        self.assertEqual(claim.state, "unsent")

    def test_a_connection_replaced_during_the_wait_never_answers_for_the_old_write(self):
        self.old.cmd.waits_running = 2
        self.old.cmd.on_wait = lambda: swap_connection(self.new)
        claim = _claim()
        rc = self._write(claim)
        self.assertEqual(rc, linuxcnc.RCS_DONE)
        self.assertEqual([e[1] for e in self.events if e[0] in ("write", "wait")],
                         ["old", "old", "old", "old"], self.events)
        self.assertEqual(claim.serial, 41)   # the serial of the write that went out

    def test_without_a_replacement_everything_is_the_one_connection(self):
        claim = _claim()
        rc = self._write(claim)
        self.assertEqual(rc, linuxcnc.RCS_DONE)
        self.assertEqual(self.events, [("admit_poll", "old"), ("write", "old", "G4 P0", 41),
                                       ("wait", "old", 41)])
        self.assertEqual((claim.serial, claim.state), (41, "sent"))


class EntryPathsWithoutConnection(unittest.TestCase):
    """What each entry path does without a connection — pinned before the
    Link changes how "no connection" is represented (package 2b step 2)."""

    def test_a_dispatched_command_and_a_stop_answer_not_connected(self):
        disconnect(self)
        for msg in ({"cmd": "mdi", "command": "G0 X1"}, {"cmd": "abort"}, {"cmd": "jog_stop", "axis": 0}):
            r = asyncio.run(gateway.handle_command(msg, True))
            self.assertEqual(r, {"ok": False, "error": "LinuxCNC not connected"}, msg)

    def test_the_disconnect_jog_stop_does_nothing_without_a_connection(self):
        disconnect(self)
        saved = dict(gateway._active_jogs)
        gateway._active_jogs[0] = (0, 0)
        self.addCleanup(lambda: (gateway._active_jogs.clear(), gateway._active_jogs.update(saved)))
        asyncio.run(gateway._jog_stop_for_client())   # no exception, nothing sent
        self.assertEqual(gateway._active_jogs, {0: (0, 0)})

    def test_a_write_whose_connection_is_gone_before_the_thread_is_refused(self):
        events: list = []
        old = FakeConnection(stat=_Stat("old", events), cmd=_Chan("old", 40, events))
        connect_fake(self, stat=old.stat, cmd=old.cmd)
        real = asyncio.to_thread

        async def gone_at_dispatch(fn, /, *args, **kwargs):
            swap_connection(None)
            return await real(fn, *args, **kwargs)

        async def go():
            async with gateway._get_cmd_lock():
                return await gateway._cmd_blocking(gateway.link(), gateway.op(linuxcnc.command.mdi, "G4 P0"), wait=1.0, claim=_claim())
        with mock.patch.object(asyncio, "to_thread", gone_at_dispatch):
            with self.assertRaises(PermissionError):
                asyncio.run(go())
        self.assertEqual([e for e in events if e[0] == "write"], [], "the stale channel took the write")


class TheLinkContracts(unittest.TestCase):
    """The Link's own contracts (package 2b, VM352-02)."""

    def test_op_names_only_a_known_command_and_takes_no_keyword(self):
        self.assertEqual(gateway.op(linuxcnc.command.auto, linuxcnc.AUTO_RUN, 3),
                         gateway.CmdOp("auto", (linuxcnc.AUTO_RUN, 3)))
        with self.assertRaises(ValueError):
            gateway.op(len, [1])                       # not a LinuxCNC command
        with self.assertRaises(TypeError):
            gateway.op(linuxcnc.command.mdi, command="G0")   # the binding takes no keyword

    def test_the_start_kind_reads_the_ops_name(self):
        for code, kind in ((linuxcnc.AUTO_RUN, "auto"), (linuxcnc.AUTO_STEP, "auto"),
                           (linuxcnc.AUTO_RESUME, "auto"), (linuxcnc.AUTO_PAUSE, None)):
            c = gateway.op(linuxcnc.command.auto, code) if code != linuxcnc.AUTO_RUN \
                else gateway.op(linuxcnc.command.auto, code, 0)
            self.assertEqual(gateway._start_kind(c.name, c.args), kind, code)
        m = gateway.op(linuxcnc.command.mdi, "G0 X1")
        self.assertEqual(gateway._start_kind(m.name, m.args), "mdi")

    def test_the_link_lock_is_never_held_across_a_write_or_a_wait(self):
        events: list = []
        held = []

        class _Watching(_Chan):
            def mdi(self, text, /):
                held.append(("write", gateway._link_lock.locked()))
                super().mdi(text)

            def wait_complete(self, timeout=5.0, /):
                held.append(("wait", gateway._link_lock.locked()))
                return super().wait_complete(timeout)
        conn = FakeConnection(stat=_Stat("one", events), cmd=_Watching("one", 1, events))
        connect_fake(self, stat=conn.stat, cmd=conn.cmd)

        async def go():
            async with gateway._get_cmd_lock():
                return await gateway._cmd_blocking(gateway.link(), gateway.op(linuxcnc.command.mdi, "G4 P0"),
                                                   wait=1.0, claim=_claim())
        self.assertEqual(asyncio.run(go()), linuxcnc.RCS_DONE)
        self.assertEqual(held, [("write", False), ("wait", False)])

    def test_a_failed_connect_publishes_nothing_and_revokes_the_old_link(self):
        connect_fake(self)
        from link_fixture import is_connected, restore_after
        restore_after(self)
        self.assertTrue(is_connected())

        class _Dead:
            def poll(self):
                raise linuxcnc.error("no status channel")
        with mock.patch.object(gateway, "_nml_connectable", lambda: True), \
                mock.patch.object(gateway.linuxcnc, "stat", _Dead):
            self.assertFalse(gateway.try_connect_lcnc())
        self.assertFalse(is_connected())

    def test_a_ws_command_whose_connection_went_away_answers_not_connected(self):
        connect_fake(self)
        replies = []

        async def reply(_ws, m):
            replies.append(m)

        async def revoked_during(msg, armed, conn_key=None):
            gateway._revoke_link("test: the connection went away")
            gateway.link()   # the handler needs it now

        client = types.SimpleNamespace(armed=True, conn_key="k", cmd_preempted_by=None)
        with mock.patch.object(gateway, "handle_command", revoked_during), \
                mock.patch.object(gateway, "ws_send_json", reply):
            asyncio.run(gateway._execute_client_command(7, client, None, {"cmd": "mdi", "req_id": 3}))
        self.assertEqual(replies[-1]["ok"], False)
        self.assertEqual(replies[-1]["error"], "LinuxCNC not connected")

    def test_an_http_route_without_a_connection_answers_503(self):
        from fastapi.testclient import TestClient

        def needs_it():
            raise gateway.NotConnected()
        with mock.patch.object(gateway, "get_nc_files_dir", needs_it):
            r = TestClient(gateway.app).get("/files")
        self.assertEqual((r.status_code, r.json()), (503, {"ok": False, "error": "LinuxCNC not connected"}))


class OneLinkPerCommand(unittest.TestCase):
    """A command runs on ONE Link (Fable's review of R359): handle_command
    pins the published Link; a reconnect while the command runs makes its
    next link() NotConnected(LINK_CHANGED) — it never continues on the new
    Link with what it read from the old one."""

    def test_a_command_that_outlives_its_link_answers_link_changed(self):
        connect_fake(self)
        new = FakeConnection()
        seen = {}

        async def impl(msg, armed, conn_key=None):
            seen["first"] = gateway.link()
            swap_connection(new)                   # a reconnect while the command runs
            seen["stat"] = gateway._stat_now()     # a tolerant read: no connection for this command
            gateway.link()                         # needs it now
        with mock.patch.object(gateway, "_handle_command_impl", impl):
            with self.assertRaises(gateway.NotConnected) as cm:
                asyncio.run(gateway.handle_command({"cmd": "x"}, True))
        self.assertEqual(str(cm.exception), gateway.LINK_CHANGED)
        self.assertIsNone(seen["stat"])
        self.assertIs(gateway.link().stat, new.stat)   # outside the command: the new Link

    def test_without_a_reconnect_the_command_reads_its_own_link(self):
        conn = connect_fake(self)

        async def impl(msg, armed, conn_key=None):
            return {"ok": gateway.link().stat is conn.stat and gateway._stat_now() is conn.stat}
        with mock.patch.object(gateway, "_handle_command_impl", impl):
            self.assertEqual(asyncio.run(gateway.handle_command({"cmd": "x"}, True)), {"ok": True})

    def test_a_command_that_began_without_a_connection_never_takes_a_later_one(self):
        disconnect(self)
        new = FakeConnection()
        seen = {}

        async def impl(msg, armed, conn_key=None):
            swap_connection(new)                   # the poller connects while the command runs
            seen["stat"] = gateway._stat_now()     # not this command's connection
            gateway.link()
        with mock.patch.object(gateway, "_handle_command_impl", impl):
            with self.assertRaises(gateway.NotConnected) as cm:
                asyncio.run(gateway.handle_command({"cmd": "x"}, True))
        self.assertEqual(str(cm.exception), gateway.LINK_CHANGED)
        self.assertIsNone(seen["stat"])
        self.assertIs(gateway.link().stat, new.stat)   # outside the command: the new Link

    def test_without_a_connection_throughout_it_is_not_connected(self):
        disconnect(self)

        async def impl(msg, armed, conn_key=None):
            gateway.link()
        with mock.patch.object(gateway, "_handle_command_impl", impl):
            with self.assertRaises(gateway.NotConnected) as cm:
                asyncio.run(gateway.handle_command({"cmd": "x"}, True))
        self.assertEqual(str(cm.exception), "LinuxCNC not connected")


class AStopOnAChangedLink(unittest.TestCase):
    """A stop whose Link changed before its write is refused like any write
    (it used to go out on the stale channel through the bound method); the
    next press goes out on the new Link."""

    def test_an_abort_on_a_changed_link_is_refused_and_the_next_goes_out(self):
        class _Aborts:
            serial = 0

            def __init__(self):
                self.aborts = 0

            def abort(self):
                self.aborts += 1

            def wait_complete(self, timeout=5.0, /):
                return linuxcnc.RCS_DONE
        old_cmd, new_cmd = _Aborts(), _Aborts()
        connect_fake(self, cmd=old_cmd)
        new = FakeConnection(cmd=new_cmd)
        real = asyncio.to_thread

        async def replaced_at_dispatch(fn, /, *args, **kwargs):
            swap_connection(new)
            return await real(fn, *args, **kwargs)
        with mock.patch.object(asyncio, "to_thread", replaced_at_dispatch):
            r = asyncio.run(gateway.handle_command({"cmd": "abort"}, True))
        self.assertEqual((r["ok"], r.get("error")), (False, gateway.LINK_CHANGED))
        self.assertEqual((old_cmd.aborts, new_cmd.aborts), (0, 0))
        r = asyncio.run(gateway.handle_command({"cmd": "abort"}, True))
        self.assertTrue(r["ok"], r)
        self.assertEqual((old_cmd.aborts, new_cmd.aborts), (0, 1))


class ClaimsOfAnEarlierLink(unittest.TestCase):
    """A start claim written on an earlier Link is never released by its
    serial against this Link's echo; the quiet controller, held for the
    error proof's window, releases it."""

    def setUp(self):
        self.conn = connect_fake(self)
        saved = list(gateway._source_claims)
        self.addCleanup(lambda: gateway._source_claims.__setitem__(slice(None), saved))
        gateway._source_claims.clear()
        c = gateway._StartClaim("mdi")
        c.state, c.serial, c.sent_t, c.link_seq = "sent", 5, 0.0, -1   # an earlier Link
        gateway._source_claims.append(c)
        self.claim = c

    def status(self, *, echo, state, interp, queued=0, exec_state=None):
        s = self.conn.stat
        s.echo_serial_number, s.state, s.interp_state = echo, state, interp
        s.queued_mdi_commands = queued
        s.exec_state = linuxcnc.EXEC_DONE if exec_state is None else exec_state

    def test_a_matching_serial_on_this_link_releases_nothing(self):
        self.status(echo=9, state=linuxcnc.RCS_DONE, interp=linuxcnc.INTERP_READING)
        gateway._release_start_claims(1.0)
        self.assertEqual(gateway._source_claims, [self.claim])

    def test_the_quiet_controller_held_for_the_window_releases_it(self):
        self.status(echo=0, state=linuxcnc.RCS_DONE, interp=linuxcnc.INTERP_IDLE)
        gateway._release_start_claims(1.0)
        self.assertEqual(gateway._source_claims, [self.claim])          # the window starts
        gateway._release_start_claims(1.0 + gateway._CLAIM_ERROR_PROOF_S)
        self.assertEqual(gateway._source_claims, [])

    def test_a_queued_mdi_keeps_it(self):
        self.status(echo=0, state=linuxcnc.RCS_DONE, interp=linuxcnc.INTERP_IDLE, queued=1)
        gateway._release_start_claims(1.0)
        gateway._release_start_claims(1.0 + gateway._CLAIM_ERROR_PROOF_S)
        self.assertEqual(gateway._source_claims, [self.claim])

    # Codex R360 VM-I09: written at 100.100, window 20 ms
    def test_a_poll_begun_before_the_write_does_not_start_the_window(self):
        self.claim.sent_t = 100.100
        self.status(echo=0, state=linuxcnc.RCS_ERROR, interp=linuxcnc.INTERP_IDLE)
        gateway._release_start_claims(100.000)          # begun before the write, evaluated after
        gateway._release_start_claims(100.105)          # the first poll after it: the window starts
        self.assertEqual(gateway._source_claims, [self.claim], "released 5 ms after its write")
        gateway._release_start_claims(100.130)          # after the full window from 100.105
        self.assertEqual(gateway._source_claims, [])

    def test_a_mark_of_another_proof_does_not_shorten_the_window(self):
        self.claim.sent_t = 100.100
        self.claim.err_since = 99.0                     # left by an earlier proof
        self.status(echo=0, state=linuxcnc.RCS_ERROR, interp=linuxcnc.INTERP_IDLE)
        gateway._release_start_claims(100.2)
        self.assertEqual(gateway._source_claims, [self.claim], "the window ran from another proof's mark")
        gateway._release_start_claims(100.225)          # after the full window from 100.2
        self.assertEqual(gateway._source_claims, [])

    def test_a_poll_that_read_no_link_proves_nothing(self):
        # Fable's check of 7c16f5e9: no Link at the poll's start, one
        # published while it ran — its quiet status is not this poll's
        self.status(echo=0, state=linuxcnc.RCS_DONE, interp=linuxcnc.INTERP_IDLE)
        gateway._release_after_poll(1.0, None)
        gateway._release_after_poll(1.0 + gateway._CLAIM_ERROR_PROOF_S, None)
        self.assertEqual(gateway._source_claims, [self.claim])
        self.assertIsNone(self.claim.err_since)

    def test_a_poll_of_a_replaced_link_proves_nothing(self):
        polled = gateway._link
        swap_connection(FakeConnection(stat=self.conn.stat))   # replaced while that poll ran
        self.status(echo=0, state=linuxcnc.RCS_DONE, interp=linuxcnc.INTERP_IDLE)
        gateway._release_start_claims(1.0, polled)
        gateway._release_start_claims(1.0 + gateway._CLAIM_ERROR_PROOF_S, polled)
        self.assertEqual(gateway._source_claims, [self.claim])
        self.assertIsNone(self.claim.err_since)


class OneConnectAtATime(unittest.TestCase):
    def test_a_failing_attempt_revokes_only_the_link_it_found(self):
        connect_fake(self)
        from link_fixture import restore_after
        restore_after(self)
        published = {}
        real_stat = gateway.linuxcnc.stat

        class _Dead:
            def __init__(self):
                assert gateway._connect_lock.locked(), "a connect runs under _connect_lock"
                # someone else publishes while this attempt runs
                published["link"] = gateway._publish_link(real_stat(), linuxcnc.command(),
                                                         linuxcnc.error_channel(), None)

            def poll(self):
                raise linuxcnc.error("no status channel")
        with mock.patch.object(gateway, "_nml_connectable", lambda: True), \
                mock.patch.object(gateway.linuxcnc, "stat", _Dead):
            self.assertFalse(gateway.try_connect_lcnc())
        self.assertIs(gateway._link, published["link"])


class _ModeStat:
    """A status whose task mode the test sets; poll() runs a hook once."""

    def __init__(self, task_mode):
        self.task_mode = task_mode
        self.interp_state = linuxcnc.INTERP_IDLE
        self.g5x_index = 7          # G59.1 — the TWP scratch row the heal leaves
        self.on_poll = None

    def poll(self):
        if self.on_poll is not None:
            hook, self.on_poll = self.on_poll, None
            hook()


class _ModeCmd:
    """A command channel: mode() moves its status only when `obeys`; mdi
    writes are booked; a hook may run after the Nth write."""

    def __init__(self, stat, name, events, obeys=True, serial=40):
        self.stat, self.name, self.events, self.obeys, self.serial = stat, name, events, obeys, serial
        self.after_write = None

    def _wrote(self, what):
        self.serial += 1
        self.events.append((self.name, what, self.serial))
        if self.after_write is not None:
            hook, self.after_write = self.after_write, None
            hook()

    def mode(self, m, /):
        if self.obeys:
            self.stat.task_mode = m
        self._wrote(("mode", m))

    def mdi(self, text, /):
        self._wrote(("mdi", text))

    def task_plan_synch(self):
        self._wrote(("task_plan_synch",))

    def wait_complete(self, timeout=5.0, /):
        return linuxcnc.RCS_DONE


class SetModeReadsItsOwnLink(unittest.TestCase):
    """set_mode polls AND reads its own Link (Codex R359 VM-I05): a Link
    replaced meanwhile confirms nothing and books nothing."""

    def setUp(self):
        self.events = []
        saved = dict(gateway._active_jogs)
        self.addCleanup(lambda: (gateway._active_jogs.clear(), gateway._active_jogs.update(saved)))
        gateway._active_jogs.clear()

    def run_set_mode(self):
        async def go():
            async with gateway._get_cmd_lock():
                await gateway.set_mode(linuxcnc.MODE_MDI)
        asyncio.run(go())

    def test_an_ignored_switch_on_the_old_link_is_not_confirmed_by_the_new(self):
        old_stat = _ModeStat(linuxcnc.MODE_MANUAL)
        old = _ModeCmd(old_stat, "old", self.events, obeys=False)     # keeps MANUAL
        connect_fake(self, stat=old_stat, cmd=old)
        new_stat = _ModeStat(linuxcnc.MODE_MDI)
        old.after_write = lambda: swap_connection(FakeConnection(stat=new_stat, cmd=_ModeCmd(new_stat, "new", self.events)))
        with self.assertRaises(PermissionError) as cm:
            self.run_set_mode()
        self.assertEqual(str(cm.exception), gateway.LINK_CHANGED)

    def test_the_ignored_switch_without_a_replacement_is_still_refused(self):
        old_stat = _ModeStat(linuxcnc.MODE_MANUAL)
        connect_fake(self, stat=old_stat, cmd=_ModeCmd(old_stat, "old", self.events, obeys=False))
        with self.assertRaises(ValueError) as cm:
            self.run_set_mode()
        self.assertIn("MANUAL", str(cm.exception))

    def test_a_replacement_before_the_early_return_books_nothing(self):
        stat = _ModeStat(linuxcnc.MODE_MDI)       # already in MDI: the early return
        connect_fake(self, stat=stat, cmd=_ModeCmd(stat, "old", self.events))
        gateway._active_jogs[0] = (0, 0)
        # the new Link shows MDI too: before VM-I05 its status confirmed the
        # early return for the OLD Link and cleared that Link's jogs
        stat.on_poll = lambda: swap_connection(FakeConnection(stat=_ModeStat(linuxcnc.MODE_MDI)))
        with self.assertRaises(PermissionError):
            self.run_set_mode()
        self.assertEqual(gateway._active_jogs, {0: (0, 0)}, "a replaced Link must not clear this one's jogs")

    def test_the_switch_on_an_unchanged_link_goes_through(self):
        stat = _ModeStat(linuxcnc.MODE_MANUAL)
        connect_fake(self, stat=stat, cmd=_ModeCmd(stat, "old", self.events))
        self.run_set_mode()
        self.assertEqual(stat.task_mode, linuxcnc.MODE_MDI)


class MultiStepCommandsKeepTheirLink(unittest.TestCase):
    """A command of several writes keeps its Link (Codex R359 VM-I06):
    after a reconnect the rest is refused, what went out stays booked."""

    def setUp(self):
        self.events = []
        for name, value in (("_start_guard", None), ("reject_if_auto_running", None)):
            orig = getattr(gateway, name)
            self.addCleanup(setattr, gateway, name, orig)

        async def no_guard(armed):
            return None
        gateway._start_guard = no_guard
        gateway.reject_if_auto_running = lambda: None
        gateway._shared_status = None   # (handlers called directly below)

    def test_mode_then_mdi(self):
        old_stat = _ModeStat(linuxcnc.MODE_MANUAL)
        old = _ModeCmd(old_stat, "old", self.events)
        connect_fake(self, stat=old_stat, cmd=old)
        new_stat = _ModeStat(linuxcnc.MODE_MDI)
        old.after_write = lambda: swap_connection(FakeConnection(stat=new_stat, cmd=_ModeCmd(new_stat, "new", self.events)))

        async def go():
            async with gateway._get_cmd_lock():
                with gateway._pinned_link():
                    await gateway.set_mode(linuxcnc.MODE_MDI)
                    await gateway._cmd_blocking(gateway.link(), gateway.op(linuxcnc.command.mdi, "G0 X1"), wait=None)
        with self.assertRaises((PermissionError, gateway.NotConnected)):
            asyncio.run(go())
        self.assertEqual([e[1] for e in self.events], [("mode", linuxcnc.MODE_MDI)], "the MDI text went to the new Link")

    def test_m6_then_g43_through_the_real_handler(self):
        stat = _ModeStat(linuxcnc.MODE_MDI)
        old = _ModeCmd(stat, "old", self.events)
        connect_fake(self, stat=stat, cmd=old)
        new_stat = _ModeStat(linuxcnc.MODE_MDI)
        old.after_write = lambda: swap_connection(FakeConnection(stat=new_stat, cmd=_ModeCmd(new_stat, "new", self.events, serial=80)))

        async def go():
            async with gateway._get_cmd_lock():
                with gateway._pinned_link():
                    return await gateway._cmds_tool_table("tool_change", {"cmd": "tool_change", "tool_number": 7}, True, None)
        with self.assertRaises(gateway.NotConnected) as cm:
            asyncio.run(go())
        self.assertEqual(str(cm.exception), gateway.LINK_CHANGED)
        self.assertEqual(self.events, [("old", ("mdi", "T7 M6"), 41)], "G43 H7 went to the new Link")

    def test_m6_then_g43_without_a_reconnect_both_on_one_link(self):
        stat = _ModeStat(linuxcnc.MODE_MDI)
        connect_fake(self, stat=stat, cmd=_ModeCmd(stat, "old", self.events))

        async def go():
            async with gateway._get_cmd_lock():
                with gateway._pinned_link():
                    return await gateway._cmds_tool_table("tool_change", {"cmd": "tool_change", "tool_number": 7}, True, None)
        self.assertEqual(asyncio.run(go()), {"ok": True})
        self.assertEqual(self.events, [("old", ("mdi", "T7 M6"), 41), ("old", ("mdi", "G43 H7"), 42)])


class BackgroundSequencesKeepTheirLink(unittest.TestCase):
    """The same rule outside a command (Codex R359 VM-I06, "the other
    multi-step sequences"): the reserved-fixture heal (MDI, then G54) and
    the toolsetter read-back (the synch's mode check, the synch, the file)
    run on ONE Link; the heal also holds _cmd_lock, as set_mode requires."""

    def setUp(self):
        self.events = []
        for name in ("reject_if_auto_running", "_reserved_heal_pending", "_reserved_fixture_warning",
                     "_reserved_heal_inflight", "_reserved_heal_last_try"):
            self.addCleanup(setattr, gateway, name, getattr(gateway, name))
        gateway.reject_if_auto_running = lambda: None
        gateway._reserved_heal_pending = 7
        gateway._reserved_heal_inflight = False
        # a fresh _cmd_lock for this test's loop (a Lock binds to the loop of
        # its first contention — an earlier test's)
        self.addCleanup(setattr, gateway, "_cmd_lock", gateway._cmd_lock)
        gateway._cmd_lock = None
        # the heal's current read: a TWP machine, no plane active (fresh
        # reader), ready
        self.plane = {"twp_active": 0}
        self.not_ready = None
        for name, value in (("_reader_fresh_get", lambda f: self.plane.get(f)),
                            ("_controller_gate_refusal", lambda gate, armed: self.not_ready),
                            ("_twp_capable", lambda: True)):
            p = mock.patch.object(gateway, name, value)
            p.start()
            self.addCleanup(p.stop)

    def test_the_heal_refuses_its_g54_after_a_reconnect(self):
        stat = _ModeStat(linuxcnc.MODE_MANUAL)
        connect_fake(self, stat=stat, cmd=_ModeCmd(stat, "old", self.events))
        new_stat = _ModeStat(linuxcnc.MODE_MDI)
        real_set_mode = gateway.set_mode

        async def then_reconnect(*a, **k):
            await real_set_mode(*a, **k)
            swap_connection(FakeConnection(stat=new_stat, cmd=_ModeCmd(new_stat, "new", self.events)))
        with mock.patch.object(gateway, "set_mode", then_reconnect):
            asyncio.run(gateway._reserved_fixture_heal())
        self.assertEqual(self.events, [("old", ("mode", linuxcnc.MODE_MDI), 41)], "G54 went to the new Link")
        self.assertEqual(gateway._reserved_heal_pending, 7, "a refused heal is not healed")

    def test_a_link_replaced_in_the_g54_wait_heals_nothing(self):
        stat = _ModeStat(linuxcnc.MODE_MDI)              # already MDI: the G54 is the first write
        cmd = _ModeCmd(stat, "old", self.events)
        connect_fake(self, stat=stat, cmd=cmd)
        gateway._reserved_fixture_warning = "G59.1 active at the last shutdown"
        cmd.after_write = lambda: swap_connection(FakeConnection(stat=_ModeStat(linuxcnc.MODE_MDI)))
        asyncio.run(gateway._reserved_fixture_heal())
        self.assertEqual(self.events, [("old", ("mdi", "G54"), 41)])
        self.assertEqual(gateway._reserved_heal_pending, 7, "the replaced Link's G54 declared the row healed")
        self.assertEqual(gateway._reserved_fixture_warning, "G59.1 active at the last shutdown")

    def test_the_heal_on_one_link_writes_both(self):
        stat = _ModeStat(linuxcnc.MODE_MANUAL)
        connect_fake(self, stat=stat, cmd=_ModeCmd(stat, "old", self.events))
        asyncio.run(gateway._reserved_fixture_heal())
        self.assertEqual(self.events, [("old", ("mode", linuxcnc.MODE_MDI), 41), ("old", ("mdi", "G54"), 42)])
        self.assertIsNone(gateway._reserved_heal_pending)

    def run_behind_a_command(self, stat, during):
        """The heal queued behind a command holding _cmd_lock; `during` is
        what that command does to the machine before it releases."""
        async def go():
            lock = gateway._get_cmd_lock()
            await lock.acquire()
            heal = asyncio.ensure_future(gateway._reserved_fixture_heal())
            for _ in range(20):
                await asyncio.sleep(0)
            during()
            lock.release()
            await heal
        asyncio.run(go())

    def test_a_fixture_selected_ahead_of_the_heal_supersedes_it(self):
        stat = _ModeStat(linuxcnc.MODE_MANUAL)
        connect_fake(self, stat=stat, cmd=_ModeCmd(stat, "old", self.events))
        self.run_behind_a_command(stat, lambda: setattr(stat, "g5x_index", 1))   # G54 selected
        self.assertEqual(self.events, [], "the heal wrote over the fixture the command selected")
        self.assertIsNone(gateway._reserved_heal_pending)

    def test_a_plane_oriented_ahead_of_the_heal_supersedes_it(self):
        stat = _ModeStat(linuxcnc.MODE_MANUAL)
        connect_fake(self, stat=stat, cmd=_ModeCmd(stat, "old", self.events))
        self.run_behind_a_command(stat, lambda: self.plane.update(twp_active=1))
        self.assertEqual(self.events, [], "the heal wrote G54 over the oriented plane")
        self.assertIsNone(gateway._reserved_heal_pending)

    def test_a_machine_no_longer_ready_defers_it(self):
        stat = _ModeStat(linuxcnc.MODE_MANUAL)
        connect_fake(self, stat=stat, cmd=_ModeCmd(stat, "old", self.events))
        self.run_behind_a_command(stat, lambda: setattr(self, "not_ready", "Machine busy"))
        self.assertEqual(self.events, [])
        self.assertEqual(gateway._reserved_heal_pending, 7, "a deferred heal stays pending")

    def test_a_fixture_selected_at_the_write_is_refused_there(self):
        stat = _ModeStat(linuxcnc.MODE_MANUAL)
        cmd = _ModeCmd(stat, "old", self.events)
        connect_fake(self, stat=stat, cmd=cmd)
        cmd.after_write = lambda: setattr(stat, "g5x_index", 1)   # another GUI, after the switch
        asyncio.run(gateway._reserved_fixture_heal())
        self.assertEqual(self.events, [("old", ("mode", linuxcnc.MODE_MDI), 41)], "G54 written over G54's selection")
        self.assertEqual(gateway._reserved_heal_pending, 7, "refused at the write: tried again, then superseded")

    def test_the_heal_waits_for_a_command_in_flight(self):
        stat = _ModeStat(linuxcnc.MODE_MANUAL)
        connect_fake(self, stat=stat, cmd=_ModeCmd(stat, "old", self.events))

        async def go():
            lock = gateway._get_cmd_lock()
            await lock.acquire()                   # a client's command holds it
            heal = asyncio.ensure_future(gateway._reserved_fixture_heal())
            for _ in range(20):
                await asyncio.sleep(0)
            during = list(self.events)
            lock.release()
            await heal
            return during
        self.assertEqual(asyncio.run(go()), [], "the heal wrote while a command held _cmd_lock")
        self.assertEqual(len(self.events), 2)

    def test_the_read_back_refuses_its_synch_after_a_reconnect(self):
        import tempfile
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        var = f"{tmp.name}/m.var"
        with open(var, "w") as f:
            f.write("".join(f"{k}\t1.000000\n" for k in gateway.TOOLSETTER_BASIS_KEYS))
        stat = _ModeStat(linuxcnc.MODE_MDI)
        connect_fake(self, stat=stat, cmd=_ModeCmd(stat, "old", self.events))
        new_stat = _ModeStat(linuxcnc.MODE_MDI)
        real_read = gateway.read_var_snapshot
        reads = []

        def first_read_then_reconnect(*a, **k):
            out = real_read(*a, **k)
            if not reads:
                swap_connection(FakeConnection(stat=new_stat, cmd=_ModeCmd(new_stat, "new", self.events)))
            reads.append(out)
            return out
        booked = []
        with mock.patch.object(gateway, "_resolve_var_file_path", lambda: var), \
                mock.patch.object(gateway, "read_var_snapshot", first_read_then_reconnect), \
                mock.patch.object(gateway, "_ts_book", lambda *a, **k: booked.append(a)):
            asyncio.run(gateway._ts_read_back("prog.ngc"))
        self.assertEqual(self.events, [], "the synch went to the new Link")
        self.assertEqual(booked, [])


class _Synch:
    """The interpreter at a synch: writes the parameter file afresh (a new
    inode) with `value`; its wait runs `on_wait` once."""

    def __init__(self, path, value, events, keys=None):
        self.path, self.value, self.events, self.serial = path, value, events, 40
        self.keys = list(keys) if keys is not None else list(gateway.TOOLSETTER_BASIS_KEYS)
        self.on_wait = None

    def task_plan_synch(self):
        import os
        self.serial += 1
        self.events.append(("task_plan_synch", self.serial))
        tmp = self.path + ".new"
        with open(tmp, "w") as f:
            f.write("".join(f"{k}\t{self.value:.6f}\n" for k in self.keys))
        os.replace(tmp, self.path)

    def wait_complete(self, timeout=5.0, /):
        if self.on_wait is not None:
            hook, self.on_wait = self.on_wait, None
            hook()
        return linuxcnc.RCS_DONE


class CompletionsKeepTheirLink(unittest.TestCase):
    """Codex R360 VM-I06 rest: the background sequences keep their Link to
    the END — the read-back books, the heal declares its row healed, only
    while the Link that wrote and waited is still the published one."""

    def setUp(self):
        import tempfile
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.var = f"{tmp.name}/m.var"
        with open(self.var, "w") as f:
            f.write("".join(f"{k}\t1.000000\n" for k in gateway.TOOLSETTER_BASIS_KEYS))
        self.events, self.booked = [], []
        self.addCleanup(setattr, gateway, "_cmd_lock", gateway._cmd_lock)
        gateway._cmd_lock = None
        for name, value in (("_resolve_var_file_path", lambda: self.var),
                            ("_ts_book", lambda values, origin: self.booked.append((origin, values)))):
            p = mock.patch.object(gateway, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.cmd = _Synch(self.var, 2.0, self.events)
        connect_fake(self, stat=_ModeStat(linuxcnc.MODE_MDI), cmd=self.cmd)

    def replaced(self):
        swap_connection(FakeConnection(stat=_ModeStat(linuxcnc.MODE_MDI)))

    def test_unchanged_the_read_back_books_the_synched_values(self):
        asyncio.run(gateway._ts_read_back("prog.ngc"))
        self.assertEqual([(o, set(v.values())) for o, v in self.booked], [("read", {2.0})])

    def test_a_link_replaced_in_the_synchs_wait_books_nothing(self):
        self.addCleanup(setattr, gateway, "_ts_readback_tried", gateway._ts_readback_tried)
        gateway._ts_readback_tried = (1, "prog.ngc")     # the once-per-version-and-program latch
        self.cmd.on_wait = self.replaced
        asyncio.run(gateway._ts_read_back("prog.ngc"))
        self.assertEqual(len(self.events), 1)            # the synch went out, on its Link
        self.assertEqual(self.booked, [], "a completion of a replaced Link was booked")
        self.assertIsNone(gateway._ts_readback_tried, "not tried again on the new Link")

    def test_a_file_permission_error_is_the_files_and_keeps_the_latch(self):
        # Fable's check of f4ba0f31: `except PermissionError` took a real file
        # refusal for a Link refusal and released the latch (due on every poll)
        self.addCleanup(setattr, gateway, "_ts_readback_tried", gateway._ts_readback_tried)
        gateway._ts_readback_tried = (1, "prog.ngc")
        traced = []

        def denied(*a, **k):
            raise PermissionError(13, "Permission denied", self.var)
        with mock.patch.object(gateway, "read_var_snapshot", denied), \
                mock.patch.object(gateway._trace, "emit", lambda name, **kw: traced.append((name, kw))):
            asyncio.run(gateway._ts_read_back("prog.ngc"))
        whys = [kw.get("why") for n, kw in traced if n == "toolsetter.read_back_failed"]
        self.assertEqual(whys, ["file"])
        self.assertEqual(gateway._ts_readback_tried, (1, "prog.ngc"), "a file refusal released the latch")

    def test_a_link_replaced_at_the_last_file_read_books_nothing(self):
        real = gateway.read_var_snapshot
        reads = []

        def second_read_replaces(*a, **k):
            out = real(*a, **k)
            reads.append(1)
            if len(reads) == 2:
                self.replaced()
            return out
        with mock.patch.object(gateway, "read_var_snapshot", second_read_replaces):
            asyncio.run(gateway._ts_read_back("prog.ngc"))
        self.assertEqual(self.booked, [], "a completion of a replaced Link was booked")


class TheSkipFlagClearOnAReplacedLink(unittest.TestCase):
    """The run-from-line flag clear (#3116=0 after a sequence that armed it)
    confirmed by an MDI whose Link a reconnect replaced vouches nothing: the
    flag stays unknown and the next start clears it first (VM-I06 class)."""

    def setUp(self):
        for name in ("_skip_flag_unknown", "_rfl_flag_task"):
            self.addCleanup(setattr, gateway, name, getattr(gateway, name))
        gateway._skip_flag_unknown = True
        stat = _ModeStat(linuxcnc.MODE_MDI)
        stat.task_state = linuxcnc.STATE_ON
        connect_fake(self, stat=stat)
        self.stat = stat

    def run_clear(self, replace):
        async def step(text, timeout_s=10.0):
            if replace:
                swap_connection(FakeConnection(stat=self.stat))
            return True, ""

        async def go():
            with gateway._pinned_link(), mock.patch.object(gateway, "_rfl_mdi_step", step), \
                    mock.patch.object(gateway, "_rfl_phase", lambda *a, **k: None):
                gateway._rfl_clear_flag()
                await gateway._rfl_flag_task
        asyncio.run(go())

    def test_cleared_on_its_own_link_the_flag_is_known(self):
        self.run_clear(replace=False)
        self.assertFalse(gateway._skip_flag_unknown)

    def test_cleared_on_a_replaced_link_the_flag_stays_unknown(self):
        self.run_clear(replace=True)
        self.assertTrue(gateway._skip_flag_unknown, "a replaced Link's #3116=0 vouched the flag")


class TheG30ConfirmedReadKeepsItsLink(unittest.TestCase):
    """read_g30 / set_g30 / capture_g30 confirm from _g30_synch_read — the
    read-back's shape (synch, wait, file read): a confirmation through a
    Link replaced meanwhile is none (Fable's check of f4ba0f31)."""

    KEYS = ["5181", "5182", "5183"]

    def setUp(self):
        import tempfile
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.var = f"{tmp.name}/m.var"
        with open(self.var, "w") as f:
            f.write("".join(f"{k}\t1.000000\n" for k in self.KEYS))
        self.events = []
        for name in ("_cmd_lock", "_var_file_lock"):
            self.addCleanup(setattr, gateway, name, getattr(gateway, name))
        gateway._cmd_lock = gateway._var_file_lock = None
        self.cmd = _Synch(self.var, 2.0, self.events, keys=self.KEYS)
        connect_fake(self, stat=_ModeStat(linuxcnc.MODE_MDI), cmd=self.cmd)

    def read(self):
        async def go():
            with gateway._pinned_link():
                return await gateway._g30_synch_read(self.var, self.KEYS)
        return asyncio.run(go())

    def replaced(self):
        swap_connection(FakeConnection(stat=_ModeStat(linuxcnc.MODE_MDI)))

    def test_unchanged_the_synched_values_are_confirmed(self):
        self.assertEqual(set(self.read().values()), {2.0})

    def test_a_link_replaced_in_the_synchs_wait_confirms_nothing(self):
        self.cmd.on_wait = self.replaced
        with self.assertRaises(gateway._G30Unconfirmed):
            self.read()

    def test_a_link_replaced_at_the_last_file_read_confirms_nothing(self):
        real, reads = gateway.read_var_snapshot, []

        def second_read_replaces(*a, **k):
            out = real(*a, **k)
            reads.append(1)
            if len(reads) == 2:
                self.replaced()
            return out
        with mock.patch.object(gateway, "read_var_snapshot", second_read_replaces):
            with self.assertRaises(gateway._G30Unconfirmed):
                self.read()


class TheViewerInitCacheIsTheLinks(unittest.TestCase):
    """build_viewer_init reads the status (axis mask, limits) and the INI:
    its cache entries belong to the Link read through (VM-I08)."""

    def setUp(self):
        saved = dict(gateway._viewer_init_cache)
        self.addCleanup(lambda: (gateway._viewer_init_cache.clear(), gateway._viewer_init_cache.update(saved)))
        gateway._viewer_init_cache.clear()

    def test_an_old_build_never_publishes_for_the_new_link(self):
        connect_fake(self)
        real_cfg = gateway.get_machine_cfg

        def cfg_then_reconnect():
            out = real_cfg()
            gateway._publish_link(linuxcnc.stat(), linuxcnc.command(), linuxcnc.error_channel(), None)
            return out
        with mock.patch.object(gateway, "get_machine_cfg", cfg_then_reconnect):
            mine = gateway.build_viewer_init("/assets/")
        self.assertIsInstance(mine, dict)                  # its own answer
        self.assertEqual(gateway._viewer_init_cache, {}, "an old build published for the new Link")

    def test_a_link_change_clears_it_and_a_current_build_stores(self):
        connect_fake(self)
        gateway.build_viewer_init("/assets/")
        self.assertEqual(len(gateway._viewer_init_cache), 1)
        gateway._publish_link(linuxcnc.stat(), linuxcnc.command(), linuxcnc.error_channel(), None)
        self.assertEqual(gateway._viewer_init_cache, {}, "a Link change left the old Link's entries")


class ReservedRowsOnlyOnATwpMachine(unittest.TestCase):
    """G59–G59.3 are reserved only where TWP rules apply (TWP-08 / TWP-08a,
    the ONE predicate _twp_capable): on a switchable machine without the
    TWP stack — a TCP trunnion — they are ordinary fixtures, and the boot
    heal must leave them (it decided by "switchable" and would have put an
    operator's G59 back to G54; Fable's check of 3e3ec6ed). On a TWP
    machine an unread plane state defers the heal."""

    def setUp(self):
        for name in ("_reserved_heal_checked", "_reserved_heal_pending", "_reserved_fixture_warning",
                     "_reserved_heal_inflight", "_reserved_heal_last_try", "reject_if_auto_running",
                     "_cmd_lock"):
            self.addCleanup(setattr, gateway, name, getattr(gateway, name))
        # (getattr with a default: the red check runs these tests against
        # the product before the retry cadence existed)
        self.addCleanup(setattr, gateway, "_reserved_heal_decl_tried",
                        getattr(gateway, "_reserved_heal_decl_tried", 0.0))
        gateway._reserved_heal_checked = False
        gateway._reserved_heal_decl_tried = 0.0
        gateway._reserved_heal_pending = None
        gateway._reserved_fixture_warning = ""
        gateway._reserved_heal_inflight = False
        gateway._cmd_lock = None
        gateway.reject_if_auto_running = lambda: None
        self.events = []

    def boot_tick(self, capable, decl=True):
        """The first tick with G59.1 active; `decl`: the kins declaration read."""
        st = types.SimpleNamespace(g5x_index=7, twp_active=False, permissions={})
        with mock.patch.object(gateway, "_twp_capable", lambda: capable), \
                mock.patch.object(gateway, "_kins_is_switchable", lambda: True), \
                mock.patch.object(gateway, "_parse_kins_decl", lambda: {"type": "x"} if decl else None):
            gateway._reserved_fixture_heal_tick(st)

    def test_an_unread_declaration_does_not_spend_the_boot_check(self):
        # Fable's check of 7c16f5e9: an unread declaration reads "not TWP"
        self.boot_tick(capable=False, decl=False)
        self.assertFalse(gateway._reserved_heal_checked, "the one-shot spent on an unread declaration")
        self.assertIsNone(gateway._reserved_heal_pending)
        gateway._reserved_heal_decl_tried = 0.0          # the retry cadence has passed
        self.boot_tick(capable=True)                     # read now: a TWP machine
        self.assertEqual(gateway._reserved_heal_pending, 7)

    def test_a_tcp_trunnions_g59_1_is_an_ordinary_fixture(self):
        self.boot_tick(capable=False)
        self.assertIsNone(gateway._reserved_heal_pending, "an ordinary G59.1 set to be healed")
        self.assertEqual(gateway._reserved_fixture_warning, "")

    def test_a_twp_machines_g59_1_is_its_scratch_row(self):
        self.boot_tick(capable=True)
        self.assertEqual(gateway._reserved_heal_pending, 7)
        self.assertIn("TWP scratch row", gateway._reserved_fixture_warning)

    def test_the_heal_on_a_machine_without_twp_writes_nothing(self):
        gateway._reserved_heal_pending = 7
        stat = _ModeStat(linuxcnc.MODE_MANUAL)
        connect_fake(self, stat=stat, cmd=_ModeCmd(stat, "old", self.events))
        with mock.patch.object(gateway, "_twp_capable", lambda: False):
            asyncio.run(gateway._reserved_fixture_heal())
        self.assertEqual(self.events, [])
        self.assertIsNone(gateway._reserved_heal_pending)

    def test_an_unread_plane_state_on_a_twp_machine_defers(self):
        gateway._reserved_heal_pending = 7
        stat = _ModeStat(linuxcnc.MODE_MANUAL)
        connect_fake(self, stat=stat, cmd=_ModeCmd(stat, "old", self.events))
        with mock.patch.object(gateway, "_twp_capable", lambda: True), \
                mock.patch.object(gateway, "_reader_fresh_get", lambda f: None):
            asyncio.run(gateway._reserved_fixture_heal())
        self.assertEqual(self.events, [])
        self.assertEqual(gateway._reserved_heal_pending, 7, "unknown defers, never heals or drops")


class _SlowG54(_ModeCmd):
    """The heal's G54 runs on (wait_complete: -1 per slice, as LinuxCNC
    answers a running MDI) until `done`; an abort is booked and answered."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        import threading
        self.g54_written = threading.Event()
        self.done = threading.Event()

    def mdi(self, text, /):
        super().mdi(text)
        if text == "G54":
            self.g54_written.set()

    def abort(self):
        self._wrote(("abort",))
        self.done.set()

    def wait_complete(self, timeout=5.0, /):
        if self.g54_written.is_set() and not self.done.is_set():
            self.done.wait(timeout)
            return -1 if not self.done.is_set() else linuxcnc.RCS_DONE
        return linuxcnc.RCS_DONE


class AnAbortDuringTheHeal(unittest.TestCase):
    """The heal holds _cmd_lock (package 2b), so an abort must not queue
    behind its G54 wait: _preempt_inflight cancels it like a client's
    handler; the abort goes out after the current wait slice."""

    def setUp(self):
        self.events = []
        for name in ("reject_if_auto_running", "_reserved_heal_pending", "_reserved_fixture_warning",
                     "_reserved_heal_inflight", "_reserved_heal_last_try", "_reserved_heal_task"):
            self.addCleanup(setattr, gateway, name, getattr(gateway, name))
        gateway.reject_if_auto_running = lambda: None
        gateway._reserved_heal_pending = 7
        gateway._reserved_heal_inflight = False
        # a fresh _cmd_lock for this test's loop (a Lock binds to the loop of
        # its first contention — an earlier test's)
        self.addCleanup(setattr, gateway, "_cmd_lock", gateway._cmd_lock)
        gateway._cmd_lock = None
        # the heal's current read: a TWP machine, no plane active (fresh
        # reader), ready
        self.plane = {"twp_active": 0}
        self.not_ready = None
        for name, value in (("_reader_fresh_get", lambda f: self.plane.get(f)),
                            ("_controller_gate_refusal", lambda gate, armed: self.not_ready),
                            ("_twp_capable", lambda: True)):
            p = mock.patch.object(gateway, name, value)
            p.start()
            self.addCleanup(p.stop)

    def test_the_abort_goes_out_within_a_slice(self):
        import time
        stat = _ModeStat(linuxcnc.MODE_MDI)
        cmd = _SlowG54(stat, "old", self.events)
        connect_fake(self, stat=stat, cmd=cmd)

        async def go():
            gateway._reserved_heal_task = asyncio.ensure_future(gateway._reserved_fixture_heal())
            while not cmd.g54_written.is_set():
                await asyncio.sleep(0.01)
            t0 = time.monotonic()
            gateway._preempt_inflight("abort", 0)
            reply = await gateway.handle_command({"cmd": "abort"}, True)
            took = time.monotonic() - t0
            with self.assertRaises(asyncio.CancelledError):
                await gateway._reserved_heal_task
            return reply, took
        reply, took = asyncio.run(go())
        self.assertTrue(reply["ok"], reply)
        self.assertLess(took, 1.0, "the abort waited behind the heal's G54 (5 s)")
        self.assertEqual([e[1] for e in self.events], [("mdi", "G54"), ("abort",)])
        self.assertEqual(gateway._reserved_heal_pending, 7, "a cancelled heal is not healed")


class TheReadBackOnAChangedLinkAtItsWrite(unittest.TestCase):
    """The synch's own write refused (_WriteRefused, a PermissionError) when
    the Link changes at its dispatch: traced, nothing synched — never an
    unhandled task exception."""

    def test_refused_and_traced(self):
        import tempfile
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        var = f"{tmp.name}/m.var"
        with open(var, "w") as f:
            f.write("".join(f"{k}\t1.000000\n" for k in gateway.TOOLSETTER_BASIS_KEYS))
        events = []
        stat = _ModeStat(linuxcnc.MODE_MDI)
        connect_fake(self, stat=stat, cmd=_ModeCmd(stat, "old", events))
        new_stat = _ModeStat(linuxcnc.MODE_MDI)
        real = asyncio.to_thread

        async def replaced_at_the_write(fn, /, *args, **kwargs):
            if getattr(fn, "__name__", "") == "_run":
                swap_connection(FakeConnection(stat=new_stat, cmd=_ModeCmd(new_stat, "new", events)))
            return await real(fn, *args, **kwargs)
        traced = []
        with mock.patch.object(gateway, "_resolve_var_file_path", lambda: var), \
                mock.patch.object(asyncio, "to_thread", replaced_at_the_write), \
                mock.patch.object(gateway._trace, "emit", lambda name, **kw: traced.append((name, kw))):
            asyncio.run(gateway._ts_read_back("prog.ngc"))
        self.assertEqual(events, [])
        failed = [kw for name, kw in traced if name == "toolsetter.read_back_failed"]
        self.assertEqual([(kw["why"], kw["msg"]) for kw in failed], [("link", gateway.LINK_CHANGED)])


class CachesFilledOnTheirOwnLink(unittest.TestCase):
    """A reconnect clears the session caches; a caller whose pinned Link it
    replaced reads no status afterwards (Fable's check of 211ecc45). What it
    computes then is its own fallback — never cached for the new Link."""

    def setUp(self):
        for name in ("_machine_limits", "_ini_config", "_joint_jog_cache", "_kins_decl_cache", "_nc_files_dir",
                     "_coord_without_homing_cache", "_spindle_before_homing_cache"):
            self.addCleanup(setattr, gateway, name, getattr(gateway, name))
        gateway._machine_limits = None
        gateway._joint_jog_cache = None
        gateway._ini_config = {"linear_units": "mm"}    # the INI read; the status is the question

    def reconnect(self, stat):
        """A reconnect through the real publish (it clears the caches in the
        same step) — restored with the test's connection."""
        return gateway._publish_link(stat, linuxcnc.command(), linuxcnc.error_channel(), None)

    def test_an_old_poll_never_publishes_its_bounds_for_the_new_link(self):
        old_stat, new_stat = _ModeStat(linuxcnc.MODE_MANUAL), _ModeStat(linuxcnc.MODE_MANUAL)
        old_stat.axis_mask, old_stat.joints = 0b11111, 5
        new_stat.axis_mask, new_stat.joints = 0b111, 3
        connect_fake(self, stat=old_stat)
        gateway._ini_config = {"max_jog_velocity": 2.0}          # the old Link's INI

        def reconnect_and_a_new_reader():
            self.reconnect(new_stat)
            gateway._ini_config = {"max_jog_velocity": 100.0}    # a reader of the new Link has its INI
        old_stat.on_poll = reconnect_and_a_new_reader
        mine = gateway.get_machine_limits()                      # the old call: its own bounds
        self.assertEqual((mine.n_axes, mine.max_jog_velocity), (5, 2.0))
        self.assertIsNone(gateway._machine_limits, "the old call's bounds published for the new Link")
        now = gateway.get_machine_limits()
        self.assertEqual((now.n_axes, now.n_joints, now.max_jog_velocity), (3, 3, 100.0))

    def test_an_old_ini_read_never_publishes_its_kins_mode_commands_for_the_new_link(self):
        for name in ("_kins_mode_cmd_cache",):
            self.addCleanup(setattr, gateway, name, getattr(gateway, name))
        gateway._kins_mode_cmd_cache = None
        conn = connect_fake(self)
        conn.stat.ini_filename = "/old.ini"
        new_stat = linuxcnc.stat()
        new_stat.ini_filename = "/new.ini"
        test = self
        traced = []

        class _Ini:
            def __init__(self, path):
                if path == "/old.ini" and gateway._link is not None and gateway._link.stat is conn.stat:
                    test.reconnect(new_stat)               # replaced while the old INI is read

            def find(self, section, key):
                return None

            def findall(self, section, key):
                return []
        with mock.patch.object(gateway.linuxcnc, "ini", _Ini, create=True), \
                mock.patch.object(gateway, "kins_mode_commands", lambda remaps, source: {0: "M428"}), \
                mock.patch.object(gateway._trace, "emit", lambda name, **kw: traced.append((name, kw))):
            mine = gateway._kins_mode_commands()
        self.assertEqual(mine, {0: "M428"})               # the old read's own answer
        self.assertIsNone(gateway._kins_mode_cmd_cache, "the old INI's commands published for the new Link")
        self.assertIn(("lcnc.cache_store_refused", "kins_mode_commands"),
                      [(n, kw.get("cache")) for n, kw in traced], "a refused store is said")

    def test_an_old_ini_read_never_publishes_its_joint_jog_facts_for_the_new_link(self):
        conn = connect_fake(self)
        conn.stat.ini_filename, conn.stat.joints, conn.stat.axis_mask = "/old.ini", 3, 7
        new_stat = linuxcnc.stat()
        new_stat.ini_filename, new_stat.joints, new_stat.axis_mask = "/new.ini", 3, 7
        on = {("DISPLAY", "WEBUI_JOINT_JOG_BEFORE_HOMING"): "1", ("DISPLAY", "WEBUI_JOINT_AXES"): "X Y Z",
              ("JOINT_0", "MAX_VELOCITY"): "10", ("JOINT_1", "MAX_VELOCITY"): "10",
              ("JOINT_2", "MAX_VELOCITY"): "10"}
        test = self

        class _Ini:
            def __init__(self, path):
                self.values = on if path == "/old.ini" else {}
                if path == "/old.ini" and gateway._link is not None and gateway._link.stat is conn.stat:
                    test.reconnect(new_stat)               # replaced while the old INI is read

            def find(self, section, key):
                return self.values.get((section, key))
        with mock.patch.object(gateway.linuxcnc, "ini", _Ini, create=True):
            mine = gateway._joint_jog_facts()
            self.assertTrue(mine["enabled"])               # the old read's own answer
            self.assertIsNone(gateway._joint_jog_cache, "the old INI's facts published for the new Link")
            now = gateway._joint_jog_facts()
        self.assertFalse(now["enabled"], "the new INI switches the jog before homing off")
        self.assertIs(gateway._joint_jog_cache, now)

    def test_the_payload_bounds_are_not_cached_by_a_pinned_out_caller(self):
        conn = connect_fake(self)
        conn.stat.axis_mask, conn.stat.joints = 7, 3
        with gateway._pinned_link():
            swap_connection(FakeConnection(stat=conn.stat))   # the reconnect ...
            gateway._machine_limits = None                    # ... cleared the cache
            mine = gateway.get_machine_limits()
        self.assertIsNone(mine.n_axes)
        self.assertIsNone(gateway._machine_limits, "fallback bounds cached for the new Link")
        self.assertEqual(gateway.get_machine_limits().n_axes, 3)   # read on the new Link: cached
        self.assertIsNotNone(gateway._machine_limits)

    def test_the_joint_jog_facts_read_one_status(self):
        conn = connect_fake(self)
        conn.stat.ini_filename, conn.stat.joints, conn.stat.axis_mask = "/m.ini", 3, 7
        values = {("DISPLAY", "WEBUI_JOINT_JOG_BEFORE_HOMING"): "1", ("DISPLAY", "WEBUI_JOINT_AXES"): "X Y Z",
                  ("JOINT_0", "MAX_VELOCITY"): "10", ("JOINT_1", "MAX_VELOCITY"): "10",
                  ("JOINT_2", "MAX_VELOCITY"): "10"}

        class _Ini:
            def __init__(self, path):
                swap_connection(FakeConnection(stat=conn.stat))   # a reconnect while the INI is read

            def find(self, section, key):
                return values.get((section, key))
        with gateway._pinned_link(), mock.patch.object(gateway.linuxcnc, "ini", _Ini, create=True):
            facts = gateway._joint_jog_facts()
        self.assertTrue(facts["enabled"], facts)
        self.assertEqual([(r["letter"], r["joint"]) for r in facts["axes"]], [("X", 0), ("Y", 1), ("Z", 2)])


class ConnectLifecycle(unittest.TestCase):
    """Codex R359 VM-I07: a failed pre-check revokes the Link it found; a
    connect that began before the bound instance ended never publishes after."""

    def setUp(self):
        from link_fixture import restore_after
        restore_after(self)
        for name in ("_instance_ended", "_bound_instance", "_hal_disconnect", "_request_process_shutdown",
                     "_nml_connectable"):
            self.addCleanup(setattr, gateway, name, getattr(gateway, name))
        gateway._hal_disconnect = lambda: None
        gateway._request_process_shutdown = lambda reason: None

    def test_a_failed_precheck_revokes_the_link_it_found(self):
        connect_fake(self)
        gateway._nml_connectable = lambda: False
        self.assertFalse(gateway.try_connect_lcnc())
        self.assertIsNone(gateway._link)

    def test_an_instance_end_during_the_connect_publishes_nothing(self):
        connect_fake(self)
        gateway._instance_ended = False
        gateway._bound_instance = (424242, 1)
        gateway._nml_connectable = lambda: True
        real_stat = gateway.linuxcnc.stat

        class _EndsDuringConnect(real_stat):
            def poll(self):
                gateway._on_instance_ended("test: the instance ended during the connect")
        with mock.patch.object(gateway.linuxcnc, "stat", _EndsDuringConnect), \
                mock.patch.object(gateway._session_bind, "instance_for_pid", lambda pid: (424242, 1)), \
                mock.patch.object(gateway, "_get_lcnc_pid", lambda: 424242):
            self.assertFalse(gateway.try_connect_lcnc())
        self.assertTrue(gateway._instance_ended)
        self.assertIsNone(gateway._link)


class TheTestSessionHasNoHostConnection(unittest.TestCase):
    """CI on 999a8ca9: eight tests passed on the dev box because the gateway
    connected at import to the host's running sim (the fake binding, the
    real linuxcncsvr pid) — and failed where no LinuxCNC runs. Under pytest
    (conftest.py) the host's /proc yields no instance, so no test starts
    with a connection it did not install. Meaningful where a LinuxCNC runs
    on the host (the dev box's sim); trivially true elsewhere. Its NML is
    not reached either (_nml_connectable asks it through the REAL binding)."""

    def setUp(self):
        if not getattr(gateway.linuxcnc, "__lcnc_fake__", False):
            self.skipTest("needs the fake binding (run under pytest)")

    def test_no_connection_without_the_tests_own(self):
        self.assertIsNone(gateway._link, "a Link no test installed — the gateway connected to the host?")

    def test_the_hosts_proc_yields_no_instance(self):
        import session_bind
        self.assertEqual(session_bind.discover_instance(), (None, []))
        with mock.patch.object(gateway, "_lcnc_pid", None):
            self.assertIsNone(gateway._get_lcnc_pid())

    def test_the_hosts_nml_never_answers(self):
        self.assertFalse(gateway._nml_connectable(), "the host's NML answered — a WS connect in a test would connect")
        self.assertFalse(gateway.try_connect_lcnc())
        self.assertIsNone(gateway._link)


if __name__ == "__main__":
    unittest.main()
