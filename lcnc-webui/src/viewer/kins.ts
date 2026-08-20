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
 *  Known types: `trivkins`, `xyzac-trt`, `xyzbc-trt` (routed) and
 *  `xyzacb-trsrn` (declared; routing lands with the TWP marker work). */
export interface KinsSpec {
  type?: string;
  /** switchkins `sparm=identityfirst`: which raw type is the identity
   *  kins (phase 3: the wire ships raw types, the client maps them —
   *  see worldModeForSpec). */
  identityFirst?: boolean;
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

/** Geometry + plane params for the xyzacb_trsrn model — mirrors the comp's
 *  HAL pins. UNIT ASYMMETRY (upstream remap.py's set_p): preRot is RADIANS
 *  while nutAngle / primaryAngle / secondaryAngle are DEGREES. Absent
 *  fields = 0. */
export interface TrsrnParams {
  yPivot?: number; zPivot?: number; xOffset?: number; yOffset?: number;
  yRotAxis?: number; zRotAxis?: number; nutAngle?: number; toolOffset?: number;
  preRot?: number; primaryAngle?: number; secondaryAngle?: number;
}

/** LinuxCNC xyzacb_trsrn switchable kinematics — the upstream TWP machine
 *  (rotary table C + rotary spindle B + nutating spindle A). Line-for-line
 *  mirror of the comp's case 0/1/2 forward+inverse (master @493926b56c,
 *  vendored in scripts/kins_oracle/), pinned by TRSRN_KINS_FIXTURES and
 *  live-validated against the 2.9.4 spike captures (TWP plan phase 3).
 *
 *  Mode semantics (the live `motion.switchkins-type` values):
 *    0 = identity; 1 = TCP (frame from the CURRENT rotary values — world
 *    a/b/c ≡ joints under rotary passthrough); 2 = TOOL/plane (frame pinned
 *    by preRot/primaryAngle/secondaryAngle — the values remap.py set_p's at
 *    G53.x, NOT live joints; that's why plane moves drive XYZ joints only).
 *  TLO note: case 2 ignores toolOffset by upstream design (motion applies
 *  TLO before the kins in plane mode); case 1 folds it into the pivot.
 *  Joint order is fixed j0..j5 = X Y Z A B C — the comp hardcodes indices
 *  (no coordinate remapping like trtKinematicsSetup). */
export class TrsrnKins implements KinsModel {
  readonly type = "xyzacb-trsrn";
  readonly mode: 0 | 1 | 2;
  private ly: number; private lz: number; private dx: number; private dy: number;
  private dray: number; private draz: number; private dt: number;
  private sv: number; private cv: number; private stc: number; private ctc: number;
  private th1: number; private th2: number;

  constructor(mode: 0 | 1 | 2, p?: TrsrnParams) {
    this.mode = mode;
    this.ly = p?.yPivot ?? 0; this.lz = p?.zPivot ?? 0;
    this.dx = p?.xOffset ?? 0; this.dy = p?.yOffset ?? 0;
    this.dray = (p?.yRotAxis ?? 0) - (this.dy + this.ly);
    this.draz = (p?.zRotAxis ?? 0) - this.lz;
    this.dt = p?.toolOffset ?? 0;
    const nu = p?.nutAngle ?? 0;
    this.sv = Math.sin(nu * RAD); this.cv = Math.cos(nu * RAD);
    const tc = p?.preRot ?? 0; // radians
    this.stc = Math.sin(tc); this.ctc = Math.cos(tc);
    this.th1 = p?.primaryAngle ?? 0; this.th2 = p?.secondaryAngle ?? 0;
  }

