#!/usr/bin/env python3
"""Feeds the sim_toolsetter realtime component (LCNC Suite sim configs only).

HAL userspace component `sim-toolsetter-feed`, loaded by
hallib/sim_toolsetter.hal. It gives sim_toolsetter the one thing a real tool
setter learns by being touched: the spindle tool's TABLE length (Z offset),
from STAT — the sim's physical length of the tool, so a measurement returns
it.

The PLATE is not fed from here: it is physical, a fixed HAL constant per
profile (`setp sim-toolsetter.0.plate-*` in the profile's core_sim_N.hal).
Reading the WebUI's setting back from the var file lagged the interpreter,
and a measurement right after a change took the old plate (Codex R44
ST-I01). A WebUI setting that differs from the fixed plate now measures
wrong the same way every time — a machine with a mis-set reference.

`enable` is false, with the reason on stderr, when the spindle is empty or
the tool has no positive table length: then nothing trips automatically and
the probe finds nothing, as on a machine without a tool setter (the WebUI's
manual trip keeps working).

The decisions are pure functions (spindle_length, feed_values) so they are
tested without HAL (lcnc-gateway/test_sim_toolsetter.py).
"""
import sys
import time


def spindle_length(spindle_tool, rows):
    """The table Z offset of the spindle tool: `rows` = [(id, z), ...] from
    STAT.tool_table (pocket 0, the spindle, repeats the loaded tool's row).
    None when the spindle is empty or the tool has no row."""
    try:
        want = int(spindle_tool or 0)
    except (TypeError, ValueError):
        return None
    if want <= 0:
        return None
    for tid, z in rows:
        try:
            if int(tid) == want:
                return float(z)
        except (TypeError, ValueError):
            continue
    return None


def feed_values(spindle_tool, rows):
    """(tool_length, enable, why) for the pins. `why` names the state for
    the log: "armed" or what is missing."""
    length = spindle_length(spindle_tool, rows)
    if length is None:
        return 0.0, False, ("no tool in the spindle" if not spindle_tool or int(spindle_tool) <= 0
                            else f"T{int(spindle_tool)} is not in the tool table")
    if length <= 0.0:
        return length, False, f"T{int(spindle_tool)} has no length in the tool table"
    return length, True, "armed"


def main():
    import hal
    import linuxcnc

    comp = hal.component("sim-toolsetter-feed")
    comp.newpin("tool-length", hal.HAL_FLOAT, hal.HAL_OUT)
    comp.newpin("enable", hal.HAL_BIT, hal.HAL_OUT)
    comp.ready()

    stat = linuxcnc.stat()
    last = None
    try:
        while True:
            try:
                stat.poll()
                rows = [(t.id, t.zoffset) for t in list(stat.tool_table)[1:] if t.id > 0]
                spindle = stat.tool_in_spindle
            except linuxcnc.error:
                rows, spindle = [], 0
            length, enable, why = feed_values(spindle, rows)
            comp["tool-length"], comp["enable"] = length, enable
            state = (round(length, 4), enable, why)
            if state != last:
                last = state
                print(f"sim-toolsetter: {why} — T{spindle} length {length:g}", file=sys.stderr, flush=True)
            time.sleep(0.2)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
