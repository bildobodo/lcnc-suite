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

/** Serializable kins selection — rides machine.json / viewer_init and
 *  crosses worker boundaries. Absent/`trivkins` = identity permutation.
 *  Phase 1c adds per-model params (pivot offsets) here. */
export interface KinsSpec {
  type?: string;
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

/** Build a kins model from plain data. Unknown spec types fall back to
 *  trivkins LOUDLY — a machine declaring kins this client can't evaluate
 *  must not silently pose wrong. */
export function makeKins(axes: string[], spec?: KinsSpec): KinsModel {
  const type = spec?.type ?? "trivkins";
  if (type !== "trivkins") {
    console.error(`[kins] unknown kins type "${type}" — falling back to trivkins (poses may be wrong)`);
  }
  return new Trivkins(axes);
}

// Memoized construction for per-frame callers (scrub pose runs at display
// rate): keyed by the axes identity + spec type, so repeated calls with
// the same machine cost a Map lookup, not an allocation.
const _memo = new Map<string, KinsModel>();

export function kinsFor(axes: string[], spec?: KinsSpec): KinsModel {
  const key = axes.join(",") + "|" + (spec?.type ?? "trivkins");
  let m = _memo.get(key);
  if (!m) {
    m = makeKins(axes, spec);
    _memo.set(key, m);
  }
  return m;
}
