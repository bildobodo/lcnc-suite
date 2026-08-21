#!/usr/bin/env python3
"""Generate the XYZACB-TRSRN nutating-head viewer model (machine.json + STLs).

Companion to vismach_to_stl.py (the XYZAC trunnion mill). Same discipline:
a hand-written geometry BUILDER, not a vismach parser, and the functional
assembly is DERIVED from the kinematic constants rather than transcribed —
the v2 lesson from the trunnion model, where a verbatim transcription drew
a machine for pivot offsets the shipped config did not use.

Design reference: LinuxCNC's `xyzacb-trsrn-gui` vismach model (David
Mueller, GPL v2) from the master TWP sample config. Machine layout, per the
kins comp's own math (scripts/kins_oracle/xyzacb_trsrn.comp) rather than
its docstring, which names the letters wrongly:

    j0 j1 j2 = X Y Z   head-moving linear slides (sign +1)
    j3 = A             WORK-side rotary table, axis along world +X
    j4 = B             TOOL-side NUTATING rotary, axis (0, sin nu, cos nu)
    j5 = C             TOOL-side primary swivel about +Z

so the rotaries are SPLIT across the two chains — a third topology next to
machine-xyzac (both work-side) and machine-dmu160p (both tool-side).

LOAD-BEARING CONSTANTS. Everything below is derived from the seven kins
geometry pins plus the machine-zero and table placement; the INI must set
the same values via `[HAL]HALCMD setp <module>_kins.<pin>` (the gateway's
parse_kins_config and the forked TWP remap both read only that form).
Changing a pin here without changing the INI desynchronises the 3D model
from the kinematics — kins_pivot_warning exists to catch exactly that.

THE NUTATION CLEARANCE RULE. A rotation about the nutation axis n
preserves a point's coordinate ALONG n. So if every B-side body lies in
n·p <= -JOINT_GAP and every C-side body in n·p >= +JOINT_GAP, the B joint
can never drive those two groups into each other — for any B, at any C.
That is the same invariant-clearance trick the trunnion model uses for its
cheeks (x-clearances survive rotation about X); here it is what makes a
55-degree nutating head with a 50 mm pivot offset mechanically sound
instead of self-intersecting. Every dimension below is checked against it
by _assert_nutation_clearance().

SCHEMATIC, AND SAID SO: the head moves in all three linear axes while the
column is static, so no fixed structure can support the ram without a
telescoping model the schema has no way to express. The column is
therefore drawn as a PORTAL the ram passes through with real clearance
across the working envelope — it is a body the head can crash into, not a
fake support. Nothing here claims a bearing that does not exist.

Usage:  python3 scripts/vismach_to_stl_trsrn.py
Output: examples/sim_config/machine-xyzacb-trsrn/*.stl + machine.json
"""

import json
import math
import struct
from pathlib import Path

# ── kins geometry pins — MUST match the INI's `setp <module>_kins.*` lines ──
NUT_ANGLE = 55.0      # nut-angle    (deg)
PIVOT_Y = 50.0        # y-pivot      spindle axis offset from the C axis
PIVOT_Z = 120.0       # z-pivot      B pivot height above the spindle nose
OFFSET_X = 0.0        # x-offset
OFFSET_Y = 0.0        # y-offset
Y_ROT_AXIS = -1000.0  # y-rot-axis   A axis, measured from machine zero
Z_ROT_AXIS = -2000.0  # z-rot-axis

# ── frame placement (from the vismach model's own constants) ──
MZ = (-1000.0, 1000.0, 2000.0)   # world position of the spindle nose at J=0
TABLE_X = -1700.0                # world X of the rotary table's face centre

SEGMENTS = 32     # cylinder tessellation, same as vismach's gluCylinder
JOINT_GAP = 2.0   # half-clearance across the nutation joint face (mm)

