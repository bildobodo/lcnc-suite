// Kinematics boundary: machine axis coords ↔ joint values.
//
// Everything offline (part-frame preview, scrub pose, collision sweep,
// entry move) needs JOINT values, but programs and WCS math live in
// machine AXIS coordinates (canonical slots 0..5 = X,Y,Z,A,B,C — the
// space programToMachine produces). The conversion between the two IS the
// machine's kinematics. Under trivkins it is a pure letter→slot
// permutation — which every consumer used to inline as
// `"XYZABC".indexOf(letter)`. This module makes that step an explicit,
// swappable model so non-trivial kinematics (xyzac-trt TCP, nutating
// heads — TCP+TWP plan phase 1c) plug in behind one interface instead of
// four scattered assumptions.
//
// Worker-boundary rule: machines cross postMessage as plain data, so a
// KinsModel is never serialized — consumers construct one AT THE USE SITE
// from the (clonable) axes list + KinsSpec via makeKins()/kinsFor().
//
// The Python twin of the non-trivial implementations lives in
// gateway_util.py (parse-time soft limits need inverse kins under TCP);
// both sides are pinned by ONE fixture set generated from the compiled
// LinuxCNC kins C source (scripts/gen_kins_fixtures.py) — same oracle
// discipline as rs274.test.ts. Trivkins needs no fixtures: it is the
// identity permutation by definition.

/** Pivot geometry for the trt models — mirrors the kins HAL pins
 *  (xyzac-trt-kins.y-offset etc.). Machine units. Absent fields = 0. */
export interface KinsParams {
  xRotPoint?: number; yRotPoint?: number; zRotPoint?: number;
  xOffset?: number; yOffset?: number; zOffset?: number;
  toolOffset?: number;
}

/** Serializable kins selection — rides machine.json / viewer_init and
 *  crosses worker boundaries. Absent/`trivkins` = identity permutation.
 *  Known types: `trivkins`, `xyzac-trt`, `xyzbc-trt`. */
export interface KinsSpec {
  type?: string;
  params?: KinsParams;
}

export interface KinsModel {
  readonly type: string;
  /** Machine axis coords → JOINT-ordered values (out.length = axes.length).
   *  A joint whose letter is outside XYZABC (UVW) yields null — the caller
   *  decides the fallback (pose paths use 0, the scrub keeps the live joint
   *  value) rather than this module inventing one. Returns `out`. */
  inverse(world: ReadonlyArray<number>, out: (number | null)[]): (number | null)[];
  /** JOINT-ordered values → machine axis coords. Fills world[0..5] (X..C);
   *  slots no joint maps to become 0. Null/missing joints contribute 0.
   *  Returns `world`. */
  forward(joints: ArrayLike<number | null>, world: number[]): number[];
}

class Trivkins implements KinsModel {
  readonly type = "trivkins";
  private slots: number[];
  constructor(axes: string[]) {
    this.slots = axes.map(l => "XYZABC".indexOf(l.toUpperCase()));
  }
  inverse(world: ReadonlyArray<number>, out: (number | null)[]): (number | null)[] {
    out.length = this.slots.length;
    for (let ji = 0; ji < this.slots.length; ji++) {
      const slot = this.slots[ji]!;
      out[ji] = slot >= 0 ? (world[slot] ?? 0) : null;
    }
    return out;
  }
  forward(joints: ArrayLike<number | null>, world: number[]): number[] {
    for (let s = 0; s < 6; s++) world[s] = 0;
    for (let ji = 0; ji < this.slots.length; ji++) {
      const slot = this.slots[ji]!;
      if (slot >= 0) world[slot] = joints[ji] ?? 0;
    }
    return world;
  }
}

const RAD = Math.PI / 180;

/** Principal joint index per letter — first joint whose letter matches,
 *  exactly like trtKinematicsSetup's assignment loop. -1 = absent. */
function principal(axes: string[], letter: string): number {
  for (let ji = 0; ji < axes.length; ji++) {
    if (axes[ji]!.toUpperCase() === letter) return ji;
  }
  return -1;
}

