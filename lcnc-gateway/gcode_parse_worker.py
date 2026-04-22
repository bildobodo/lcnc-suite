#!/usr/bin/env python3
"""Subprocess: parse a G-code file via LinuxCNC's RS274NGC interpreter.

Reads a msgpack context from stdin, writes a msgpack result to stdout.
Isolated from the gateway's event loop by an OS process boundary — the
gateway awaits this process via asyncio.create_subprocess_exec while its
own _heartbeat_loop continues to tick.

Context shape (msgpack dict):
  file:        absolute path to .ngc/.nc
  ini_path:    LinuxCNC INI path (read for RS274NGC.PARAMETER_FILE,
               AXIS_0..2.MAX_VELOCITY, EMCIO.RANDOM_TOOLCHANGER)
  units:       "mm" | "in" (machine linear units)
  var_patches: { "<param_num>": "<float_str>", ... } — rotation patches
               applied to the temp parameter file before parse
  g5x_index:   1..9, live active WCS. Forced into the interpreter via an
               initcode so the preview matches the controller when the
               program doesn't explicitly select a WCS (param 5220 on
               disk is stale — LinuxCNC only writes it at shutdown).

Result shape (msgpack dict):
  feed:        [[x, y, z], ...]   work-coord polyline (feed moves)
  feed_lines:  [lineno, ...]      parallel line numbers for feed
  rapid:       [[x, y, z], ...]   work-coord polyline (rapid moves)
  stats:       { feedMoves, rapidMoves, linearMoves, arcMoves, feedDist,
                 rapidDist, linearDist, arcDist, feedTime, rapidTime,
                 totalTime, feedRates, toolChanges, toolsUsed, unit,
                 fileSize }  or None
"""

import math
import os
import shutil
import sys
import tempfile
import time

import msgspec
import linuxcnc
import gcode

# Ensure local-dir imports resolve when invoked from anywhere
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gcode_canon import PreviewCanon, apply_var_patches


_EMPTY = {"feed": [], "feed_lines": [], "rapid": [], "stats": None}

# g5x_index → RS274 WCS word. Interpreter starts in G54 unless the initcode
# selects another; param 5220 on disk is stale until LinuxCNC shutdown, so
# relying on the var file would produce a preview that doesn't match the
# active WCS the operator is running under.
_WCS_CODES = {
    1: "G54", 2: "G55", 3: "G56", 4: "G57", 5: "G58",
    6: "G59", 7: "G59.1", 8: "G59.2", 9: "G59.3",
}


