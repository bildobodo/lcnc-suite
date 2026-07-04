#!/usr/bin/env python3
"""A pure-Python stand-in for the ``linuxcnc`` binding (issue #26).

The gateway does ``import linuxcnc`` at module top, so it is unimportable under
a normal test run without the real binding — and even where the binding exists,
importing the gateway against a *live* LinuxCNC is non-deterministic. Tests call
:func:`install` BEFORE importing ``gateway`` to force this fake into
``sys.modules``, so the command dispatch, policy enforcement, and payload
validation can be exercised deterministically off-machine.

Keep this pure: stdlib only, no side effects beyond building the module object.
"""

import sys
import types

# Constants the gateway compares against. Distinct ints — only relative identity
# matters (e.g. INTERP_IDLE != INTERP_READING; MODE_MDI != MODE_AUTO).
_CONSTANTS = [
    "MODE_MANUAL", "MODE_AUTO", "MODE_MDI",
    "INTERP_IDLE", "INTERP_READING", "INTERP_WAITING", "INTERP_PAUSED",
    "JOG_STOP", "JOG_INCREMENT", "JOG_CONTINUOUS",
    "SPINDLE_FORWARD", "SPINDLE_REVERSE", "SPINDLE_OFF",
    "SPINDLE_INCREASE", "SPINDLE_DECREASE",
    "AUTO_RUN", "AUTO_STEP", "AUTO_PAUSE", "AUTO_RESUME",
    "STATE_ON", "STATE_OFF", "STATE_ESTOP", "STATE_ESTOP_RESET",
    "TRAJ_MODE_TELEOP", "MIST_ON", "MIST_OFF", "FLOOD_ON", "FLOOD_OFF",
]


class _Stat:
    """stat: poll() is a no-op. Tests set machine state via the gateway's own
    globals (e.g. _shared_status), never via this object.

    axis_mask is the one stat attribute the viewer_init build path reads
    directly (build_viewer_init → _axes_from_mask); without it the send
    raises every tick and no viewer_init frame ever reaches a test client
    (the WS-B lifecycle tests assert delivery). 7 = XYZ."""
    axis_mask = 7

    def poll(self):
        pass


class _Command:
    """command: any attribute is a callable no-op, so handlers that reference
    CMD.mdi / CMD.mode / … don't AttributeError merely on attribute access."""
    def __getattr__(self, _name):
        return lambda *a, **k: None


class _ErrorChannel:
    def poll(self):
        return None


class _Ini:
    def __init__(self, *a, **k):
        pass
    def find(self, *a, **k):
        return None
    def findall(self, *a, **k):
        return []


def build_module() -> types.ModuleType:
    lc = types.ModuleType("linuxcnc")
    for i, name in enumerate(_CONSTANTS):
        setattr(lc, name, i + 1)
    lc.stat = _Stat
    lc.command = _Command
    lc.error_channel = _ErrorChannel
    lc.ini = _Ini
    lc.error = type("error", (Exception,), {})
    lc.__lcnc_fake__ = True
    return lc


def install() -> types.ModuleType:
    """Force the fake into ``sys.modules`` (overriding any real binding) so a
    subsequent ``import gateway`` is deterministic. Idempotent. Returns the fake
    module so tests can reference its constants."""
    existing = sys.modules.get("linuxcnc")
    if existing is not None and getattr(existing, "__lcnc_fake__", False):
        return existing
    lc = build_module()
    sys.modules["linuxcnc"] = lc
    return lc
