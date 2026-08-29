"""Pure geometry for table-aware TWP composition (stage 2 of the
table-aware wave).

The xyzacb-trsrn machine's A rotary is a WORK-side table (axis along
machine +X). The TWP plane is defined as static world numbers relative to
the G54 work offset; when the table has moved by d_a_deg since the plane
was defined, the physical plane feature's world pose is the definition
pose rotated about the table's axis line (x-parallel through machine
(y_rot_axis, z_rot_axis)).

Sign derivation: the kins comp's TCP (mode 1) forward expands to
    work = Rx(+A) . (machine - pivot) + pivot
so a table-fixed point's MACHINE coordinates move by Rx(-dA) when A
increases by dA.

SIGN IS LIVE-VERIFIED (2026-08-28, sim xyzacb-trsrn), not just derived:
scripts/parity_corpus/twp_a_tilt.ngc moves the table 20 deg between g68.2
and g53.3, and twp_parity.py's invariants (tool tip in the WORKPIECE
frame, from sampled joints) report normal_err 0.000 deg against the
G68.2-defined plane.  Adversarially falsified in the same session: with
this composition stubbed off, the identical program reports 19.31 deg -
the stale-plane defect itself.  A flipped sign would report ~40 deg.

This module is deliberately free of linuxcnc/interpreter imports so the
gateway test suite can import it directly (remap.py cannot be imported
off-machine).
"""

import math


def _rot_x(v, c, s):
    # Rx applied to a 3-vector: x unchanged, (y,z) rotated.
    return (
        float(v[0]),
        c * float(v[1]) - s * float(v[2]),
        s * float(v[1]) + c * float(v[2]),
    )


def compose_table_a(tool_z, tool_x, origin_world, d_a_deg, y_rot_axis, z_rot_axis):
    """Rotate the requested plane frame by the table's A move.

    tool_z, tool_x   plane frame direction vectors (world, definition pose)
    origin_world     plane origin POINT in machine coords
                     (work offset + definition origin vector)
    d_a_deg          machine-frame A now minus A at definition, degrees
    y_rot_axis,
    z_rot_axis       the table axis line's machine y/z (raw kins pin values)

    Returns (tool_z', tool_x', origin') as 3-tuples of float.  Direction
    vectors rotate about the axis DIRECTION; the origin rotates about the
    axis LINE.
    """
    th = -math.radians(float(d_a_deg))
    c, s = math.cos(th), math.sin(th)
    return _apply(tool_z, tool_x, origin_world, c, s, y_rot_axis, z_rot_axis)


def _apply(tool_z, tool_x, origin_world, c, s, y_rot_axis, z_rot_axis):
    z2 = _rot_x(tool_z, c, s)
    x2 = _rot_x(tool_x, c, s)
    py, pz = float(y_rot_axis), float(z_rot_axis)
    rel = (
        float(origin_world[0]),
        float(origin_world[1]) - py,
        float(origin_world[2]) - pz,
    )
    r2 = _rot_x(rel, c, s)
    return z2, x2, (r2[0], r2[1] + py, r2[2] + pz)


# ---------------------------------------------------------------------------
# Named directions. The plane is STORED in the TABLE frame — the frame in
# which a table-fixed feature has constant coordinates, datum'd so that it
# coincides with the machine frame at A = 0. Call sites then read as
# directions rather than as signed deltas, which is what a reader needs in
# order to check them: "machine -> table" and "table -> machine".
#
# This is the same frame the viewer's work group already draws in (a_work,
# child of the A table), and the same frame the kins' TCP mode calls "work":
#     work = Rx(+A) . (machine - pivot) + pivot
# so a plane stored here rides the workpiece by construction.
# ---------------------------------------------------------------------------

def to_table_frame(tool_z, tool_x, origin_machine, a_now_deg,
                   y_rot_axis, z_rot_axis):
    """Machine-frame plane -> table frame, at the CURRENT table pose."""
    return compose_table_a(tool_z, tool_x, origin_machine, -float(a_now_deg),
                           y_rot_axis, z_rot_axis)


def from_table_frame(tool_z, tool_x, origin_table, a_now_deg,
                     y_rot_axis, z_rot_axis):
    """Table-frame plane -> machine frame, at the CURRENT table pose.

    This is what G53.x needs: the head must be oriented to where the face IS
    right now, so the stored (table-frame) plane is mapped through the live
    table angle before the spindle angles are solved.
    """
    return compose_table_a(tool_z, tool_x, origin_table, float(a_now_deg),
                           y_rot_axis, z_rot_axis)


def to_table_frame_vector(v, a_now_deg):
    """Machine-frame free VECTOR -> table frame, at the CURRENT table pose.

    Rotation only: a free vector has no position, so the table axis LINE's
    pivot terms must cancel. Deriving the origin: with W the work offset and
    v the offset->origin vector, to_table_point(W + v) = to_table_point(W)
    + Rx(A)*v — the pivot appears once on the point and not at all on the
    vector. Pushing a vector through the POINT path instead displaces the
    result by (I - Rx(A))*pivot: ~776 mm at A=20 deg with this config's
    pivot (0, -1000, -2000). Same rotation sense as to_table_frame applies
    to its direction vectors (th = +radians(a_now)).
    """
    th = math.radians(float(a_now_deg))
    return _rot_x(v, math.cos(th), math.sin(th))


def from_table_frame_vector(v, a_now_deg):
    """Table-frame free VECTOR -> machine frame, at the CURRENT table pose."""
    return to_table_frame_vector(v, -float(a_now_deg))


def calc_shortest_distance(pos, trgt, mode):
    """Signed rotary move pos -> trgt (degrees) for the operator's P-word.

    mode 0: shortest distance either way (result in [-180, 180]).
    mode 1: positive rotation only.
    mode 2: negative rotation only.

    Moved here from remap.py (pure, linuxcnc-free) so the mode logic is
    unit-testable off-machine. Upstream's version chained the final `else`
    onto `if mode == 2`, so a mode-1 result was immediately overwritten
    with the shortest distance — positive-only requests could silently go
    the negative way. The elif chain is the fix.
    """
    dist_short = (float(trgt) - float(pos) + 180.0) % 360.0 - 180.0
    if dist_short >= 0:  # ie dist_long should be negative
        dist_long = -(360.0 - dist_short)
    else:
        dist_long = 360.0 + dist_short
    if mode == 1:  # positive rotation only
        dist = dist_short if dist_short >= 0 else dist_long
    elif mode == 2:  # negative rotation only
        dist = dist_short if dist_short < 0 else dist_long
    else:  # mode 0: shortest distance either way
        dist = dist_short
    return dist
