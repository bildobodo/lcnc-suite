#!/usr/bin/env python3
"""Shared G-code preview canon + var-file patching.

Lives outside gateway.py so the subprocess worker (gcode_parse_worker.py)
can import the same class without dragging gateway state in. Gateway uses
apply_var_patches() when building the context handed to the worker.
"""

import math
from typing import Dict, List
from rs274.interpret import Translated, ArcsToSegmentsMixin, StatMixin


# Adaptive arc tessellation (A1). Chord tolerance in canon units (inches —
# LinuxCNC internal). 0.001 in ≈ 0.025 mm — sub-pixel at typical viewports.
# Bounds prevent both pathological coarsness on tiny arcs and runaway segment
# counts on huge-radius arcs where the controller would still emit a smooth
# enough preview at 64 segments per full circle.
_ARC_EPS = 0.001
_ARC_MIN_SEGS = 8
_ARC_MAX_SEGS = 64


class PreviewCanon(Translated, ArcsToSegmentsMixin, StatMixin):
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
        self.xo = self.yo = self.zo = 0.0
        self.ao = self.bo = self.co = 0.0
        self.uo = self.vo = self.wo = 0.0
        self.g5x_index = 1
        self.plane = 1
        self.arcdivision = _ARC_MAX_SEGS

    def next_line(self, st):
        self.state = st
        self.lineno = st.sequence_number

    def set_feed_rate(self, f): self.feedrate = f / 60.0
    def set_spindle_rate(self, _): pass
    def select_plane(self, _): pass
    def comment(self, _): pass
    def message(self, _): pass
    def check_abort(self): pass
    def user_defined_function(self, i, p, q): pass
    def dwell(self, _): pass

    def change_tool(self, idx):
        StatMixin.change_tool(self, idx)
        self.first_move = True
        self.tool_changes += 1
        # (lineno, tool) per executed M6 — timeline event markers. NOTE: only
        # canon-executed changes appear here (an M600 remap whose body is
        # preview-skipped contributes none — same honesty rule as the stats).
        self.tool_change_events.append((self.lineno, idx))
        if idx > 0:
            self.tools_used.add(idx)

    def tool_offset(self, xo, yo, zo, ao, bo, co, uo, vo, wo):
        self.first_move = True
        x, y, z, a, b, c, u, v, w = self.lo
        self.lo = (x - xo + self.xo, y - yo + self.yo, z - zo + self.zo,
                   a - ao + self.ao, b - bo + self.bo, c - co + self.co,
                   u - uo + self.uo, v - vo + self.vo, w - wo + self.wo)
        self.xo, self.yo, self.zo = xo, yo, zo
        self.ao, self.bo, self.co = ao, bo, co
        self.uo, self.vo, self.wo = uo, vo, wo

    # rotate_and_translate keeps straight moves in the same translated frame
    # gcode.arc_to_segments produces for arcs; WCS offsets subtract once at
    # extraction time (not here).
    def _next_seq(self):
        self.seq += 1
        return self.seq

    def straight_traverse(self, x, y, z, a, b, c, u, v, w):
        if self.suppress > 0: return
        l = self.rotate_and_translate(x, y, z, a, b, c, u, v, w)
        if self.first_move:
            # First motion after program start / tool change: the PRIOR
            # position is unknown (machine parked spot, post-M6 pre-position),
            # so this one segment can't be plotted — but its END is a
            # commanded, known position. Clear the flag here so subsequent
            # rapids ARE recorded. (gremlin keeps suppressing until the first
            # FEED, which silently drops entire leading rapid sequences — the
            # scrub track and collision sweep need those lines: a low rapid
            # traverse before the first cut is exactly the classic crash.)
            self.first_move = False
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

    LinuxCNC only writes the var file on shutdown, so runtime edits (e.g.
    G10 L2 R rotation) don't reach disk until then. Gateway hands us the
    fresh values; we rewrite the temp copy the parser will read.
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