/** LinuxCNC xyzac-trt / xyzbc-trt world kinematics — line-for-line mirror
 *  of v2.9.4 trtfuncs.c (xyzac/xyzbcKinematicsForward/Inverse), pinned by
 *  kinsFixtures.gen.ts (oracle = the compiled C itself, scripts/kins_oracle).
 *  Letters outside the model's principal set follow the C passthrough
 *  (optional rotary rides along; UVW have no world slot here → null). */
class TrtKins implements KinsModel {
  readonly type: string;
  private jx: number; private jy: number; private jz: number;
  private jr1: number;              // A (xyzac) or B (xyzbc)
  private jc: number;
  private jopt: number;             // the OTHER rotary if configured (C: JB/JA)
  private uvw: number[];            // joint indices with no world slot → null
  private isBC: boolean;
  private xr: number; private yr: number; private zr: number;
  private dx: number; private dy: number; private dzBase: number; private dt: number;

  constructor(type: "xyzac-trt" | "xyzbc-trt", axes: string[], p?: KinsParams) {
    this.type = type;
    this.isBC = type === "xyzbc-trt";
    this.jx = principal(axes, "X");
    this.jy = principal(axes, "Y");
    this.jz = principal(axes, "Z");
    this.jr1 = principal(axes, this.isBC ? "B" : "A");
    this.jc = principal(axes, "C");
    this.jopt = principal(axes, this.isBC ? "A" : "B");
    this.uvw = [];
    for (let ji = 0; ji < axes.length; ji++) {
      if ("XYZABC".indexOf(axes[ji]!.toUpperCase()) < 0) this.uvw.push(ji);
    }
    this.xr = p?.xRotPoint ?? 0; this.yr = p?.yRotPoint ?? 0; this.zr = p?.zRotPoint ?? 0;
    this.dx = p?.xOffset ?? 0; this.dy = p?.yOffset ?? 0;
    this.dzBase = p?.zOffset ?? 0; this.dt = p?.toolOffset ?? 0;
  }

  /** All principal letters present? (trtKinematicsSetup's required check.) */
  complete(): boolean {
    return this.jx >= 0 && this.jy >= 0 && this.jz >= 0 && this.jr1 >= 0 && this.jc >= 0;
  }

  forward(joints: ArrayLike<number | null>, world: number[]): number[] {
    const jx = joints[this.jx] ?? 0, jy = joints[this.jy] ?? 0, jz = joints[this.jz] ?? 0;
    const r1 = joints[this.jr1] ?? 0, c = joints[this.jc] ?? 0;
    const dz = this.dzBase + this.dt;
    const cc = Math.cos(c * RAD), sc = Math.sin(c * RAD);
    for (let s = 0; s < 6; s++) world[s] = 0;
    if (!this.isBC) {
      const ca = Math.cos(r1 * RAD), sa = Math.sin(r1 * RAD);
      world[0] = cc * (jx - this.xr)
               + sc * ca * (jy - this.dy - this.yr)
               + sc * sa * (jz - dz - this.zr)
               + sc * this.dy + this.xr;
      world[1] = -sc * (jx - this.xr)
               + cc * ca * (jy - this.dy - this.yr)
               + cc * sa * (jz - dz - this.zr)
               + cc * this.dy + this.yr;
      world[2] = -sa * (jy - this.dy - this.yr)
               + ca * (jz - dz - this.zr)
               + dz + this.zr;
      world[3] = r1;
      world[4] = this.jopt >= 0 ? (joints[this.jopt] ?? 0) : 0;
    } else {
      const cb = Math.cos(r1 * RAD), sb = Math.sin(r1 * RAD);
      world[0] = cc * cb * (jx - this.dx - this.xr)
               + sc * (jy - this.yr)
               - cc * sb * (jz - dz - this.zr)
               + cc * this.dx + this.xr;
      world[1] = -sc * cb * (jx - this.dx - this.xr)
               + cc * (jy - this.yr)
               + sc * sb * (jz - dz - this.zr)
               - sc * this.dx + this.yr;
      world[2] = sb * (jx - this.dx - this.xr)
               + cb * (jz - dz - this.zr)
               + dz + this.zr;
      world[3] = this.jopt >= 0 ? (joints[this.jopt] ?? 0) : 0;
      world[4] = r1;
    }
    world[5] = c;
    return world;
  }

