#!/usr/bin/env python3
"""Shared G-code preview canon + var-file patching.

Lives outside gateway.py so the subprocess worker (gcode_parse_worker.py)
can import the same class without dragging gateway state in. Gateway uses
apply_var_patches() when building the context handed to the worker.
"""

import math
import os
from typing import Dict, List

import numpy as np
from rs274.interpret import Translated, ArcsToSegmentsMixin, StatMixin

from gateway_util import (
    parse_kinstype_marker, parse_twpframe_marker, parse_sub_marker, parse_m600_marker,
)


# Adaptive arc tessellation (A1). Chord tolerance in canon units (inches —
# LinuxCNC internal). 0.001 in ≈ 0.025 mm — sub-pixel at typical viewports.
# Bounds prevent both pathological coarsness on tiny arcs and runaway segment
# counts on huge-radius arcs where the controller would still emit a smooth
# enough preview at 64 segments per full circle.
_ARC_EPS = 0.001
_ARC_MIN_SEGS = 8
_ARC_MAX_SEGS = 64

# The interpreter's OWN word on where a callback comes from (Codex R107,
# measured natively on 2.9.4): gcode.parse runs LinuxCNC's interpreter in
# this process, and its Python face — the module `interpreter`, built into
# gcode.so — is importable while a parse runs (not before the first one).
# `interpreter.this` is that interpreter: `call_level`, `remap_level`,
# `filename`, `sequence_number`, `blocks[1..remap_level].executing_remap
# .name` (the remapped codes running, outermost first: "M200", "M600",
# "G88.1") and `sub_context[k]` — each calling frame's `filename` and the
# byte `position` just after the line it called from. next_line tells none
# of it: it fires only when the sequence number CHANGES, so a body line
# numbered like the line before it reports nothing at all (Codex R107
# VP-I61: a foreign M600's `G53 G0 Z0` on its line 2 after the main
# program's line 2).
_INTERP = None


