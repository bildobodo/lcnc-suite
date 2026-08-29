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
  rapid_ustart: u8 per rapid point (schema 6, only when any set): 1 = the
               point is a suppressed first-move ENDPOINT — the segment into
               it is an unknown path (client brk semantics), the vertex is
               a real commanded pose with 0 s / 0 dist
  feed_cline / rapid_cline: u16 per point (schema 7, only when any span
               attributed): the text-verified UNIQUE main-file call/trigger
               line of the marked sub span the point sits in; 0 = none
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

import json
import math
import os
import shutil
import sys
import tempfile
import time
from itertools import chain

import msgspec
import numpy as np
import linuxcnc
import gcode

import lcnc_trace as _trace
_trace.init("gcode_parse_worker")

# Ensure local-dir imports resolve when invoked from anywhere
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gcode_canon import PreviewCanon, apply_var_patches
from gateway_util import (
    scan_tool_stats, read_axis_limits, check_limit_violations,
    check_limit_violations_world, merge_violation_records,
    wcs_basis_terms, parse_kins_config, kins_type_flags,
    kins_nonidentity_flags, kins_frame_indices, check_limit_violations_trsrn,
    kins_marker_policy, mode_boundary_indices,
    classify_motion_lines, line_trust_flags, resolve_sub_indices,
    attribute_sub_callers, resolve_sub_callers,
    insert_flip_relabels, read_var_wcs_rows, wcs_event_rewritten,
    wcs_rewrite_targets,
    PREVIEW_SCHEMA, should_ship_abc, rotary_sync_initcode,
    rotary_seed_values, seed_kins_events, wcs_offset_flat_from_var,
    find_unmarked_subs, resolve_subroutine_dirs,
)


_EMPTY = {"feed": [], "feed_lines": [], "rapid": [], "stats": None,
          "violations": None, "violations_total": 0,
          "parse_error": None, "error_line": None,
          "preview_schema": PREVIEW_SCHEMA}

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


#: Canonical 9-slot indices whose offsets are LENGTHS (X Y Z … U V W). A B C
#: are angles and never scale with the machine's linear unit.
_LINEAR_OFFSET_SLOTS = frozenset((0, 1, 2, 6, 7, 8))


