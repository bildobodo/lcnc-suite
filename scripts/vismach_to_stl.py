#!/usr/bin/env python3
"""Convert the LinuxCNC vismach XYZAC trunnion-mill model to viewer assets.

Geometry transcribed from /usr/bin/xyzac-trt-gui (Copyright 2016 Rudy du
Preez, GPL v2+, shipped with LinuxCNC). The vismach model is a tree of
boxes/cylinders under HAL-driven transforms; this script bakes each rigid
assembly (base, knee, saddle, table, A-trunnion, C-platter) into binary
STL files — one per (assembly, color) pair, since STL carries no color —
plus a machine.json in lcnc-webui's viewer_init schema (groups / parts /
kinematics / workGroup / toolGroup) that ThreeViewer articulates with
live joint positions.

Layout notes (viewer semantics, see ThreeViewer.vue applyState):
- Transforms COMPOSE: a group may carry a static pivot `translate` plus any
  number of translate/rotate kinematics DOFs; the viewer resets driven
  groups to their base each frame and accumulates DOFs on top (the TCP
  tool offset composes with the tool group's base the same way).
- This is a knee mill: the head/spindle is fixed to the column; the Z
  joint moves the whole knee (saddle+table+trunnion) down (sign -1).
- The original model's y-offset / z-offset HAL pins (A-pivot position
  relative to the C rotary center) are baked in as constants, matching
  hallib/vismach_xyzac.hal.
- The original's red reference tool is intentionally omitted: ThreeViewer
  draws the real tool from the tool table at the toolGroup.

Usage:  python3 scripts/vismach_to_stl.py
Output: examples/sim_config/machine-xyzac/*.stl + machine.json
"""

import json
import math
import struct
from pathlib import Path

Y_OFFSET = 20.0  # A-pivot Y relative to C rotary center (matches HAL setp)
Z_OFFSET = 10.0  # A-pivot Z relative to C rotary center (matches HAL setp)
SEGMENTS = 32    # cylinder tessellation, same as vismach's gluCylinder
KNEE_Z = 200.0   # knee home height: platter top meets the tool tip

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
}


def build_meshes():
    """Return {part_id: (group, color_key, triangles)} in group-local mm coords."""
    # -- static base + column + head + spindle (head at z+200 on the column) --
    head_z = 200.0
    base_green = (
        box(-120, -100, -250, 120, 160, -100)            # base
        + box(-50, 100, -250, 50, 200, 260)              # column
        + translate(box(-30, -30, 60, 30, 240, 135), 0, 0, head_z)  # head
    )
    base_yellow = (
        box(-25, -100, -195, 25, -110, -145)             # Z motor
        + cylinder_z(-100, 15, 50, 15)                   # Z lead screw
    )
    sp = head_z + 20.0                                   # spindle frame offset
    base_teal = (
        translate(cylinder_z(0, 10, 20, 15), 0, 0, sp)     # spindle nose
        + translate(cylinder_z(20, 20, 135, 20), 0, 0, sp)  # spindle housing
        + translate(cylinder_z(135, 30, 200, 30), 0, 200, head_z)  # motor
    )

    knee_yellow = box(-50, -100, -180, 50, 120, -105)

    saddle_silver = box(-75, -53, -105, 75, 53, -73)

    table_gray = (
        box(-150, -50, -69, 150, 50, -52)                # body
        + box(-150, -40, -75, 150, 40, -69)              # ways
        + translate(
            box(-77, -40, -50, -67, 40, 0)               # bracket left
            + box(77, -40, -50, 67, 40, 0)               # bracket right
            + box(77, 40, -52, -77, -40, -40),           # mounting plate
            0, Y_OFFSET, Z_OFFSET)
    )

    a_orange = (
        box(-65, -40, -35, 65, 40, -25)                  # trunnion plate
        + box(-65, -40, -35, -55, 40, 0)                 # side plate left
        + box(55, -40, -35, 65, 40, 0)                   # side plate right
        + cylinder_x(-78, 20, -55, 20)                   # trunnion shaft left
        + cylinder_x(55, 15, 70, 15)                     # trunnion shaft right
    )
    a_white = box(-80, -20, -1, -78, 20, 1)              # drive-side mark

    c_base_blue = box(-50, -50, -30, 50, 50, -18)        # rotary base

    platter_magenta = cylinder_z(-18, 50, 0, 50)
    platter_white = (
        cylinder_x(-50, 1, 50, 1)                        # cross X
        + cylinder_y(-50, 1, 50, 1)                      # cross Y
        + box(42, -4, -20, 51, 4, 5)                     # lump on one side
    )

    return {
        "base_frame":      (None,         "green",   base_green),
        "base_drives":     (None,         "yellow",  base_yellow),
        "base_spindle":    (None,         "teal",    base_teal),
        "knee":            ("knee",       "yellow",  knee_yellow),
        "saddle":          ("saddle",     "silver",  saddle_silver),
        "table":           ("table",      "gray",    table_gray),
        "a_trunnion":      ("a_assembly", "orange",  a_orange),
        "a_mark":          ("a_assembly", "white",   a_white),
        "c_base":          ("c_assembly", "blue",    c_base_blue),
        "c_platter":       ("c_platter",  "magenta", platter_magenta),
        "c_platter_marks": ("c_platter",  "white",   platter_white),
    }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    meshes = build_meshes()
    total = 0
    parts = []
    for part_id, (group, color, tris) in meshes.items():
        write_stl(OUT_DIR / f"{part_id}.stl", tris)
        parts.append({
            "id": part_id,
            "file": f"{part_id}.stl",
            "group": group,
            "translate": [0, 0, 0],
            "color": COLORS[color],
        })
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