  forward(joints: ArrayLike<number | null>, world: number[]): number[] {
    const Px = joints[0] ?? 0, Py = joints[1] ?? 0, Pz = joints[2] ?? 0;
    const j3 = joints[3] ?? 0, j4 = joints[4] ?? 0, j5 = joints[5] ?? 0;
    for (let s = 0; s < 6; s++) world[s] = 0;
    world[3] = j3; world[4] = j4; world[5] = j5;
    if (this.mode === 0) {
      world[0] = Px; world[1] = Py; world[2] = Pz;
      return world;
    }
    const { ly: Ly, lz: Lz, dx: Dx, dy: Dy, dray: Dray, draz: Draz, dt: Dt,
            sv: Sv, cv: Cv, stc: Stc, ctc: Ctc } = this;
    const Sw = Math.sin(j3 * RAD), Cw = Math.cos(j3 * RAD);
    // TCP uses the current rotary values; TOOL uses the remap-written pins.
    const Ss = this.mode === 1 ? Math.sin(j4 * RAD) : Math.sin(this.th2 * RAD);
    const Cs = this.mode === 1 ? Math.cos(j4 * RAD) : Math.cos(this.th2 * RAD);
    const Sp = this.mode === 1 ? Math.sin(j5 * RAD) : Math.sin(this.th1 * RAD);
    const Cp = this.mode === 1 ? Math.cos(j5 * RAD) : Math.cos(this.th1 * RAD);
    const CvSs = Cv * Ss, SvSs = Sv * Ss;
    const r = Cs + Sv * Sv * (1 - Cs);
    const s = Cs + Cv * Cv * (1 - Cs);
    const t = Sv * Cv * (1 - Cs);
    if (this.mode === 1) {
      world[0] = -(Cp * SvSs - Sp * t) * (Dt + Lz)
               - Cp * Dx
               + (Cp * CvSs + Sp * r) * Ly
               + Dy * Sp
               + Dx
               + Px;
      world[1] = -Cp * Cw * Dy
               - Cw * Dx * Sp
               - Cw * (Dray - Py)
               - (Cw * Sp * SvSs + Cp * Cw * t - Sw * s) * (Dt + Lz)
               + (CvSs * Cw * Sp - Cp * Cw * r + Sw * t) * Ly
               + (Draz - Pz) * Sw
               + Dray
               + Dy
               + Ly;
      world[2] = -Cp * Dy * Sw
               - Dx * Sp * Sw
               - Cw * (Draz - Pz)
               - (Sp * SvSs * Sw + Cp * Sw * t + Cw * s) * (Dt + Lz)
               + (CvSs * Sp * Sw - Cp * Sw * r - Cw * t) * Ly
               - (Dray - Py) * Sw
               + Draz
               + Dt
               + Lz;
    } else {
      world[0] = ((Cs * Ctc - CvSs * Stc) * Cp - (Ctc * CvSs + Stc * r) * Sp) * (Dx + Px)
               - (Cs * Ctc - CvSs * Stc) * Dx
               + ((Ctc * CvSs + Stc * r) * Cp
               + (Cs * Ctc - CvSs * Stc) * Sp) * (Dy + Ly + Py)
               - (Ctc * CvSs + Stc * r) * Dy
               - (Ctc * SvSs - Stc * t) * (Lz + Pz)
               - Ly * Stc;
      world[1] = -((Ctc * CvSs + Cs * Stc) * Cp - (CvSs * Stc - Ctc * r) * Sp) * (Dx + Px)
               + (Ctc * CvSs + Cs * Stc) * Dx
               - ((CvSs * Stc - Ctc * r) * Cp
               + (Ctc * CvSs + Cs * Stc) * Sp) * (Dy + Ly + Py)
               + (CvSs * Stc - Ctc * r) * Dy
               - Ctc * Ly
               + (Stc * SvSs + Ctc * t) * (Lz + Pz);
      world[2] = (Cp * SvSs - Sp * t) * (Dx + Px)
               + (Sp * SvSs + Cp * t) * (Dy + Ly + Py)
               - Dx * SvSs
               + (Lz + Pz) * s
               - Dy * t
               - Lz;
    }
    return world;
  }

