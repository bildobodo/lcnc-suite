// EVIDENCE PROBE (plan 3.6, not part of the gate): the stepped build against
// the build as it was at bb2214c0 (zz_old/, a frozen copy) — field for field,
// on the budget shapes, the gap and separator shapes, and real sweeps.
import { describe, expect, it } from "vitest";
import { ContactStore, GAP_TOOL_UNKNOWN, GAP_UNDECIDABLE, IV_AFTER_UNKNOWN_TOOL, IV_ENDED_AT_GAP, IV_ENTER_DECIDED, IV_EXIT_DECIDED, NONE,
  REQUEST_BUDGET, shareOf, type StoreBudget } from "./contactStore";
import { buildContactView, buildContactViewSteps, contactBands, startTargets, viewCounts, type ContactSource, type ContactView } from "./contactView";
import { buildContactView as buildOld, contactBands as bandsOld, startTargets as startsOld, viewCounts as countsOld } from "./zz_old/contactViewOld";
import { buildCollisionModel, sweepCollisions, toolCylinderPositions, type CollisionMachine } from "./collision";
import { boxPositions } from "./collisionFixtures";
import { buildScrubTrack, type ScrubTrack } from "./scrubTrack";

const D = IV_ENTER_DECIDED | IV_EXIT_DECIDED;
/** Every derived field of a view, plain. */
function fields(v: ContactView): unknown {
  const rl = (r: { refs: Uint32Array; max: Float64Array; pre: Float64Array }) => [Array.from(r.refs), Array.from(r.max), Array.from(r.pre)];
  return {
    n: v.n, tgt: rl(v.tgt), aux: rl(v.aux), ep: rl(v.ep), joined: Array.from(v.joined), reachRef: Array.from(v.reachRef), reachVal: Array.from(v.reachVal),
    tables: v.tables.map(t => t ? [t.src, t.shard, t.held, t.revision, t.ownCov, t.cov, Array.from(t.hIdx), Array.from(t.hReach)] : null),
    unions: v.unions.map(u => u ? [u.gens.map(g => [Array.from(g.uIdx), g.back, g.front]), Array.from(u.sRef)] : null),
    indexes: v.indexes.map(u => u ? [u.gens.map(g => [Array.from(g.uIdx), g.back, g.front]), Array.from(u.sRef)] : null),
    unionCounts: v.unionCounts, nearCur: Array.from(v.nearCur), nearHeld: Array.from(v.nearHeld), conflicts: v.conflicts,
  };
}
let compared = 0, targets = 0, yieldsMax = 0;
function same(input: Parameters<typeof buildContactView>[0], tag: string) {
  const a = buildOld(input as never) as unknown as ContactView;
  const job = buildContactViewSteps(input);
  let yields = 0, r = job.next();
  while (!r.done) { yields++; r = job.next(); }
  const b = r.value;
  expect(fields(b), tag).toEqual(fields(a));
  // the stepped queries the bar takes: the bands at two resolutions, the counts, the start targets
  const end = input.coverage;
  for (const cols of [997, 8192]) expect(contactBands(b, cols, end), `${tag} bands ${cols}`).toEqual(bandsOld(a as never, cols, end));
  expect(viewCounts(b), `${tag} counts`).toEqual(countsOld(a as never));
  expect(startTargets(b), `${tag} starts`).toEqual(startsOld(a as never));
  compared++; targets += b.n; yieldsMax = Math.max(yieldsMax, yields);
}

// ---- the budget shapes (the measurement's), at a sixteenth of the budget ----
function shaped(cutting: boolean, onePair: boolean, generation: number, b: StoreBudget, count: number, request = 1): ContactStore {
  const st = new ContactStore(request, generation, b);
  const later = generation === 1 && cutting, per = 4;
  let ep = -1, last = -1;
  for (let i = 0; i < count; i++) {
    const pair = onePair ? 0 : (i / per) | 0;
    if (i % per === 0) {
      const at = 3 * i + (later ? 1.5 : 0);
      ep = st.episodes.append({ pair, ordinal: onePair ? i / per : 0, flags: 0, onset: at, end: at + 3 * per, closeAt: at, closeDist: 0, firstIv: NONE, ivCount: per });
      last = -1;
    }
    const enter = 3 * i + (later ? 1.5 : 0), exit = enter + 1;
    const iv = st.intervals.append({ episode: ep, enter, exit, flags: D, next: NONE, witness: later ? enter + 0.1 : enter + 0.5,
                                     freeAt: later ? 3 * i + 3.2 : 3 * i + 2, freeR: 0.25 });
    if (last < 0) st.episodes.set(ep, "firstIv", iv); else st.intervals.set(last, "next", iv);
    last = iv;
  }
  return st;
}
const names = (p: number) => ({ a: `t${p}`, b: `w${p}` });