# The A axis lies along world +X at (y, z) = machine zero + (rot-axis pins).
A_AXIS_Y = MZ[1] + Y_ROT_AXIS
A_AXIS_Z = MZ[2] + Z_ROT_AXIS

_NU = math.radians(NUT_ANGLE)
NUT_AXIS = (0.0, math.sin(_NU), math.cos(_NU))

OUT_DIR = (Path(__file__).resolve().parent.parent
           / "examples" / "sim_config" / "machine-xyzacb-trsrn")


# ── mesh primitives (lists of ((v1, v2, v3)) triangles, CCW outward) ──

def box(x1, y1, z1, x2, y2, z2):
    x1, x2 = sorted((x1, x2))
    y1, y2 = sorted((y1, y2))
    z1, z2 = sorted((z1, z2))
    p = [(x1, y1, z1), (x2, y1, z1), (x2, y2, z1), (x1, y2, z1),
         (x1, y1, z2), (x2, y1, z2), (x2, y2, z2), (x1, y2, z2)]
    quads = [(0, 3, 2, 1),   # bottom (-Z)
             (4, 5, 6, 7),   # top (+Z)
             (0, 1, 5, 4),   # -Y
             (2, 3, 7, 6),   # +Y
             (1, 2, 6, 5),   # +X
             (3, 0, 4, 7)]   # -X
    tris = []
    for a, b, c, d in quads:
        tris.append((p[a], p[b], p[c]))
        tris.append((p[a], p[c], p[d]))
    return tris


def _frustum_z(z1, r1, z2, r2):
    if z1 > z2:
        z1, z2 = z2, z1
        r1, r2 = r2, r1
    tris = []
    for i in range(SEGMENTS):
        a0 = 2 * math.pi * i / SEGMENTS
        a1 = 2 * math.pi * (i + 1) / SEGMENTS
        c0, s0 = math.cos(a0), math.sin(a0)
        c1, s1 = math.cos(a1), math.sin(a1)
        b0 = (r1 * c0, r1 * s0, z1)
        b1 = (r1 * c1, r1 * s1, z1)
        t0 = (r2 * c0, r2 * s0, z2)
        t1 = (r2 * c1, r2 * s1, z2)
        if r1 > 0:
            tris.append((b0, b1, t1))
        if r2 > 0:
            tris.append((b0, t1, t0))
        if r1 > 0:  # bottom cap (faces -Z)
            tris.append(((0.0, 0.0, z1), b1, b0))
        if r2 > 0:  # top cap (faces +Z)
            tris.append(((0.0, 0.0, z2), t0, t1))
    return tris


def cylinder_z(z1, r1, z2, r2):
    return _frustum_z(z1, r1, z2, r2)


def cylinder_x(x1, r1, x2, r2):
    # vismach CylinderX = CylinderZ rotated so +Z → +X
    return [tuple((z, y, -x) for x, y, z in tri) for tri in _frustum_z(x1, r1, x2, r2)]


def translate(tris, dx, dy, dz):
    return [tuple((x + dx, y + dy, z + dz) for x, y, z in tri) for tri in tris]


def rotate_x(tris, deg):
    """Rotate about +X. Used to bake the static nutation tilt into the mesh —
    machine.json groups carry no static rotation, so a tilted body has to
    arrive already tilted (same rule the DMU model's fetch script follows)."""
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return [tuple((x, y * c - z * s, y * s + z * c) for x, y, z in tri)
            for tri in tris]


def along_nutation(t1, r1, t2, r2):
    """Frustum whose axis is the nutation axis n, spanning n-parameter t1..t2.

    Built along +Z then tilted by -nu about +X, which maps +Z onto
    (0, sin nu, cos nu) = n."""
    return rotate_x(_frustum_z(t1, r1, t2, r2), -NUT_ANGLE)


# ── binary STL writer ──

