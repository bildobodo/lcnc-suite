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