describe("the stepped build is the build as it was (plan 3.6 evidence)", () => {
  it("the budget shapes: plain and union, identical and cutting, one pair and many", { timeout: 600_000 }, () => {
    const B = shareOf(REQUEST_BUDGET, 16), S = shareOf(REQUEST_BUDGET, 128), N = B.intervals, NS = S.intervals;
    const cov = 3 * N + 10, covS = 3 * NS + 10;
    for (const cutting of [false, true]) for (const onePair of [false, true]) for (const union of [false, true]) {
      const cur = shaped(cutting, onePair, 1, B, N), held = shaped(cutting, onePair, 0, B, N);
      const curS = shaped(cutting, onePair, 1, S, NS, -1), heldS = shaped(cutting, onePair, 0, S, NS, -1);
      const sources: ContactSource[] = union ? [
        { stores: [cur], held: [held], heldCoverage: [cov], at: c => c, ownCoverage: cov },
        { stores: [curS], held: [heldS], heldCoverage: [covS], at: c => c, entry: true, ownCoverage: covS },
      ] : [{ stores: [cur], at: c => c, ownCoverage: cov }, { stores: [curS], at: c => c, entry: true, ownCoverage: covS }];
      same({ sources, pairName: names, coverage: cov }, `cutting ${cutting} one pair ${onePair} union ${union}`);
    }
  });

  it("gaps of both reasons, separators where the generations disagree on the tool", { timeout: 600_000 }, () => {
    const B = shareOf(REQUEST_BUDGET, 64);
    for (const reason of [GAP_UNDECIDABLE, GAP_TOOL_UNKNOWN]) for (const spread of [false, true]) {
      const mk = (g: number) => {
        const st = shaped(true, true, g, B, B.intervals);
        for (let k = 0; k < B.gaps; k++) { const at = 3 * B.intervals + 10 + 3 * k; st.gaps.append({ pair: spread ? 1 + k : 1, start: at, end: at + 1, reason }); }
        return st;
      };
      const end = 3 * B.intervals + 10 + 3 * B.gaps + 10;
      same({ sources: [{ stores: [mk(1)], held: [mk(0)], heldCoverage: [end], at: c => c, ownCoverage: end }], pairName: names, coverage: end }, `gaps ${reason} ${spread}`);
    }
    // separators: the earlier generation's contacts reach over tool gaps only the later one saw
    const held = new ContactStore(1, 0, B), cur = new ContactStore(1, 1, B);
    const n = Math.min(B.episodes, B.gaps);
    for (let i = 0; i < n; i++) {
      const ep = held.episodes.append({ pair: 0, ordinal: i, flags: 0, onset: 6 * i, end: 6 * i + 5, closeAt: 6 * i, closeDist: 0, firstIv: NONE, ivCount: 1 });
      held.episodes.set(ep, "firstIv", held.intervals.append({ episode: ep, enter: 6 * i, exit: 6 * i + 5, flags: D, next: NONE, witness: 6 * i + 0.5, freeAt: 6 * i + 5.5, freeR: 0.2 }));
      const e2 = cur.episodes.append({ pair: 0, ordinal: 2 * i, flags: 0, onset: 6 * i, end: 6 * i + 2, closeAt: 6 * i, closeDist: 0, firstIv: NONE, ivCount: 1 });
      cur.episodes.set(e2, "firstIv", cur.intervals.append({ episode: e2, enter: 6 * i, exit: NaN, flags: IV_ENTER_DECIDED | IV_ENDED_AT_GAP, next: NONE, witness: 6 * i + 0.5, freeAt: NaN, freeR: 0 }));
      cur.gaps.append({ pair: 0, start: 6 * i + 2, end: 6 * i + 2.5, reason: GAP_TOOL_UNKNOWN });
      const e3 = cur.episodes.append({ pair: 0, ordinal: 2 * i + 1, flags: 0, onset: 6 * i + 3, end: 6 * i + 5, closeAt: 6 * i + 3, closeDist: 0, firstIv: NONE, ivCount: 1 });
      cur.episodes.set(e3, "firstIv", cur.intervals.append({ episode: e3, enter: 6 * i + 3, exit: 6 * i + 5, flags: D | IV_AFTER_UNKNOWN_TOOL, next: NONE, witness: 6 * i + 3.5, freeAt: 6 * i + 5.5, freeR: 0.2 }));
    }
    const end = 6 * n + 10;
    same({ sources: [{ stores: [cur], held: [held], heldCoverage: [end], at: c => c, ownCoverage: end }], pairName: names, coverage: end }, "separators");
  });

  it("real sweeps: a head past a vise, the tool unknown on random stretches, collapsed times — alone, with an empty and with an identical rerun", { timeout: 600_000 }, () => {
    const machine: CollisionMachine = {
      groups: [{ id: "table", parent: "root" }, { id: "part", parent: "table" }, { id: "head", parent: "root" }],
      kinematics: [{ group: "head", joint: 0, type: "translate", direction: "x", sign: 1 }],
      workGroup: "part", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
    };
    const model = buildCollisionModel(machine, [
      { id: "vise", group: "table", positions: boxPositions(2, 2, 2, 0, 0, 1) },
      { id: "tool", group: "head", positions: toolCylinderPositions(20, 2), tool: true },
    ]);
    const pairName = (p: number) => ({ a: model.bodies[model.pairs[p]![0]]!.id, b: model.bodies[model.pairs[p]![1]]!.id });
    const EVENTS = [{ seq: 0, xyz: [0, 0, 0] as [number, number, number], tool: 1 }, { seq: 1, xyz: [0, 0, 0] as [number, number, number], tool: 3 }];
    const track = (xs: number[], times: number[], unknown: number[]): ScrubTrack => {
      const n = xs.length;
      return buildScrubTrack({ pos: new Float32Array() }, {
        pos: new Float32Array(xs.flatMap(x => [x, 0, 0])), abc: new Float32Array(n * 3),
        lines: Uint32Array.from({ length: n }, (_, i) => i + 1), seq: Uint32Array.from({ length: n }, (_, i) => i + 1),
        tcum: new Float32Array(times), tlo: Uint32Array.from(unknown),
      }, undefined, undefined, undefined, EVENTS)!;
    };
    const sweep = (t: ScrubTrack, generation: number) => {
      const st = new ContactStore(1, generation);
      sweepCollisions(model, t, { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 }, {
        margin: 0.1, linStepMm: 0.1, rotStepDeg: 0.1, tloEvents: EVENTS, toolDims: { 1: { diam: 20, len: 2 } }, liveTool: 1, unknownTools: [3],
        contacts: { store: st } });
      return st;
    };
    let seed = 360;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let c = 0; c < 300; c++) {
      const n = 12 + Math.floor(rnd() * 30), xs: number[] = [], times: number[] = [], unknown: number[] = [];
      let x = 4 + rnd() * 12, time = 0, u = 0;
      for (let i = 0; i < n; i++) {
        x = Math.max(3, Math.min(17, x + (rnd() - 0.5) * 6));
        xs.push(x);
        time += rnd() < 0.15 ? 0.00001 : 0.5 + rnd() * 3;
        times.push(10000 + time);
        if (rnd() < (u ? 0.45 : 0.12)) u = 1 - u;
        unknown.push(i === 0 ? 0 : u);
      }
      const t = track(xs, times, unknown), end = t.cum[t.count - 1]!;
      const old = sweep(t, 0), cur = sweep(t, 1);
      same({ sources: [{ stores: [old], at: v => v, ownCoverage: end }], coverage: end, pairName }, `case ${c} alone`);
      same({ sources: [{ stores: [new ContactStore(1, 1)], held: [old], heldCoverage: [end], at: v => v, ownCoverage: 0 }], coverage: end, pairName }, `case ${c} empty`);
      same({ sources: [{ stores: [cur], held: [old], heldCoverage: [end], at: v => v, ownCoverage: end }], coverage: end, pairName }, `case ${c} same`);
    }
    console.log(`[3.6 evidence] ${compared} views compared field for field, ${targets} targets; at most ${yieldsMax} yields in one build`);
  });
});
