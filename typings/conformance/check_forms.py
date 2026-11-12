# pyright: reportUnnecessaryTypeIgnoreComment=error
"""pyright only (never imported): the call FORMS the binding takes, bound to
the sub-operation (package 2a, Codex R354 VM-I01) — on the real binding's
stub, on the interface the code needs and on the tests' fake.

Each refused form carries an ignore naming its rule; this file reports an
UNNECESSARY ignore as an error, so a refused form the type gate accepted again
(an overload widened back to `int`, a selector set grown) turns the gate red.
The forms and their refusals are emcmodule.cc v2.9.4 (emcauto, jog, spindle,
mode, state, mist, flood); the fake's runtime refusals are in
lcnc-gateway/test_lcnc_iface.py."""
import fake_linuxcnc as fake
import linuxcnc

from lcnc_iface import CommandLike


def forms(c: CommandLike) -> None:
    # accepted: each sub-operation in its own form
    c.auto(linuxcnc.AUTO_RUN, 0)
    c.auto(linuxcnc.AUTO_PAUSE)
    c.auto(linuxcnc.AUTO_RESUME)
    c.auto(linuxcnc.AUTO_STEP)
    c.jog(linuxcnc.JOG_STOP, 0, 0)
    c.jog(linuxcnc.JOG_CONTINUOUS, 0, 0, 1.0)
    c.jog(linuxcnc.JOG_INCREMENT, 0, 0, 1.0, 0.1)
    c.spindle(linuxcnc.SPINDLE_OFF)
    c.spindle(linuxcnc.SPINDLE_FORWARD, 1000.0, 0)
    c.spindle(linuxcnc.SPINDLE_REVERSE, 1000.0, 0, 1)
    c.spindle(linuxcnc.SPINDLE_INCREASE, 0)
    c.mode(linuxcnc.MODE_MDI)
    c.state(linuxcnc.STATE_ON)
    c.mist(linuxcnc.MIST_ON)
    c.flood(linuxcnc.FLOOD_OFF)
    # refused: the binding raises before it sends
    c.auto(linuxcnc.AUTO_RUN)  # pyright: ignore[reportArgumentType]
    c.auto(linuxcnc.AUTO_PAUSE, 1)  # pyright: ignore[reportArgumentType]
    c.auto(linuxcnc.AUTO_STEP, 1)  # pyright: ignore[reportArgumentType]
    c.auto(99)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_CONTINUOUS, 0, 0)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_INCREMENT, 0, 0, 1.0)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_STOP, 0, 0, 1.0)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_STOP, 0, 0, 1.0, 0.1)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_CONTINUOUS, 0, 0, 1.0, 0.1)  # pyright: ignore[reportArgumentType]
    c.jog(999, 0, 0)  # pyright: ignore[reportArgumentType]
    c.spindle(7)  # pyright: ignore[reportArgumentType]
    c.mode(0)  # pyright: ignore[reportArgumentType]
    c.state(5)  # pyright: ignore[reportArgumentType]
    c.mist(2)  # pyright: ignore[reportArgumentType]
    c.flood(2)  # pyright: ignore[reportArgumentType]


def run_time_selector(c: CommandLike, fn: int) -> None:
    # a selector known only at run time is not a form: it must be narrowed
    c.jog(fn, 0, 0)  # pyright: ignore[reportArgumentType]
    if fn == linuxcnc.JOG_STOP:
        c.jog(fn, 0, 0)


def stub(c: linuxcnc.command) -> None:
    c.auto(linuxcnc.AUTO_RUN, 0)
    c.jog(linuxcnc.JOG_CONTINUOUS, 0, 0, 1.0)
    c.auto(linuxcnc.AUTO_RUN)  # pyright: ignore[reportArgumentType]
    c.auto(linuxcnc.AUTO_PAUSE, 1)  # pyright: ignore[reportArgumentType]
    c.auto(linuxcnc.AUTO_STEP, 1)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_CONTINUOUS, 0, 0)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_INCREMENT, 0, 0, 1.0)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_STOP, 0, 0, 1.0)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_STOP, 0, 0, 1.0, 0.1)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_CONTINUOUS, 0, 0, 1.0, 0.1)  # pyright: ignore[reportArgumentType]
    c.jog(999, 0, 0)  # pyright: ignore[reportArgumentType]
    c.spindle(7)  # pyright: ignore[reportArgumentType]
    c.mode(0)  # pyright: ignore[reportArgumentType]


def fake_command(c: fake._Command) -> None:
    c.auto(linuxcnc.AUTO_RUN, 0)
    c.jog(linuxcnc.JOG_CONTINUOUS, 0, 0, 1.0)
    c.auto(linuxcnc.AUTO_RUN)  # pyright: ignore[reportArgumentType]
    c.auto(linuxcnc.AUTO_PAUSE, 1)  # pyright: ignore[reportArgumentType]
    c.auto(linuxcnc.AUTO_STEP, 1)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_CONTINUOUS, 0, 0)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_INCREMENT, 0, 0, 1.0)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_STOP, 0, 0, 1.0)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_STOP, 0, 0, 1.0, 0.1)  # pyright: ignore[reportArgumentType]
    c.jog(linuxcnc.JOG_CONTINUOUS, 0, 0, 1.0, 0.1)  # pyright: ignore[reportArgumentType]
    c.jog(999, 0, 0)  # pyright: ignore[reportArgumentType]
    c.spindle(7)  # pyright: ignore[reportArgumentType]
    c.mode(0)  # pyright: ignore[reportArgumentType]
