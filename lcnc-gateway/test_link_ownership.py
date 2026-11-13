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
                return await gateway._cmd_blocking(self.old.cmd.mdi, "G4 P0", wait=wait,
                                                   claim=claim, admit=self._admit)
        return asyncio.run(go())

    @unittest.expectedFailure   # package 2b: the Link
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

    @unittest.expectedFailure   # package 2b: the Link
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

    @unittest.expectedFailure   # package 2b: the Link
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
                return await gateway._cmd_blocking(old.cmd.mdi, "G4 P0", wait=1.0, claim=_claim())
        with mock.patch.object(asyncio, "to_thread", gone_at_dispatch):
            with self.assertRaises(PermissionError):
                asyncio.run(go())
        self.assertEqual([e for e in events if e[0] == "write"], [], "the stale channel took the write")


if __name__ == "__main__":
    unittest.main()
