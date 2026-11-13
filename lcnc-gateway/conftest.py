"""pytest bootstrap: install the fake linuxcnc before any test imports gateway.

Harmless under plain `unittest` (conftest is a pytest concept and isn't loaded
there) — the gateway test modules also call fake_linuxcnc.install() at their top
so they work under either runner.

The host's LinuxCNC is not the test session's connection (package 2b): the
gateway connects (at import, on a WS connect, in the poller) when it finds a
live ``linuxcncsvr`` and its NML answers — on the dev box the running sim:
the instance through the host's /proc, the NML through a subprocess with the
REAL binding (``_nml_connectable``) — and the fake binding then published a
Link. Every test that read it passed here and failed on a host without
LinuxCNC (CI, 999a8ca9: eight tests whose passes rested on it or on a
connection an earlier test left behind). In the test session the HOST's
/proc never yields an instance and the host's NML never answers — as on
CI; a test's own /proc tree (test_session_bind) is read as before; a test
that needs a connection installs its own (link_fixture.connect_fake), one
that connects through the gateway's own path patches ``_get_lcnc_pid`` /
``_nml_connectable`` and restores the Link (link_fixture.restore_after).
"""
import os
import sys

import pytest

import fake_linuxcnc
import session_bind

fake_linuxcnc.install()

_real_discover_instance = session_bind.discover_instance


def _no_host_instance(proc_root: str = "/proc", comm: str = "linuxcncsvr"):
    if os.path.realpath(proc_root) == "/proc":
        return None, []
    return _real_discover_instance(proc_root, comm)


session_bind.discover_instance = _no_host_instance


def _host_nml_unreachable() -> bool:
    return False


@pytest.fixture(autouse=True)
def _no_host_nml_and_the_connection_as_found():
    """Per test: the host's NML never answers (``gateway._nml_connectable``
    is False unless the test patches it — a test that saves and restores it
    restores this), and no test leaves a connection behind for the next:
    the gateway's published Link after a test is the one before it — a
    test that connects goes through link_fixture (restored) or restores
    itself."""
    gw = sys.modules.get("gateway")
    saved_probe = before = None
    if gw is not None:
        saved_probe = gw._nml_connectable
        gw._nml_connectable = _host_nml_unreachable
        before = gw._link
    yield
    if gw is not None:
        gw._nml_connectable = saved_probe
    gw = sys.modules.get("gateway")
    if gw is not None and gw._link is not before:
        leaked = gw._link
        with gw._link_lock:
            gw._link = before
        raise AssertionError(f"the test left the gateway's connection changed: {before!r} -> {leaked!r}")
