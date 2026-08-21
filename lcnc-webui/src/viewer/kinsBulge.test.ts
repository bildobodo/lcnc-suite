// Certification of KinsModel.jointBulge — the bound the collision sweep's
// conservative advancement rests on.
//
// The sweep prices a chunk's relative motion from its ENDPOINT joint deltas.
// Under a world kins that under-reads the truth: the pivot compensation makes
// the linear joints trigonometric in the swept rotaries, so a chunk symmetric
// about an extremum has equal endpoints around a real mid-chunk bulge. Every
// model therefore declares an upper bound on that excursion, and the sweep
// adds it to the pair's speed budget.
//
// "Conservative" has to be CHECKED, not asserted in a comment — that is what
// this file is. For each family and mode it lerps the machine coords across a
// chunk, samples the real inverse densely, and requires
//
//     max_t |j(t) - lerp(j(0), j(1))|  <=  jointBulge(w0, w1)[j]
//
// for EVERY joint, rotaries included (their passthrough is a property of
// today's families, not of the interface). It also requires the bound not to
// be vacuously loose, and requires the sampled bulges to be large enough that
// a bound stubbed to zero would fail here — a property test that cannot fail
// certifies nothing.
//
// NOTE ON SCOPE: this certifies the bound against the sweep's own
// interpolation model (machine coords lerp across a chunk), which is the
// caller contract in kins.ts. It says nothing about how faithfully that model
// tracks a real machine's trajectory between program points.
import { describe, expect, it } from "vitest";
import { kinsFor, kinsForSegment, makeKins, specFromWire, type KinsModel } from "./kins";

const AXES5 = ["X", "Y", "Z", "A", "C"];
const AXES5BC = ["X", "Y", "Z", "B", "C"];
const AXES6 = ["X", "Y", "Z", "A", "B", "C"];

// The upstream TWP machine's INI wiring, through the real wire mapping — the
// same spec kins.test.ts pins the capture goldens with.
const TRSRN = specFromWire({
  type: "xyzacb-trsrn", identity_first: false,
  params: { y_pivot: 50, z_pivot: 120, x_offset: 0, y_offset: 0,
            y_rot_axis: -1000, z_rot_axis: -2000, nut_angle: 55 },
})!;
const FRAME: [number, number, number] = [-1.781762, 130.2455, -40.8555];

/** Deterministic LCG — a gate must fail reproducibly, not sometimes. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Max |j(t) - chord(t)| per joint over a densely sampled chunk. */
function sampledBulge(model: KinsModel, w0: number[], w1: number[], n: number): number[] {
  const at = (t: number) => {
    const w = w0.map((v, i) => v + (w1[i]! - v) * t);
    return model.inverse(w, []);
  };
  const j0 = at(0), j1 = at(1);
  const worst = j0.map(() => 0);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const jt = at(t);
    for (let ji = 0; ji < jt.length; ji++) {
      const a = j0[ji], b = j1[ji], c = jt[ji];
      if (a == null || b == null || c == null) continue;  // UVW
      const dev = Math.abs(c - (a + (b - a) * t));
      if (dev > worst[ji]!) worst[ji] = dev;
    }
  }
  return worst;
}

interface Case {
  name: string;
  model: KinsModel;
  nJoints: number;
  /** Draw a chunk: [w0, w1] machine coords (X Y Z A B C). */
  draw: (r: () => number) => [number[], number[]];
  /** True when the family/mode is affine in the coords, so the bound is 0. */
  exact?: boolean;
}

/** Rotary deltas summing to at most `capDeg` — the sweep chunks to keep the
 *  SUMMED sweep inside CHUNK_ROT_DEG, so that is the contracted regime. The
 *  bound has no small-angle assumption, and the wide-sweep case below checks
 *  that it holds well past the contract too. */
function chunk(r: () => number, span: number, capDeg: number, rotIdx: number[]): [number[], number[]] {
  const w0 = [
    (r() - 0.5) * 2 * span, (r() - 0.5) * 2 * span, (r() - 0.5) * 2 * span,
    (r() - 0.5) * 720, (r() - 0.5) * 720, (r() - 0.5) * 720,
  ];
  const w1 = w0.slice();
  for (let i = 0; i < 3; i++) w1[i] = w0[i]! + (r() - 0.5) * span * 0.2;
  // Split the angular budget across this family's rotaries, biased so the
  // symmetric-about-an-extremum case (the miss class) shows up often.
  let left = capDeg;
  for (const i of rotIdx) {
    const d = left * r();
    left -= d;
    w1[i] = w0[i]! + (r() < 0.5 ? d : -d);
  }
  // Half the draws are centred on an extremum of the dominant rotary, where
  // endpoint deltas cancel exactly and only the bound sees the bulge.
  if (r() < 0.5 && rotIdx.length) {
    const i = rotIdx[0]!;
    const half = Math.abs(w1[i]! - w0[i]!) / 2;
    w0[i] = -half; w1[i] = half;
  }
  return [w0, w1];
}

