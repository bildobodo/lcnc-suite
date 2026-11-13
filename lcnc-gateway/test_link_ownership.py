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
                pinned = gateway._command_link.set(gateway._link)
                try:
                    await gateway.set_mode(linuxcnc.MODE_MDI)
                    await gateway._cmd_blocking(gateway.link(), gateway.op(linuxcnc.command.mdi, "G0 X1"), wait=None)
                finally:
                    gateway._command_link.reset(pinned)
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
                pinned = gateway._command_link.set(gateway._link)
                try:
                    return await gateway._cmds_tool_table("tool_change", {"cmd": "tool_change", "tool_number": 7}, True, None)
                finally:
                    gateway._command_link.reset(pinned)
        with self.assertRaises(gateway.NotConnected) as cm:
            asyncio.run(go())
        self.assertEqual(str(cm.exception), gateway.LINK_CHANGED)
        self.assertEqual(self.events, [("old", ("mdi", "T7 M6"), 41)], "G43 H7 went to the new Link")

    def test_m6_then_g43_without_a_reconnect_both_on_one_link(self):
        stat = _ModeStat(linuxcnc.MODE_MDI)
        connect_fake(self, stat=stat, cmd=_ModeCmd(stat, "old", self.events))

        async def go():
            async with gateway._get_cmd_lock():
                pinned = gateway._command_link.set(gateway._link)
                try:
                    return await gateway._cmds_tool_table("tool_change", {"cmd": "tool_change", "tool_number": 7}, True, None)
                finally:
                    gateway._command_link.reset(pinned)
        self.assertEqual(asyncio.run(go()), {"ok": True})
        self.assertEqual(self.events, [("old", ("mdi", "T7 M6"), 41), ("old", ("mdi", "G43 H7"), 42)])


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


if __name__ == "__main__":
    unittest.main()
