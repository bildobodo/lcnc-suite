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
import { CONTACT_EPS, buildCollisionModel, poseModel, sweepCollisions, sweepCollisionsIter, type CollisionMachine, type CollisionTrack } from "./collision";
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
      const chunks: Array<[number, number]> = [];
      const r = sweepCollisions(model, track, WCS0, { margin: 2, contacts: { store }, onChunkSpeed: (_pi, s0, s1) => chunks.push([s0, s1]) });
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
      // a free radius holds only inside the chunk whose speed bound proves it
      // (plan 2.2, Codex R142). A touching pair is queried at every chunk's
      // start, so on these short lines a separation is found there (the side
      // before it 0) or by a re-sample in an earlier chunk: the radius is 0 and
      // the sample point alone is the evidence. Unclipped, it reaches past.
      for (let k = 0; k < I.rows; k++) {
        const f = I.get(k, "freeAt"), fr = I.get(k, "freeR");
        if (Number.isNaN(f) || !(fr > 0)) continue;
        expect(chunks.some(([s0, s1]) => f - fr >= s0 - 1e-4 && f + fr <= s1 + 1e-4),
          `case ${t}: the free stretch ${f.toFixed(4)} ± ${fr.toFixed(4)} lies inside one chunk`).toBe(true);
      }
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

