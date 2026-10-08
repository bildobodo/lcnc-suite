#!/usr/bin/env python3
"""Shared G-code preview canon + var-file patching.

Lives outside gateway.py so the subprocess worker (gcode_parse_worker.py)
can import the same class without dragging gateway state in. Gateway uses
apply_var_patches() when building the context handed to the worker.
"""

import math
from typing import Dict, List
from rs274.interpret import Translated, ArcsToSegmentsMixin, StatMixin

from gateway_util import (
    parse_kinstype_marker, parse_twpframe_marker, parse_sub_marker,
)


# Adaptive arc tessellation (A1). Chord tolerance in canon units (inches —
# LinuxCNC internal). 0.001 in ≈ 0.025 mm — sub-pixel at typical viewports.
# Bounds prevent both pathological coarsness on tiny arcs and runaway segment
# counts on huge-radius arcs where the controller would still emit a smooth
# enough preview at 64 segments per full circle.
_ARC_EPS = 0.001
_ARC_MIN_SEGS = 8
_ARC_MAX_SEGS = 64


class PreviewCanon(Translated, ArcsToSegmentsMixin, StatMixin):
    # Does the CONTROLLER move the machine at an M6 where the preview cannot
    # see it? Only [EMCIO] TOOL_CHANGE_POSITION does — task's CHANGE_TOOL
    # issues that motion itself, no canon call. Then the move after the
    # change starts where no parse can know (first_move). The interpreter's
    # own quill-up (TOOL_CHANGE_QUILL_UP) and G30 (TOOL_CHANGE_AT_G30) moves
    # are STRAIGHT_TRAVERSE canon calls before CHANGE_TOOL (interp_convert.cc
    # convert_tool_change) and recorded here like a remap's own moves, so
    # without a tool change position the next move starts where the machine
    # stands. The worker sets it from the INI; the default keeps the unknown
    # start.
    tool_change_moves = True

    """Lightweight canon that collects feed/rapid polylines for 3D preview."""

    def __init__(self, s, random=0):
        StatMixin.__init__(self, s, random)
        self.feed = []          # [(lineno, start_9, end_9, feedrate, tlo_3, seq)]
        self.rapid = []         # [(lineno, start_9, end_9, tlo_3, seq)]
        # Global segment sequence across feed AND rapid. The two lists are
        # each in execution order, but interleaving between them is lost —
        # seq restores it so the scrub track can replay segments in true
        # program order (feed[i] before/after rapid[j] is undecidable from
        # line numbers alone once subroutine loops revisit lines).
        self.seq = 0
        self.lineno = -1
        self.feedrate = 1.0
        self.lo = (0,) * 9
        self.first_move = True
        self.suppress = 0
        self.arc_dist = 0.0
        self.arc_moves = 0
        self.tools_used = set()
        self.tool_changes = 0
        self.tool_change_events = []   # [(lineno, tool_idx)] in execution order
        # Switchkins mode markers `(WEBUI_KINSTYPE=n)` from the toggle
        # remaps (TCP+TWP phase 2): [(seq_at_marker, kinstype)] in
        # execution order — a marker at seq N applies to segments seq > N.
        self.kins_events = []
        # TWP plane-frame markers `(WEBUI_TWPFRAME=p,t1,t2)` from the
        # forked TWP remap's g53x_core (phase 3): [(seq_at_marker,
        # pre_rot_rad, primary_deg, secondary_deg)] in execution order —
        # the three kins-pin values that pin the TOOL-kins (type 2) frame.
        self.kins_frames = []
        # WCS basis captured at the first real program line — see next_line().
        # None means no line ever ran (empty/failed parse); the caller must
        # then fall back and say so rather than silently using end-of-parse.
        self.basis_at_start = None
        # Work coordinate systems that actually PRODUCED MOTION (g5x indices,
        # 1=G54 … 9=G59.3), in first-use order. This is the authoritative
        # answer to "which fixtures does this program cut in" — the viewer used
        # to guess it with a regex over the first 8 KB of source, which sees
        # only the first WCS word and misses a mid-program switch entirely.
        #
        # Recorded at MOTION, not at the G-code word, so M2's reset to G54
        # (which happens after the last move) never counts as a fixture used.
        self.wcs_used = []
        self._last_motion_g5x = None
        # WCS EPOCH events (review P2 — the metre-off TWP preview): the
        # effective basis (g5x + g92 + rotation, per wcs_basis()) sampled at
        # every motion, recorded when it CHANGES: [(seq_at_change, g5x_index,
        # basis)]. One channel covers both fixture switches (G54→G59) and
        # mid-program G10 L2 rewrites of the governing fixture — either way
        # the value the canon's rotate_and_translate applied to subsequent
        # segments changed, and the extraction must subtract per-epoch
        # instead of one program-start basis. Seq convention matches the
        # kins markers: an event at seq N governs segments with seq > N.
        self.wcs_events = []
        self._last_wcs_basis = None
        # The basis can only change through the three canon setters below
        # (the interpreter never writes the offset attributes directly —
        # rs274.interpret.Translated owns them and only its setters assign).
        # They raise this flag; _next_seq re-snapshots ONLY when it is set.
        # Before: a 19-getattr snapshot + two 9-tuple compares on EVERY
        # segment — 60 % of the canon's share of a 1.18 M-line parse.
        self._wcs_dirty = True
        # Subroutine span markers `(WEBUI_SUB=name [CALLER=tok])` /
        # `(WEBUI_SUB_END)` from our shipped subs and the TWP remap
        # wrappers (W2 P6): [(seq_at_marker, name | None, caller_token |
        # None)] in execution order; name None = span end. Motion inside a
        # span carries the SUB file's line numbers — colliding with the
        # main program's — so the worker marks those points untrusted
        # (with the sub's name for the UI) instead of letting the
        # text-panel highlight land on an unrelated main line. The CALLER
        # token (W4) declares the main-file text that invokes the sub, for
        # call-site line attribution (attribute_sub_callers). NOTE: the
        # interpreter fires next_line only for plainly-executed blocks —
        # never for remap trigger lines, o-call lines, blanks, or
        # comment-only lines (verified empirically, W4) — so no canon-side
        # signal can locate the call site; attribution is text-scan only.
        self.sub_events = []
        # Seqs of ZERO-LENGTH rapids recorded at suppressed-move endpoints
        # (W3 P1): a first_move rapid's PRIOR position is unknown, but its
        # END is a commanded pose the run will visit — dropping the whole
        # segment (pre-schema-6) erased the program's own first rapid, so
        # the sim entry lerped straight to remap-internal motion (the
        # collapsed two-stage TWP approach). The endpoint ships as a
        # start==end tuple; the segment INTO it is unknown-path (client
        # brk semantics, `rapid_ustart` on the wire).
        self.unknown_start = []
        # TLO / tool EVENTS (schema 8 — the sixth run-time state input):
        # [(seq, xo, yo, zo, tool)] in execution order, CANON units, recorded
        # at every G43/G43.1/G49 (tool_offset) and every executed M6
        # (change_tool) on a PROGRAM line. Same seq convention as the other
        # channels — a row at seq N governs segments with seq > N; two rows
        # at one seq (`m6 t3 g43 h3`) resolve last-wins. Rows carry FULL
        # state (a G43 row the current tool, an M6 row the current tlo).
        # `tool` is -1 until the first executed M6 (= inherit the loaded
        # tool). Segments BEFORE the first row run under the machine's START
        # tool state (its inherited modal G43): the worker seeds it with an
        # init-line `G43.1` and ships it as `tlo_start` (VP-I20) — an
        # initcode-driven tool_offset (lineno 0) is that seed, never "the
        # program asserted it" (the ustart lineno rule). Absent = the program
        # never changes tool or offset.
        self.tlo_events = []
        # Seqs at which a PROGRAM line changed the tool offset (G43 / G49 /
        # G43.1 — tool_offset, never an M6): the last emitted seq, so the
        # next tuple starts in the new frame. The parse worker inserts a
        # relabel vertex there for EVERY such event, whatever the value —
        # the payload's structure must not depend on the start offset
        # (the VP-I20 verify compares two parses at different starts).
        self.offset_events = []
        self.cur_tool = -1
        self.xo = self.yo = self.zo = 0.0
        self.ao = self.bo = self.co = 0.0
        self.uo = self.vo = self.wo = 0.0
        self.g5x_index = 1
        self.plane = 1
        self.arcdivision = _ARC_MAX_SEGS

    # Axis-offset attribute suffixes, canonical order (rs274.interpret).
    _WCS_SUFFIXES = ("x", "y", "z", "a", "b", "c", "u", "v", "w")
    # Class default so a canon built without __init__ (test harnesses) still
    # snapshots on its first segment; __init__ sets it too.
    _wcs_dirty = True

    def wcs_basis(self):
        """The WCS state right now: (g5x9, g929, rotation_xy).

        Canon/interpreter length units (INCHES) — the extraction multiplies by
        unit_scale, same as the endpoints these offsets are subtracted from."""
        return (
            tuple(getattr(self, "g5x_offset_" + s, 0.0) for s in self._WCS_SUFFIXES),
            tuple(getattr(self, "g92_offset_" + s, 0.0) for s in self._WCS_SUFFIXES),
            float(getattr(self, "rotation_xy", 0.0) or 0.0),
        )

    # The INIT PHASE of a `%`-delimited file (VP-I20, native, Codex R58
    # VP-I22): the interpreter reports the `%` line as sequence 1 — whatever
    # blank lines precede it — and runs the initcode block right AFTER that
    # next_line: the rotary sync move, the start-offset G43.1 and the
    # fixture code arrive numbered 1. The phase is decided by what was
    # OBSERVED, never by a line number: it opens at the first next_line ≥ 1
    # of such a file and ends for good at the next one — a later line 1 (a
    # subroutine's) is program. Without `%` the initcodes run at line 0.
    # Inside it: no recorded motion (the phantom zero-length rapid at
    # program 0,0,0), no TLO row, no start snapshot. The worker sets
    # `percent_delimited` from the source text (percent_delimiter_line).
    percent_delimited = False
    _pct_line_seen = False
    _in_init = False

    def _program_line(self):
        """Is the current callback from a PROGRAM line (not the initcodes)?"""
        return (self.lineno or 0) >= 1 and not self._in_init

    def next_line(self, st):
        self.state = st
        if (st.sequence_number or 0) < 0 and (self.lineno or 0) >= 1:
            # A motion the interpreter makes itself inside the current block —
            # an M6's quill-up or G30 move (TOOL_CHANGE_QUILL_UP /
            # TOOL_CHANGE_AT_G30, interp_convert.cc STRAIGHT_TRAVERSE(-1, …))
            # arrives as line -1: it belongs to the block that runs it, and a
            # -1 on the wire's uint32 line arrays ended every such parse in an
            # OverflowError (found 2026-10-08 with Codex R91's R92 notes).
            return
        self.lineno = st.sequence_number
        if (self.lineno or 0) >= 1:
            if self.percent_delimited and not self._pct_line_seen:
                self._pct_line_seen = True     # the `%` line: the init block follows
                self._in_init = True
            else:
                self._in_init = False          # program from here on, for good
        # PROGRAM-START basis: the offsets in effect after the gateway's
        # initcodes (which force the machine's ACTIVE WCS) and before the
        # program's first line runs.
        #
        # This is the basis the extraction must subtract, because the CLIENT
        # re-adds the live active WCS. End-of-parse is wrong: M2 resets the
        # interpreter to G54, so a program run in any other WCS would render
        # displaced by the whole fixture delta. First-MOTION is also wrong: a
        # program whose preamble selects a different WCS than the active one
        # would then be drawn at the wrong fixture. Both verified against the
        # real interpreter (scripts/gen_canon_fixtures.py).
        #
        # The initcode block arrives as sequence_number 0 and its offsets are
        # applied AFTER that callback, so the first line with a real (>=1)
        # number is the first moment the post-initcode state is visible.
        if self.basis_at_start is None and self._program_line():
            self.basis_at_start = self.wcs_basis()
            # Re-arm the first-move suppression for the PROGRAM (schema 5):
            # the rotary-sync initcode (gateway_util.rotary_sync_initcode)
            # is a G53 move that consumed the one suppression while seeding
            # self.lo with the machine's live rotary pose. The program's
            # own first move must stay suppressed exactly as before — its
            # prior XYZ position is still unknown. A parse without the
            # sync initcode leaves first_move already True; this is a no-op.
            self.first_move = True

    def set_feed_rate(self, f): self.feedrate = f / 60.0
    def set_spindle_rate(self, _): pass
    def select_plane(self, _): pass
    def comment(self, text):
        k = parse_kinstype_marker(text)
        if k is not None:
            self.kins_events.append((self.seq, k))
            return
        fr = parse_twpframe_marker(text)
        if fr is not None:
            self.kins_frames.append((self.seq, fr[0], fr[1], fr[2]))
            return
        sub = parse_sub_marker(text)
        if sub is not None:
            self.sub_events.append((self.seq, sub[1], sub[2]))
    def message(self, _): pass
    def check_abort(self): pass
    def user_defined_function(self, i, p, q): pass
    def dwell(self, _): pass

    def change_tool(self, idx):
        StatMixin.change_tool(self, idx)
        if self.tool_change_moves:
            self.first_move = True
        self.tool_changes += 1
        # (lineno, tool) per executed M6 — timeline event markers. NOTE: only
        # canon-executed changes appear here (an M600 remap whose body is
        # preview-skipped contributes none — same honesty rule as the stats).
        self.tool_change_events.append((self.lineno, idx))
        if idx > 0:
            self.tools_used.add(idx)
        self.cur_tool = idx
        if self._program_line():
            self.tlo_events.append((self.seq, self.xo, self.yo, self.zo, idx))

    def tool_offset(self, xo, yo, zo, ao, bo, co, uo, vo, wo):
        # G43 / G49 move nothing: the machine stands, and only the frame the
        # program's coordinates are read in changes — `lo` is re-expressed in
        # it below (LinuxCNC's canon moves its end point the same way). So the
        # NEXT move starts at the new `lo`, a known pose: it is recorded as a
        # real segment (timed, limit-checked, swept along its path), and the
        # parse worker inserts the re-expression as a relabel vertex
        # (insert_flip_relabels, a tool-offset flip). Before 2026-10-07 this
        # set first_move like axis' preview does — the move after a G43
        # became a zero-length unknown-start endpoint: 0 s on the timeline,
        # checked for collisions at its end only (operator, haus.ngc L18
        # `G43 Z15. H13`). A first move still unknown stays so.
        x, y, z, a, b, c, u, v, w = self.lo
        self.lo = (x - xo + self.xo, y - yo + self.yo, z - zo + self.zo,
                   a - ao + self.ao, b - bo + self.bo, c - co + self.co,
                   u - uo + self.uo, v - vo + self.vo, w - wo + self.wo)
        self.xo, self.yo, self.zo = xo, yo, zo
        self.ao, self.bo, self.co = ao, bo, co
        self.uo, self.vo, self.wo = uo, vo, wo
        # G49 when already zero IS recorded: the program asserting zero
        # differs from "inherit live" (see tlo_events in __init__).
        if self._program_line():
            self.tlo_events.append((self.seq, xo, yo, zo, self.cur_tool))
            self.offset_events.append(self.seq)

    # rotate_and_translate keeps straight moves in the same translated frame
    # gcode.arc_to_segments produces for arcs; WCS offsets subtract once at
    # extraction time (not here).
    def _next_seq(self):
        # Called exactly once per emitted segment, by every motion emitter —
        # so it is also where the fixture-in-use is sampled (an int compare)
        # and where the WCS epoch snapshot is taken: the offsets sampled here
        # are EXACTLY the values rotate_and_translate just applied to this
        # segment, so per-epoch subtraction at extraction is per-segment
        # exact by construction. Cost: two 9-tuples per segment; the tuple
        # compare short-circuits on the first differing float.
        idx = getattr(self, "g5x_index", None)
        if idx != self._last_motion_g5x:
            self._last_motion_g5x = idx
            if idx is not None and idx not in self.wcs_used:
                self.wcs_used.append(idx)
        if self._wcs_dirty:
            self._wcs_dirty = False
            basis = self.wcs_basis()
            if basis != self._last_wcs_basis:
                self._last_wcs_basis = basis
                self.wcs_events.append((self.seq, idx, basis))
        self.seq += 1
        return self.seq

    # WCS basis writers (rs274.interpret.Translated): the ONLY paths that
    # change what wcs_basis() returns — flag, then let the parent assign.
    def set_g5x_offset(self, *args, **kw):
        self._wcs_dirty = True
        return super().set_g5x_offset(*args, **kw)

    def set_g92_offset(self, *args, **kw):
        self._wcs_dirty = True
        return super().set_g92_offset(*args, **kw)

    def set_xy_rotation(self, *args, **kw):
        self._wcs_dirty = True
        return super().set_xy_rotation(*args, **kw)

    def straight_traverse(self, x, y, z, a, b, c, u, v, w):
        if self.suppress > 0: return
        l = self.rotate_and_translate(x, y, z, a, b, c, u, v, w)
        if self.first_move:
            # First motion after program start / tool change / G43: the PRIOR
            # position is unknown (machine parked spot, post-M6 pre-position),
            # so the segment can't be plotted — but its END is a commanded,
            # known position the run will visit. Record it as a ZERO-LENGTH
            # rapid (W3 P1) and mark the seq unknown-start: 0 s / 0 dist by
            # construction, the endpoint keeps its line/epoch/kins stamps,
            # and the client renders the connector into it as a gap instead
            # of a false straight line. Only PROGRAM lines (lineno >= 1)
            # record — the rotary-sync initcode's G53 move (lineno 0) stays
            # fully suppressed: its endpoint IS the live parked pose the
            # client-built entry move already starts from. (gremlin keeps
            # suppressing until the first FEED, which silently drops entire
            # leading rapid sequences — the scrub track and collision sweep
            # need those lines: a low rapid traverse before the first cut is
            # exactly the classic crash.)
            self.first_move = False
            if self._program_line():
                seq = self._next_seq()
                self.rapid.append((self.lineno, l, l, (self.xo, self.yo, self.zo), seq))
                self.unknown_start.append(seq)
        else:
            self.rapid.append((self.lineno, self.lo, l, (self.xo, self.yo, self.zo), self._next_seq()))
        self.lo = l

    def straight_feed(self, x, y, z, a, b, c, u, v, w):
        if self.suppress > 0: return
        self.first_move = False
        l = self.rotate_and_translate(x, y, z, a, b, c, u, v, w)
        self.feed.append((self.lineno, self.lo, l, self.feedrate, (self.xo, self.yo, self.zo), self._next_seq()))
        self.lo = l

    straight_probe = straight_feed

    def rigid_tap(self, x, y, z):
        if self.suppress > 0: return
        self.first_move = False
        l = self.rotate_and_translate(x, y, z, 0, 0, 0, 0, 0, 0)[:3]
        l += (self.lo[3], self.lo[4], self.lo[5],
              self.lo[6], self.lo[7], self.lo[8])
        self.feed.append((self.lineno, self.lo, l, self.feedrate, (self.xo, self.yo, self.zo), self._next_seq()))
        self.feed.append((self.lineno, l, self.lo, self.feedrate, (self.xo, self.yo, self.zo), self._next_seq()))

    def straight_arcsegments(self, segs):
        self.first_move = False
        lo = self.lo
        for l in segs:
            self.feed.append((self.lineno, lo, l, self.feedrate, (self.xo, self.yo, self.zo), self._next_seq()))
            dx, dy, dz = l[0] - lo[0], l[1] - lo[1], l[2] - lo[2]
            self.arc_dist += (dx * dx + dy * dy + dz * dz) ** 0.5
            self.arc_moves += 1
            lo = l
        self.lo = lo

    def arc_feed(self, x1, y1, cx, cy, rot, z1, a, b, c, u, v, w):
        # Pick a per-arc segment count that keeps chord error below _ARC_EPS.
        # Active plane decides which two coordinates form the arc circle:
        # plane 1 = XY, 2 = XZ, 3 = YZ. cx/cy are in those active-plane axes.
        if self.plane == 1:
            r_dx, r_dy = self.lo[0] - cx, self.lo[1] - cy
        elif self.plane == 2:
            r_dx, r_dy = self.lo[0] - cx, self.lo[2] - cy
        else:
            r_dx, r_dy = self.lo[1] - cx, self.lo[2] - cy
        radius = math.hypot(r_dx, r_dy)
        if radius > _ARC_EPS:
            ratio = max(-1.0, 1.0 - _ARC_EPS / radius)
            seg_angle = 2.0 * math.acos(ratio)
            if seg_angle > 0.0:
                n = int(math.ceil(2.0 * math.pi / seg_angle))
                self.arcdivision = max(_ARC_MIN_SEGS, min(_ARC_MAX_SEGS, n))
            else:
                self.arcdivision = _ARC_MAX_SEGS
        else:
            self.arcdivision = _ARC_MIN_SEGS
        super().arc_feed(x1, y1, cx, cy, rot, z1, a, b, c, u, v, w)


def apply_var_patches(path: str, patches: Dict[str, str]) -> None:
    """Overwrite numeric-parameter lines in a LinuxCNC var file in place.

    LinuxCNC writes the var file only at a synch (a switch to MDI/AUTO,
    task_plan_synch) or at shutdown, so runtime edits (e.g. G10 L2 R
    rotation) may not have reached disk yet. Gateway hands us the fresh
    values; we rewrite the temp copy the parser will read.
    """
    if not patches:
        return
    lines: List[str] = []
    seen: set = set()
    try:
        with open(path, "r") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2 and parts[0] in patches:
                    lines.append(f"{parts[0]}\t{patches[parts[0]]}\n")
                    seen.add(parts[0])
                else:
                    lines.append(line)
        for pnum, val in patches.items():
            if pnum not in seen:
                lines.append(f"{pnum}\t{val}\n")
        with open(path, "w") as f:
            f.writelines(lines)
    except Exception as e:
        print(f"[GCODE] var file patch failed: {e}")
