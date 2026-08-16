#!/usr/bin/env bash
# Regenerate the DMU 160 P machine STLs from Sigma1912's repo.
#
# Source: https://github.com/Sigma1912/LinuxCNC_Demo_Configs
#         5axis-twp/spindle-nutating_table-rotary/DMU-160-P/vismach-stl-files
#         (GPL v3, by Sigma1912 — see README.md in this directory)
#
# The upstream files are ASCII STL (~53 MB total). This script downloads
# them, converts to binary STL (~9 MB), and bakes the vismach pre-rotation
# of the B head (net +45 deg about +X, from vtk-dmu-160-p-gui.py:
# Rotate(-90,-1,0,0) then Rotate(nutation=45,-1,0,0)) into the mesh so
# machine.json needs no per-part rotation.
#
# The converted binaries are committed to this repo — run this only to
# re-fetch from upstream (needs network + python3 with numpy).
set -euo pipefail
cd "$(dirname "$0")"

BASE="https://raw.githubusercontent.com/Sigma1912/LinuxCNC_Demo_Configs/main/5axis-twp/spindle-nutating_table-rotary/DMU-160-P/vismach-stl-files"
FILES=(160Pbase 160PB 160PC 160PX 160PY 160PZ work_piece_1)

for f in "${FILES[@]}"; do
    echo "fetching $f.stl ..."
    curl -sfL "$BASE/$f.stl" -o "$f.stl.ascii" &
done
wait

python3 - << 'EOF'
import numpy as np, struct, math, os

def read_ascii(path):
    verts = []
    with open(path) as f:
        for line in f:
            s = line.split()
            if s and s[0] == "vertex":
                verts.append((float(s[1]), float(s[2]), float(s[3])))
    return np.array(verts, dtype=np.float64)

def write_bin(path, v):
    n = len(v) // 3
    tri = v.reshape(n, 3, 3)
    e1 = tri[:, 1] - tri[:, 0]
    e2 = tri[:, 2] - tri[:, 0]
    nrm = np.cross(e1, e2)
    l = np.linalg.norm(nrm, axis=1, keepdims=True)
    l[l == 0] = 1
    rec = np.zeros((n, 50), dtype=np.uint8)
    rec[:, 0:12] = (nrm / l).astype(np.float32).view(np.uint8).reshape(n, 12)
    rec[:, 12:48] = tri.astype(np.float32).reshape(n, 9).view(np.uint8).reshape(n, 36)
    with open(path, "wb") as f:
        f.write(b"\0" * 80)
        f.write(struct.pack("<I", n))
        f.write(rec.tobytes())

for name in ["160Pbase", "160PB", "160PC", "160PX", "160PY", "160PZ", "work_piece_1"]:
    v = read_ascii(f"{name}.stl.ascii")
    if name == "160PB":
        # Bake the vismach pre-rotation: net +45 deg about +X.
        th = math.radians(45.0)
        c, s = math.cos(th), math.sin(th)
        y, z = v[:, 1].copy(), v[:, 2].copy()
        v[:, 1] = y * c - z * s
        v[:, 2] = y * s + z * c
    write_bin(f"{name}.stl", v)
    os.remove(f"{name}.stl.ascii")
    print(f"{name}.stl: {len(v)//3} tris (binary)")
EOF
echo "done."
