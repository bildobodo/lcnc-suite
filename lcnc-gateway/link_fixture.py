"""Test support (package 2b, plan vor-maschine R352/R353 VM352-02): THE seam
through which a test gives the gateway its connection to LinuxCNC — one
helper installs the whole connection state and restores ALL of it after the
test, so no test leaves its fakes behind for the next.

    conn = connect_fake(self)                 # fresh fakes: no status claimed
    conn = connect_fake(self, stat=MyStat())  # the test's own stat / cmd / err
    conn.stat.interp_state = linuxcnc.INTERP_IDLE
    current().stat                            # the installed fakes, read anywhere
    is_connected()                            # does the gateway hold a connection
    use(self, cmd=MyCmd())                    # a new connection: these channels, the rest kept
    with using(cmd=spy): ...                  # the same for a block
    disconnect(self) / with without_connection(): ...   # no connection (the negative case)
    swap_connection(new)                      # a replacement mid-test (the test restores)
    restore_after(self)                       # the test connects via try_connect_lcnc itself

Nothing is filled in on the test's behalf: a default stat is the fake's
empty status (every field unknown until the test sets it), a failed poll or
an unknown instance stays the test's explicit negative case.
"""
from __future__ import annotations

import contextlib
import unittest
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Optional

import linuxcnc

import gateway


@dataclass
class FakeConnection:
    """The channels a test installed — read and change them through here."""
    stat: Any = field(default_factory=lambda: linuxcnc.stat())
    cmd: Any = field(default_factory=lambda: linuxcnc.command())
    err: Any = field(default_factory=lambda: linuxcnc.error_channel())


_STATE = ("STAT", "CMD", "ERR", "lcnc_connected")


def snapshot() -> dict[str, Any]:
    """The whole connection state now (restore() puts it back)."""
    return {name: getattr(gateway, name) for name in _STATE}


def restore(saved: dict[str, Any]) -> None:
    for name, value in saved.items():
        setattr(gateway, name, value)


def _install(conn: Optional[FakeConnection]) -> None:
    if conn is None:
        gateway.STAT = gateway.CMD = gateway.ERR = None
        gateway.lcnc_connected = False
    else:
        gateway.STAT, gateway.CMD, gateway.ERR = conn.stat, conn.cmd, conn.err
        gateway.lcnc_connected = True


def connect_fake(testcase: unittest.TestCase, *, stat: Any = None, cmd: Any = None,
                 err: Any = None) -> FakeConnection:
    """Install `stat` / `cmd` / `err` (fresh fakes where not given) as the
    gateway's connection for the test; everything is restored after it."""
    saved = snapshot()
    testcase.addCleanup(restore, saved)
    conn = FakeConnection()
    if stat is not None:
        conn.stat = stat
    if cmd is not None:
        conn.cmd = cmd
    if err is not None:
        conn.err = err
    _install(conn)
    return conn


def restore_after(testcase: unittest.TestCase) -> None:
    """For a test that connects through the gateway's OWN connect path
    (try_connect_lcnc with the fake binding): the connection state before
    it is restored after the test."""
    testcase.addCleanup(restore, snapshot())


def disconnect(testcase: unittest.TestCase) -> None:
    """No connection for the test (restored after it)."""
    saved = snapshot()
    testcase.addCleanup(restore, saved)
    _install(None)


def swap_connection(conn: Optional[FakeConnection]) -> None:
    """Replace the connection NOW (mid-test — a reconnect, a revocation);
    the test's earlier connect_fake / disconnect restores at its end."""
    _install(conn)


def is_connected() -> bool:
    """Does the gateway hold a connection now? (Before the Link: the flag AND
    the channels — an ended instance cleared only the flag.)"""
    return bool(gateway.lcnc_connected) and gateway.STAT is not None and gateway.CMD is not None


def current() -> FakeConnection:
    """The connection installed now (the test's handle on its fakes)."""
    if gateway.STAT is None or gateway.CMD is None:
        raise AssertionError("no connection installed — connect_fake first")
    return FakeConnection(stat=gateway.STAT, cmd=gateway.CMD, err=gateway.ERR)


def _kept(stat: Any, cmd: Any, err: Any) -> FakeConnection:
    """These channels, the installed ones where not given (fresh fakes when
    nothing is installed)."""
    conn = FakeConnection()
    if gateway.STAT is not None:
        conn.stat = gateway.STAT
    if gateway.CMD is not None:
        conn.cmd = gateway.CMD
    if gateway.ERR is not None:
        conn.err = gateway.ERR
    if stat is not None:
        conn.stat = stat
    if cmd is not None:
        conn.cmd = cmd
    if err is not None:
        conn.err = err
    return conn


def use(testcase: unittest.TestCase, *, stat: Any = None, cmd: Any = None,
        err: Any = None) -> FakeConnection:
    """A NEW connection with these channels and the installed ones for the
    rest — a test that replaces only the command channel, say. Restored
    after the test."""
    saved = snapshot()
    testcase.addCleanup(restore, saved)
    conn = _kept(stat, cmd, err)
    _install(conn)
    return conn


@contextlib.contextmanager
def using(*, stat: Any = None, cmd: Any = None, err: Any = None) -> Iterator[FakeConnection]:
    """`use` for a block: the previous connection state after it."""
    saved = snapshot()
    try:
        conn = _kept(stat, cmd, err)
        _install(conn)
        yield conn
    finally:
        restore(saved)


@contextlib.contextmanager
def without_connection() -> Iterator[None]:
    """No connection for a block: the previous connection state after it."""
    saved = snapshot()
    try:
        _install(None)
        yield
    finally:
        restore(saved)