  inverse(world: ReadonlyArray<number>, out: (number | null)[]): (number | null)[] {
    const Qx = world[0] ?? 0, Qy = world[1] ?? 0, Qz = world[2] ?? 0;
    const wa = world[3] ?? 0, wb = world[4] ?? 0, wc = world[5] ?? 0;
    out.length = 6;
    out[3] = wa; out[4] = wb; out[5] = wc;
    if (this.mode === 0) {
      out[0] = Qx; out[1] = Qy; out[2] = Qz;
      return out;
    }
    const { ly: Ly, lz: Lz, dx: Dx, dy: Dy, dray: Dray, draz: Draz, dt: Dt,
            sv: Sv, cv: Cv, stc: Stc, ctc: Ctc } = this;
    // The comp reads the CURRENT rotary joints here; motion seeds them with
    // actuals, which in steady state equal world a/b/c (rotary passthrough)
    // — mirrored the same way the oracle harness seeds them.
    const Sw = Math.sin(wa * RAD), Cw = Math.cos(wa * RAD);
    const Ss = this.mode === 1 ? Math.sin(wb * RAD) : Math.sin(this.th2 * RAD);
    const Cs = this.mode === 1 ? Math.cos(wb * RAD) : Math.cos(this.th2 * RAD);
    const Sp = this.mode === 1 ? Math.sin(wc * RAD) : Math.sin(this.th1 * RAD);
    const Cp = this.mode === 1 ? Math.cos(wc * RAD) : Math.cos(this.th1 * RAD);
    const CvSs = Cv * Ss, SvSs = Sv * Ss;
    const r = Cs + Sv * Sv * (1 - Cs);
    const s = Cs + Cv * Cv * (1 - Cs);
    const t = Sv * Cv * (1 - Cs);
    if (this.mode === 1) {
      out[0] = (Cp * SvSs - Sp * t) * (Dt + Lz)
             + Cp * Dx
             - (Cp * CvSs + Sp * r) * Ly
             - Dy * Sp
             - Dx
             + Qx;
      out[1] = Cp * Dy
             + Dx * Sp
             - Cw * (Dray + Dy + Ly - Qy)
             + (Sp * SvSs + Cp * t) * (Dt + Lz)
             - (CvSs * Sp - Cp * r) * Ly
             - (Draz + Dt + Lz - Qz) * Sw
             + Dray;
      out[2] = (Dt + Lz) * s
             + Ly * t
             - Cw * (Draz + Dt + Lz - Qz)
             + (Dray + Dy + Ly - Qy) * Sw
             + Draz;
    } else {
      out[0] = Cp * Dx
             - (Cp * CvSs + Sp * r) * Ly
             + (Cp * SvSs - Sp * t) * Lz
             + ((Cp * Cs - CvSs * Sp) * Ctc
             - (Cp * CvSs + Sp * r) * Stc) * Qx
             - ((Cp * CvSs + Sp * r) * Ctc + (Cp * Cs - CvSs * Sp) * Stc) * Qy
             + (Cp * SvSs - Sp * t) * Qz
             - Dy * Sp
             - Dx;
      out[1] = Cp * Dy
             - (CvSs * Sp - Cp * r) * Ly
             + (Sp * SvSs + Cp * t) * Lz
             + ((Cp * CvSs + Cs * Sp) * Ctc - (CvSs * Sp - Cp * r) * Stc) * Qx
             - ((CvSs * Sp - Cp * r) * Ctc + (Cp * CvSs + Cs * Sp) * Stc) * Qy
             + (Sp * SvSs + Cp * t) * Qz
             + Dx * Sp
             - Dy
             - Ly;
      out[2] = -(Ctc * SvSs - Stc * t) * Qx
             + (Stc * SvSs + Ctc * t) * Qy
             + Lz * s
             + Qz * s
             + Ly * t
             - Lz;
    }
    return out;
  }
}

/** Build a kins model from plain data. Unknown or incomplete specs fall
 *  back to trivkins LOUDLY — a machine declaring kins this client can't
 *  evaluate must not silently pose wrong.
 *
 *  `toolOffsetZ` overlays KinsParams.toolOffset: the trt kins' tool-offset
 *  pin is LIVE TLO (netted from motion.tooloffset.z), so it never rides
 *  the spec — callers inject the current wcs.tool Z here instead. World
 *  coords stay TLO-INCLUSIVE (the kins' dz cancels at pose zero), so
 *  programToMachine keeps adding o.tz — two roles, not a double count. */
export function makeKins(axes: string[], spec?: KinsSpec, toolOffsetZ?: number): KinsModel {
  const type = spec?.type ?? "trivkins";
  if (type === "trivkins") return new Trivkins(axes);
  const params = toolOffsetZ
    ? { ...spec?.params, toolOffset: toolOffsetZ }
    : spec?.params;
  if (type === "xyzac-trt" || type === "xyzbc-trt") {
    const m = new TrtKins(type, axes, params);
    if (m.complete()) return m;
    console.error(`[kins] ${type}: required letters missing from axes [${axes.join(",")}] — falling back to trivkins`);
    return new Trivkins(axes);
  }
  console.error(`[kins] unknown kins type "${type}" — falling back to trivkins (poses may be wrong)`);
  return new Trivkins(axes);
}

// Once-per-context (main thread / each worker) loud fallback for the
// mode-without-spec hole: the track carries world-mode (TCP) segments but
// no kins declaration reached this consumer, so they pose as trivkins —
// wrong by construction. makeKins can't catch this (it is never called
// with a spec on that path), so the routing sites report it themselves.
let _warnedWorldNoSpec = false;
export function warnWorldWithoutSpec(site: string): void {
  if (_warnedWorldNoSpec) return;
  _warnedWorldNoSpec = true;
  console.error(
    `[kins] ${site}: world-mode (TCP) segments present but no kins declaration ` +
    `— posing them as trivkins, positions will be wrong. Check viewer_init.kins ` +
    `([KINS]KINEMATICS parsing).`);
}

/** viewer_init.kins wire declaration → KinsSpec (snake_case pin names →
 *  KinsParams). Returns undefined for trivkins/absent — callers treat
 *  that as the identity permutation. NOTE (phase 1d): the declaration is
 *  shipped and stored but NOT yet fed to the transform consumers — that
 *  activation is phase 2, per-segment modes + the TLO-flow audit (the
 *  kins' tool-offset pin is live TLO, already carried as wcs.tool). */
export function specFromWire(w?: {
  type: string; identity_first?: boolean; params: Record<string, number>;
} | null): KinsSpec | undefined {
  if (!w || w.type === "trivkins") return undefined;
  const p = w.params ?? {};
  return {
    type: w.type,
    identityFirst: !!w.identity_first,
    params: {
      xRotPoint: p.x_rot_point, yRotPoint: p.y_rot_point, zRotPoint: p.z_rot_point,
      xOffset: p.x_offset, yOffset: p.y_offset, zOffset: p.z_offset,
    },
  };
}

/** Live `motion.switchkins-type` value → is the machine in WORLD (TCP)
 *  mode? Mirrors gateway_util.kins_world_flags' parse-time mapping so the
 *  live pin and the track's mode array can never disagree on semantics:
 *  with `sparm=identityfirst` type 1 is the world kins, otherwise the
 *  module's startup type 0 is; type 2 (userk) is identity math in the
 *  stock switchkins template. */
export function worldModeForType(kinstype: number, identityFirst: boolean): boolean {
  const t = Math.round(kinstype);
  return identityFirst ? t === 1 : t === 0;
}

/** RAW switchkins type (wire feed_kinstype/rapid_kinstype, live pin, or a
 *  track's mode array) → "this segment needs the machine's non-identity
 *  kins". Family-aware client twin of gateway_util.kins_nonidentity_flags:
 *  trt follows sparm (worldModeForType; userk type 2 = identity in the
 *  stock template); `xyzacb-trsrn` boots identity as type 0 with types 1
 *  (TCP) and 2 (TOOL) both non-identity — with DIFFERENT math, which is
 *  why the wire carries raw types at all. With NO spec the mapping is
 *  unknowable: any nonzero type reports true so the routing sites hit
 *  their loud warnWorldWithoutSpec + trivkins fallback, never a silent
 *  guess. */
export function worldModeForSpec(kinstype: number | undefined, spec?: KinsSpec | null): boolean {
  const t = Math.round(kinstype ?? 0);
  if (!spec) return t !== 0;
  if (spec.type === "xyzacb-trsrn") return t !== 0;
  return worldModeForType(t, !!spec.identityFirst);
}

// Memoized construction for per-frame callers (scrub pose runs at display
// rate): keyed by the axes identity + spec type, so repeated calls with
// the same machine cost a Map lookup, not an allocation.
const _memo = new Map<string, KinsModel>();

export function kinsFor(axes: string[], spec?: KinsSpec, toolOffsetZ?: number): KinsModel {
  const p = spec?.params;
  const key = axes.join(",") + "|" + (spec?.type ?? "trivkins")
    + (p ? "|" + [p.xRotPoint, p.yRotPoint, p.zRotPoint, p.xOffset, p.yOffset, p.zOffset].join(",") : "")
    + (toolOffsetZ ? "|t" + toolOffsetZ : "");
  let m = _memo.get(key);
  if (!m) {
    // Bound the memo: every distinct live TLO mints a new key (tool
    // changes over a long session), and touch-off can sweep values.
    // Models are tiny — a rare full clear is cheaper than an LRU.
    if (_memo.size >= 64) _memo.clear();
    m = makeKins(axes, spec, toolOffsetZ);
    _memo.set(key, m);
  }
  return m;
}