def _basis_to_machine(vals, unit_scale):
    """Canon offsets (inches) -> machine units, leaving the rotary slots alone."""
    return [v * unit_scale if i in _LINEAR_OFFSET_SLOTS else v
            for i, v in enumerate(vals)]


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
        # Fixture rows as the machine holds them at parse time (the temp copy
        # was just patched with the live table) — the baseline that exposes a
        # program REWRITING its fixtures via G10 L2 (review P2, `rewritten`
        # flag on the wcs_frames wire rows). Read here: the temp dir is gone
        # by extraction time.
        var_wcs_rows = read_var_wcs_rows(temp_param)

        unitcode = "G%d" % (20 + (s.linear_units == 1))
        initcodes = [unitcode, "G90"]
        # Rotary position sync (schema 5): seed the preview interp's rotary
        # pose from the LIVE machine — the same sync task performs at run
        # start. Without it every uncommanded axis sits at program-zero of
        # the active fixture (= the fixture's rotary offset in machine
        # frame; measured: derived A = 19.05° vs machine A = 0 on the TWP
        # config). The G53 move is eaten by the canon's first-move
        # suppression (re-armed at the first real program line), so it
        # seeds position without recording any motion. XYZ deliberately
        # not synced — see rotary_sync_initcode's docstring.
        _rot_sync = rotary_sync_initcode(
            getattr(s, "axis_mask", 0),
            getattr(s, "actual_position", None))
        if _rot_sync:
            initcodes.append(_rot_sync)
        # The seeded values, captured at the same read (W6): stderr snapshot
        # for the gateway's rotary-drift reparse edge — a later run that
        # leaves the rotaries elsewhere makes every uncommanded-rotary
        # segment of this payload stale (the arc-vs-plunge class).
        _rot_seed = rotary_seed_values(
            getattr(s, "axis_mask", 0),
            getattr(s, "actual_position", None))
        wcs_code = _WCS_CODES.get(g5x_index if isinstance(g5x_index, int) else 0)
        if wcs_code:
            initcodes.append(wcs_code)
        # TWP preview state reset (phase 3): the forked TWP remap module
        # mirrors HAL state (twp defined/active, pre-rot) in module globals
        # for the preview interpreter, and the module stays cached in
        # sys.modules across parses — without this hook a previous
        # program's TWP state would leak into the next parse. First parse:
        # the module isn't imported yet (interp init loads it), nothing to
        # reset. Non-TWP configs never import a module named "remap" here.
        _remap_mod = sys.modules.get("remap")
        _reset = getattr(_remap_mod, "webui_preview_reset", None)
        if _reset is not None:
            _reset()
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
    # RS274 order (rotate_and_translate): machine = g5x + Rz(θ)·(program+g92),
    # so the single subtractable origin is g5x + Rz(θ)·g92 — NOT g5x+g92,
    # which mis-places g92 under an active G10 R rotation. Z/rotary are never
    # rotated; plain sums stay exact there.
    unit_scale = 25.4 if machine_units == "mm" else 1.0
    # WHICH basis: the state at PROGRAM START — after the initcodes force the
    # machine's active WCS, before the program's first line. The client re-adds
    # the LIVE active WCS when it renders, so this is the only basis that makes
    # `live + shipped == true machine position`.
    #
    # This used to be the END-OF-PARSE state, which is wrong for every program
    # that ends in M2 (i.e. nearly all of them): M2 resets the interpreter to
    # G54, so a program run in any other WCS rendered displaced by the whole
    # fixture delta — the path shape was right, the whole thing sat at the
    # wrong fixture. Pinned by canon_fixtures.gen.json / test_canon_basis.py,
    # which also pin why "first motion" is NOT the answer.
    _basis = canon.basis_at_start
    if _basis is None:
        # No program line ever ran (empty file, or an error on line 1). Fall
        # back to the end state and say so — never silently.
        _basis = canon.wcs_basis()
        print("wcs basis: no program-start snapshot (no line executed) — "
              "using end-of-parse state", file=sys.stderr, flush=True)
    # NOTE (review P2): the extraction below no longer subtracts THIS basis —
    # each endpoint subtracts its own EPOCH's basis (canon.wcs_events; see the
    # per-epoch block before the extraction loops). basis_at_start remains the
    # wire's `wcs_basis` staleness comparator: it is the state the machine's
    # ACTIVE fixture held at parse time, which is what a touch-off changes.
    # For a program that never switches or rewrites offsets, epoch 0 IS this
    # basis and the shipped coordinates are unchanged.
    # Source text read ONCE — the tool scan and the line-trust
    # classification (W2 P6) reuse it.
    _src_text = ""
    try:
        with open(filename, "r", errors="replace") as f:
            _src_text = f.read()
    except OSError as e:
        _trace.emit_exc("gcode.tool_scan_failed", e)

    # Per-line soft-limit validation (offline dry run stage 1). Runs on the
    # FULL canon segment list — the RDP decimation below can shave up to eps
    # off an extreme excursion, so post-RDP data is not trustworthy for
    # limits. Canon ends are machine-frame (g5x+g92+rotation applied at
    # parse time): exactly the frame soft limits act in. Touch-off after
    # load shifts that frame — the annotations refresh on the next re-parse.
    axis_limits = read_axis_limits(ini.find, s.axis_mask)
    # Switchkins mode resolution (phase 2) — computed here because BOTH the
    # limit check (2c: joint-side for world segments) and the wire mode
    # arrays (2a, further down) consume it. Flags align 1:1 with the
    # pre-RDP canon.feed / canon.rapid lists.
    kins_cfg = None
    feed_types = rapid_types = None
    feed_world = rapid_world = None
    world_unchecked = 0
    relabel_seqs = set()
    flips_unresolved = 0
    flips_carry_spans = 0
    flips_handled = False
    kins_active = False
    live_kins_type = ctx.get("kins_type")
    live_kins_frame = ctx.get("kins_frame")
    if canon.kins_events or live_kins_type not in (None, 0):
        kins_cfg = parse_kins_config(ini.find("KINS", "KINEMATICS"),
                                     ini.findall("HAL", "HALCMD") or [])
        if kins_marker_policy(kins_cfg) == "ignore":
            # Declared kins can't switch (trivkins / no [KINS]): markers
            # are stale noise. Emitting flags anyway would map startup
            # type 0 to "world" (no sparm), pull nearly every segment out
            # of the identity limit check, and ship a meaningless mode
            # track — said once here, then checked as plain identity.
            # (Any WEBUI_TWPFRAME markers are dropped with them.)
            print(f"kins markers={len(canon.kins_events)} IGNORED "
                  f"(declared kinematics "
                  f"{kins_cfg.get('module') if kins_cfg else None} cannot switch)",
                  file=sys.stderr, flush=True)
        else:
            kins_active = True
            # FIFTH freshness input: seed the startup kins state from the
            # live pin (ctx, sampled by the gateway via hal_reader). The
            # 855-unit class: a markerless program run while the machine
            # is PARKED in TOOL kins (the demo's M2 restores G54, not the
            # kins type) used to parse as identity throughout.
            if live_kins_type not in (None, 0):
                canon.kins_events, canon.kins_frames = seed_kins_events(
                    canon.kins_events, canon.kins_frames,
                    live_kins_type, live_kins_frame)
                print(f"kins seeded from live pin: type={live_kins_type} "
                      f"frame={'yes' if canon.kins_frames and canon.kins_frames[0][0] == -1 else 'no'}",
                      file=sys.stderr, flush=True)
    if kins_active or len(canon.wcs_events) > 1:
        # Flip relabels (W8 phantom jump + review P2): a switchkins flip
        # relabels the frame at a stationary pose but the offline interp
        # never resyncs, so the first post-flip canon segment starts at the
        # PRE-flip position — bundling the relabel jump with the real entry
        # move; a WCS-epoch flip (fixture switch / G10 L2 rewrite) likewise
        # needs the pre-flip pose re-expressed under the new epoch's basis.
        # Insert the relabeled start vertices BEFORE anything reads the
        # canon lists: limit subdivision then follows the real entry path,
        # the time/distance stats drop the phantom length, and the wire
        # gains per-point `brk` flags marking the relabel connectors as
        # not-motion. All seqs come back doubled (inserted vertices sit at
        # odd seqs) — kins events, frames, and wcs events re-keyed to
        # match, every strict `<` comparison downstream unaffected. In
        # marker-ignore mode the kins events are dropped here (enforcing
        # the policy) while epoch flips are still handled.
        (canon.feed, canon.rapid, canon.kins_events, canon.kins_frames,
         canon.wcs_events, relabel_seqs, flips_unresolved,
         flips_carry_spans) = insert_flip_relabels(
            canon.feed, canon.rapid,
            canon.kins_events if kins_active else [],
            canon.kins_frames if kins_active else [],
            canon.wcs_events, kins_cfg, unit_scale,
            ustart_seqs=set(canon.unknown_start),
            # Fifth input: the initcode pose is expressed under the LIVE
            # parse-time kins — the k=0 correction converts FROM it.
            start_type=(live_kins_type if (kins_active and
                                           live_kins_type is not None) else 0),
            start_frame=(live_kins_frame if (kins_active and
                                             live_kins_type == 2) else None))
        flips_handled = True
        # Sub-span markers re-key with the same seq doubling (W2 P6) — their
        # strict `<` comparisons must stay aligned with the doubled per-point
        # seqs (inserted relabel vertices at odd seqs resolve consistently).
        canon.sub_events = [(_ev[0] * 2,) + tuple(_ev[1:])
                            for _ev in canon.sub_events]
        if relabel_seqs or flips_unresolved or flips_carry_spans:
            print(f"flips: {len(relabel_seqs)} relabel vertices inserted "
                  f"({len(canon.wcs_events)} wcs epochs), {flips_unresolved} "
                  f"UNRESOLVED (no twin/frame — those keep the raw segment), "
                  f"{flips_carry_spans} segment(s) moved by the relabel carry",
                  file=sys.stderr, flush=True)
    # Unknown-start seqs (W3 P1) in the same seq space as the tuples —
    # doubled iff the relabel pass ran and doubled everything else.
    ustart_seqs = {(_s * 2 if flips_handled else _s) for _s in canon.unknown_start}
    if kins_active:
        # Raw switchkins type per segment — the wire ships these
        # (phase 3: trsrn type 1/TCP and type 2/TOOL have different
        # joint mappings, a world bool cannot carry that). The
        # identity-vs-not split for the limit check below is a
        # property of the kins family, resolved here once.
        feed_types = kins_type_flags([t[5] for t in canon.feed], canon.kins_events)
        rapid_types = kins_type_flags([t[4] for t in canon.rapid], canon.kins_events)
        feed_world = kins_nonidentity_flags(feed_types, kins_cfg)
        rapid_world = kins_nonidentity_flags(rapid_types, kins_cfg)
    _any_world = bool(feed_world and any(feed_world)) or bool(rapid_world and any(rapid_world))
    if axis_limits:
        def _identity_segs():
            # Unknown-start segments yield start=None (W3 P1): the endpoint
            # is a commanded pose reached via an unknown path, so the
            # checkers treat every axis as moved-to instead of skipping the
            # zero-length tuple as "parked".
            for _i, (_lineno, _start, _end, _rate, _tlo, _seq) in enumerate(canon.feed):
                if not (feed_world and feed_world[_i]):
                    yield _lineno, _start, _end, _tlo
            for _i, (_lineno, _start, _end, _tlo, _seq) in enumerate(canon.rapid):
                if not (rapid_world and rapid_world[_i]):
                    yield _lineno, None if _seq in ustart_seqs else _start, _end, _tlo
        violations, violations_total = check_limit_violations(
            _identity_segs(), axis_limits, unit_scale)
        if _any_world and kins_cfg and kins_cfg.get("type") == "xyzacb-trsrn":
            # trsrn non-identity segments: joint-side check through the
            # trsrn twin, per-segment TYPE (1=TCP w/ TLO-in-pivot,
            # 2=TOOL w/ its governing WEBUI_TWPFRAME) — frames resolved
            # by seq exactly like the type markers. Frameless type-2
            # (bare M430) rides the wire as the unchecked count.
            _f_frame = kins_frame_indices([t[5] for t in canon.feed], canon.kins_frames)
            _r_frame = kins_frame_indices([t[4] for t in canon.rapid], canon.kins_frames)
            _frames = [(f[1], f[2], f[3]) for f in canon.kins_frames]

            def _trsrn_segs():
                for _i, (_lineno, _start, _end, _rate, _tlo, _seq) in enumerate(canon.feed):
                    if feed_world and feed_world[_i]:
                        _fi = _f_frame[_i]
                        yield (_lineno, _start, _end, _tlo, feed_types[_i],
                               _frames[_fi] if _fi is not None else None)
                for _i, (_lineno, _start, _end, _tlo, _seq) in enumerate(canon.rapid):
                    if rapid_world and rapid_world[_i]:
                        _fi = _r_frame[_i]
                        yield (_lineno, None if _seq in ustart_seqs else _start,
                               _end, _tlo, rapid_types[_i],
                               _frames[_fi] if _fi is not None else None)
            w_records, w_total, world_unchecked = check_limit_violations_trsrn(
                _trsrn_segs(), axis_limits, kins_cfg, unit_scale)
            if world_unchecked:
                print(f"limits: {world_unchecked} type-2 segments UNCHECKED "
                      f"(no TWP frame marker — bare M430?)",
                      file=sys.stderr, flush=True)
            violations, _merged_total = merge_violation_records(violations, w_records)
            violations_total = max(_merged_total, violations_total, w_total)
        elif _any_world:
            # World-mode segments: joint-side check through the kins twin
            # (subdivided — the joint path between world endpoints is
            # nonlinear; endpoint checks miss the phase-0 -22.36 class).
            def _world_segs():
                for _i, (_lineno, _start, _end, _rate, _tlo, _seq) in enumerate(canon.feed):
                    if feed_world and feed_world[_i]:
                        yield _lineno, _start, _end, _tlo
                for _i, (_lineno, _start, _end, _tlo, _seq) in enumerate(canon.rapid):
                    if rapid_world and rapid_world[_i]:
                        yield _lineno, None if _seq in ustart_seqs else _start, _end, _tlo
            w_records, w_total = check_limit_violations_world(
                _world_segs(), axis_limits, kins_cfg, unit_scale)
            if w_records is None:
                # No twin for the declared kins: those segments are
                # UNCHECKED — carried on the wire as an explicit count
                # (the UI must say "not validated", never imply a pass)
                # and said loudly here too.
                world_unchecked = w_total
                print(f"limits: {w_total} world-mode segments UNCHECKED "
                      f"(no kins twin for {kins_cfg.get('type') if kins_cfg else None})",
                      file=sys.stderr, flush=True)
            else:
                violations, _merged_total = merge_violation_records(violations, w_records)
                # Truncation-safe total: the merge only sees capped lists.
                violations_total = max(_merged_total, violations_total, w_total)
        print(f"limits axes={''.join(sorted(axis_limits))} violations={violations_total}"
              + (f" (world-checked)" if _any_world else ""),
              file=sys.stderr, flush=True)
    else:
        # No MIN/MAX_LIMIT anywhere in the INI: unchecked, NOT clean — None
        # (not []) so the UI can say "not validated" instead of implying a pass.
        violations, violations_total = None, 0
        print("limits UNCHECKED — no MIN/MAX_LIMIT in INI", file=sys.stderr, flush=True)

    # Per-epoch subtraction terms (review P2 — the metre-off TWP preview):
    # every endpoint subtracts ITS OWN epoch's basis instead of one
    # program-start basis, so a program cutting in several fixtures — or one
    # that G10-rewrites its fixture mid-run, which is the NORMAL TWP path
    # (G53.x writes the plane origin into G59) — ships every section in that
    # section's own program frame. The client re-adds each epoch's live
    # fixture row (or the parse snapshot for program-rewritten epochs). The
    # terms are exactly what rotate_and_translate applied to each segment:
    # canon.wcs_events snapshots the basis at every change, sampled in the
    # same _next_seq call that stamps the segment. Single-epoch programs
    # produce coordinates identical to the old single-basis path.
    _ep = []
    for _ev in canon.wcs_events:
        _et = wcs_basis_terms(_ev[2])
        _erad = math.radians(_et[6]) if _et[6] else 0.0
        _ep.append((_et[0], _et[1], _et[2], _et[3], _et[4], _et[5],
                    math.cos(_erad), math.sin(_erad)))
    feed_epoch = kins_frame_indices([t[5] for t in canon.feed], canon.wcs_events)
    rapid_epoch = kins_frame_indices([t[4] for t in canon.rapid], canon.wcs_events)

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
    for i, (lineno, start, end, rate, _tlo, seq) in enumerate(canon.feed):
        e = _ep[feed_epoch[i]]
        dx = end[0] - e[0]
        dy = end[1] - e[1]
        feed.append([
            (dx * e[6] + dy * e[7]) * unit_scale,
            (-dx * e[7] + dy * e[6]) * unit_scale,
            (end[2] - e[2]) * unit_scale,
        ])
        feed_abc.append([end[3] - e[3], end[4] - e[4], end[5] - e[5]])
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

    for i, (lineno, start, end, _tlo, seq) in enumerate(canon.rapid):
        e = _ep[rapid_epoch[i]]
        dx = end[0] - e[0]
        dy = end[1] - e[1]
        rapid.append([
            (dx * e[6] + dy * e[7]) * unit_scale,
            (-dx * e[7] + dy * e[6]) * unit_scale,
            (end[2] - e[2]) * unit_scale,
        ])
        rapid_abc.append([end[3] - e[3], end[4] - e[4], end[5] - e[5]])
        rapid_lines.append(lineno)
        rapid_seq.append(seq)
        sdx = (end[0] - start[0]) * unit_scale
        sdy = (end[1] - start[1]) * unit_scale
        sdz = (end[2] - start[2]) * unit_scale
        _d = (sdx * sdx + sdy * sdy + sdz * sdz) ** 0.5
        total_rapid_dist += _d
        _rtc += _rapid_seg_t(_d, start, end)
        rapid_tcum.append(_rtc)

    total_rapid_time = _rtc if time_axis else 0.0

    # Flip relabel flags for the wire (W8 phantom jump + review P2 epochs).
    # brk[i]=1 means the segment INTO point i is a frame relabel — zero
    # machine motion — inserted by insert_flip_relabels (always into the
    # rapid stream). Shipped whenever the insertion pass ran, zeros
    # included, so the client can tell "flips handled" from a legacy
    # payload.
    rapid_brk = None
    if flips_handled:
        rapid_brk = [1 if s in relabel_seqs else 0 for s in rapid_seq]

    # Unknown-start flags (W3 P1): ustart[i]=1 means point i is a suppressed
    # first-move ENDPOINT — the machine reaches it via a path no parse can
    # know (program start, post-M6 excursion, post-G43 shift). The client
    # unions these into brk (never draw/sweep/time across the connector)
    # while keeping the channel distinct (relabel = stationary, ustart =
    # unknown motion). Present only when the program has suppressed moves —
    # absence under schema >= 6 means "none", not "legacy".
    rapid_ustart = None
    if ustart_seqs:
        rapid_ustart = [1 if s in ustart_seqs else 0 for s in rapid_seq]

    # Kins mode (TCP+TWP phase 2a, raw types since phase 3): per-segment
    # switchkins TYPE from the `(WEBUI_KINSTYPE=n)` markers, resolved
    # above at the limit-check site (aligned 1:1 with the pre-RDP canon
    # lists, which these extraction lists mirror). Present ONLY when
    # markers were seen — absent = no mode data (untracked ≠ identity),
    # so ordinary programs pay zero wire cost and the client never
    # guesses. The client maps type → world/identity per the declared
    # kins family (worldModeForType / TrsrnKins mode selection).
    feed_mode = feed_types
    rapid_mode = rapid_types
    if canon.kins_events:
        print(f"kins markers={len(canon.kins_events)} "
              f"frames={len(canon.kins_frames)} "
              f"nonidentity_feed={sum(feed_world or [])}/{len(feed_mode or [])} "
              f"nonidentity_rapid={sum(rapid_world or [])}/{len(rapid_mode or [])}",
              file=sys.stderr, flush=True)

    arc_dist_scaled = canon.arc_dist * unit_scale
    linear_dist = total_feed_dist - arc_dist_scaled
    linear_moves = len(canon.feed) - canon.arc_moves

    # abc ship condition (W2 P3): per-vertex A/B/C must ride the wire
    # whenever the tool-vs-work POSE depends on it — not only when a rotary
    # sweeps. The TWP defect this replaces: the tilt lived in fixture ROTARY
    # OFFSETS + kins markers while canon abc stayed constant; the old
    # peeled-sweep test said "no rotary", abc never shipped, and the client
    # drew the plane flat in XY and posed the sim head at B0/C0.
    # should_ship_abc (gateway_util, truth-table tested) ORs: kins markers
    # present, any RAW canon rotary ≠ 0 (the peel subtracts fixture offsets
    # — exactly the case being fixed — so raw endpoints are the honest
    # input), any peeled-stream variation (fixture rotary offsets can
    # differ across epochs even with raw abc ≡ 0).
    _abc_all = feed_abc + rapid_abc
    ship_abc = should_ship_abc(
        bool(canon.kins_events),
        chain(((t[2][3], t[2][4], t[2][5]) for t in canon.feed),
              ((t[2][3], t[2][4], t[2][5]) for t in canon.rapid)),
        _abc_all)

    # A2: lossless RDP decimation on the rendering polylines. Stats above
    # use the full canon.feed / canon.rapid counts so they remain accurate.
    # eps is in display units (mm or inches) — the polylines are already
    # converted by the unit_scale multiplication above.
    #
    # Whenever abc ships, RDP runs in 6D (xyz + abc scaled by deg_to_unit)
    # so a straight-XYZ run with a rotary sweep only collapses when the
    # sweep is LINEAR across the run — which is lossless, because the
    # frontend re-subdivides rotary deltas by linear interpolation.
    # Constant abc columns contribute zero deviation, so the 6D pass on a
    # constant-tilt program decimates exactly like the 3D pass. _rdp_keep
    # is dimension-agnostic.
    eps = _RDP_EPS_MM if machine_units == "mm" else _RDP_EPS_MM / 25.4
    eps_sq = eps * eps
    deg_to_unit = 1.0 if machine_units == "mm" else 1.0 / 25.4  # 1° ≙ 1 mm
    pre_feed = len(feed)
    pre_rapid = len(rapid)

    def _rdp_points(xyz_list, abc_list):
        pts = np.asarray(xyz_list, dtype=np.float64)
        if ship_abc:
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
        # Mode boundaries must survive decimation — a straight run crossing
        # a kins switch would otherwise collapse into one mixed segment
        # (both flip vertices: see mode_boundary_indices).
        if feed_mode:
            anchors = sorted(set(anchors) | mode_boundary_indices(feed_mode))
        if relabel_seqs:
            # A relabel vertex's exec-order predecessor (seq+1 = the inserted
            # vertex) must survive too: dropping it would extend the brk
            # connector backwards over REAL motion. Frame-only flips share a
            # mode, so mode_boundary_indices alone cannot anchor these.
            anchors = sorted(set(anchors)
                             | {i for i, s in enumerate(feed_seq) if s + 1 in relabel_seqs})
        keep = _rdp_keep(_rdp_points(feed, feed_abc), anchors, eps_sq)
        if len(keep) < len(feed):
            feed = [feed[i] for i in keep]
            feed_lines = [feed_lines[i] for i in keep]
            feed_abc = [feed_abc[i] for i in keep]
            feed_seq = [feed_seq[i] for i in keep]
            if feed_mode:
                feed_mode = [feed_mode[i] for i in keep]
            # CUMULATIVE time — sampling kept indices preserves the dropped
            # interior segments' durations in the next kept point's delta.
            feed_tcum = [feed_tcum[i] for i in keep]
    if len(rapid) > 2:
        r_anchors = [0, len(rapid) - 1]
        if rapid_mode:
            r_anchors = sorted(set(r_anchors) | mode_boundary_indices(rapid_mode))
        if relabel_seqs:
            # Relabel vertices AND their in-stream predecessors (see the feed
            # anchor note): a dropped relabel vertex loses the brk flag; a
            # dropped predecessor stretches the brk connector over real motion.
            r_anchors = sorted(set(r_anchors)
                               | {i for i, s in enumerate(rapid_seq)
                                  if s in relabel_seqs or s + 1 in relabel_seqs})
        if ustart_seqs:
            # Unknown-start vertices are ZERO-LENGTH (collinear by
            # construction — plain RDP would silently drop them) and their
            # in-stream predecessors bound the unknown connector; anchor
            # both, same reasoning as the relabel anchors above.
            _u_idx = {i for i, s in enumerate(rapid_seq) if s in ustart_seqs}
            r_anchors = sorted(set(r_anchors) | _u_idx
                               | {i - 1 for i in _u_idx if i > 0})
        keep = _rdp_keep(_rdp_points(rapid, rapid_abc), r_anchors, eps_sq)
        if len(keep) < len(rapid):
            rapid = [rapid[i] for i in keep]
            rapid_abc = [rapid_abc[i] for i in keep]
            rapid_lines = [rapid_lines[i] for i in keep]
            rapid_seq = [rapid_seq[i] for i in keep]
            rapid_tcum = [rapid_tcum[i] for i in keep]
            if rapid_mode:
                rapid_mode = [rapid_mode[i] for i in keep]
            if rapid_brk:
                rapid_brk = [rapid_brk[i] for i in keep]
            if rapid_ustart:
                rapid_ustart = [rapid_ustart[i] for i in keep]
    print(
        f"rdp feed {pre_feed}->{len(feed)} rapid {pre_rapid}->{len(rapid)} eps={eps:.5f} ship_abc={ship_abc}",
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
    if _src_text:   # read once, further up (rotary-rebase command scan)
        text_changes, text_tools = scan_tool_stats(_src_text)

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

    # Per-point line trust (W2 P6): a point trusts its line number iff the
    # line exists in THIS file, can move the machine, its classified motion
    # kind is compatible with the stream the point sits in
    # (classify_motion_lines / line_trust_flags), AND the point is not
    # inside a marked `(WEBUI_SUB=…)` span — motion executed in a called
    # sub or remap carries THAT file's line numbers, which collide with the
    # main program's (see gateway_util.check_line_attribution for why the
    # number itself is unfixable). Computed on the SHIPPED (post-RDP)
    # lists: trust is a pure per-point function of (line, seq, stream), so
    # decimation commutes with it. Wholesale `lines_untrusted` — the run
    # highlight's kill switch — now means NO shipped point trusts; a main
    # program that calls subs keeps its own lines highlightable (pre-
    # schema-4 payloads disabled the whole highlight instead).
    _line_cls = classify_motion_lines(_src_text)
    feed_lineok = line_trust_flags(feed_lines, _line_cls, False)
    rapid_lineok = line_trust_flags(rapid_lines, _line_cls, True)
    sub_names = []
    feed_sub = rapid_sub = None
    feed_cline = rapid_cline = None
    if canon.sub_events:
        for _ev in canon.sub_events:
            _nm = _ev[1]
            if _nm is not None and _nm not in sub_names:
                sub_names.append(_nm)
        sub_names = sub_names[:254]   # u8 channel; 0xff = "no sub"
        _nm_index = {nm: i for i, nm in enumerate(sub_names)}
        feed_sub = resolve_sub_indices(feed_seq, canon.sub_events, _nm_index)
        rapid_sub = resolve_sub_indices(rapid_seq, canon.sub_events, _nm_index)
        # Call-site line attribution (W4): a span whose UNIQUE main-file
        # call/trigger line text-verifies stamps its points with that line
        # (u16 wire channel, 0 = none) so the text-panel highlight tracks
        # the o-call/remap line instead of going dark. Unattributed spans
        # keep the chip-only display — noted, never guessed. Lines beyond
        # the u16 range make no claim (same honest degradation).
        _caller_map, _unattributed = attribute_sub_callers(
            canon.sub_events, _src_text)
        if _caller_map:
            feed_cline = [c if 0 < c <= 0xffff else 0 for c in
                          resolve_sub_callers(feed_seq, canon.sub_events,
                                              _caller_map)]
            rapid_cline = [c if 0 < c <= 0xffff else 0 for c in
                           resolve_sub_callers(rapid_seq, canon.sub_events,
                                               _caller_map)]
        if _unattributed:
            print(f"call-site attribution: no unique main-file site for "
                  f"{_unattributed} — those spans keep chip-only display",
                  file=sys.stderr, flush=True)
        feed_lineok = [0 if sb != 0xff else ok
                       for ok, sb in zip(feed_lineok, feed_sub)]
        rapid_lineok = [0 if sb != 0xff else ok
                        for ok, sb in zip(rapid_lineok, rapid_sub)]
    _n_pts = len(feed_lineok) + len(rapid_lineok)
    _n_ok = sum(feed_lineok) + sum(rapid_lineok)
    lines_untrusted = _n_pts > 0 and _n_ok == 0
    lines_untrusted_reason = "" if not lines_untrusted else (
        "no motion point attributes to a line of this file that could have "
        "produced it — the motion runs in called subroutines or remaps "
        "whose line numbers collide with this file's")
    if _n_pts and _n_ok < _n_pts:
        print(f"line trust: {_n_ok}/{_n_pts} shipped points trust their "
              f"line (marked subs: {sub_names or 'none'})",
              file=sys.stderr, flush=True)

    # Unmarked-sub advisory (W3 P5): external o-calls whose files carry no
    # WEBUI_SUB marker — their motion's line numbers collide with the main
    # file's and can false-positively trust. File-level hint only, no
    # per-point reattribution (markers remain the only trust mechanism).
    unmarked_subs = []
    if _src_text:
        unmarked_subs = find_unmarked_subs(
            _src_text,
            resolve_subroutine_dirs(ini.find("RS274NGC", "SUBROUTINE_PATH"),
                                    ini_path))
        if unmarked_subs:
            print(f"unmarked subs: {unmarked_subs} — line highlight may be "
                  f"unreliable during their motion (add WEBUI_SUB markers)",
                  file=sys.stderr, flush=True)

    # Include "file" so this dict is the EXACT GET /preview wire shape: the
    # gateway publishes these bytes verbatim (no decode + re-encode), which is
    # what keeps the multi-MB polyline from ever becoming Python objects on the
    # event-loop process (mmw#4 GC pressure).

    # Parse-time TLO snapshot (W2 P4): the tool-table rows this parse baked
    # into its per-line limit flags (canon TLO modeling reads s.tool_table),
    # for the tools the program touches plus the spindle tool. Rides the
    # payload as `parse_tlos` (client staleness hint) AND stderr as a
    # `__TLO__` line (the gateway's drift edge — the payload bytes are
    # passthrough and never decoded there). table_mtime anchors the broad
    # drift signal: any re-measure writes the file (G10 L1 saves through).
    _tlo_tools = set(int(t) for t in canon.tools_used)
    _spindle_tool = int(getattr(s, "tool_in_spindle", 0) or 0)
    if _spindle_tool > 0:
        _tlo_tools.add(_spindle_tool)
    parse_tlos = []
    _tlo_seen = set()
    for _t in (getattr(s, "tool_table", None) or []):
        _tid = int(getattr(_t, "id", -1))
        # Dedupe by id: with a non-random toolchanger the spindle pocket
        # (index 0) repeats the loaded tool's id alongside its home pocket.
        if _tid > 0 and _tid in _tlo_tools and _tid not in _tlo_seen:
            _tlo_seen.add(_tid)
            parse_tlos.append([_tid, float(_t.xoffset), float(_t.yoffset),
                               float(_t.zoffset)])
    _tt_file = ini.find("EMCIO", "TOOL_TABLE")
    _tt_path = None
    _tt_mtime = None
    if _tt_file:
        _tt_path = os.path.normpath(os.path.join(
            os.path.dirname(os.path.abspath(ini_path)),
            os.path.expanduser(_tt_file)))
        try:
            _tt_mtime = os.path.getmtime(_tt_path)
        except OSError:
            _tt_mtime = None   # honest None — the drift edge skips mtime then
    print("__TLO__\t" + json.dumps(
        {"table_path": _tt_path, "table_mtime": _tt_mtime, "tlos": parse_tlos}),
        file=sys.stderr, flush=True)
    if _rot_seed is not None:
        # Rotary pose this parse was seeded with (W6) — the gateway's
        # drift edge. Absent line = no rotary sync (3-axis config).
        print("__ABCSEED__\t" + json.dumps(_rot_seed),
              file=sys.stderr, flush=True)
    # Switchkins state this parse ASSUMED (fifth freshness input): the ctx
    # values verbatim — None type on untracked configs, where the drift
    # edge then makes no claim. (kins_marker_policy gating in the gateway
    # means a type can only arrive on configs whose kins can switch.)
    print("__KINSSEED__\t" + json.dumps(
        {"type": live_kins_type, "frame": live_kins_frame}),
        file=sys.stderr, flush=True)
    # WCS offsets this parse baked (abc peel + soft-limit flags): the
    # gateway's offset-drift edge reparses when a touch-off moves them
    # with no pose change — the rotary Zero-All double-count class, and
    # the stale-soft-limit-flags-after-touch-off class. Absent line =
    # unreadable var rows (no claim).
    _wcs_off = wcs_offset_flat_from_var(
        var_wcs_rows, getattr(s, "g92_offset", None))
    if _wcs_off is not None:
        print("__WCSOFF__\t" + json.dumps(_wcs_off),
              file=sys.stderr, flush=True)

    result = {"file": filename,
              # Parse-time tool-table rows [[tool, xo, yo, zo]…] for the
              # tools involved (W2 P4) — lets the client say "parsed with a
              # different T3 length" while a run is holding off the
              # gateway's idle-gated auto-reparse. Machine units.
              "parse_tlos": parse_tlos,
              # Wire-format generation (P1): the client banners an absent or
              # different stamp (EXPECTED_PREVIEW_SCHEMA) and offers Reparse;
              # the gateway poller auto-reparses on mismatch with its own
              # imported constant. Read fresh from gateway_util at every spawn
              # — this subprocess always reflects the code on disk, which is
              # exactly what makes a stale long-lived gateway detectable.
              "preview_schema": PREVIEW_SCHEMA,
              "feed": feed_bin, "feed_lines": feed_lines_bin,
              "feed_seq": feed_seq_bin, "rapid_seq": rapid_seq_bin,
              "rapid_lines": rapid_lines_bin,
              "feed_tcum": feed_tcum_bin, "rapid_tcum": rapid_tcum_bin,
              "rapid_rate": rapid_vel, "rot_rapid_rate": rot_rapid_vel,
              "tool_change_lines": [[int(l), int(t)] for l, t in canon.tool_change_events],
              "rapid": rapid_bin, "stats": stats, "bounds": bounds,
              "motion_bounds": motion_bounds,
              "violations": violations, "violations_total": violations_total,
              # Whether the per-point line numbers actually index THIS file.
              # A program that calls an external subroutine or a remap gets
              # motion tagged with that file's line numbers, which collide with
              # the main program's. Unfixable (see check_line_attribution), but
              # detectable — and a wrong highlight is worse than none.
              "lines_untrusted": lines_untrusted,
              "lines_untrusted_reason": lines_untrusted_reason,
              # Which WCS this preview is expressed relative to, and which
              # fixtures the program actually cut in (W5d). `wcs_basis_index`
              # is the active WCS the parse was forced into — the one the
              # client re-adds; anything in `wcs_used` that differs from it is
              # a fixture the program moves to but the operator's DRO does not
              # read. Authoritative (sampled at motion), replacing a regex over
              # the first 8 KB of source that saw only the first WCS word.
              "wcs_basis_index": g5x_index if isinstance(g5x_index, int) else None,
              "wcs_used": list(canon.wcs_used),
              # The offsets this preview was actually parsed against, in MACHINE
              # units so the client can compare them straight against the live
              # status values. Differing means the preview is STALE — a touch-off
              # after load — and the client can say so and offer a re-parse
              # instead of the operator wondering why the path moved.
              "wcs_basis": {
                  "g5x": _basis_to_machine(_basis[0], unit_scale),
                  "g92": _basis_to_machine(_basis[1], unit_scale),
                  "rotation": _basis[2],
              },
              "parse_error": parse_error, "error_line": error_line}
    if ship_abc:
        # Per-vertex abc (degrees, per-epoch-peeled program coords),
        # index-aligned with feed/rapid. Present whenever abc is NEEDED to
        # pose tool-vs-work (should_ship_abc, W2 P3): a rotary sweeps, raw
        # abc ≠ 0 anywhere (a constant tilt — the per-epoch peel can zero
        # it), or switchkins markers are present. Absence still means
        # "programmed preview is already exact".
        result["feed_abc"] = np.asarray(feed_abc, dtype="<f4").tobytes() if feed_abc else b""
        result["rapid_abc"] = np.asarray(rapid_abc, dtype="<f4").tobytes() if rapid_abc else b""
    if _n_pts:
        # Per-point line trust (W2 P6), u8 0/1, index-aligned with
        # feed/rapid — which points may drive the text-panel highlight.
        result["feed_lineok"] = np.asarray(feed_lineok, dtype="<u1").tobytes() if feed_lineok else b""
        result["rapid_lineok"] = np.asarray(rapid_lineok, dtype="<u1").tobytes() if rapid_lineok else b""
    if feed_sub is not None:
        # Marked-subroutine membership (W2 P6): u8 index into sub_names,
        # 0xff = not in a marked sub — lets the UI say "in subroutine
        # (name)" instead of highlighting a colliding main-file line.
        # Present only when `(WEBUI_SUB=…)` markers executed.
        result["feed_sub"] = np.asarray(feed_sub, dtype="<u1").tobytes() if feed_sub else b""
        result["rapid_sub"] = np.asarray(rapid_sub, dtype="<u1").tobytes() if rapid_sub else b""
        result["sub_names"] = sub_names
    if feed_cline is not None:
        # Call-site attribution (W4, schema 7): u16 main-file line per
        # point, 0 = none. Present only when some span attributed.
        result["feed_cline"] = np.asarray(feed_cline, dtype="<u2").tobytes() if feed_cline else b""
        result["rapid_cline"] = np.asarray(rapid_cline, dtype="<u2").tobytes() if rapid_cline else b""
    if feed_mode is not None:
        # Per-vertex RAW switchkins type (u8), index-aligned with
        # feed/rapid — present ONLY when the program carried switchkins
        # markers (absence = no mode data, not "all identity"). Renamed
        # from the phase-2 feed_mode/rapid_mode world bools: a client
        # that predates the rename sees no mode field and degrades to
        # the honest "untracked" path instead of misreading types.
        result["feed_kinstype"] = np.asarray(feed_mode, dtype="<u1").tobytes() if feed_mode else b""
        result["rapid_kinstype"] = np.asarray(rapid_mode, dtype="<u1").tobytes() if rapid_mode else b""
        if canon.kins_frames:
            # TWP plane frames, execution-ordered: [seq, pre_rot_rad,
            # primary_deg, secondary_deg] — a frame at seq N governs
            # type-2 segments with seq > N (same convention as the type
            # markers). A handful per program, so a plain list rides the
            # msgpack wire; per-vertex resolution happens client-side.
            result["kins_frames"] = [
                [int(s), float(p), float(t1), float(t2)]
                for s, p, t1, t2 in canon.kins_frames]
    if rapid_brk is not None:
        # Flip relabel flags (u8), index-aligned with rapid: brk[i]=1 ⇒ the
        # segment INTO point i is a frame relabel at a stationary pose
        # (insert_flip_relabels — kins flips AND WCS-epoch flips), zero
        # machine motion — the client must never draw, sweep, time, or lerp
        # across it. Present (zeros included) whenever the insertion pass
        # ran, so absence identifies a legacy payload whose flip segments
        # still carry the raw phantom.
        result["rapid_brk"] = np.asarray(rapid_brk, dtype="<u1").tobytes() if rapid_brk else b""
    if rapid_ustart is not None:
        # Unknown-start flags (u8, W3 P1), index-aligned with rapid:
        # ustart[i]=1 ⇒ point i is a suppressed first-move ENDPOINT — the
        # segment into it is an unknown path (brk semantics client-side),
        # the vertex itself is a real commanded pose with 0 s / 0 dist.
        # Present only when the program has suppressed moves (schema ≥ 6).
        result["rapid_ustart"] = np.asarray(rapid_ustart, dtype="<u1").tobytes() if rapid_ustart else b""
    if flips_unresolved:
        # Flips the twins could not evaluate (no twin for the family, or
        # a frameless type-2 side): their segments keep the raw phantom
        # geometry. Unhandled ≠ handled — the count rides the wire so
        # the sweep/UI can say so instead of implying a clean track.
        result["kins_flips_unresolved"] = flips_unresolved
    if flips_carry_spans:
        # Segments whose geometry a relabel CARRY moved (the post-g69 class):
        # an axis the post-flip blocks never command keeps the pre-flip value
        # in the un-resynced offline interpreter, so the correction is carried
        # until that axis is re-commanded. Canon-endpoint replay cannot tell
        # "held" from "commanded to exactly the stale value", so the reach of
        # the carry rides the wire instead of being silently assumed.
        result["kins_carry_spans"] = flips_carry_spans
    if canon.wcs_events:
        # WCS epoch rows (review P2), execution-ordered: [seq, g5x_index,
        # rotation_deg, rewritten, g5x x6, g92 x6] — MACHINE units, the
        # basis each epoch's endpoints were peeled against. An event at seq
        # N governs segments with seq > N (marker convention). `rewritten`
        # = the PROGRAM wrote these offsets (G10 L2 / mid-program G92) so
        # the live table row is not authoritative for this epoch — the
        # client re-adds the snapshot instead of the live row. Always ≥1
        # row when motion exists, so absence unambiguously means a legacy
        # payload. A handful of small rows — GC discipline intact.
        _e0_g92 = canon.wcs_events[0][2][1]
        # The value comparison alone misses a G10 L2 that writes the SAME
        # numbers the var row already holds — a program re-asserting its own
        # offsets every run then reads as operator-owned, and the client
        # re-adds the LIVE row, so a touch-off between parse and display
        # moves the preview somewhere the machine will never go. Union in
        # what the SOURCE says the program writes.
        _wr_explicit, _wr_active = wcs_rewrite_targets(_src_text)
        result["wcs_frames"] = []
        for _eseq, _eidx, _ebasis in canon.wcs_events:
            _rw = (wcs_event_rewritten(_ebasis, _eidx, var_wcs_rows,
                                       _e0_g92, unit_scale)
                   or _wr_active or (_eidx in _wr_explicit))
            result["wcs_frames"].append(
                [int(_eseq), int(_eidx or 0), float(_ebasis[2]),
                 1 if _rw else 0]
                + [float(v) for v in _basis_to_machine(_ebasis[0], unit_scale)[:6]]
                + [float(v) for v in _basis_to_machine(_ebasis[1], unit_scale)[:6]])
    if world_unchecked:
        # World-mode segments with no kins twin to check against —
        # unchecked ≠ clean, so the count rides the wire and the UI says
        # "not validated" instead of implying a pass.
        result["violations_world_unchecked"] = world_unchecked
    if unmarked_subs:
        # Unmarked-sub advisory (W3 P5, schema 6): called external subs
        # with no WEBUI_SUB markers — the stats dialog shows one info-tier
        # hint. Present only when non-empty.
        result["unmarked_subs"] = unmarked_subs
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
    # Out-of-band schema stamp for the gateway (P1): the pipeline publishes
    # stdout as PASSTHROUGH bytes (GC discipline — it must never decode the
    # multi-MB payload), so the stamp it records at publish time rides stderr,
    # which it already line-parses for __PARTIAL__. Emitted only on success —
    # a failed parse publishes nothing.
    print(f"__SCHEMA__\t{PREVIEW_SCHEMA}", file=sys.stderr, flush=True)
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
