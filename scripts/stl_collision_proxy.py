#!/usr/bin/env python3
"""Collision proxies for prismatic hardware (2026-09-13).

Reads a binary STL, splits it into connected components (triangles sharing a
vertex, coordinates rounded to 1 µm) and writes one axis-aligned bounding box
per component — 12 triangles each — as the part's COLLISION mesh (machine.json
`collision: "collision/<part>.stl"`). The display mesh is untouched.

Why: the wall gantry tessellates its linear guides (HIWIN rail/block profiles)
into ~210,000 of the model's 236,000 triangles; every clearance query walked
those BVHs and a 1.2 M-point program's sweep went from minutes to hours. For
collision purposes a rail, a block or an end cap IS its box. The box of a
component CONTAINS the component, so the sweep can only become more
conservative — its no-missed-crossing guarantee is unchanged (the vitest gate
machineGantry.test.ts checks the containment of every proxied part).

Only use it on parts whose components are box-like in their own frame. A box
around a ring, a tilted housing or a set of ribs fills the space between and
inside them and reports crashes that are not there — keep those on their mesh.

Usage:
  stl_collision_proxy.py IN.stl OUT.stl          write the proxy
  stl_collision_proxy.py --check IN.stl OUT.stl  exit 1 unless OUT is byte-for-
                                                 byte the proxy IN produces
Deterministic: components sorted by their minimum corner; the 80-byte header
names the source file. Stdlib only.
"""
import os
import struct
import sys


def read_stl(path):
    with open(path, "rb") as f:
        data = f.read()
    if data[:7] == b"version":
        raise SystemExit(f"{path}: Git LFS pointer, not a mesh — run `git lfs pull`")
    if data[:5] == b"solid" and b"facet" in data[:400]:
        raise SystemExit(f"{path}: ASCII STL — this tool reads binary STL only")
    if len(data) < 84:
        raise SystemExit(f"{path}: too small for a binary STL")
    n = struct.unpack_from("<I", data, 80)[0]
    if 84 + n * 50 != len(data):
        raise SystemExit(f"{path}: size mismatch for {n} triangles")
    tris = []
    for i in range(n):
        v = struct.unpack_from("<9f", data, 84 + i * 50 + 12)
        tris.append(((v[0], v[1], v[2]), (v[3], v[4], v[5]), (v[6], v[7], v[8])))
    return tris


def components(tris):
    """Union-find over triangles that share a (rounded) vertex."""
    parent = list(range(len(tris)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    seen = {}
    for i, tri in enumerate(tris):
        for p in tri:
            key = (round(p[0], 3), round(p[1], 3), round(p[2], 3))
            j = seen.get(key)
            if j is None:
                seen[key] = i
            else:
                ra, rb = find(i), find(j)
                if ra != rb:
                    parent[ra] = rb
    groups = {}
    for i in range(len(tris)):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def aabb(tris, idx):
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for i in idx:
        for p in tris[i]:
            for k in range(3):
                if p[k] < lo[k]:
                    lo[k] = p[k]
                if p[k] > hi[k]:
                    hi[k] = p[k]
    return tuple(lo), tuple(hi)


def box_triangles(lo, hi):
    """12 triangles, outward normals, counter-clockwise seen from outside."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    c = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    faces = [((0, 0, -1), (0, 3, 2, 1)), ((0, 0, 1), (4, 5, 6, 7)),
             ((0, -1, 0), (0, 1, 5, 4)), ((0, 1, 0), (2, 3, 7, 6)),
             ((-1, 0, 0), (0, 4, 7, 3)), ((1, 0, 0), (1, 2, 6, 5))]
    out = []
    for nrm, (a, b, cc, d) in faces:
        out.append((nrm, c[a], c[b], c[cc]))
        out.append((nrm, c[a], c[cc], c[d]))
    return out


def proxy_bytes(src_path):
    tris = read_stl(src_path)
    boxes = sorted(aabb(tris, idx) for idx in components(tris))
    out = []
    for lo, hi in boxes:
        out.extend(box_triangles(lo, hi))
    header = f"lcnc-suite collision proxy of {os.path.basename(src_path)}".encode()[:80].ljust(80, b"\0")
    body = bytearray(header)
    body += struct.pack("<I", len(out))
    for nrm, a, b, c in out:
        body += struct.pack("<12fH", *nrm, *a, *b, *c, 0)
    return bytes(body), len(tris), len(boxes)


def main(argv):
    check = "--check" in argv
    args = [a for a in argv if a != "--check"]
    if len(args) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    src, dst = args
    data, ntri, nbox = proxy_bytes(src)
    if check:
        try:
            with open(dst, "rb") as f:
                same = f.read() == data
        except FileNotFoundError:
            same = False
        print(f"{'ok' if same else 'STALE'} {dst}: {nbox} boxes for {ntri} triangles")
        return 0 if same else 1
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    with open(dst, "wb") as f:
        f.write(data)
    print(f"{src}: {ntri} triangles, {nbox} components -> {dst}: {nbox * 12} triangles")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
