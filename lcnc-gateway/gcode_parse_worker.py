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
  feed_seq:    [seq, ...]         global execution-order sequence per point;
               feed and rapid each ascending — merging the two streams on
               seq reconstructs true program order (scrub track, stage 2)
  rapid:       [[x, y, z], ...]   work-coord polyline (rapid moves)
  rapid_lines: [lineno, ...]      parallel line numbers for rapid
  rapid_seq:   [seq, ...]         see feed_seq
  stats:       { feedMoves, rapidMoves, linearMoves, arcMoves, feedDist,
                 rapidDist, linearDist, arcDist, feedTime, rapidTime,
                 totalTime, feedRates, toolChanges, toolsUsed, unit,
                 fileSize }  or None
  bounds:      { min: [x,y,z], max: [x,y,z] }  or None — cut envelope
               (X/Y over feed+rapid, Z over feed only)
  motion_bounds: same shape or None — full feed+rapid envelope (overflow)
  violations:  [{line, axis, value, limit, kind}, ...] per-line soft-limit
               overtravels (all axes incl. rotary, joint-side w/ TLO), capped
               at 200 — or None when the INI has no MIN/MAX_LIMIT to check
               against (unchecked ≠ clean)
  violations_total: distinct (line, axis) violation count before the cap
"""

import math
import os
import shutil
import sys
import tempfile
import time

import msgspec
import numpy as np
import linuxcnc
import gcode

import lcnc_trace as _trace
_trace.init("gcode_parse_worker")

# Ensure local-dir imports resolve when invoked from anywhere
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gcode_canon import PreviewCanon, apply_var_patches
from gateway_util import scan_tool_stats, read_axis_limits, check_limit_violations


_EMPTY = {"feed": [], "feed_lines": [], "rapid": [], "stats": None,
          "violations": None, "violations_total": 0,
          "parse_error": None, "error_line": None}

# RDP decimation tolerance in machine units (mm or in — caller passes the
# scaled epsilon). 0.005 mm is sub-pixel at typical viewport zoom (~0.2
# mm/pixel) and well below the chord error CAM posts emit (typically
# 0.01-0.1 mm). Keeps visual parity while collapsing collinear runs.
_RDP_EPS_MM = 0.005


def _rdp_keep(points, anchors, eps_sq):
    """Iterative RDP that preserves a set of anchor indices.

    points  -- np.ndarray of shape (N, 3), float64
    anchors -- iterable of indices that must be kept (line-number transitions)
    eps_sq  -- squared chord tolerance

    Returns: sorted list of kept indices.
    """
    n = len(points)
    if n <= 2:
        return list(range(n))
    keep = np.zeros(n, dtype=bool)
    keep[0] = True
    keep[-1] = True
    for a in anchors:
        if 0 <= a < n:
            keep[a] = True
    anchor_idx = sorted(np.flatnonzero(keep).tolist())
    for lo, hi in zip(anchor_idx, anchor_idx[1:]):
        if hi - lo < 2:
            continue
        # Iterative RDP between anchors using an explicit stack — Python's
        # default recursion limit (1000) would blow on long anchored spans.
        stack = [(lo, hi)]
        while stack:
            i0, i1 = stack.pop()
            if i1 - i0 < 2:
                continue
            p0 = points[i0]
            p1 = points[i1]
            seg = p1 - p0
            seg_len_sq = float(np.dot(seg, seg))
            interior = points[i0 + 1:i1]
            rel = interior - p0
            if seg_len_sq > 0.0:
                t = (rel @ seg) / seg_len_sq
                np.clip(t, 0.0, 1.0, out=t)
                proj = p0 + t[:, None] * seg
                diff = interior - proj
            else:
                diff = rel
            dist_sq = (diff * diff).sum(axis=1)
            max_idx = int(np.argmax(dist_sq))
            if float(dist_sq[max_idx]) > eps_sq:
                pivot = i0 + 1 + max_idx
                keep[pivot] = True
                stack.append((i0, pivot))
                stack.append((pivot, i1))
    return np.flatnonzero(keep).tolist()

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
    parse_error = None  # set if the interpreter errors partway through
    error_line = None
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
            # The interpreter hit an error partway through. We still return the
            # polyline collected so far, but flag it so the gateway/UI can badge
            # the preview as PARTIAL instead of presenting a truncated path as a
            # complete one (silent partial-success was the bug).
            parse_error = gcode.strerror(result)
            error_line = seq
            # Machine-readable marker so the gateway can raise the structured
            # parse_partial event WITHOUT decoding the (multi-MB) stdout payload.
            print(f"__PARTIAL__\t{seq}\t{parse_error}", file=sys.stderr, flush=True)
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
    # Rotary offsets — subtracted so abc is in raw program coords, symmetric
    # with xyz (frontend re-applies LIVE offsets when evaluating the machine
    # chain for the part-frame preview). Degrees; XY rotation never touches abc.
    oa = canon.g5x_offset_a + canon.g92_offset_a
    ob = canon.g5x_offset_b + canon.g92_offset_b
    oc = canon.g5x_offset_c + canon.g92_offset_c
    # Per-line soft-limit validation (offline dry run stage 1). Runs on the
    # FULL canon segment list — the RDP decimation below can shave up to eps
    # off an extreme excursion, so post-RDP data is not trustworthy for
    # limits. Canon ends are machine-frame (g5x+g92+rotation applied at
    # parse time): exactly the frame soft limits act in. Touch-off after
    # load shifts that frame — the annotations refresh on the next re-parse.
    axis_limits = read_axis_limits(ini.find, s.axis_mask)
    if axis_limits:
        def _limit_segs():
            for _lineno, _start, _end, _rate, _tlo, _seq in canon.feed:
                yield _lineno, _start, _end, _tlo
            for _lineno, _start, _end, _tlo, _seq in canon.rapid:
                yield _lineno, _start, _end, _tlo
        violations, violations_total = check_limit_violations(
            _limit_segs(), axis_limits, unit_scale)
        print(f"limits axes={''.join(sorted(axis_limits))} violations={violations_total}",
              file=sys.stderr, flush=True)
    else:
        # No MIN/MAX_LIMIT anywhere in the INI: unchecked, NOT clean — None
        # (not []) so the UI can say "not validated" instead of implying a pass.
        violations, violations_total = None, 0
        print("limits UNCHECKED — no MIN/MAX_LIMIT in INI", file=sys.stderr, flush=True)

    theta = canon.rotation_xy or 0.0
    if theta:
        rad = math.radians(theta)
        ca = math.cos(rad)
        sa = math.sin(rad)
    else:
        ca = 1.0
        sa = 0.0

    # Rapid velocities from the INI — needed up front for the time axis.
    # Linear: min of AXIS_0..2 MAX_VELOCITY (machine units/s). Rotary: min of
    # AXIS_A/B/C MAX_VELOCITY (deg/s), falling back to the linear rate under
    # the 1° ≙ 1 unit equivalence when absent. No linear velocity at all →
    # no time axis (the client falls back to the distance axis — honest).
    def _ini_vel(section, key):
        _v = ini.find(section, key)
        if not _v:
            return None
        try:
            return float(_v)
        except (ValueError, TypeError):
            return None

    def _min_axis_vel(letters):
        _best = None
        for _axl in letters:
            _fv = _ini_vel(f"AXIS_{_axl}", "MAX_VELOCITY")
            if _fv is not None:
                _best = _fv if _best is None else min(_best, _fv)
        return _best

    # [TRAJ] caps are canonical; per-axis sections next (letter style, then
    # the legacy numbered style — the old numbered-only read left rapidTime
    # silently 0 on joints-style INIs).
    rapid_vel = _ini_vel("TRAJ", "MAX_LINEAR_VELOCITY") \
        or _min_axis_vel(("X", "Y", "Z")) or _min_axis_vel(("0", "1", "2"))
    rot_rapid_vel = _ini_vel("TRAJ", "MAX_ANGULAR_VELOCITY") or _min_axis_vel(("A", "B", "C"))
    time_axis = rapid_vel is not None

    feed = []
    feed_lines = []
    feed_abc = []
    feed_seq = []
    feed_tcum = []
    _ftc = 0.0
    total_feed_dist = 0.0
    total_feed_time = 0.0
    feed_rates = set()
    if theta:
        for lineno, start, end, rate, _tlo, seq in canon.feed:
            dx = end[0] - ox
            dy = end[1] - oy
            feed.append([
                (dx * ca + dy * sa) * unit_scale,
                (-dx * sa + dy * ca) * unit_scale,
                (end[2] - oz) * unit_scale,
            ])
            feed_abc.append([end[3] - oa, end[4] - ob, end[5] - oc])
            feed_lines.append(lineno)
            feed_seq.append(seq)
            sdx = (end[0] - start[0]) * unit_scale
            sdy = (end[1] - start[1]) * unit_scale
            sdz = (end[2] - start[2]) * unit_scale
            dist = (sdx * sdx + sdy * sdy + sdz * sdz) ** 0.5
            total_feed_dist += dist
            if rate > 0:
                # Segment time: F governs the larger of linear distance and
                # rotary sweep (1° ≙ 1 unit — exact for G94 linear moves,
                # honest approximation for rotary/G93).
                _rotd = max(abs(end[3] - start[3]), abs(end[4] - start[4]), abs(end[5] - start[5]))
                _ftc += max(dist, _rotd) / (rate * unit_scale)
                total_feed_time = _ftc
                feed_rates.add(round(rate * unit_scale * 60.0, 1))
            feed_tcum.append(_ftc)
    else:
        for lineno, start, end, rate, _tlo, seq in canon.feed:
            feed.append([(end[0] - ox) * unit_scale, (end[1] - oy) * unit_scale, (end[2] - oz) * unit_scale])
            feed_abc.append([end[3] - oa, end[4] - ob, end[5] - oc])
            feed_lines.append(lineno)
            feed_seq.append(seq)
            dx = (end[0] - start[0]) * unit_scale
            dy = (end[1] - start[1]) * unit_scale
            dz = (end[2] - start[2]) * unit_scale
            dist = (dx * dx + dy * dy + dz * dz) ** 0.5
            total_feed_dist += dist
            if rate > 0:
                _rotd = max(abs(end[3] - start[3]), abs(end[4] - start[4]), abs(end[5] - start[5]))
                _ftc += max(dist, _rotd) / (rate * unit_scale)
                total_feed_time = _ftc
                feed_rates.add(round(rate * unit_scale * 60.0, 1))
            feed_tcum.append(_ftc)

    rapid = []
    rapid_abc = []
    rapid_lines = []
    rapid_seq = []
    rapid_tcum = []
    _rtc = 0.0
    total_rapid_dist = 0.0

    def _rapid_seg_t(dist, start, end):
        # max(linear, rotary) — axes run simultaneously, the slower governs.
        if not time_axis:
            return 0.0
        lin_t = dist / rapid_vel
        rotd = max(abs(end[3] - start[3]), abs(end[4] - start[4]), abs(end[5] - start[5]))
        rot_t = rotd / (rot_rapid_vel if rot_rapid_vel else rapid_vel)
        return max(lin_t, rot_t)

    if theta:
        for lineno, start, end, _tlo, seq in canon.rapid:
            dx = end[0] - ox
            dy = end[1] - oy
            rapid.append([
                (dx * ca + dy * sa) * unit_scale,
                (-dx * sa + dy * ca) * unit_scale,
                (end[2] - oz) * unit_scale,
            ])
            rapid_abc.append([end[3] - oa, end[4] - ob, end[5] - oc])
            rapid_lines.append(lineno)
            rapid_seq.append(seq)
            sdx = (end[0] - start[0]) * unit_scale
            sdy = (end[1] - start[1]) * unit_scale
            sdz = (end[2] - start[2]) * unit_scale
            _d = (sdx * sdx + sdy * sdy + sdz * sdz) ** 0.5
            total_rapid_dist += _d
            _rtc += _rapid_seg_t(_d, start, end)
            rapid_tcum.append(_rtc)
    else:
        for lineno, start, end, _tlo, seq in canon.rapid:
            rapid.append([(end[0] - ox) * unit_scale, (end[1] - oy) * unit_scale, (end[2] - oz) * unit_scale])
            rapid_abc.append([end[3] - oa, end[4] - ob, end[5] - oc])
            rapid_lines.append(lineno)
            rapid_seq.append(seq)
            dx = (end[0] - start[0]) * unit_scale
            dy = (end[1] - start[1]) * unit_scale
            dz = (end[2] - start[2]) * unit_scale
            _d = (dx * dx + dy * dy + dz * dz) ** 0.5
            total_rapid_dist += _d
            _rtc += _rapid_seg_t(_d, start, end)
            rapid_tcum.append(_rtc)

    total_rapid_time = _rtc if time_axis else 0.0

    arc_dist_scaled = canon.arc_dist * unit_scale
    linear_dist = total_feed_dist - arc_dist_scaled
    linear_moves = len(canon.feed) - canon.arc_moves

    # Rotary participation: constant abc (however nonzero) needs no wire data —
    # the frontend's live parent transform poses the whole polyline; only abc
    # DELTAS make "path on part" differ from the programmed polyline.
    _abc_all = feed_abc + rapid_abc
    if _abc_all:
        _abc_np = np.asarray(_abc_all, dtype=np.float64)
        has_rotary = bool(np.ptp(_abc_np, axis=0).max() > 1e-9)
    else:
        has_rotary = False

    # A2: lossless RDP decimation on the rendering polylines. Stats above
    # use the full canon.feed / canon.rapid counts so they remain accurate.
    # eps is in display units (mm or inches) — the polylines are already
    # converted by the unit_scale multiplication above.
    #
    # With rotary motion present, RDP runs in 6D (xyz + abc scaled by
    # _DEG_TO_UNIT) so a straight-XYZ run with a rotary sweep only collapses
    # when the sweep is LINEAR across the run — which is lossless, because the
    # frontend re-subdivides rotary deltas by linear interpolation. _rdp_keep
    # is dimension-agnostic.
    eps = _RDP_EPS_MM if machine_units == "mm" else _RDP_EPS_MM / 25.4
    eps_sq = eps * eps
    deg_to_unit = 1.0 if machine_units == "mm" else 1.0 / 25.4  # 1° ≙ 1 mm
    pre_feed = len(feed)
    pre_rapid = len(rapid)

    def _rdp_points(xyz_list, abc_list):
        pts = np.asarray(xyz_list, dtype=np.float64)
        if has_rotary:
            abc = np.asarray(abc_list, dtype=np.float64) * deg_to_unit
            pts = np.hstack([pts, abc])
        return pts

    if len(feed) > 2:
        # Anchor every index where the source line number changes — that
        # preserves at least one rendered point per source line so the
        # WebUI's run-from-line highlight mapping stays intact.
        anchors = [0]
        for i in range(1, len(feed_lines)):
            if feed_lines[i] != feed_lines[i - 1]:
                anchors.append(i)
        keep = _rdp_keep(_rdp_points(feed, feed_abc), anchors, eps_sq)
        if len(keep) < len(feed):
            feed = [feed[i] for i in keep]
            feed_lines = [feed_lines[i] for i in keep]
            feed_abc = [feed_abc[i] for i in keep]
            feed_seq = [feed_seq[i] for i in keep]
            # CUMULATIVE time — sampling kept indices preserves the dropped
            # interior segments' durations in the next kept point's delta.
            feed_tcum = [feed_tcum[i] for i in keep]
    if len(rapid) > 2:
        keep = _rdp_keep(_rdp_points(rapid, rapid_abc), [0, len(rapid) - 1], eps_sq)
        if len(keep) < len(rapid):
            rapid = [rapid[i] for i in keep]
            rapid_abc = [rapid_abc[i] for i in keep]
            rapid_lines = [rapid_lines[i] for i in keep]
            rapid_seq = [rapid_seq[i] for i in keep]
            rapid_tcum = [rapid_tcum[i] for i in keep]
    print(
        f"rdp feed {pre_feed}->{len(feed)} rapid {pre_rapid}->{len(rapid)} eps={eps:.5f} rotary={has_rotary}",
        file=sys.stderr, flush=True,
    )

    # Bounding boxes over the rendered (post-RDP) polylines, in the same
    # raw-program coords as the points, computed here so the frontend skips an
    # O(n) main-thread scan per load (P4.1). Two boxes with different jobs:
    #
    #   bounds        — the *cut envelope* shown as the toolpath bounds box.
    #                   X/Y span feed + rapid (positioning moves belong to the
    #                   footprint); Z spans feed only, so retract/safe-height
    #                   rapids don't inflate the displayed Z extent.
    #   motion_bounds — the *full* motion envelope (feed + rapid, all axes),
    #                   used for the machine-limit overflow check: a rapid past
    #                   the machine bounds must still flag.
    #
    # `null` when the respective source polylines are empty (a rapid-only
    # program has a motion envelope but no cut envelope).
    bounds = None
    motion_bounds = None
    _mn = [float("inf"), float("inf"), float("inf")]
    _mx = [float("-inf"), float("-inf"), float("-inf")]
    _mmn = [float("inf"), float("inf"), float("inf")]
    _mmx = [float("-inf"), float("-inf"), float("-inf")]
    _any_feed = False
    _any_pt = False
    for _p in feed:
        _any_feed = _any_pt = True
        for _k in range(3):
            if _p[_k] < _mn[_k]:
                _mn[_k] = _p[_k]
            if _p[_k] > _mx[_k]:
                _mx[_k] = _p[_k]
            if _p[_k] < _mmn[_k]:
                _mmn[_k] = _p[_k]
            if _p[_k] > _mmx[_k]:
                _mmx[_k] = _p[_k]
    for _p in rapid:
        _any_pt = True
        for _k in range(2):
            if _p[_k] < _mn[_k]:
                _mn[_k] = _p[_k]
            if _p[_k] > _mx[_k]:
                _mx[_k] = _p[_k]
        for _k in range(3):
            if _p[_k] < _mmn[_k]:
                _mmn[_k] = _p[_k]
            if _p[_k] > _mmx[_k]:
                _mmx[_k] = _p[_k]
    if _any_feed:
        bounds = {"min": _mn, "max": _mx}
    if _any_pt:
        motion_bounds = {"min": _mmn, "max": _mmx}

    try:
        file_size = os.path.getsize(filename)
    except OSError:
        file_size = 0

    # Tool stats need BOTH sources. The interpreter only fires change_tool on
    # an executed M6 — this machine's M600/M601 remap reaches its inner M6 via
    # tool_touch_off.ngc, whose body is skipped in preview (#<_task> guard), so
    # the canon counts 0 for M600 programs. The textual scan sees M6/M600/M601
    # in the program text but can't expand subroutine loops the interpreter
    # does execute. Max/union of the two is the best honest estimate.
    text_changes = 0
    text_tools = set()
    try:
        with open(filename, "r", errors="replace") as f:
            text_changes, text_tools = scan_tool_stats(f.read())
    except OSError as e:
        _trace.emit_exc("gcode.tool_scan_failed", e)

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
        "toolChanges": max(canon.tool_changes, text_changes),
        "toolsUsed": sorted(canon.tools_used | text_tools),
        "unit": machine_units,
        "fileSize": file_size,
    }

    # Flat little-endian binaries for the wire (P4.1 end-state): feed/rapid as
    # float32 xyz triplets, feed_lines as uint32 (msgspec encodes bytes as msgpack
    # bin). vs nested [[x,y,z],...] lists this is ~12 B/point instead of ~28 B
    # (44.5 MB → ~14 MB on a heavy file), gzip/encode/decode get proportionally
    # cheaper at every hop, and the browser worker builds its Float32Array with
    # one memcpy instead of flattening 1M+ per-point JS arrays. Index alignment
    # is unchanged: point i ↔ feed_lines[i] ↔ float offset i*3.
    feed_bin = np.asarray(feed, dtype="<f4").tobytes() if feed else b""
    rapid_bin = np.asarray(rapid, dtype="<f4").tobytes() if rapid else b""
    feed_lines_bin = np.asarray(feed_lines, dtype="<u4").tobytes() if feed_lines else b""
    # Scrub-track ordering (stage 2): global execution-order sequence per point
    # (feed and rapid each sorted, interleaving recoverable by merging on seq)
    # + rapid source lines so the scrub can label rapids like feeds.
    feed_seq_bin = np.asarray(feed_seq, dtype="<u4").tobytes() if feed_seq else b""
    rapid_seq_bin = np.asarray(rapid_seq, dtype="<u4").tobytes() if rapid_seq else b""
    rapid_lines_bin = np.asarray(rapid_lines, dtype="<u4").tobytes() if rapid_lines else b""
    # Time axis (unified timeline phase 1): per-point CUMULATIVE seconds within
    # each stream — the client diffs per stream while merging, so the merged
    # track's cum parameter is program time. Absent when the INI lacks
    # MAX_VELOCITY (time_axis False) — client falls back to the distance axis.
    feed_tcum_bin = np.asarray(feed_tcum, dtype="<f4").tobytes() if (time_axis and feed_tcum) else b""
    rapid_tcum_bin = np.asarray(rapid_tcum, dtype="<f4").tobytes() if (time_axis and rapid_tcum) else b""

    # Include "file" so this dict is the EXACT GET /preview wire shape: the
    # gateway publishes these bytes verbatim (no decode + re-encode), which is
    # what keeps the multi-MB polyline from ever becoming Python objects on the
    # event-loop process (mmw#4 GC pressure).
    result = {"file": filename, "feed": feed_bin, "feed_lines": feed_lines_bin,
              "feed_seq": feed_seq_bin, "rapid_seq": rapid_seq_bin,
              "rapid_lines": rapid_lines_bin,
              "feed_tcum": feed_tcum_bin, "rapid_tcum": rapid_tcum_bin,
              "rapid_rate": rapid_vel, "rot_rapid_rate": rot_rapid_vel,
              "tool_change_lines": [[int(l), int(t)] for l, t in canon.tool_change_events],
              "rapid": rapid_bin, "stats": stats, "bounds": bounds,
              "motion_bounds": motion_bounds,
              "violations": violations, "violations_total": violations_total,
              "parse_error": parse_error, "error_line": error_line}
    if has_rotary:
        # Per-vertex abc (degrees, raw program coords), index-aligned with
        # feed/rapid. Present ONLY when a rotary axis actually sweeps — the
        # frontend uses absence as "programmed preview is already exact".
        result["feed_abc"] = np.asarray(feed_abc, dtype="<f4").tobytes() if feed_abc else b""
        result["rapid_abc"] = np.asarray(rapid_abc, dtype="<f4").tobytes() if rapid_abc else b""
    return result


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
