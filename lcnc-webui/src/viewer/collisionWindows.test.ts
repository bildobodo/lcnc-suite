// Step 4 package 2, round A7 — the oracle's resolution (plan Fassung 5, 7.3
// check 1, Codex VP139-05): contact windows known in CLOSED FORM, swept
// through the product. A box rides along X past one mesh of two boxes — ONE
// pair, two windows and a free gap between them — forth and back (re-contact),
// over lines whose ends fall at random places in and around the windows, the
// moves rapid or feed at random. Window widths 0.26–0.5: just wider than the
// sampling floor MIN_ADV, where a 0.5 grid could miss them entirely (the
// window [0.35, 0.65] between grid points 0.25 and 0.75). Required: every
// window is found, its boundaries to 1e-3 (the bisection's) plus the touch
// tolerance; nothing is reported outside the windows but a gap the sweep never
// sampled; a gap the sweep proved free by a sample stays a separation. A
// touching pair re-probes every EXPLORE (R86 re-samples only after a sample
// that does NOT touch), so a free gap between two touching samples narrower
// than EXPLORE may stay unsampled and read as contact — today's rule, kept
// (plan 2.2: an unsampled gap is no separation); one wider is always proved.
import { describe, expect, it } from "vitest";
import { CONTACT_EPS, buildCollisionModel, sweepCollisions, type CollisionMachine, type CollisionTrack } from "./collision";
import { ContactStore } from "./contactStore";
import { MIN_ADV, boxPositions, rng } from "./collisionFixtures";

const machine: CollisionMachine = { groups: [{ id: "fixed", parent: "root" }, { id: "moving", parent: "root" }],
  kinematics: [{ group: "moving", joint: 0, type: "translate", direction: "x", sign: 1 }],
  workGroup: "fixed", toolGroup: "moving", unitScale: 1, axes: ["X", "Y", "Z"] };
const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 } as any;
const TOL = 1e-3 + 2 * CONTACT_EPS + 1e-6;
const EXPLORE = 5;   // collision.ts DEFAULTS: max(linStepMm 5, rotStepDeg 4) — a touching pair's re-probe stride

/** A track through X waypoints, cut into lines at random lengths, each move rapid or feed at random. */
function trackThrough(xs: number[], rand: () => number): CollisionTrack {
  const pts: number[] = [xs[0]!];
  for (let k = 1; k < xs.length; k++) {
    const a = xs[k - 1]!, b = xs[k]!;
    let x = a;
    while (Math.abs(b - x) > 1e-9) {
      const step = Math.min(Math.abs(b - x), 0.05 + rand() * 0.6);
      x += Math.sign(b - x) * step;
      pts.push(x);
    }
  }
  const n = pts.length, pos = new Float32Array(n * 3), cum = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = pts[i]!; if (i) cum[i] = cum[i - 1]! + Math.abs(pts[i]! - pts[i - 1]!); }
  return { pos, abc: new Float32Array(n * 3), cum, count: n, lines: Uint32Array.from({ length: n }, (_, i) => 10 + i),
           rapid: Uint8Array.from({ length: n }, () => (rand() < 0.5 ? 1 : 0)) };
}

