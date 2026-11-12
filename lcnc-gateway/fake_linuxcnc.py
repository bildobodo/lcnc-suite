#!/usr/bin/env python3
"""A pure-Python stand-in for the ``linuxcnc`` binding (issue #26).

The gateway does ``import linuxcnc`` at module top, so it is unimportable under
a normal test run without the real binding — and even where the binding exists,
importing the gateway against a *live* LinuxCNC is non-deterministic. Tests call
:func:`install` BEFORE importing ``gateway`` to force this fake into
``sys.modules``, so the command dispatch, policy enforcement, and payload
validation can be exercised deterministically off-machine.

Its SHAPE is the binding's (package 2, Codex R352/R353 VM352-01): every class
is checked against lcnc_iface's Protocols by pyright (typings/conformance/
check_fake.py), every command takes exactly the binding's positional
arguments (a missing, extra or keyword argument, or an unknown command, is a
TypeError / AttributeError — test_lcnc_iface.py), `wait_complete` returns an
int, the constants carry the 2.9.4 binding's values (equal to the stub's,
which the native check holds to the binding). The SUB-OPERATION picks the
form as in the binding (emcmodule.cc v2.9.4, VM-I01): auto(AUTO_RUN) needs
its line and only AUTO_RUN takes one, jog takes 3 / 4 / 5 arguments for
JOG_STOP / CONTINUOUS / INCREMENT, an unknown selector (auto, jog, spindle
direction, mode, state, mist, flood) is refused — with the binding's
exception, BEFORE the send is counted. The status fields are DECLARED, not
set: a field a test does not set is absent, so `safe_get` reads it as
unknown — the fake never claims a state.

Keep this pure: stdlib only, no side effects beyond building the module object.
"""
from __future__ import annotations

import sys
import types
from typing import Literal, overload

from lcnc_iface import JointStatus, SpindleDirection, SpindleStatus, ToolRow

#: the 2.9.4 binding's values (read from the installed module; the native
#: check in test_lcnc_iface.py compares them where the binding exists)
CONSTANTS: dict[str, int] = {
    "MODE_MANUAL": 1,
    "MODE_AUTO": 2,
    "MODE_MDI": 3,
    "INTERP_IDLE": 1,
    "INTERP_READING": 2,
    "INTERP_WAITING": 4,
    "INTERP_PAUSED": 3,
    "JOG_STOP": 0,
    "JOG_INCREMENT": 2,
    "JOG_CONTINUOUS": 1,
    "SPINDLE_FORWARD": 1,
    "SPINDLE_REVERSE": -1,
    "SPINDLE_OFF": 0,
    "SPINDLE_INCREASE": 10,
    "SPINDLE_DECREASE": 11,
    "SPINDLE_CONSTANT": 12,
    "AUTO_RUN": 0,
    "AUTO_STEP": 3,
    "AUTO_PAUSE": 1,
    "AUTO_RESUME": 2,
    "AUTO_REVERSE": 4,
    "AUTO_FORWARD": 5,
    "STATE_ON": 4,
    "STATE_OFF": 3,
    "STATE_ESTOP": 1,
    "STATE_ESTOP_RESET": 2,
    "TRAJ_MODE_TELEOP": 3,
    "MIST_ON": 1,
    "MIST_OFF": 0,
    "FLOOD_ON": 1,
    "FLOOD_OFF": 0,
    "RCS_DONE": 1,
    "RCS_EXEC": 2,
    "RCS_ERROR": 3,
    "EXEC_ERROR": 1,
    "EXEC_DONE": 2,
    "KINEMATICS_IDENTITY": 1,
    "KINEMATICS_FORWARD_ONLY": 2,
    "KINEMATICS_INVERSE_ONLY": 3,
    "KINEMATICS_BOTH": 4,
}


class error(RuntimeError):
    """linuxcnc.error — a RuntimeError subclass, as PyInit_linuxcnc builds it."""


class _Absent:
    """An argument the call did not pass (None is a value the binding refuses)."""


_ABSENT = _Absent()
_JOG_ARGS = {0: 3, 1: 4, 2: 5}                  # JOG_STOP / CONTINUOUS / INCREMENT
_JOG_NAMES = {0: "JOG_STOP", 1: "JOG_CONTINUOUS", 2: "JOG_INCREMENT"}
_AUTO_NO_LINE = frozenset({1, 2, 3, 4, 5})      # PAUSE / RESUME / STEP / REVERSE / FORWARD