// A NEAR stay (step 4 package 2, plan 5, B8; found by plan 7.3 check 2): a
// box passes another at a fixed distance g inside the margin — never a touch
// — forth and back, over lines of 0.05–0.65. The pair is inside the margin
// where |x − c| ≤ W + √(margin² − g²), in closed form. A stay ends at its last
// sample inside the margin; without a sample per line, a near pair steps to
// where it could first touch (g/V, up to EXPLORE), and its stay ended up to
// that far before the pair left the margin — lines it was inside the margin
// on got no stay. Required: every line the pair is inside the margin on for
// more than MIN_ADV is reached by a stay, and every stay lies inside a window.
describe("near stays in closed form, through the product (plan 5, B8)", () => {
  it("a stay reaches every line its pair is inside the margin on for more than MIN_ADV, and lies inside the window", () => {
    const rand = rng(20261018);
    const M = 2;
    let lines = 0, cases = 0;
    for (let t = 0; t < 24; t++) {
      const g = 0.8 + rand() * 1.15;                         // the distance across: inside the margin, no touch
      const af = 0.2 + rand() * 2, am = 0.2 + rand() * 2, W = af + am;
      const H = W + Math.sqrt(M * M - g * g);                // the window's half-width along X
      const c = 0;
      const model = buildCollisionModel(machine, [
        { id: "fixed", group: "fixed", positions: boxPositions(2 * af, 20, 20, c) },
        { id: "moving", group: "moving", positions: boxPositions(2 * am, 20, 20, 0, 20 + g) }]);
      const x0 = -H - 5 - rand() * 3, x1 = H + 5 + rand() * 3;
      const track = trackThrough([x0, x1, x0 - rand()], rand);
      const store = new ContactStore(1, 0);
      const r = sweepCollisions(model, track, WCS0, { margin: M, contacts: { store } });
      expect(r.truncated).toBeNull();
      expect(store.intervals.rows, `case ${t}: never a touch`).toBe(0);
      const cumAt = (x: number, pass: 0 | 1) => pass === 0 ? x - x0 : (x1 - x0) + (x1 - x);
      const wins = ([0, 1] as const).map(p => [cumAt(c - H, p), cumAt(c + H, p)].sort((a, b) => a - b) as [number, number]);
      // an open stay (no separation before the track's end) runs to the end
      const E = store.episodes, stays: Array<[number, number]> = [];
      for (let e = 0; e < E.rows; e++) { const w = E.get(e, "end"); stays.push([E.get(e, "onset"), Number.isNaN(w) ? track.cum[track.count - 1]! : w]); }
      const where = `case ${t} (g ${g.toFixed(3)}, half-width ${H.toFixed(3)})`;
      for (const [a, b] of stays)
        expect(wins.some(([p, q]) => a >= p - TOL && b <= q + TOL), `${where}: the stay [${a.toFixed(4)}, ${b.toFixed(4)}] lies inside a window`).toBe(true);
      for (let i = 1; i < track.count; i++) {
        const a = track.cum[i - 1]!, b = track.cum[i]!;
        for (const [p, q] of wins) {
          const lo = Math.max(a, p), hi = Math.min(b, q);
          if (hi - lo <= MIN_ADV + TOL) continue;
          lines++;
          expect(stays.some(([u, w]) => u <= hi && w >= lo), `${where}: L${track.lines[i]} [${a.toFixed(4)}, ${b.toFixed(4)}] is inside the margin over [${lo.toFixed(4)}, ${hi.toFixed(4)}] — no stay reaches it: ${JSON.stringify(stays)}`).toBe(true);
        }
      }
      cases++;
    }
    expect(cases).toBe(24);
    expect(lines, "lines inside the margin for more than MIN_ADV").toBeGreaterThan(100);
  });

  // The search back from a near pair's margin exit (Codex R174 VP-I127): a
  // pair inside the margin over one step of a fixed body (gap 1.9), then just
  // OUTSIDE it over the next (gap 2.0005) along a long slow stretch — a rotary
  // no body rides drives the parameter. The search must certify the outside
  // stretch back to the exit, MIN_ADV at a time: thousands of samples, inside
  // ONE sample of the main loop. They pass its checkpoints.
  const stepped = () => {
    const spun: CollisionMachine = { groups: [{ id: "fixed", parent: "root" }, { id: "moving", parent: "root" }, { id: "spinner", parent: "root" }],
      kinematics: [{ group: "moving", joint: 0, type: "translate", direction: "x", sign: 1 },
                   { group: "spinner", joint: 3, type: "rotate", direction: "z", sign: 1 }],
      workGroup: "fixed", toolGroup: "moving", unitScale: 1, axes: ["X", "Y", "Z", "A"] };
    const model = buildCollisionModel(spun, [
      { id: "fixed", group: "fixed", positions: new Float32Array([...boxPositions(20, 20, 20, -10, 0), ...boxPositions(40, 20 - 0.1005, 20, 20, -0.1005 / 2)]) },
      { id: "moving", group: "moving", positions: boxPositions(2, 20, 20, 0, 21.9) }]);
    const xs = [-30, -10, 30], as = [0, 0, 8000];
    const n = 3, pos = new Float32Array(n * 3), abc = new Float32Array(n * 3), cum = new Float32Array(n);
    for (let k = 0; k < n; k++) { pos[k * 3] = xs[k]!; abc[k * 3] = as[k]!; if (k) cum[k] = cum[k - 1]! + Math.max(Math.abs(xs[k]! - xs[k - 1]!), as[k]! - as[k - 1]!); }
    return { model, track: { pos, abc, cum, count: n, lines: Uint32Array.from([10, 11, 12]), rapid: new Uint8Array(n) } as CollisionTrack };
  };
  const probesOf = (profile: { probes?: Uint32Array }) => { let t = 0; for (const x of profile.probes ?? []) t += x; return t; };

  it("the search back from a margin exit passes the checkpoints: never more than 512 samples between two yields (Codex R174 VP-I127)", { timeout: 120_000 }, () => {
    const { model, track } = stepped();
    const profile: { probes?: Uint32Array } = {};
    const it = sweepCollisionsIter(model, track, WCS0, { margin: 2, contacts: { store: new ContactStore(1, 0) }, profile, yieldMs: 1e9 });
    let r = it.next(), last = 0, most = 0;
    while (!r.done) { const p = probesOf(profile); most = Math.max(most, p - last); last = p; r = it.next(); }
    const p = probesOf(profile); most = Math.max(most, p - last);
    expect(r.value.truncated).toBeNull();
    expect(p, "a long search: the outside stretch certified back to the exit").toBeGreaterThan(1000);
    expect(most, "samples between two yields").toBeLessThanOrEqual(512);
  });

  it("the budget and an abort are honoured during the search (Codex R174 VP-I127)", { timeout: 120_000 }, () => {
    // a clock of work: one unit per sample away from the main step
    const { model, track } = stepped();
    const profile: { probes?: Uint32Array } = {};
    const clock = () => probesOf(profile);
    const r = sweepCollisions(model, track, WCS0, { margin: 2, contacts: { store: new ContactStore(1, 0) }, profile, clock, yieldMs: 8, maxMs: 64 });
    expect(r.truncated?.reason).toBe("time");
    expect(clock(), "stopped within a checkpoint's samples of the budget").toBeLessThanOrEqual(64 + 32);
    // an abort at the first checkpoint inside the search ends it there
    const p2: { probes?: Uint32Array } = {};
    const it = sweepCollisionsIter(model, track, WCS0, { margin: 2, contacts: { store: new ContactStore(1, 0) }, profile: p2, yieldMs: 1e9 });
    let s = it.next();
    while (!s.done && probesOf(p2) === 0) s = it.next();
    expect(s.done, "a checkpoint inside the search").toBe(false);
    const at = probesOf(p2);
    // aborted: the iterator ends (after its closing progress), searching nothing more
    let steps = 0;
    do { s = it.next(true); steps++; } while (!s.done && steps < 4);
    expect(s.done, "ended").toBe(true);
    expect(probesOf(p2), "nothing searched after the abort").toBe(at);
  });

  it("parked and continued inside the search, with the model posed elsewhere meanwhile: the same tables (Codex R174 VP-I127)", { timeout: 120_000 }, () => {
    const { model, track } = stepped();
    const whole = new ContactStore(1, 0);
    sweepCollisions(model, track, WCS0, { margin: 2, contacts: { store: whole } });
    const parked = new ContactStore(1, 0), profile: { probes?: Uint32Array } = {};
    let ticks = 0;
    const it = sweepCollisionsIter(model, track, WCS0, { margin: 2, contacts: { store: parked }, profile, clock: () => ticks++, yieldMs: 3 });
    let r = it.next(), inside = 0, last = 0;
    while (!r.done) {
      const p = probesOf(profile);
      if (p > last) inside++;
      last = p;
      poseModel(model, [5, 0, 0, 1234]);   // a side run or a snapshot's probe in between
      r = it.next();
    }
    expect(inside, "yields inside the search").toBeGreaterThan(2);
    const rows = (st: ContactStore) => JSON.stringify({
      e: Array.from({ length: st.episodes.rows }, (_, k) => [st.episodes.get(k, "onset"), st.episodes.get(k, "end"), st.episodes.get(k, "closeDist")]),
      i: Array.from({ length: st.intervals.rows }, (_, k) => [st.intervals.get(k, "enter"), st.intervals.get(k, "exit")]) });
    expect(rows(parked)).toBe(rows(whole));
    expect(whole.episodes.rows, "the stay").toBeGreaterThan(0);
  });

  it("a long slow stretch after a fast one costs a handful of samples: each chunk's own bound, not the largest (Codex R174 VP-I127)", () => {
    // Codex's geometry: X fast to 3.5, then slowly to 5.5 while a rotary no body rides turns
    const spun: CollisionMachine = { groups: [{ id: "fixed", parent: "root" }, { id: "moving", parent: "root" }, { id: "spinner", parent: "root" }],
      kinematics: [{ group: "moving", joint: 0, type: "translate", direction: "x", sign: 1 },
                   { group: "spinner", joint: 3, type: "rotate", direction: "z", sign: 1 }],
      workGroup: "fixed", toolGroup: "moving", unitScale: 1, axes: ["X", "Y", "Z", "A"] };
    for (const turns of [3600, 36000]) {
      const model = buildCollisionModel(spun, [{ id: "fixed", group: "fixed", positions: boxPositions(2, 20, 20) },
                                               { id: "moving", group: "moving", positions: boxPositions(2, 20, 20, 0, 21) }]);
      const track: CollisionTrack = { count: 3, pos: Float32Array.from([-8, 0, 0, 3.5, 0, 0, 5.5, 0, 0]), abc: Float32Array.from([0, 0, 0, 0, 0, 0, turns, 0, 0]),
        cum: Float32Array.from([0, 11.5, 11.5 + turns]), lines: Uint32Array.from([10, 11, 12]), rapid: new Uint8Array(3) };
      const profile: { probes?: Uint32Array } = {}, store = new ContactStore(1, 0);
      sweepCollisions(model, track, WCS0, { margin: 2, contacts: { store }, profile });
      expect(probesOf(profile), `${turns}°: the samples away from the main step`).toBeLessThanOrEqual(50);
      expect(store.episodes.rows, "the stay").toBe(1);
    }
  });

  // The search's bounds are the history's, each over its own stretch: here the
  // stretch begins on slow chunks (a rotary no body rides drives the
  // parameter, X creeps) and the pair leaves the margin on fast ones (X
  // alone) — the first entry's slow bound alone would step back past the fast
  // tail; varying speeds fill the history past its 16 entries (merged at the
  // larger bound).
  it("a fast chunk after slow ones: the search takes each entry's own bound, merged at the larger (Codex R174 VP-I127)", () => {
    const rand = rng(20261020);
    const M = 2;
    const spun: CollisionMachine = { groups: [{ id: "fixed", parent: "root" }, { id: "moving", parent: "root" }, { id: "spinner", parent: "root" }],
      kinematics: [{ group: "moving", joint: 0, type: "translate", direction: "x", sign: 1 },
                   { group: "spinner", joint: 3, type: "rotate", direction: "z", sign: 1 }],
      workGroup: "fixed", toolGroup: "moving", unitScale: 1, axes: ["X", "Y", "Z", "A"] };
    let lines = 0;
    for (let t = 0; t < 16; t++) {
      const g = 0.8 + rand() * 1.15;
      const af = 0.2 + rand() * 2, am = 0.2 + rand() * 2, H = af + am + Math.sqrt(M * M - g * g);
      const model = buildCollisionModel(spun, [
        { id: "fixed", group: "fixed", positions: boxPositions(2 * af, 20, 20) },
        { id: "moving", group: "moving", positions: boxPositions(2 * am, 20, 20, 0, 20 + g) }]);
      // fast to just outside the window, slow lines (each 4–12° of A, 0.02–0.3 of X) into it, fast lines out of it
      const xs = [-H - 6 - rand() * 2, -H - 0.5], as = [0, 0];
      const fastFrom = H - 0.4 - rand() * 1.2;
      while (xs[xs.length - 1]! < fastFrom) { xs.push(Math.min(fastFrom, xs[xs.length - 1]! + 0.02 + rand() * 0.28)); as.push(as[as.length - 1]! + 4 + rand() * 8); }
      while (xs[xs.length - 1]! < H + 3) { xs.push(xs[xs.length - 1]! + 0.05 + rand() * 0.6); as.push(as[as.length - 1]!); }
      const n = xs.length, pos = new Float32Array(n * 3), abc = new Float32Array(n * 3), cum = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = xs[i]!; abc[i * 3] = as[i]!;
        if (i) cum[i] = cum[i - 1]! + Math.max(Math.abs(xs[i]! - xs[i - 1]!), Math.abs(as[i]! - as[i - 1]!));
      }
      const track: CollisionTrack = { pos, abc, cum, count: n, lines: Uint32Array.from({ length: n }, (_, i) => 10 + i), rapid: new Uint8Array(n) };
      const store = new ContactStore(1, 0);
      expect(sweepCollisions(model, track, WCS0, { margin: M, contacts: { store } }).truncated).toBeNull();
      const E = store.episodes, stays: Array<[number, number]> = [];
      for (let e = 0; e < E.rows; e++) { const w = E.get(e, "end"); stays.push([E.get(e, "onset"), Number.isNaN(w) ? cum[n - 1]! : w]); }
      const where = `case ${t} (g ${g.toFixed(3)}, half-width ${H.toFixed(3)}, fast from x ${fastFrom.toFixed(3)})`;
      for (let i = 1; i < n; i++) {
        const x0 = xs[i - 1]!, x1 = xs[i]!, c0 = track.cum[i - 1]!, c1 = track.cum[i]!;
        const u0 = Math.max(0, (-H - x0) / (x1 - x0)), u1 = Math.min(1, (H - x0) / (x1 - x0));
        if (u1 <= u0) continue;
        const lo = c0 + (c1 - c0) * u0, hi = c0 + (c1 - c0) * u1;
        if (hi - lo <= MIN_ADV + TOL) continue;
        lines++;
        expect(stays.some(([u, w]) => u <= hi && w >= lo), `${where}: L${track.lines[i]} inside the margin over [${lo.toFixed(4)}, ${hi.toFixed(4)}] — no stay reaches it: ${JSON.stringify(stays)}`).toBe(true);
      }
    }
    expect(lines, "lines inside the margin for more than MIN_ADV").toBeGreaterThan(100);
  });

  // The search over a near stretch steps by the distance's rate bounds since
  // its start sample, each chunk's over its own stretch. Here the stretch
  // begins on a fast chunk (X alone, V = 1) and the pair leaves the margin on
  // slow ones, where a rotary no body rides drives the sweep's parameter
  // (1° ≙ 1) and X creeps — the current chunk's bound alone would step past
  // the fast tail.
  it("the search over a near stretch takes the fast chunk's bound where it holds (a slow chunk after a fast one)", () => {
    const rand = rng(20261019);
    const M = 2;
    const spun: CollisionMachine = { groups: [{ id: "fixed", parent: "root" }, { id: "moving", parent: "root" }, { id: "spinner", parent: "root" }],
      kinematics: [{ group: "moving", joint: 0, type: "translate", direction: "x", sign: 1 },
                   { group: "spinner", joint: 3, type: "rotate", direction: "z", sign: 1 }],
      workGroup: "fixed", toolGroup: "moving", unitScale: 1, axes: ["X", "Y", "Z", "A"] };
    let lines = 0;
    for (let t = 0; t < 16; t++) {
      const g = 0.8 + rand() * 1.15;
      const af = 0.2 + rand() * 2, am = 0.2 + rand() * 2, H = af + am + Math.sqrt(M * M - g * g);
      const model = buildCollisionModel(spun, [
        { id: "fixed", group: "fixed", positions: boxPositions(2 * af, 20, 20) },
        { id: "moving", group: "moving", positions: boxPositions(2 * am, 20, 20, 0, 20 + g) }]);
      // fast lines to just before the exit, then slow ones: each 8–12° of A and 0.05–0.35 of X
      const xs = [-H - 6 - rand() * 2], as = [0];
      const slowFrom = H - 0.4 - rand() * 1.2;
      while (xs[xs.length - 1]! < slowFrom) { xs.push(Math.min(slowFrom, xs[xs.length - 1]! + 0.05 + rand() * 0.6)); as.push(0); }
      while (xs[xs.length - 1]! < H + 3) { xs.push(xs[xs.length - 1]! + 0.05 + rand() * 0.3); as.push(as[as.length - 1]! + 8 + rand() * 4); }
      const n = xs.length, pos = new Float32Array(n * 3), abc = new Float32Array(n * 3), cum = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = xs[i]!; abc[i * 3] = as[i]!;
        if (i) cum[i] = cum[i - 1]! + Math.max(Math.abs(xs[i]! - xs[i - 1]!), Math.abs(as[i]! - as[i - 1]!));
      }
      const track: CollisionTrack = { pos, abc, cum, count: n, lines: Uint32Array.from({ length: n }, (_, i) => 10 + i), rapid: new Uint8Array(n) };
      const store = new ContactStore(1, 0);
      const r = sweepCollisions(model, track, WCS0, { margin: M, contacts: { store } });
      expect(r.truncated).toBeNull();
      // an open stay (no separation before the track's end) runs to the end
      const E = store.episodes, stays: Array<[number, number]> = [];
      for (let e = 0; e < E.rows; e++) { const w = E.get(e, "end"); stays.push([E.get(e, "onset"), Number.isNaN(w) ? cum[n - 1]! : w]); }
      const where = `case ${t} (g ${g.toFixed(3)}, half-width ${H.toFixed(3)}, slow from x ${slowFrom.toFixed(3)})`;
      for (let i = 1; i < n; i++) {
        // the part of the line inside the margin, |x| ≤ H, on the sweep's parameter (x linear in it)
        const x0 = xs[i - 1]!, x1 = xs[i]!, c0 = track.cum[i - 1]!, c1 = track.cum[i]!;
        const u0 = Math.max(0, (-H - x0) / (x1 - x0)), u1 = Math.min(1, (H - x0) / (x1 - x0));
        if (u1 <= u0) continue;
        const lo = c0 + (c1 - c0) * u0, hi = c0 + (c1 - c0) * u1;
        if (hi - lo <= MIN_ADV + TOL) continue;
        lines++;
        expect(stays.some(([u, w]) => u <= hi && w >= lo), `${where}: L${track.lines[i]} inside the margin over [${lo.toFixed(4)}, ${hi.toFixed(4)}] — no stay reaches it: ${JSON.stringify(stays)}`).toBe(true);
      }
    }
    expect(lines, "lines inside the margin for more than MIN_ADV").toBeGreaterThan(100);
  });
});