const CASES: Case[] = [
  {
    name: "trivkins XYZAC",
    model: makeKins(AXES5), nJoints: 5, exact: true,
    draw: (r) => chunk(r, 200, 22.5, [3, 5]),
  },
  {
    name: "xyzac-trt (world)",
    model: kinsFor(AXES5, { type: "xyzac-trt", identityFirst: true,
                            params: { yOffset: 20, zOffset: 10 } }, 55),
    nJoints: 5,
    draw: (r) => chunk(r, 200, 22.5, [3, 5]),
  },
  {
    name: "xyzbc-trt (world)",
    model: kinsFor(AXES5BC, { type: "xyzbc-trt", identityFirst: true,
                              params: { xOffset: 15, zOffset: 10, xRotPoint: 5 } }, 30),
    nJoints: 5,
    draw: (r) => chunk(r, 200, 22.5, [3, 5]),
  },
  {
    name: "xyzacb-trsrn mode 1 (TCP)",
    model: kinsForSegment(AXES6, TRSRN, 1, null, 100, "bulge test"), nJoints: 6,
    draw: (r) => chunk(r, 2000, 22.5, [3, 4, 5]),
  },
  {
    name: "xyzacb-trsrn mode 2 (TOOL/plane)",
    model: kinsForSegment(AXES6, TRSRN, 2, FRAME, 100, "bulge test"),
    nJoints: 6, exact: true,
    draw: (r) => chunk(r, 2000, 22.5, [3, 4, 5]),
  },
  {
    name: "xyzacb-trsrn mode 0 (identity)",
    model: kinsForSegment(AXES6, TRSRN, 0, null, 100, "bulge test"),
    nJoints: 6, exact: true,
    draw: (r) => chunk(r, 2000, 22.5, [3, 4, 5]),
  },
];