def interp_this():
    """`interpreter.this`, or None outside a parse or without the module."""
    global _INTERP
    if _INTERP is None:
        try:
            import interpreter as _INTERP   # noqa: F811 — only while a parse runs
        except ImportError:
            return None
    return getattr(_INTERP, "this", None)


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
    # The axes that unseen move changes (canonical 0–8, X Y Z A B C U V W):
    # the ones TOOL_CHANGE_POSITION names. The worker sets it; default all.
    tool_change_axes = tuple(range(9))
    # Axes whose REAL value the preview cannot know (Codex R92 VP-I51): after
    # such an M6 the controller stands at the tool change position, but the
    # preview interpreter resyncs from its own last endpoint (gcodemodule's
    # GET_EXTERNAL_POSITION_* answer in C, never through this canon), so
    # every axis a block leaves out, an arc's centre and an incremental move
    # are computed from the old position. While any axis is stale, every
    # motion — traverse, feed, probe, tap or arc — is recorded as a
    # zero-length unknown-start endpoint at its end: no invented path, no
    # duration, the sweep names it. A block re-establishes the axes whose
    # PROGRAM coordinate differs between where the block began and where it
    # ENDED (`_program`: a rotated frame turns an X move into a machine X and
    # Y change — Codex R93 VP-I51 B; a G76 ends with X on its drive line, the
    # stale start, so X stays stale — R94 C) — only once the block
    # has run and only if it ran ABSOLUTE: the distance mode a block runs in
    # shows at the NEXT line (the state arrives before its block), so nothing
    # is re-established inside a block (a G91 G81 in one block recorded its
    # feed and retract as known — R93 A) and a G90 G0 X Y Z makes the next
    # block known. A change of the XY rotation while X or Y is stale makes
    # both stale: the new program X holds the unknown old Y (R94 D). A canned
    # cycle under G98 never re-establishes its plane's normal axis: it
    # retracts to max(the height before the cycle, R) — the real, unknown
    # height when that lies above R, whatever the preview believes
    # (interp_cycles `if (old_cc < r) … clear_cc = old_cc`). An OFFSET, a
    # tool offset or a stored position written FROM the position while an
    # axis is stale (G92, G10 L20 / L10 / L11, G28.1, G30.1) is the preview's
    # guess for good: an absolute move repairs the program coordinate, never
    # such a value, so those axes stay stale to the program's end
    # (`_frame_unknown`; Codex R95 VP-I53). No canon call tells an L20 from
    # an explicit L2, and an L20 on an inactive fixture or a G28.1 makes no
    # call at all, nor does the state show them reliably (a following G90
    # overwrites the block's non-modal code before any next_line sees it —
    # measured), so the MAIN file's text decides (`write_lines`, from
    # gateway_util.position_write_lines, set by the worker with a tool change
    # position): at each next_line the lines run since the last one. An
    # inactive fixture's write takes effect at the switch to it
    # (`_reg_unknown`). Out of text order (`write_mode` inline / foreign) the
    # text speaks only for lines known to have run, and the active
    # registers' callbacks report every write as an EVENT (Codex R97: a value
    # computed equal is no proof of none). The lines go to the check's note
    # (`stale_offset_lines`).
    # Always REASSIGNED (frozenset / tuple / dict): the class values are the
    # shared defaults.
    stale = frozenset()
    _frame_unknown = frozenset()
    stale_offset_lines = ()
    write_lines = None
    write_mode = "ordered"          # gateway_util.position_write_lines: ordered | inline | foreign
    _switch_g92_line = None
    ever_stale = False
    _reg_unknown = {}
    _pending_offset_lines = ()
    _block_start = None
    # M600 in the preview (docs/reviews/m600-preview.plan.md, Codex R102–R104):
    # the bundled tool_touch_off.ngc runs in the preview. Where its probe
    # cannot be predicted it stops at the probe's start with
    # `(WEBUI_PROBE_UNPREDICTED=<reason>)`: the machine's probe may trip
    # anywhere on its travel, the length it measures and the offset the
    # routine applies are unknown, so from there EVERY axis is unknown to the
    # program's end — `_frame_unknown`, which no move re-establishes (the
    # state table's rows from the probe's start on). The worker says so
    # (`toolsetter_unpredictable`) where the toolsetter's values are unknown:
    # then from the routine's start. `probe_events` [(seq, tool, reason, k)],
    # k = the sub-span markers seen (gateway_util.main_file_event_lines).
    # `(WEBUI_TOOLLEN_TABLE)` before the routine's G10 / G43 says the length
    # they apply is the TABLE's (assumed): paired with the next G43 of the
    # same call only — any sub marker before it (the call's end) discards it.
    # `toollen_events` [(seq, tool, zo, k)].
    probe_events = ()
    toollen_events = ()
    # The probe's braking range (docs/reviews/parity-ef.plan.md F2): from
    # `(WEBUI_PROBE_BAND)` (just after the trip point) to `(WEBUI_PROBE_BAND_END)`
    # the routine moves only Z through a modeled hull — [(seq_start, seq_end,
    # tool, k)]: the segments seq_start < seq <= seq_end are the band. And
    # `(WEBUI_PROBE_NOTE=<reason>)` where the modeled sequence may not hold —
    # [(seq, tool, reason, k)]. k as for probe_events.
    probe_bands = ()
    probe_notes = ()
    _band_open = None
    toolsetter_unpredictable = None
    _probe_unknown = False
    _toollen_open = False
    # An M600 / M601 remap that is not the suite's (gateway_util
    # foreign_m600_codes): the preview cannot know what the call does — from
    # it, every axis is unknown. Its lines from the main file's text; in
    # text order (`ordered`) the mark lands where the block BEFORE the call
    # has run (a remap trigger line gets no next_line), else — lines that
    # need not run in text order — at the program's start.
    # The lines come with the remapped codes (`foreign_codes`, "m600"): the
    # interpreter says when one of them runs (`remaps_running`) — from that
    # callback on, before anything it records, all is unknown. The text adds
    # what the preview may not run where the machine does (a body's branch
    # on a value only the run has): in text order from the first main-file
    # line that may call it (`main_line`, the interpreter's), else from the
    # program's start; without the interpreter's word from the start too.
    foreign_m600_lines = frozenset()
    foreign_m600_mode = "ordered"
    foreign_codes = frozenset()
    # The MAIN program (the worker sets it, set_main_file): its real path and
    # bytes — a frame's `position` is a byte offset (a `%` file with CRLF and
    # UTF-8 comments measured too).
    main_file = None
    _main_raw = None
    _main_nl = None
    _main_names = {}
    interp = staticmethod(interp_this)    # a fake in the unit tests
    # The position-write walk in MAIN-file lines: where the last next_line
    # ran, and every stale set seen while it ran (a remap body's blocks run
    # inside the line that called it).
    _walk_line = 0
    _walk_stale = frozenset()
    _CYCLES = frozenset((730, 810, 820, 830, 840, 850, 860, 870, 880, 890))
    _PLANE_NORMAL = {170: 2, 180: 1, 190: 0, 171: 8, 181: 7, 191: 6}

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
        # [(lineno, tool_idx, k, main)] in execution order; k = the sub-span
        # markers seen so far (len(sub_events)): an M6 inside a marked sub —
        # the M600 routine's own — carries the SUB file's line; main = the
        # main-file line the interpreter ran (main_line, None where it
        # cannot tell) — gateway_util.main_file_tool_changes
        self.tool_change_events = []
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
        # None, main | None)] in execution order; name None = span end.
        # Motion inside a span carries the SUB file's line numbers —
        # colliding with the main program's — so the worker marks those
        # points untrusted (with the sub's name for the UI) instead of
        # letting the text-panel highlight land on an unrelated main line.
        # The interpreter fires next_line only for plainly-executed blocks —
        # never for remap trigger lines, o-call lines, blanks, or
        # comment-only lines (W4) — but its own state names the call site:
        # `main` at a start marker is the main-file line it ran
        # (main_line, Codex R107), the call-site line attribution's first
        # word (attribute_sub_callers); the CALLER token (W4) declares the
        # main-file text that invokes the sub, its cross-check.
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

    _program_started = False

    def _program_line(self):
        """Is the current callback from the PROGRAM (not the initcodes)? A line
        number ≥ 1 — or, once the program has begun, any: a Python remap's
        `self.execute(...)` without a line number arrives as line 0 (Codex
        R109 VP-I65; the initcodes run before the first program line)."""
        return not self._in_init and ((self.lineno or 0) >= 1 or self._program_started)

    def set_main_file(self, path):
        """The main program, for main_line (the worker)."""
        self.main_file = os.path.realpath(path)
        self._main_nl = None
        self._main_names = {}

    def _is_main(self, name):
        if not name:
            return False
        got = self._main_names.get(name)
        if got is None:
            got = self._main_names[name] = os.path.realpath(name) == self.main_file
        return got

    def _byte_line(self, pos):
        """The 1-based main-file line holding byte pos − 1: a frame's position
        is the byte after the line it called from. None when the file cannot
        be read."""
        if self._main_nl is None:
            try:
                with open(self.main_file, "rb") as f:
                    raw = f.read()
            except OSError:
                return None
            self._main_nl = np.flatnonzero(np.frombuffer(raw, dtype=np.uint8) == 10)
        return int(np.searchsorted(self._main_nl, pos - 1, side="left")) + 1

    def main_line(self):
        """The MAIN file's line the interpreter executes at this callback —
        its current line where the main file runs (an inline or M98 sub's own
        line too), else the line the deepest frame of the main file called
        from: a remap trigger, an o-call or M98 line (measured natively,
        Codex R107); in a remap of the main file whose code keeps its file (a
        Python remap) the trigger's line (R109). None outside a parse or
        without the interpreter's word; 0 where it names no main-file line
        (the initcodes, a Python remap triggered in another file)."""
        if self.main_file is None:
            return None
        t = self.interp()
        if t is None:
            return None
        if int(t.remap_level) == 0 and self._is_main(t.filename):
            return int(t.sequence_number)
        for k in range(int(t.call_level) - 1, -1, -1):
            c = t.sub_context[k]
            if self._is_main(c.filename):
                return self._byte_line(int(c.position))
        if int(t.remap_level) >= 1 and self._is_main(t.filename):
            # A Python remap keeps the file it was triggered in and records no
            # frame of it (filename "", position 0); its sequence number is
            # whatever its execute() passed, or 0 (Codex R109). The remap's
            # controlling block — the trigger — carries its byte offset in
            # that file (measured: `blocks[1].offset`, the outermost one).
            line = self._byte_line(int(t.blocks[1].offset) + 1)
            return line if line is not None else 0
        return 0

    def _in_main_file(self):
        """Does this callback come from the MAIN file's own text (a line of
        it, an inline or M98 sub's too)? None without the interpreter's
        word."""
        if self.main_file is None:
            return None
        t = self.interp()
        if t is None:
            return None
        # a remap's own code — NGC or Python, whose file stays the one it was
        # triggered in — is never the main text's (Codex R109)
        return int(t.remap_level) == 0 and self._is_main(t.filename)

    def remaps_running(self):
        """The remapped codes the interpreter runs now, lower case, outermost
        first ("m200", "m600"); () without its word."""
        t = self.interp()
        if t is None:
            return ()
        out = []
        for i in range(1, int(t.remap_level) + 1):
            r = t.blocks[i].executing_remap
            if r is not None:
                out.append(str(r.name).lower())
        return tuple(out)

    _foreign_first = None

    def _foreign_gate(self):
        """Before a callback records anything: does a foreign M600 / M601 run,
        or may it have run (the text)? Then all is unknown from here."""
        if not self.foreign_codes or self._probe_unknown or not self._program_line():
            return
        if not self.foreign_codes.isdisjoint(self.remaps_running()):
            self._mark_probe_unknown("foreign_remap")
            return
        lines = self.foreign_m600_lines
        if not lines:
            return
        if self.foreign_m600_mode != "ordered" or 0 in lines:
            self._mark_probe_unknown("foreign_remap")
            return
        if self._foreign_first is None:
            self._foreign_first = min(lines)
        m = self.main_line()
        if m is None or m == 0 or m >= self._foreign_first:
            self._mark_probe_unknown("foreign_remap")

    def next_line(self, st):
        self.state = st
        if (st.sequence_number or 0) < 0:
            # A motion the interpreter makes itself inside the current block —
            # an M6's quill-up or G30 move (TOOL_CHANGE_QUILL_UP /
            # TOOL_CHANGE_AT_G30, interp_convert.cc STRAIGHT_TRAVERSE(-1, …))
            # arrives as line -1: it belongs to the block that runs it, and a
            # -1 on the wire's uint32 line arrays ended every such parse in an
            # OverflowError (found 2026-10-08 with Codex R91's R92 notes) —
            # also when that block is a Python remap's execute("M6") numbered
            # 0 (Codex R110 VP-I66): no new block, no line of its own.
            return
        # A new block: the one that ran before it ran in the modes this
        # state shows — absolute (G90, not 910) re-establishes the stale
        # axes whose program coordinate it ENDED away from where it
        # began (but a G98 cycle's normal axis), G91 none. Slot 0 is the
        # sequence NUMBER — line 910 is no G91, line 810 no G81.
        prev = int(self.lineno or 0)
        stale_in_block = self.stale
        gs = tuple(getattr(st, "gcodes", None) or ())
        if self._block_start is not None:
            g = gs[1:]
            if 910 not in g:
                keep = frozenset()
                if 980 in g and not self._CYCLES.isdisjoint(g):
                    keep = frozenset(self._PLANE_NORMAL[c] for c in g if c in self._PLANE_NORMAL)
                p0, p1 = self._program(self._block_start), self._program(self.lo)
                self.stale = self.stale - frozenset(
                    i for i in self.stale - keep - self._frame_unknown if abs(p1[i] - p0[i]) > 1e-9)
            self._block_start = None
        # The writes on the lines run since the previous next_line: the
        # previous line's own under the stale set of its block (a group-0
        # word runs before the block's motion), the lines without a canon
        # call after it under the set its end left.
        # In text order the call-less lines between the two ran too. With
        # o-words a gap proves nothing ran (a branch not taken — Codex R96
        # VP-I54): only the line that had its own next_line is known to
        # have run (inline subs keep this file's numbers); with a call
        # into another file a number may be that file's — callbacks only.
        n = int(st.sequence_number or 0)
        if self.write_lines:
            # In MAIN-file lines, the interpreter's word (Codex R107): a
            # remap body's or a called file's blocks carry their own
            # numbers — taken for this file's, a body's high line ran the
            # walk ahead (range(prev, it)) and a main line after it,
            # lower, never counted. A line's own writes count under
            # every stale set seen while it ran, its body's blocks too.
            m = self.main_line()
            if m is not None:
                seen = self._walk_stale | stale_in_block
                prev, stale_in_block = self._walk_line, seen
                if m >= 1 and m != prev:
                    self._walk_line, self._walk_stale = m, frozenset()
                else:
                    # the same line still runs — or the interpreter names
                    # none (0): nothing is known to have run since (a
                    # guard: no native path found — an o-call or an NGC
                    # remap from a Python remap's execute() is refused,
                    # "call stack underrun", Codex R109)
                    self._walk_stale = seen
                    m = prev
                n = m
        if self.write_lines and prev >= 1 and n != prev:
            if self.write_mode == "ordered" and n > prev:
                lines = range(prev, n)
            elif self.write_mode == "inline":
                lines = (prev,)
            else:
                lines = ()
            for line in lines:
                t = self.write_lines.get(line)
                if t is not None and t != "explicit":
                    axes = stale_in_block if line == prev else self.stale
                    if axes:
                        self._position_write(line, t, axes)
        self.lineno = st.sequence_number
        if (self.lineno or 0) >= 1:
            if self.percent_delimited and not self._pct_line_seen:
                self._pct_line_seen = True     # the `%` line: the init block follows
                self._in_init = True
            else:
                self._begin_program()          # program from here on, for good
        self._enter()

    def _begin_program(self):
        """The program's first callback — a positive line, or one the
        interpreter places in the program before any (`_phase`): the init
        phase ends for good, and the PROGRAM-START basis is taken.

        The basis: the offsets in effect after the gateway's initcodes (which
        force the machine's ACTIVE WCS) and before the program's first
        command. This is the basis the extraction must subtract, because the
        CLIENT re-adds the live active WCS. End-of-parse is wrong: M2 resets
        the interpreter to G54, so a program run in any other WCS would render
        displaced by the whole fixture delta. First-MOTION is also wrong: a
        program whose preamble selects a different WCS than the active one
        would then be drawn at the wrong fixture. Both verified against the
        real interpreter (scripts/gen_canon_fixtures.py). Every callback
        enters here before it applies anything, so a program opening with a
        Python remap's G92 is measured before it (Codex R110)."""
        self._in_init = False
        if self._program_started:
            return
        self._program_started = True
        if self.basis_at_start is None:
            self.basis_at_start = self.wcs_basis()
            # Re-arm the first-move suppression for the PROGRAM (schema 5):
            # the rotary-sync initcode (gateway_util.rotary_sync_initcode)
            # is a G53 move that consumed the one suppression while seeding
            # self.lo with the machine's live rotary pose. The program's
            # own first move must stay suppressed exactly as before — its
            # prior XYZ position is still unknown. A parse without the
            # sync initcode leaves first_move already True; this is a no-op.
            self.first_move = True

    def _phase(self):
        """Before the program's first positive callback: has it begun? The
        interpreter's word (Codex R110 VP-I65): a remap runs only in the
        program — the worker's initcodes (units, G90, the rotary sync's G53,
        the start offset's G43.1, the fixture) trigger none. The file proves
        nothing: the initcodes run with the program already open (measured,
        sequence 0). A program opening with a Python remap whose execute()
        passes no line number reaches its callbacks with line 0 only (an
        o-call's sub lines are numbered)."""
        if self._program_started or self.main_file is None:
            return
        t = self.interp()
        if t is None:
            return
        if int(t.remap_level) >= 1:
            self._begin_program()

    def _enter(self):
        """Every callback's first step: the program's phase, then a foreign
        remap's boundary."""
        self._phase()
        self._foreign_gate()

    def set_feed_rate(self, f): self.feedrate = f / 60.0
    def set_spindle_rate(self, _): pass
    def select_plane(self, _): pass
    def comment(self, text):
        self._enter()
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
            # a start carries the main-file line the interpreter ran
            # (attribute_sub_callers, Codex R107 VP-I63)
            self.sub_events.append((self.seq, sub[1], sub[2],
                                    self.main_line() if sub[0] == "start" else None))
            self._toollen_open = False
            if sub[0] != "start":
                self.close_band()          # a call that returns ends its band
            if sub[0] == "start" and sub[1] == "tool_touch_off" and self.toolsetter_unpredictable:
                self._mark_probe_unknown(self.toolsetter_unpredictable)
            return
        mark = parse_m600_marker(text)
        if mark is not None and self._program_line():
            if mark[0] == "unpredicted":
                self._mark_probe_unknown(mark[1])
            elif mark[0] == "band_end":
                self.close_band()
            elif self._probe_unknown:
                pass
            elif mark[0] == "table":
                self._toollen_open = True
            elif mark[0] == "band":
                self.close_band()
                self._band_open = (self.seq, self.cur_tool, len(self.sub_events))
            elif mark[0] == "note":
                self.probe_notes = self.probe_notes + (
                    (self.seq, self.cur_tool, mark[1], len(self.sub_events)),)

    def close_band(self):
        """End an open braking range at the last emitted segment."""
        if self._band_open is not None:
            q, tool, k = self._band_open
            self._band_open = None
            self.probe_bands = self.probe_bands + ((q, self.seq, tool, k),)

    def _mark_probe_unknown(self, reason):
        """From here every axis is unknown to the program's end."""
        self.probe_events = self.probe_events + ((self.seq, self.cur_tool, reason, len(self.sub_events)),)
        self._toollen_open = False
        if not self._probe_unknown:
            self._probe_unknown = True
            every = frozenset(range(9))
            self._frame_unknown = every
            self.stale = every
            self._pending_offset_lines = ()
    def message(self, _): pass
    def check_abort(self): pass
    def user_defined_function(self, i, p, q): pass
    def dwell(self, _): pass

    def change_tool(self, idx):
        """An M6. LinuxCNC names the tool by its ROW in the tool table
        (CHANGE_TOOL(slot); StatMixin moves that row to the spindle pocket),
        never by its number: the two coincide only in a table that lists T1,
        T2 … in order. The number is the row's id — a library tool ahead of
        T1 made every T1 a 37 (XYZAC sim, live 2026-10-09), and the program's
        tools had no length or diameter on the client. Index 0 is "unload"
        only for a non-random toolchanger (StatMixin empties the pocket, id
        −1); a random one swaps pocket 0 with itself and the loaded tool
        stays (Codex R118 VP-I72). An empty pocket is tool 0."""
        self._enter()
        StatMixin.change_tool(self, idx)
        tool = max(int(self.tools[0][0]), 0)
        if self.tool_change_moves and self._program_line():
            self.stale = frozenset(self.tool_change_axes) | self._frame_unknown
            self.ever_stale = True
        self.tool_changes += 1
        # (lineno, tool) per executed M6 — timeline event markers. NOTE: only
        # canon-executed changes appear here (an M600 remap whose body is
        # preview-skipped contributes none — same honesty rule as the stats).
        self.tool_change_events.append((self.lineno, tool, len(self.sub_events), self.main_line()))
        if tool > 0:
            self.tools_used.add(tool)
        self.cur_tool = tool
        if self._program_line():
            self.tlo_events.append((self.seq, self.xo, self.yo, self.zo, tool))

    def tool_offset(self, xo, yo, zo, ao, bo, co, uo, vo, wo):
        self._enter()
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
            if self._toollen_open:
                self._toollen_open = False
                self.toollen_events = self.toollen_events + ((self.seq, self.cur_tool, zo, len(self.sub_events)),)

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

    def _position_write(self, line, target, axes):
        """A value written from the position while `axes` are stale: the
        active frame's (or every fixture's) axes stay stale to the end; an
        inactive fixture's wait for the switch to it. After an unpredicted
        probe every axis already is, for its own reason (probe_events)."""
        if self._probe_unknown:
            return
        idx = getattr(self, "g5x_index", None)
        if target in ("all", "active") or target == idx:
            self._frame_unknown = self._frame_unknown | axes
            self.stale = self.stale | axes
            # named once a move runs in it (a reset at M2 is no cause)
            if line not in self.stale_offset_lines + self._pending_offset_lines:
                self._pending_offset_lines = self._pending_offset_lines + (line,)
        else:
            had = self._reg_unknown.get(target)
            self._reg_unknown = {**self._reg_unknown,
                                 target: ((had[0] | axes) if had else axes, had[1] if had else line)}

    def _register_write(self):
        """The controller reports a write of an active register (a callback:
        G92 / G52, a G10 on the active fixture, a reset at M2). The EVENT is
        the evidence, never the value — a G92 Z40 at a believed Z40 computes
        the old offset again (Codex R97); re-selecting the active fixture
        makes no call at all (measured). Where this file's text speaks for
        the line, an explicit write is no cause, and in text order a listed
        one is the scan's (taken at the next line) — but only a write OF that
        text: a remap body's or a called file's callback is a write the line
        does not show, named by the main line, never excused by it (Codex
        R108 VP-I65: `G10 L2 P1 X0 M200`, the body's G92 from the unknown
        position). Everything else counts: a line the scan missed ("not
        found" is no proof of none), a listed line out of text order, any
        line of another file."""
        if not (self.stale and self._program_line()):
            return
        n = self._write_line()
        if (self.write_lines is not None and self.write_mode in ("ordered", "inline")
                and self._in_main_file() is not False):
            t = self.write_lines.get(n)
            if t == "explicit" or (t is not None and self.write_mode == "ordered"):
                return
        self._position_write(self._backstop_line(), "all", self.stale)

    # WCS basis writers (rs274.interpret.Translated): the ONLY paths that
    # change what wcs_basis() returns — flag, then let the parent assign.
    def set_g5x_offset(self, *args, **kw):
        self._enter()
        self._wcs_dirty = True
        before = getattr(self, "g5x_index", None)
        r = super().set_g5x_offset(*args, **kw)
        idx = getattr(self, "g5x_index", None)
        if self._program_line():
            if idx != before:
                # a switch reads the table (and re-applies G92 next: that call
                # is the switch's, not a write)
                self._switch_g92_line = self.lineno
                if idx in self._reg_unknown:
                    axes, line = self._reg_unknown[idx]
                    self._position_write(line, "all", axes)   # its offsets were the guess
            else:
                self._register_write()
        return r

    def set_g92_offset(self, *args, **kw):
        self._enter()
        self._wcs_dirty = True
        r = super().set_g92_offset(*args, **kw)
        if self._switch_g92_line is not None and self._switch_g92_line == self.lineno:
            self._switch_g92_line = None
        else:
            self._register_write()
        return r

    def _backstop_line(self):
        """The line a callback-caught write is named by: where every number is
        the main file's (ordered or inline text) its line, else 0 — with a
        call into another file a number may be that file's, and a main-file
        write listed under the same number proves no shared origin (Codex R98
        VP-I56): a note must not name the wrong main-file line."""
        if self.write_lines is not None and self.write_mode in ("ordered", "inline"):
            return self._write_line()
        return 0

    def _write_line(self):
        """The main-file line a callback-caught write ran in: the
        interpreter's word (a remap body's line is its own file's, Codex
        R107), else the current number."""
        m = self.main_line()
        return m if m is not None else int(self.lineno or 0)

    def set_xy_rotation(self, *args, **kw):
        self._enter()
        self._wcs_dirty = True
        before = getattr(self, "rotation_xy", 0) or 0
        r = super().set_xy_rotation(*args, **kw)
        # A turned frame mixes the program's X and Y: one of them unknown
        # makes both unknown (Codex R94 VP-I51 D).
        if self.stale & {0, 1} and abs((getattr(self, "rotation_xy", 0) or 0) - before) > 1e-12:
            self.stale = self.stale | {0, 1}
        return r

    def _program(self, p):
        """A translated point back in the PROGRAM frame of the offsets in
        effect now — rotate_and_translate inverted (rs274.interpret: + G92,
        rotate by the XY rotation, + G5x). `lo` is the machine-frame point
        (less the tool offset, which tool_offset re-expresses), so this is
        the interpreter's own program position for it."""
        x, y, z, a, b, c, u, v, w = (p[i] - getattr(self, "g5x_offset_" + s, 0.0)
                                     for i, s in enumerate(self._WCS_SUFFIXES))
        if getattr(self, "rotation_xy", 0):
            x, y = (x * self.rotation_cos + y * self.rotation_sin,
                    -x * self.rotation_sin + y * self.rotation_cos)
        q = (x, y, z, a, b, c, u, v, w)
        return tuple(q[i] - getattr(self, "g92_offset_" + s, 0.0) for i, s in enumerate(self._WCS_SUFFIXES))

    def _unknown_move(self, end):
        """A motion from a position with a stale axis: its end as a
        zero-length unknown-start endpoint (rapid stream, like the program's
        own first move); the block's start is noted (the next line compares
        the block's end with it)."""
        if self._program_line():
            seq = self._next_seq()
            self.rapid.append((self.lineno, end, end, (self.xo, self.yo, self.zo), seq))
            self.unknown_start.append(seq)
            if self._pending_offset_lines:
                self.stale_offset_lines = self.stale_offset_lines + self._pending_offset_lines
                self._pending_offset_lines = ()
        if self._block_start is None:
            self._block_start = self.lo
        self.lo = end

    def straight_traverse(self, x, y, z, a, b, c, u, v, w):
        self._enter()
        if self.suppress > 0: return
        l = self.rotate_and_translate(x, y, z, a, b, c, u, v, w)
        if self.stale:
            self.first_move = False
            self._unknown_move(l)
            return
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
        self._enter()
        if self.suppress > 0: return
        self.first_move = False
        l = self.rotate_and_translate(x, y, z, a, b, c, u, v, w)
        if self.stale:
            self._unknown_move(l)
            return
        self.feed.append((self.lineno, self.lo, l, self.feedrate, (self.xo, self.yo, self.zo), self._next_seq()))
        self.lo = l

    straight_probe = straight_feed

    def rigid_tap(self, x, y, z):
        self._enter()
        if self.suppress > 0: return
        self.first_move = False
        if self.stale:
            self._unknown_move(self.lo)   # a tap ends where it began
            return
        l = self.rotate_and_translate(x, y, z, 0, 0, 0, 0, 0, 0)[:3]
        l += (self.lo[3], self.lo[4], self.lo[5],
              self.lo[6], self.lo[7], self.lo[8])
        self.feed.append((self.lineno, self.lo, l, self.feedrate, (self.xo, self.yo, self.zo), self._next_seq()))
        self.feed.append((self.lineno, l, self.lo, self.feedrate, (self.xo, self.yo, self.zo), self._next_seq()))

    def straight_arcsegments(self, segs):
        self._enter()
        self.first_move = False
        if self.stale and segs:
            # The whole arc was computed from the old position (its centre is
            # relative to it): only its end, and only as an unknown start.
            self._unknown_move(segs[-1])
            return
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
        # A parameter the file lacks goes IN ORDER: LinuxCNC reads the file
        # ascending only ("Parameter file out of order" — a toolsetter key
        # appended after the 52xx fixture rows refused the whole parse).
        add = sorted((int(p), p) for p in patches if p not in seen)
        if add:
            def _num(line):
                parts = line.split()
                try:
                    return int(parts[0]) if len(parts) >= 2 else None
                except ValueError:
                    return None
            out: List[str] = []
            ai = 0
            for line in lines:
                n = _num(line)
                while ai < len(add) and n is not None and add[ai][0] < n:
                    out.append(f"{add[ai][1]}\t{patches[add[ai][1]]}\n")
                    ai += 1
                out.append(line if line.endswith("\n") else line + "\n")
            for _, p in add[ai:]:
                out.append(f"{p}\t{patches[p]}\n")
            lines = out
        with open(path, "w") as f:
            f.writelines(lines)
    except Exception as e:
        print(f"[GCODE] var file patch failed: {e}")