def write_stl(path, tris):
    with open(path, "wb") as f:
        f.write(b"\0" * 80)
        f.write(struct.pack("<I", len(tris)))
        for v1, v2, v3 in tris:
            ux = tuple(v2[i] - v1[i] for i in range(3))
            vx = tuple(v3[i] - v1[i] for i in range(3))
            n = (ux[1] * vx[2] - ux[2] * vx[1],
                 ux[2] * vx[0] - ux[0] * vx[2],
                 ux[0] * vx[1] - ux[1] * vx[0])
            ln = math.sqrt(sum(c * c for c in n)) or 1.0
            f.write(struct.pack("<3f", *(c / ln for c in n)))
            for v in (v1, v2, v3):
                f.write(struct.pack("<3f", *v))
            f.write(struct.pack("<H", 0))


COLORS = {
    "green":   [0.0, 1.0, 0.0],
    "teal":    [0.0, 0.5, 0.5],
    "yellow":  [1.0, 1.0, 0.0],
    "silver":  [0.8, 0.8, 0.8],
    "gray":    [0.4, 0.4, 0.4],
    "orange":  [1.0, 0.5, 0.0],
    "white":   [1.0, 1.0, 1.0],
    "blue":    [0.3, 0.5, 1.0],
    "magenta": [1.0, 0.0, 1.0],
    "tan":     [0.82, 0.72, 0.55],
}


# ── derived dimensions ──

# Tool side, in the B-PIVOT frame (origin = the B pivot; the spindle nose
# sits at (0, -PIVOT_Y, -PIVOT_Z) by definition of the two pivot pins).
NOSE = (0.0, -PIVOT_Y, -PIVOT_Z)
SPINDLE_R = 45.0          # spindle barrel
SPINDLE_HOUSE_R = 60.0    # housing above the barrel
NOSE_R = 30.0
STUB_R = 45.0             # the arm from the barrel up to the joint face

COLLAR_R = 150.0          # C-side sleeve around the nutation axis
COLLAR_T2 = 200.0
ARM_R = 90.0              # C-side arm up to the C bearing plate
ARM_Y = 60.0
PLATE_R = 180.0
PLATE_Z0, PLATE_Z1 = 400.0, 450.0   # C bearing plate, seats on the ram

RAM_HALF_X = 250.0
RAM_Z0 = PLATE_Z1 + PIVOT_Z          # nose-frame z of the ram underside
RAM_Z1 = RAM_Z0 + 500.0
RAM_Y0, RAM_Y1 = 200.0, 4600.0

# Work side, in the A-TABLE frame (+X is the rotation axis, face at x = 0).
PLATTER_R = 900.0
PLATTER_LEN = 700.0
CONSOLE_X = 1200.0        # angle plate standing off the faceplate
CONSOLE_HALF_Y = 920.0
CONSOLE_T = 200.0
STOCK = (300.0, -300.0, 0.0, 900.0, 300.0, 600.0)   # the 600 cube, on the plate


def _n_dot(p):
    return NUT_AXIS[0] * p[0] + NUT_AXIS[1] * p[1] + NUT_AXIS[2] * p[2]


def _assert_nutation_clearance(b_tris, c_tris):
    """Every B-side vertex must sit at n·p <= -JOINT_GAP and every C-side one
    at n·p >= +JOINT_GAP. Rotation about n preserves n·p, so this is what
    makes the B joint collision-free for ALL B by construction rather than
    by sampling. A violation here is a model bug, not a tolerance to relax."""
    tol = 1e-6   # the joint faces are authored exactly ON the +/-JOINT_GAP
                 # planes; only rounding from the nutation tilt may cross them
    b_max = max(_n_dot(v) for tri in b_tris for v in tri)
    c_min = min(_n_dot(v) for tri in c_tris for v in tri)
    if b_max > -JOINT_GAP + tol or c_min < JOINT_GAP - tol:
        raise SystemExit(
            f"nutation clearance violated: B side reaches n·p={b_max:.2f} "
            f"(need <= {-JOINT_GAP}), C side starts at n·p={c_min:.2f} "
            f"(need >= {JOINT_GAP})")
    return b_max, c_min


