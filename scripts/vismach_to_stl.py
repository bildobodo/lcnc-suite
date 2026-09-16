#!/usr/bin/env python3
"""Generate the XYZAC trunnion-mill viewer model (v2, mechanically coherent).

v1 transcribed the LinuxCNC vismach xyzac-trt-gui geometry (Rudy du Preez,
GPL v2+) verbatim — and the collision sweep then proved that model was
drawn for pivot offsets ≈ 0 while the shipped config runs 20/10: the
trunnion support brackets floated above the table and the C base
interpenetrated the trunnion plate. v2 keeps the machine frame (base,
column, knee, saddle, table) and DERIVES the rotary assembly from the
pivot constants so it is mechanically sound:

- Support pads sit FLUSH on the table top; pillars rise to the trunnion
  shaft bearings at the pivot height.
- The cradle (plate + cheeks + shafts) swings a max radius of ~81 mm
  about the pivot; with Z_OFFSET=35 the lowest swing point clears the
  table top by ~5.7 mm through the FULL A range (analytic bound, also
  gated by src/viewer/machineModel.test.ts sweeping the real STLs).
- x-direction clearances (platter↔cheeks 4 mm, cheeks↔pillars 3 mm) are
  INVARIANT under A rotation (rotation about X preserves x) and above
  the 2 mm collision margin, so the rotary can articulate freely.
- The C stack (bearing housing + platter) seats ON the cradle plate;
  seat/bearing contacts are intentional and land in the sweep's
  staticContacts baseline.
- Platter TOP stays at table-frame z=0: machine Z0 = tool tip touching
  the platter surface, as before.
- The spindle nose is shortened so the nose→platter crash plane sits at
  machine Z −35; INI Z travel is −30..+100 (5 mm margin at full plunge,
  retract is POSITIVE Z — knee down).

Viewer semantics unchanged (see ThreeViewer.vue applyState): transforms
COMPOSE; knee mill (Z moves the knee, sign -1); the real tool is drawn by
ThreeViewer at the toolGroup.

Usage:  python3 scripts/vismach_to_stl.py
Output: examples/sim_config/machine-xyzac/*.stl + machine.json
"""

import json
import math
import struct
from pathlib import Path

Y_OFFSET = 20.0  # A-pivot Y relative to C rotary center (matches HAL setp)
Z_OFFSET = 35.0  # A-pivot Z above the platter top (matches HAL setp)
SEGMENTS = 32    # cylinder tessellation, same as vismach's gluCylinder
KNEE_Z = 200.0   # knee home height: platter top meets the tool tip

# ── v2 rotary-assembly dimensions (all derived checks in the docstring) ──
PLATTER_R = 40.0
PLATTER_H = 12.0          # platter top at z=0 (C frame) → bottom -12
CBASE_R = 36.0
CBASE_H = 12.0            # bearing housing under the platter → -24..-12
CRADLE_T = 8.0            # cradle plate thickness
CHEEK_X0, CHEEK_X1 = 44.0, 56.0   # cheek inner/outer |x|
SHAFT_R = 13.0
SHAFT_X1 = 75.0           # shaft outer |x| end
PILLAR_X0, PILLAR_X1 = 59.0, 73.0
PAD_X0, PAD_X1 = 55.0, 77.0

OUT_DIR = Path(__file__).resolve().parent.parent / "examples" / "sim_config" / "machine-xyzac"


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


def cylinder_y(y1, r1, y2, r2):
    # vismach CylinderY = CylinderZ rotated so +Z → +Y
    return [tuple((x, z, -y) for x, y, z in tri) for tri in _frustum_z(y1, r1, y2, r2)]


def translate(tris, dx, dy, dz):
    return [tuple((x + dx, y + dy, z + dz) for x, y, z in tri) for tri in tris]


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


# ── model geometry (transcribed from xyzac-trt-gui) ──

