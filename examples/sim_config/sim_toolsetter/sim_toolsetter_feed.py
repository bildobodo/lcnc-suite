#!/usr/bin/env python3
"""Feeds the sim_toolsetter realtime component (LCNC Suite sim configs only).

HAL userspace component `sim-toolsetter-feed`, loaded by
hallib/sim_toolsetter.hal. Its pins give sim_toolsetter what a real tool
setter would know by being there:

- the plate: the WebUI's tool setter position, `#3100` / `#3101` / `#3102`
  (G53 X, Y and the plate surface Z) from the var file — re-read when the
  file changes (task persists the parameters on every switch to MDI/AUTO);
- the spindle tool's TABLE length (Z offset), from STAT — the sim's
  physical length of the tool, so a measurement returns it.

`enable` is false, with the reason on stderr, when the plate is unknown, the
spindle is empty or the tool has no positive table length: then nothing
trips automatically and the probe finds nothing, as on a machine without a
tool setter (the WebUI's manual trip keeps working).

The decisions are pure functions (read_params, spindle_length, feed_values)
so they are tested without HAL (lcnc-gateway/test_sim_toolsetter.py).
"""
import os
import sys
import time

PLATE_PARAMS = (3100, 3101, 3102)


def read_params(text, nums=PLATE_PARAMS):
    """{number: value} for the requested numbered parameters in var-file text
    ("<number> <value>" per line); a missing or unparsable one is absent."""
    out = {}
    for line in (text or "").splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        try:
            num, value = int(parts[0]), float(parts[1])
        except ValueError:
            continue
        if num in nums:
            out[num] = value
    return out


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


def feed_values(params, spindle_tool, rows):
    """(plate_x, plate_y, plate_z, tool_length, enable, why) for the pins.
    `why` names the state for the log: "armed" or what is missing."""
    missing = [n for n in PLATE_PARAMS if n not in params]
    length = spindle_length(spindle_tool, rows)
    px, py, pz = (params.get(n, 0.0) for n in PLATE_PARAMS)
    if missing:
        return px, py, pz, length or 0.0, False, "no tool setter position (" + ", ".join(f"#{n}" for n in missing) + ")"
    if length is None:
        return px, py, pz, 0.0, False, ("no tool in the spindle" if not spindle_tool or int(spindle_tool) <= 0
                                        else f"T{int(spindle_tool)} is not in the tool table")
    if length <= 0.0:
        return px, py, pz, length, False, f"T{int(spindle_tool)} has no length in the tool table"
    return px, py, pz, length, True, "armed"


def _param_file(ini_path):
    import linuxcnc
    ini = linuxcnc.ini(ini_path)
    rel = ini.find("RS274NGC", "PARAMETER_FILE")
    if not rel:
        return None
    return rel if os.path.isabs(rel) else os.path.join(os.path.dirname(os.path.abspath(ini_path)), rel)


def main():
    import hal
    import linuxcnc

    comp = hal.component("sim-toolsetter-feed")
    for name in ("plate-x", "plate-y", "plate-z", "tool-length"):
        comp.newpin(name, hal.HAL_FLOAT, hal.HAL_OUT)
    comp.newpin("enable", hal.HAL_BIT, hal.HAL_OUT)
    comp.ready()

    ini_path = os.environ.get("INI_FILE_NAME")
    var_path = _param_file(ini_path) if ini_path else None
    stat = linuxcnc.stat()
    params, var_mtime, last = {}, None, None
    try:
        while True:
            if var_path:
                try:
                    mtime = os.path.getmtime(var_path)
                except OSError:
                    mtime = None
                if mtime != var_mtime:
                    var_mtime = mtime
                    try:
                        with open(var_path, encoding="utf-8", errors="replace") as f:
                            params = read_params(f.read())
                    except OSError:
                        params = {}
            try:
                stat.poll()
                rows = [(t.id, t.zoffset) for t in list(stat.tool_table)[1:] if t.id > 0]
                spindle = stat.tool_in_spindle
            except linuxcnc.error:
                rows, spindle = [], 0
            px, py, pz, length, enable, why = feed_values(params, spindle, rows)
            comp["plate-x"], comp["plate-y"], comp["plate-z"] = px, py, pz
            comp["tool-length"], comp["enable"] = length, enable
            state = (round(px, 4), round(py, 4), round(pz, 4), round(length, 4), enable, why)
            if state != last:
                last = state
                print(f"sim-toolsetter: {why} — plate X{px:g} Y{py:g} Z{pz:g}, "
                      f"T{spindle} length {length:g}", file=sys.stderr, flush=True)
            time.sleep(0.2)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