describe("contact windows in closed form, through the product (plan 7.3 check 1)", () => {
  it("every window found to 1e-3; nothing outside but an unsampled narrow gap; a sampled free gap stays a separation", () => {
    const rand = rng(20261013);
    let proved = 0, bridged = 0, windows = 0;
    for (let t = 0; t < 24; t++) {
      const W = 0.13 + rand() * 0.12;                       // half the window: widths 0.26–0.5
      expect(2 * W, "each window wider than the sampling floor").toBeGreaterThan(MIN_ADV);
      const gap = [0.3, 0.4, 0.27, 0.15, 0.05, 6, 8][t % 7]!;   // the free stretch between the two windows
      const am = W * (0.3 + 0.4 * rand()), af = W - am;      // the two half-widths
      const c1 = 0, c2 = 2 * W + gap;                        // centres of the fixed boxes
      const fixed = new Float32Array([...boxPositions(2 * af, 20, 20, c1), ...boxPositions(2 * af, 20, 20, c2)]);
      const model = buildCollisionModel(machine, [
        { id: "fixed", group: "fixed", positions: fixed }, { id: "moving", group: "moving", positions: boxPositions(2 * am, 20, 20) }]);
      const x0 = -4 - rand() * 3, x1 = c2 + 4 + rand() * 3;
      const track = trackThrough([x0, x1, x0 - rand()], rand);
      const store = new ContactStore(1, 0);
      const r = sweepCollisions(model, track, WCS0, { margin: 2, contacts: { store } });
      expect(r.truncated).toBeNull();
      // the windows in track cum: each pass through each box
      const cumAt = (x: number, pass: 0 | 1) => pass === 0 ? x - x0 : (x1 - x0) + (x1 - x);
      const wins: Array<[number, number]> = [];
      for (const pass of [0, 1] as const) {
        for (const c of [c1, c2]) {
          const a = cumAt(c - W, pass), b = cumAt(c + W, pass);
          wins.push([Math.min(a, b), Math.max(a, b)]);
        }
      }
      wins.sort((p, q) => p[0] - q[0]);
      windows += wins.length;
      const I = store.intervals, ivs: Array<{ a: number; b: number; free: number }> = [];
      for (let k = 0; k < I.rows; k++) ivs.push({ a: I.get(k, "enter"), b: I.get(k, "exit"), free: I.get(k, "freeAt") });
      const frees = ivs.map(v => v.free).filter(f => !Number.isNaN(f));
      const where = `case ${t} (W ${W.toFixed(3)}, gap ${gap})`;
      // every window lies inside one interval
      for (const [a, b] of wins) {
        expect(ivs.some(v => v.a <= a + TOL && v.b >= b - TOL), `${where}: window [${a.toFixed(4)}, ${b.toFixed(4)}] found — ${JSON.stringify(ivs)}`).toBe(true);
      }
      // every interval: from a window's start to a window's end; what it spans between windows is an
      // unsampled gap narrower than MIN_ADV — never a gap with a free sample in it
      for (const v of ivs) {
        const first = wins.findIndex(w => Math.abs(w[0] - v.a) <= TOL);
        const lastW = wins.findIndex(w => Math.abs(w[1] - v.b) <= TOL);
        expect(first, `${where}: an interval starting at ${v.a.toFixed(5)} starts where a window starts`).toBeGreaterThanOrEqual(0);
        expect(lastW, `${where}: an interval ending at ${v.b.toFixed(5)} ends where a window ends`).toBeGreaterThanOrEqual(first);
        for (let k = first; k < lastW; k++) {
          const g0 = wins[k]![1], g1 = wins[k + 1]![0];
          expect(g1 - g0, `${where}: a bridged gap [${g0.toFixed(4)}, ${g1.toFixed(4)}] is narrower than a touching pair's stride`).toBeLessThan(EXPLORE + TOL);
          expect(frees.some(f => f > g0 + TOL && f < g1 - TOL), `${where}: a bridged gap holds no free sample`).toBe(false);
          bridged++;
        }
      }
      // a gap wider than the stride is proved free on each pass
      if (gap > EXPLORE + TOL) {
        for (let k = 0; k + 1 < wins.length; k++) {
          const g0 = wins[k]![1], g1 = wins[k + 1]![0];
          if (g1 - g0 > EXPLORE + TOL) {
            expect(frees.some(f => f >= g0 - TOL && f <= g1 + TOL), `${where}: the gap [${g0.toFixed(4)}, ${g1.toFixed(4)}] is proved free`).toBe(true);
            proved++;
          }
        }
      }
    }
    expect(windows).toBe(96);
    expect(proved, "gaps wider than the stride checked").toBeGreaterThan(10);
    expect(bridged, "narrow gaps met").toBeGreaterThan(0);
  });
});