describe("jointBulge is a genuine upper bound", () => {
  for (const c of CASES) {
    it(`${c.name}: no sampled excursion exceeds the declared bound`, () => {
      const r = rng(0x5c1a5 + c.name.length);
      const out = new Float64Array(c.nJoints);
      let worstRatio = 0, biggestSampled = 0;
      for (let trial = 0; trial < 300; trial++) {
        const [w0, w1] = c.draw(r);
        c.model.jointBulge(w0, w1, out);
        const sampled = sampledBulge(c.model, w0, w1, 400);
        for (let ji = 0; ji < c.nJoints; ji++) {
          const bound = out[ji]!;
          const got = sampled[ji] ?? 0;
          // 1e-9 absorbs float noise in the dense resampling, nothing more.
          expect(got, `${c.name} joint ${ji}: sampled ${got} > bound ${bound}`)
            .toBeLessThanOrEqual(bound + 1e-9);
          if (got > biggestSampled) biggestSampled = got;
          if (got > 1) worstRatio = Math.max(worstRatio, bound / got);
        }
      }
      if (c.exact) {
        // Affine in the coords: the joints ride the chord exactly, and the
        // model must SAY so — a nonzero bound here would be slack the sweep
        // pays for on every identity segment.
        expect(biggestSampled).toBeLessThan(1e-6);
        const zero = new Float64Array(c.nJoints);
        c.model.jointBulge([0, 0, 0, 0, 0, 0], [1, 1, 1, 10, 10, 10], zero);
        expect(Array.from(zero)).toEqual(new Array(c.nJoints).fill(0));
      } else {
        // Teeth: a bound stubbed to 0 has to fail this file. If the sampled
        // excursions were all negligible, the test above would pass vacuously.
        expect(biggestSampled).toBeGreaterThan(1);
        // Runaway guard. The bound is phase-independent, so a chunk sitting
        // where the true curvature happens to vanish (a sine sweep centred on
        // zero) reads loose — see "tightness where it matters" below for why
        // that slack is harmless and for the assertion on the term that is
        // NOT allowed to go loose.
        expect(worstRatio).toBeLessThan(200);
      }
    });
  }

  it("trsrn mode 1: the A-rotation lever is the machine's, not the origin's", () => {
    // The defect this bound replaces: the sweep read trt-shaped pivot params
    // (xRotPoint/…), which a trsrn spec does not carry, so the radius
    // collapsed to distance-from-machine-origin. Near the origin the true
    // lever is |yRotAxis - Qy| ≈ 1000 and |zRotAxis + TLO - Qz| ≈ 1900, so
    // the bound there must be LARGE, not ~0.
    const m = kinsForSegment(AXES6, TRSRN, 1, null, 100, "bulge test");
    const out = new Float64Array(6);
    m.jointBulge([0, 0, 0, -10, 0, 0], [0, 0, 0, 10, 0, 0], out);
    const sampled = sampledBulge(m, [0, 0, 0, -10, 0, 0], [0, 0, 0, 10, 0, 0], 400);
    // A ±10° sweep about a joint extremum: endpoints equal, real bulge ~30.
    expect(Math.max(sampled[1]!, sampled[2]!)).toBeGreaterThan(25);
    expect(out[1]).toBeGreaterThanOrEqual(sampled[1]!);
    expect(out[2]).toBeGreaterThanOrEqual(sampled[2]!);
  });

  it("trsrn mode 1: B/C terms are pivot-driven, so they survive at the origin", () => {
    // Unlike the A term, the spindle-pivot terms do not shrink with position:
    // a C sweep at the machine origin still bulges the X joint.
    const m = kinsForSegment(AXES6, TRSRN, 1, null, 100, "bulge test");
    const out = new Float64Array(6);
    m.jointBulge([0, 0, 0, 0, 0, -10], [0, 0, 0, 0, 0, 10], out);
    expect(out[0]).toBeGreaterThan(0);
    const sampled = sampledBulge(m, [0, 0, 0, 0, 0, -10], [0, 0, 0, 0, 0, 10], 400);
    expect(out[0]).toBeGreaterThanOrEqual(sampled[0]!);
  });

  it("tightness where it matters: the A lever stays within ~3x of the truth", () => {
    // The bound is phase-independent — it charges phi^2 * amplitude whether or
    // not the chunk actually sits on a curvature peak — so a B or C sweep
    // centred on zero (where the joint response is an almost-linear sine) can
    // read tens of times loose. That slack is HARMLESS in the sweep: for any
    // pair that a rotary actually swings, the lever term (Δangle × lever × 2)
    // dominates the same budget by two orders of magnitude, and for a pair
    // the rotary does NOT swing the bulge is a few units against a certificate
    // measured in hundreds, so it never sets the step.
    //
    // The A term is different: it IS the budget for the miss class this bound
    // exists to price (a pair riding a world-driven linear joint while the
    // table sweeps, where endpoint deltas read zero). It must stay tight, or
    // real programs pay for it in samples.
    const m = kinsForSegment(AXES6, TRSRN, 1, null, 100, "bulge test");
    const out = new Float64Array(6);
    let worst = 0;
    for (const half of [2, 5, 11.25]) {
      const w0 = [500, -300, -900, -half, 0, 0], w1 = [500, -300, -900, half, 0, 0];
      m.jointBulge(w0, w1, out);
      const sampled = sampledBulge(m, w0, w1, 800);
      for (let ji = 0; ji < 6; ji++) {
        if ((sampled[ji] ?? 0) > 0.01) worst = Math.max(worst, out[ji]! / sampled[ji]!);
      }
    }
    expect(worst).toBeGreaterThan(1);      // still an upper bound
    expect(worst).toBeLessThan(3.5);
  });

  it("holds past the contracted chunk size (no small-angle assumption)", () => {
    const m = kinsForSegment(AXES6, TRSRN, 1, null, 100, "bulge test");
    const out = new Float64Array(6);
    for (const half of [30, 60, 90]) {
      const w0 = [500, -200, -800, -half, 0, 0], w1 = [500, -200, -800, half, 0, 0];
      m.jointBulge(w0, w1, out);
      const sampled = sampledBulge(m, w0, w1, 800);
      for (let ji = 0; ji < 6; ji++) {
        expect(sampled[ji] ?? 0, `half-sweep ${half}° joint ${ji}`)
          .toBeLessThanOrEqual(out[ji]! + 1e-9);
      }
    }
  });
});