# Muted machine palette — MUST equal lcnc-webui/src/viewer/palette.ts
# (palette.test.ts pins the emitted machine.json against it). Keys are the
# ROLE a part plays; linear slides carry no color at all so the viewer's
# axis rule (X red / Y green / Z blue, muted) applies.
COLORS = {
    "frame":   [0.612, 0.612, 0.612],   # 0x9c9c9c
    "base":    [0.486, 0.486, 0.486],   # 0x7c7c7c
    "rotaryA": [0.549, 0.478, 0.388],   # 0x8c7a63 bronze
    "rotaryC": [0.478, 0.463, 0.565],   # 0x7a7690 slate
    "marks":   [0.788, 0.788, 0.788],   # 0xc9c9c9
    "slide":   None,                    # linear axis: no color, axis rule
}


def build_meshes():
    """Return {part_id: (group, color_key, triangles)} in group-local mm coords."""
    # -- static base + column + head (unchanged from the vismach original) --
    head_z = 200.0
    # Column moved back vs the original (front face y=130): at Y travel ±70
    # the saddle reaches y 123 — 7 mm clear of the column instead of 23 mm
    # INSIDE it (the original's geometry/travel contradiction). Head raised
    # (bottom world 290): trunnion pillar tops reach world 281 at Z −30, and
    # the original head bottom (260) sat in their sweep path.
    base_green = (
        box(-120, -100, -250, 120, 220, -100)            # base
        + box(-50, 130, -250, 50, 230, 340)              # column
        + translate(box(-30, -30, 90, 30, 240, 165), 0, 0, head_z)  # head
    )
    base_yellow = (
        box(-25, -100, -195, 25, -110, -145)             # Z motor
        # Z lead screw BELOW the knee at all travel (knee bottom reaches
        # world -80 at Z+100) — the original's screw skewered the saddle.
        + cylinder_z(-240, 15, -90, 15)
    )
    # Spindle, v2.1: nose bottom at world z 255 — tool stickout (55) must
    # exceed the trunnion cheek height above the work plane (49), or the
    # cheeks foul the nose on any XY excursion ≥ ~29 at work height (real
    # trunnion machines demand long tools for exactly this reason). Plunge
    # margin at full legal Z −30: 25 mm.
    base_teal = (
        cylinder_z(255, 10, 270, 15)                     # spindle nose
        + cylinder_z(270, 20, 340, 20)                   # spindle housing
        + translate(cylinder_z(135, 30, 200, 30), 0, 200, head_z)  # motor
    )

    knee_yellow = box(-50, -100, -180, 50, 120, -105)

    saddle_silver = box(-75, -53, -105, 75, 53, -73)

    # -- table, v2: support pads FLUSH on the table top (-52), pillars up to
    #    the trunnion shaft bearings at the pivot (y=Y_OFFSET, z=Z_OFFSET) --
    def _support(sx):
        pad = box(sx * PAD_X0, Y_OFFSET - 18, -52, sx * PAD_X1, Y_OFFSET + 18, -46)
        pillar = box(sx * PILLAR_X0, Y_OFFSET - 14, -46, sx * PILLAR_X1, Y_OFFSET + 14, Z_OFFSET + 16)
        return pad + pillar

    table_gray = (
        box(-150, -50, -69, 150, 50, -52)                # body
        + box(-150, -40, -75, 150, 40, -69)              # ways
        + _support(-1)
        + _support(+1)
    )

    # -- A cradle (a_assembly frame: origin = pivot; C center at (0, -Y_OFFSET)) --
    cy = -Y_OFFSET                                       # C rotary center y
    plate_top = -Z_OFFSET - PLATTER_H - CBASE_H          # C stack seats here (-59)
    a_orange = (
        # cradle plate under the C stack
        box(-CBASE_R - 10, cy - 26, plate_top - CRADLE_T, CBASE_R + 10, cy + 26, plate_top)
        # cheeks: from the plate up past the pivot, on the shaft axis (y=0,z=0)
        + box(-CHEEK_X1, -16, plate_top - 1, -CHEEK_X0, 16, 14)
        + box(CHEEK_X0, -16, plate_top - 1, CHEEK_X1, 16, 14)
        # trunnion shafts into the pillar bearings (static contact by design)
        + cylinder_x(-SHAFT_X1, SHAFT_R, -CHEEK_X1, SHAFT_R)
        + cylinder_x(CHEEK_X1, SHAFT_R, SHAFT_X1, SHAFT_R)
    )

    # -- C stack (c_assembly frame: platter top at z=0) --
    c_base_blue = cylinder_z(-PLATTER_H - CBASE_H, CBASE_R, -PLATTER_H, CBASE_R)

    platter_magenta = cylinder_z(-PLATTER_H, PLATTER_R, 0, PLATTER_R)
    platter_white = (
        cylinder_x(-PLATTER_R + 4, 1, PLATTER_R - 4, 1)  # cross X (half-proud at z0)
        + cylinder_y(-PLATTER_R + 4, 1, PLATTER_R - 4, 1)  # cross Y
        + box(26, -3, 0, 36, 3, 3)                       # C-orientation notch
    )

    return {
        "base_frame":      (None,         "frame",   base_green),
        "base_drives":     (None,         "frame",   base_yellow),
        "base_spindle":    (None,         "frame",   base_teal),
        "knee":            ("knee",       "slide",   knee_yellow),
        "saddle":          ("saddle",     "slide",   saddle_silver),
        "table":           ("table",      "slide",   table_gray),
        "a_trunnion":      ("a_assembly", "rotaryA", a_orange),
        "c_base":          ("c_assembly", "rotaryC", c_base_blue),
        "c_platter":       ("c_platter",  "rotaryC", platter_magenta),
        "c_platter_marks": ("c_platter",  "marks",   platter_white),
    }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    meshes = build_meshes()
    total = 0
    parts = []
    for part_id, (group, color, tris) in meshes.items():
        write_stl(OUT_DIR / f"{part_id}.stl", tris)
        part = {
            "id": part_id,
            "file": f"{part_id}.stl",
            "group": group,
            "translate": [0, 0, 0],
        }
        if COLORS[color] is not None:
            part["color"] = COLORS[color]
        parts.append(part)
        total += len(tris)

    machine = {
        "name": "XYZAC Trunnion Mill (vismach)",
        "source": "LinuxCNC xyzac-trt-gui vismach model (Rudy du Preez, GPL v2+)",
        "groups": [
            # Static translates are pivot/home offsets; the viewer composes
            # the kinematics DOFs on top of them each frame.
            {"id": "knee", "parent": "root", "translate": [0, 0, KNEE_Z]},
            {"id": "saddle", "parent": "knee"},
            {"id": "table", "parent": "saddle"},
            {"id": "a_assembly", "parent": "table", "translate": [0, Y_OFFSET, Z_OFFSET]},
            {"id": "c_assembly", "parent": "a_assembly", "translate": [0, -Y_OFFSET, -Z_OFFSET]},
            {"id": "c_platter", "parent": "c_assembly"},
            # Tool tip nominal position; the TCP offset composes with it.
            {"id": "tool", "parent": "root", "translate": [0, 0, KNEE_Z]},
        ],
        "parts": parts,
        "kinematics": [
            {"group": "table",      "joint": 0, "type": "translate", "direction": "x", "sign": -1},
            {"group": "saddle",     "joint": 1, "type": "translate", "direction": "y", "sign": -1},
            {"group": "knee",       "joint": 2, "type": "translate", "direction": "z", "sign": -1},
            {"group": "a_assembly", "joint": 3, "type": "rotate",    "direction": "x", "sign": 1},
            {"group": "c_platter",  "joint": 4, "type": "rotate",    "direction": "z", "sign": 1},
        ],
        "workGroup": "c_platter",
        "toolGroup": "tool",
    }
    with open(OUT_DIR / "machine.json", "w") as f:
        json.dump(machine, f, indent=2)
    print(f"wrote {len(parts)} STLs, {total} triangles + machine.json → {OUT_DIR}")


if __name__ == "__main__":
    main()