  inverse(world: ReadonlyArray<number>, out: (number | null)[]): (number | null)[] {
    const wx = world[0] ?? 0, wy = world[1] ?? 0, wz = world[2] ?? 0;
    const r1 = (this.isBC ? world[4] : world[3]) ?? 0;
    const c = world[5] ?? 0;
    const dz = this.dzBase + this.dt;
    const cc = Math.cos(c * RAD), sc = Math.sin(c * RAD);
    let px: number, py: number, pz: number;
    if (!this.isBC) {
      const ca = Math.cos(r1 * RAD), sa = Math.sin(r1 * RAD);
      px = cc * (wx - this.xr) - sc * (wy - this.yr) + this.xr;
      py = sc * ca * (wx - this.xr) + cc * ca * (wy - this.yr)
         - sa * (wz - this.zr) - ca * this.dy + sa * dz + this.dy + this.yr;
      pz = sc * sa * (wx - this.xr) + cc * sa * (wy - this.yr)
         + ca * (wz - this.zr) - sa * this.dy - ca * dz + dz + this.zr;
    } else {
      const cb = Math.cos(r1 * RAD), sb = Math.sin(r1 * RAD);
      const dpx = -cb * this.dx - sb * dz + this.dx;
      const dpz = sb * this.dx - cb * dz + dz;
      px = cc * cb * (wx - this.xr) - sc * cb * (wy - this.yr)
         + sb * (wz - this.zr) + dpx + this.xr;
      py = sc * (wx - this.xr) + cc * (wy - this.yr) + this.yr;
      pz = -cc * sb * (wx - this.xr) + sc * sb * (wy - this.yr)
         + cb * (wz - this.zr) + dpz + this.zr;
    }
    // position_to_mapped_joints over the computed pose: every joint takes
    // its letter's value (optional rotary passes through; UVW → null).
    return this.fillJoints(px, py, pz, r1, c, world, out);
  }

  private fillJoints(
    px: number, py: number, pz: number, r1: number, c: number,
    world: ReadonlyArray<number>, out: (number | null)[],
  ): (number | null)[] {
    const n = Math.max(this.jx, this.jy, this.jz, this.jr1, this.jc, this.jopt, ...this.uvw) + 1;
    out.length = n;
    for (let ji = 0; ji < n; ji++) out[ji] = 0;
    out[this.jx] = px; out[this.jy] = py; out[this.jz] = pz;
    out[this.jr1] = r1; out[this.jc] = c;
    if (this.jopt >= 0) out[this.jopt] = (this.isBC ? world[3] : world[4]) ?? 0;
    for (const ji of this.uvw) out[ji] = null;
    return out;
  }
}

/** Build a kins model from plain data. Unknown or incomplete specs fall
 *  back to trivkins LOUDLY — a machine declaring kins this client can't
 *  evaluate must not silently pose wrong. */
export function makeKins(axes: string[], spec?: KinsSpec): KinsModel {
  const type = spec?.type ?? "trivkins";
  if (type === "trivkins") return new Trivkins(axes);
  if (type === "xyzac-trt" || type === "xyzbc-trt") {
    const m = new TrtKins(type, axes, spec?.params);
    if (m.complete()) return m;
    console.error(`[kins] ${type}: required letters missing from axes [${axes.join(",")}] — falling back to trivkins`);
    return new Trivkins(axes);
  }
  console.error(`[kins] unknown kins type "${type}" — falling back to trivkins (poses may be wrong)`);
  return new Trivkins(axes);
}

// Memoized construction for per-frame callers (scrub pose runs at display
// rate): keyed by the axes identity + spec type, so repeated calls with
// the same machine cost a Map lookup, not an allocation.
const _memo = new Map<string, KinsModel>();

export function kinsFor(axes: string[], spec?: KinsSpec): KinsModel {
  const p = spec?.params;
  const key = axes.join(",") + "|" + (spec?.type ?? "trivkins")
    + (p ? "|" + [p.xRotPoint, p.yRotPoint, p.zRotPoint, p.xOffset, p.yOffset, p.zOffset, p.toolOffset].join(",") : "");
  let m = _memo.get(key);
  if (!m) {
    m = makeKins(axes, spec);
    _memo.set(key, m);
  }
  return m;
}