def _int_arg(value: object) -> int:
    """PyArg_ParseTuple "i": an int (bool included), never a float or None."""
    if not isinstance(value, int):
        raise TypeError(f"'{type(value).__name__}' object cannot be interpreted as an integer")
    return value


def _choice(value: object, allowed: frozenset[int], what: str) -> None:
    if _int_arg(value) not in allowed:
        raise ValueError(f"{what} should be one of {sorted(allowed)}")


class _Stat:
    """stat: poll() is a no-op; every field is declared with the binding's type
    and absent until a test sets it (axis_mask excepted: the viewer_init build
    reads it directly — 7 = XYZ — and the WS-B lifecycle tests assert that
    frame's delivery)."""
    actual_position: tuple[float, ...]
    adaptive_feed_enabled: bool
    angular_units: float
    axis_mask: int = 7
    block_delete: bool
    call_level: int
    current_line: int
    current_vel: float
    dtg: tuple[float, ...]
    echo_serial_number: int
    enabled: bool
    estop: int
    exec_state: int
    feed_hold_enabled: bool
    feed_override_enabled: bool
    feedrate: float
    file: str
    flood: int
    g5x_index: int
    g5x_offset: tuple[float, ...]
    g92_offset: tuple[float, ...]
    gcodes: tuple[int, ...]
    homed: tuple[int, ...]
    ini_filename: str
    inpos: bool
    interp_state: int
    joint: tuple[JointStatus, ...]
    joint_actual_position: tuple[float, ...]
    joint_position: tuple[float, ...]
    joints: int
    kinematics_type: int
    linear_units: float
    max_velocity: float
    mcodes: tuple[int, ...]
    mist: int
    motion_line: int
    motion_mode: int
    optional_stop: bool
    paused: bool
    position: tuple[float, ...]
    probed_position: tuple[float, ...]
    probe_tripped: bool
    probing: bool
    program_units: int
    queued_mdi_commands: int
    rapidrate: float
    read_line: int
    rotation_xy: float
    spindle: tuple[SpindleStatus, ...]
    state: int
    task_mode: int
    task_state: int
    tool_in_spindle: int
    tool_offset: tuple[float, ...]
    tool_table: tuple[ToolRow, ...]

    def poll(self) -> None:
        pass