def parse(ctx: dict) -> dict:
    filename = ctx.get("file") or ""
    ini_path = ctx.get("ini_path")
    machine_units = ctx.get("units", "mm")
    var_patches = ctx.get("var_patches") or {}
    g5x_index = ctx.get("g5x_index")

    if not filename or not os.path.isfile(filename) or not ini_path:
        return _EMPTY

    ini = linuxcnc.ini(ini_path)
    random_tc = int(ini.find("EMCIO", "RANDOM_TOOLCHANGER") or 0)

    # Reader-only STAT — shared memory allows multiple readers; no conflict
    # with the gateway's STAT in the parent process.
    s = linuxcnc.stat()
    s.poll()
    canon = PreviewCanon(s, random_tc)

    parameter = ini.find("RS274NGC", "PARAMETER_FILE")
    td = tempfile.mkdtemp()
    try:
        temp_param = os.path.join(td, os.path.basename(parameter or "linuxcnc.var"))
        if parameter:
            param_path = parameter if os.path.isabs(parameter) else os.path.join(os.path.dirname(ini_path), parameter)
            if os.path.exists(param_path):
                shutil.copy(param_path, temp_param)
        apply_var_patches(temp_param, var_patches)
        canon.parameter_file = temp_param

        unitcode = "G%d" % (20 + (s.linear_units == 1))
        initcodes = [unitcode, "G90"]
        wcs_code = _WCS_CODES.get(g5x_index if isinstance(g5x_index, int) else 0)
        if wcs_code:
            initcodes.append(wcs_code)
        t0 = time.monotonic()
        result, seq = gcode.parse(filename, canon, initcodes, "")
        t1 = time.monotonic()
        if result > gcode.MIN_ERROR:
            print(f"parse error at line {seq}: {gcode.strerror(result)}", file=sys.stderr, flush=True)
        print(f"gcode.parse feed={len(canon.feed)} rapid={len(canon.rapid)} parse_ms={(t1-t0)*1000:.0f}", file=sys.stderr, flush=True)
    finally:
        shutil.rmtree(td, ignore_errors=True)

    # Canon outputs in inches (LinuxCNC internal) in translated+rotated coords.
    # Subtract WCS origin AND un-rotate so the polyline is in raw program
    # coords — frontend re-applies LIVE origin (workOrigin.position) and LIVE
    # rotation (workRotGroup.rotation.z) from STAT. Symmetric with XYZ.
    unit_scale = 25.4 if machine_units == "mm" else 1.0
    ox = canon.g5x_offset_x + canon.g92_offset_x
    oy = canon.g5x_offset_y + canon.g92_offset_y
    oz = canon.g5x_offset_z + canon.g92_offset_z
    theta = canon.rotation_xy or 0.0
    if theta:
        rad = math.radians(theta)
        ca = math.cos(rad)
        sa = math.sin(rad)
    else:
        ca = 1.0
        sa = 0.0

    feed = []
    feed_lines = []
    total_feed_dist = 0.0
    total_feed_time = 0.0
    feed_rates = set()
    if theta:
        for lineno, start, end, rate, _tlo in canon.feed:
            dx = end[0] - ox
            dy = end[1] - oy
            feed.append([
                (dx * ca + dy * sa) * unit_scale,
                (-dx * sa + dy * ca) * unit_scale,
                (end[2] - oz) * unit_scale,
            ])
            feed_lines.append(lineno)
            sdx = (end[0] - start[0]) * unit_scale
            sdy = (end[1] - start[1]) * unit_scale
            sdz = (end[2] - start[2]) * unit_scale
            dist = (sdx * sdx + sdy * sdy + sdz * sdz) ** 0.5
            total_feed_dist += dist
            if rate > 0:
                total_feed_time += dist / (rate * unit_scale)
                feed_rates.add(round(rate * unit_scale * 60.0, 1))
    else:
        for lineno, start, end, rate, _tlo in canon.feed:
            feed.append([(end[0] - ox) * unit_scale, (end[1] - oy) * unit_scale, (end[2] - oz) * unit_scale])
            feed_lines.append(lineno)
            dx = (end[0] - start[0]) * unit_scale
            dy = (end[1] - start[1]) * unit_scale
            dz = (end[2] - start[2]) * unit_scale
            dist = (dx * dx + dy * dy + dz * dz) ** 0.5
            total_feed_dist += dist
            if rate > 0:
                total_feed_time += dist / (rate * unit_scale)
                feed_rates.add(round(rate * unit_scale * 60.0, 1))

    rapid = []
    total_rapid_dist = 0.0
    if theta:
        for _lineno, start, end, _tlo in canon.rapid:
            dx = end[0] - ox
            dy = end[1] - oy
            rapid.append([
                (dx * ca + dy * sa) * unit_scale,
                (-dx * sa + dy * ca) * unit_scale,
                (end[2] - oz) * unit_scale,
            ])
            sdx = (end[0] - start[0]) * unit_scale
            sdy = (end[1] - start[1]) * unit_scale
            sdz = (end[2] - start[2]) * unit_scale
            total_rapid_dist += (sdx * sdx + sdy * sdy + sdz * sdz) ** 0.5
    else:
        for _lineno, start, end, _tlo in canon.rapid:
            rapid.append([(end[0] - ox) * unit_scale, (end[1] - oy) * unit_scale, (end[2] - oz) * unit_scale])
            dx = (end[0] - start[0]) * unit_scale
            dy = (end[1] - start[1]) * unit_scale
            dz = (end[2] - start[2]) * unit_scale
            total_rapid_dist += (dx * dx + dy * dy + dz * dz) ** 0.5

    rapid_vel = None
    try:
        for ax in range(3):
            v = ini.find("AXIS_%d" % ax, "MAX_VELOCITY")
            if v:
                v_scaled = float(v)
                if rapid_vel is None or v_scaled < rapid_vel:
                    rapid_vel = v_scaled
    except (ValueError, TypeError):
        pass
    total_rapid_time = (total_rapid_dist / rapid_vel) if rapid_vel else 0.0

    arc_dist_scaled = canon.arc_dist * unit_scale
    linear_dist = total_feed_dist - arc_dist_scaled
    linear_moves = len(canon.feed) - canon.arc_moves

    try:
        file_size = os.path.getsize(filename)
    except OSError:
        file_size = 0

    stats = {
        "feedMoves": len(canon.feed),
        "rapidMoves": len(canon.rapid),
        "linearMoves": linear_moves,
        "arcMoves": canon.arc_moves,
        "feedDist": round(total_feed_dist, 2),
        "rapidDist": round(total_rapid_dist, 2),
        "linearDist": round(linear_dist, 2),
        "arcDist": round(arc_dist_scaled, 2),
        "feedTime": round(total_feed_time, 1),
        "rapidTime": round(total_rapid_time, 1),
        "totalTime": round(total_feed_time + total_rapid_time, 1),
        "feedRates": sorted(feed_rates),
        "toolChanges": canon.tool_changes,
        "toolsUsed": sorted(canon.tools_used),
        "unit": machine_units,
        "fileSize": file_size,
    }

    return {"feed": feed, "feed_lines": feed_lines, "rapid": rapid, "stats": stats}


def main() -> None:
    t_main = time.monotonic()
    raw = sys.stdin.buffer.read()
    try:
        ctx = msgspec.msgpack.decode(raw)
    except Exception as e:
        print(f"bad context: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        sys.exit(2)
    try:
        result = parse(ctx)
    except Exception as e:
        print(f"parse failed: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        sys.exit(3)
    t_parse_done = time.monotonic()
    out = msgspec.msgpack.encode(result)
    sys.stdout.buffer.write(out)
    sys.stdout.buffer.flush()
    t_end = time.monotonic()
    print(
        f"worker total_ms={(t_end - t_main)*1000:.0f} "
        f"parse_section_ms={(t_parse_done - t_main)*1000:.0f} "
        f"encode_ms={(t_end - t_parse_done)*1000:.0f} "
        f"output={len(out)}B",
        file=sys.stderr, flush=True,
    )


if __name__ == "__main__":
    main()