def build_meshes():
    """Return {part_id: (group, color_key, stock, triangles)}, group-local mm."""
    nx, ny, nz = NOSE

    # ---- B side: the nutating spindle head (b_nut frame = pivot) ----
    b_spindle = (
        translate(cylinder_z(nz, NOSE_R, nz + 20, SPINDLE_R), 0, ny, 0)
        + translate(cylinder_z(nz + 20, SPINDLE_R, nz + 60, SPINDLE_R), 0, ny, 0)
        + translate(cylinder_z(nz + 60, SPINDLE_HOUSE_R,
                               nz + 90, SPINDLE_HOUSE_R), 0, ny, 0)
        # arm from the barrel up to the joint face at n·p = -JOINT_GAP
        + along_nutation(-90.0, STUB_R, -JOINT_GAP, STUB_R)
    )

    # ---- C side: sleeve + arm + bearing plate (c_swivel frame = pivot) ----
    c_head = (
        along_nutation(JOINT_GAP, COLLAR_R, COLLAR_T2, COLLAR_R)
        + translate(cylinder_z(60, ARM_R, PLATE_Z1 - 40, ARM_R), 0, ARM_Y, 0)
        + cylinder_z(PLATE_Z0, PLATE_R, PLATE_Z1, PLATE_R)
    )

    _assert_nutation_clearance(b_spindle, c_head)

    # ---- the XYZ ram (xyz_head frame = the spindle nose at B = C = 0) ----
    ram = box(-RAM_HALF_X, RAM_Y0, RAM_Z0, RAM_HALF_X, RAM_Y1, RAM_Z1)

    # ---- static frame (root frame = world) ----
    bed = box(-3200, -1400, -1400, 1200, 2400, -1100)

    # A-axis bearing block behind the faceplate + its pedestal down to the bed
    plat_back = TABLE_X - PLATTER_LEN
    table_base = (
        box(plat_back - 400, A_AXIS_Y - 950, A_AXIS_Z - 950,
            plat_back, A_AXIS_Y + 950, A_AXIS_Z + 950)
        + box(plat_back - 350, A_AXIS_Y - 700, -1100,
              plat_back - 50, A_AXIS_Y + 700, A_AXIS_Z - 900)
    )

    # Portal the ram passes through. The opening clears the ram across the
    # working envelope (see machineTrsrn.test.ts) — it is a crash body, not
    # a support: nothing static can support a head that moves in X, Y and Z.
    column = (
        box(-2900, 2600, -1100, -2000, 3200, RAM_Z1 + MZ[2] + 100)
        + box(-400, 2600, -1100, 500, 3200, RAM_Z1 + MZ[2] + 100)
        + box(-2900, 2600, RAM_Z1 + MZ[2] + 100, 500, 3200, RAM_Z1 + MZ[2] + 600)
    )

    # ---- work side (a_table frame: +X is the A axis, faceplate at x = 0) ----
    platter = cylinder_x(-PLATTER_LEN, PLATTER_R, 0, PLATTER_R)
    platter_marks = (
        box(0, -12, -PLATTER_R + 40, 8, 12, PLATTER_R - 40)
        + box(0, -PLATTER_R + 40, -12, 8, PLATTER_R - 40, 12)
    )
    console = box(0, -CONSOLE_HALF_Y, -CONSOLE_T,
                  CONSOLE_X, CONSOLE_HALF_Y, 0)
    work_piece = box(*STOCK)

    return {
        "bed":            ("root",      "gray",    False, bed),
        "column":         ("root",      "green",   False, column),
        "table_base":     ("root",      "green",   False, table_base),
        "ram":            ("xyz_head",  "silver",  False, ram),
        "c_head":         ("c_swivel",  "orange",  False, c_head),
        "b_spindle":      ("b_nut",     "teal",    False, b_spindle),
        "platter":        ("a_table",   "magenta", False, platter),
        "platter_marks":  ("a_table",   "white",   False, platter_marks),
        "console":        ("a_table",   "gray",    False, console),
        "work_piece":     ("a_table",   "tan",     True,  work_piece),
    }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    meshes = build_meshes()
    total = 0
    parts = []
    for part_id, (group, color, stock, tris) in meshes.items():
        write_stl(OUT_DIR / f"{part_id}.stl", tris)
        entry = {
            "id": part_id,
            "file": f"{part_id}.stl",
            "group": None if group == "root" else group,
            "translate": [0, 0, 0],
            "color": COLORS[color],
        }
        if stock:
            entry["stock"] = True
        parts.append(entry)
        total += len(tris)

    machine = {
        "name": "XYZACB-TRSRN Nutating-Head Mill (TWP)",
        "source": ("LinuxCNC xyzacb-trsrn-gui vismach model "
                   "(David Mueller, GPL v2) — geometry derived from the "
                   "xyzacb_trsrn kins pins, not transcribed"),
        "groups": [
            # Tool chain. The head carries all three linear DOFs (one rigid
            # assembly in the source model), then C swivels about the pivot
            # and B nutates about it; `tool` steps back to the spindle nose,
            # so tool-vs-work relative pose is machine coords by construction.
            {"id": "xyz_head", "parent": "root", "translate": list(MZ)},
            {"id": "c_swivel", "parent": "xyz_head",
             "translate": [OFFSET_X, PIVOT_Y + OFFSET_Y, PIVOT_Z]},
            {"id": "b_nut", "parent": "c_swivel"},
            {"id": "tool", "parent": "b_nut", "translate": list(NOSE)},
            # Work chain: the A faceplate, its axis along world +X at the
            # (y, z) the rot-axis pins declare.
            {"id": "a_table", "parent": "root",
             "translate": [TABLE_X, A_AXIS_Y, A_AXIS_Z]},
            # The WORK frame rides the faceplate but is ORIGINED at machine
            # zero, not at the table centre — otherwise tool-vs-work relative
            # pose would carry the constant nose-to-table offset and the
            # toolpath would draw that far from the tool that follows it.
            # Splitting it from a_table is what keeps the A rotation about the
            # real axis while the work origin lands on machine zero: the
            # offset is exactly the rot-axis pins read backwards.
            {"id": "a_work", "parent": "a_table",
             "translate": [MZ[0] - TABLE_X, -Y_ROT_AXIS, -Z_ROT_AXIS]},
        ],
        "parts": parts,
        "kinematics": [
            {"group": "xyz_head", "joint": 0, "type": "translate", "direction": "x", "sign": 1},
            {"group": "xyz_head", "joint": 1, "type": "translate", "direction": "y", "sign": 1},
            {"group": "xyz_head", "joint": 2, "type": "translate", "direction": "z", "sign": 1},
            # A: vismach rotates the faceplate by -A about its local +Z, and
            # the two static 90-degree placements map that onto world +X.
            {"group": "a_table", "joint": 3, "type": "rotate", "direction": "x", "sign": -1},
            # B: +B about n. HalRotateNutation turns by -B about -n, same thing.
            {"group": "b_nut", "joint": 4, "type": "rotate",
             "axis": [round(v, 12) for v in NUT_AXIS], "sign": 1},
            {"group": "c_swivel", "joint": 5, "type": "rotate", "direction": "z", "sign": 1},
        ],
        "workGroup": "a_work",
        "toolGroup": "tool",
    }
    with open(OUT_DIR / "machine.json", "w") as f:
        json.dump(machine, f, indent=2)
    print(f"wrote {len(parts)} STLs, {total} triangles + machine.json → {OUT_DIR}")


if __name__ == "__main__":
    main()