class _Command:
    """command: the binding's calls, each with its PyArg_ParseTuple shape
    (positional only), each a no-op that counts `serial` like the real
    channel; wait_complete answers `wait_result` (RCS_DONE unless a test sets
    another)."""
    serial: int = 0
    wait_result: int = CONSTANTS["RCS_DONE"]

    def _sent(self) -> None:
        self.serial += 1

    def abort(self) -> None: self._sent()

    @overload
    def auto(self, fn: Literal[0], line: int, /) -> None: ...
    @overload
    def auto(self, fn: Literal[1, 2, 3, 4, 5], /) -> None: ...
    def auto(self, fn: int, line: int | _Absent = _ABSENT, /) -> None:
        # emcauto: "ii" taken only for AUTO_RUN; else "i" (an extra argument is
        # its TypeError), and a selector outside the switch is linuxcnc.error
        if not isinstance(line, _Absent) and _int_arg(fn) == 0:
            _int_arg(line)
        elif not isinstance(line, _Absent):
            raise TypeError("function takes exactly 1 argument (2 given)")
        elif _int_arg(fn) not in _AUTO_NO_LINE:
            raise error(f"Unexpected argument '{fn}' to command.auto")
        self._sent()

    def feedrate(self, scale: float, /) -> None: self._sent()

    def flood(self, on: Literal[0, 1], /) -> None:
        _choice(on, frozenset({0, 1}), "flood")
        self._sent()

    def home(self, joint: int, /) -> None: self._sent()

    @overload
    def jog(self, fn: Literal[0], jjogmode: int, ja_value: int, /) -> None: ...
    @overload
    def jog(self, fn: Literal[1], jjogmode: int, ja_value: int, vel: float, /) -> None: ...
    @overload
    def jog(self, fn: Literal[2], jjogmode: int, ja_value: int, vel: float, inc: float, /) -> None: ...
    def jog(self, fn: int, jjogmode: int, ja_value: int, vel: float | _Absent = _ABSENT,
            inc: float | _Absent = _ABSENT, /) -> None:
        # jog: "iii|dd", then the count the sub-operation needs (PyTuple_Size);
        # every refusal a TypeError
        for v in (fn, jjogmode, ja_value):
            _int_arg(v)
        given = 3 + (not isinstance(vel, _Absent)) + (not isinstance(inc, _Absent))
        need = _JOG_ARGS.get(fn)
        if need is None:
            raise TypeError("jog() first argument must be JOG_xxx")
        if given != need:
            raise TypeError(f"jog({_JOG_NAMES[fn]}, ...) takes {need} arguments ({given} given)")
        self._sent()

    def load_tool_table(self) -> None: self._sent()
    def maxvel(self, velocity: float, /) -> None: self._sent()
    def mdi(self, command: str, /) -> None: self._sent()

    def mist(self, on: Literal[0, 1], /) -> None:
        _choice(on, frozenset({0, 1}), "mist")
        self._sent()

    def mode(self, mode: Literal[1, 2, 3], /) -> None:
        _choice(mode, frozenset({1, 2, 3}), "mode")
        self._sent()

    def program_open(self, path: str, /) -> None: self._sent()
    def rapidrate(self, scale: float, /) -> None: self._sent()
    def reset_interpreter(self) -> None: self._sent()
    def set_block_delete(self, on: int, /) -> None: self._sent()
    def set_optional_stop(self, on: int, /) -> None: self._sent()

    @overload
    def spindle(self, direction: SpindleDirection, /) -> None: ...
    @overload
    def spindle(self, direction: SpindleDirection, spindle: float, /) -> None: ...
    @overload
    def spindle(self, direction: SpindleDirection, speed: float, spindle: float, /) -> None: ...
    @overload
    def spindle(self, direction: SpindleDirection, speed: float, spindle: float, wait: int, /) -> None: ...
    def spindle(self, direction: int, a: float | _Absent = _ABSENT, b: float | _Absent = _ABSENT,
                wait: int | _Absent = _ABSENT, /) -> None:
        # "i|ddi" for every direction; an unknown direction is ValueError
        _choice(direction, frozenset({-1, 0, 1, 10, 11, 12}), "Spindle direction")
        self._sent()

    def spindleoverride(self, scale: float, spindle: int = 0, /) -> None: self._sent()

    def state(self, state: Literal[1, 2, 3, 4], /) -> None:
        _choice(state, frozenset({1, 2, 3, 4}), "state")
        self._sent()

    def task_plan_synch(self) -> None: self._sent()
    def teleop_enable(self, enable: int, /) -> None: self._sent()
    def unhome(self, joint: int, /) -> None: self._sent()

    def wait_complete(self, timeout: float = 5.0, /) -> int:
        return self.wait_result


class _ErrorChannel:
    def poll(self) -> tuple[int, str] | None:
        return None


class _Ini:
    def __init__(self, path: str, /) -> None:
        self.path = path

    def find(self, section: str, option: str, num: int = 1, /) -> str | None:
        return None

    def findall(self, section: str, option: str, /) -> list[str]:
        return []


class _ToolRow:
    """A tool_table row (the binding's `linuxcnc.tool`, named tool_result) —
    for tests that build one."""
    def __init__(self, id: int = 0, zoffset: float = 0.0, diameter: float = 0.0, **offsets: float) -> None:
        self.id, self.zoffset, self.diameter = id, zoffset, diameter
        for k in ("xoffset", "yoffset", "aoffset", "boffset", "coffset", "uoffset", "voffset", "woffset",
                  "frontangle", "backangle"):
            setattr(self, k, float(offsets.get(k, 0.0)))
        self.orientation = int(offsets.get("orientation", 0))

    xoffset: float
    yoffset: float
    aoffset: float
    boffset: float
    coffset: float
    uoffset: float
    voffset: float
    woffset: float
    frontangle: float
    backangle: float
    orientation: int


def build_module() -> types.ModuleType:
    lc = types.ModuleType("linuxcnc")
    members: dict[str, object] = {
        **CONSTANTS, "stat": _Stat, "command": _Command, "error_channel": _ErrorChannel,
        "ini": _Ini, "tool": _ToolRow, "error": error, "__lcnc_fake__": True,
    }
    for name, value in members.items():
        setattr(lc, name, value)
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


# the Protocol types are referenced by the declarations' annotations only
_ = (JointStatus, SpindleStatus, ToolRow)
