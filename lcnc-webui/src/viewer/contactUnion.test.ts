// Round B4: the fallback's union (plan 3.5) — Codex's sequences R140–R142 and
// the fast search against a brute force over plain sets of spans.
import { describe, expect, it } from "vitest";
import {
  eachPiece, eachWideConflict, evidencePos, evidenceZone, mergeSeps, NO_SEPARATORS, pieceFrom, pieceIntervals, PROTECT, sepArray, START_ENTER, START_FREE,
  START_SEP, unionScratch, unionReach, type UnionPiece, type UnionSeps, type UnionSide,
} from "./contactUnion";

interface Iv {
  enter: number; end: number; open?: boolean; witness?: number; ed?: boolean; xd?: boolean; freeAt?: number; freeR?: number;
  /** Began after the unknown tool. */
  after?: boolean;
}
/** A generation's intervals of one group and its tool gaps (closed spans). */
interface Plain { ivs: Iv[]; gaps?: Array<[number, number]> }

function side(p: Plain): UnionSide {
  const ivs = p.ivs;
  // the bounds over the whole "source" (here: this generation's one group)
  const r = unionReach(ivs.length, k => ivs[k]!.enter, k => ivs[k]!.freeAt ?? NaN, k => ivs[k]!.freeR ?? NaN, () => true);
  return {
    n: ivs.length,
    enter: k => ivs[k]!.enter, end: k => ivs[k]!.end, open: k => !!ivs[k]!.open,
    witness: k => ivs[k]!.witness ?? (ivs[k]!.enter + ivs[k]!.end) / 2,
    enterDecided: k => ivs[k]!.ed ?? true, exitDecided: k => ivs[k]!.xd ?? true, afterTool: k => !!ivs[k]!.after,
    freeAt: k => ivs[k]!.freeAt ?? NaN, freeR: k => ivs[k]!.freeR ?? NaN,
    back: r.back, front: r.front,
  };
}
const sidesOf = (held: Plain, cur: Plain) => [side(held), side(cur)];
/** Both generations' tool gaps merged: the flat spans (the brute force reads them) and as the core reads them. */
const sepsFlat = (held: Plain, cur: Plain) => mergeSeps([(held.gaps ?? []).flat(), (cur.gaps ?? []).flat()]).seps;
const sepsOf = (held: Plain, cur: Plain) => sepArray(sepsFlat(held, cur));

const pieces = (sides: UnionSide[], seps: UnionSeps = NO_SEPARATORS) => {
  const out: UnionPiece[] = [];
  eachPiece(sides, seps, p => out.push({ ...p }));
  return out;
};
const spans = (ps: UnionPiece[]) => ps.map(p => [p.start, p.end]);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** The held interval whose witness the piece holds (the earliest), else −1. */
function heir(sides: UnionSide[], p: UnionPiece, seps: UnionSeps = NO_SEPARATORS): number {
  let h = -1, w = Infinity;
  pieceIntervals(sides, seps, p, (si, k) => {
    const x = sides[si]!.witness(k);
    const inside = (x > p.start || (x === p.start && !p.startOpen)) && (x < p.end || (x === p.end && !p.endOpen));
    if (si === 0 && inside && x < w) { w = x; h = k; }
  });
  return h;
}

// ---- the brute force: sets of spans ---------------------------------------------------------------
interface Sp { a: number; ao: boolean; b: number; bo: boolean }
const empty = (s: Sp) => s.a > s.b || (s.a === s.b && (s.ao || s.bo));
function union(list: Sp[]): Sp[] {
  const xs = list.filter(s => !empty(s)).sort((x, y) => x.a - y.a || Number(x.ao) - Number(y.ao));
  const out: Sp[] = [];
  for (const s of xs) {
    const l = out[out.length - 1];
    if (l && (s.a < l.b || (s.a === l.b && !(s.ao && l.bo)))) {
      if (s.b > l.b) { l.b = s.b; l.bo = s.bo; } else if (s.b === l.b) l.bo = l.bo && s.bo;
    } else out.push({ ...s });
  }
  return out;
}
function minus(set: Sp[], f: Sp): Sp[] {
  const out: Sp[] = [];
  for (const s of set) {
    const meets = !(f.b < s.a || s.b < f.a || (f.b === s.a && (f.bo || s.ao)) || (s.b === f.a && (s.bo || f.ao)));
    if (!meets) { out.push(s); continue; }
    const left: Sp = { a: s.a, ao: s.ao, b: f.a, bo: !f.ao };
    if (f.a > s.a || (f.a === s.a && f.ao && !s.ao)) out.push(left);
    const right: Sp = { a: f.b, ao: !f.bo, b: s.b, bo: s.bo };
    if (f.b < s.b || (f.b === s.b && f.bo && !s.bo)) out.push(right);
  }
  return out.filter(s => !empty(s));
}
/** The zone of each POINT interval of a generation (index → zone), the rule
 *  written out apart: the zones holding its point are [separators starting
 *  before it, separators ending at or before it]; where several do, the
 *  generation's order decides — never before the interval before it, one
 *  further after a restart. */
function pointZones(g: Plain, seps: ArrayLike<number>): Map<number, number> {
  const m = seps.length / 2, out = new Map<number, number>();
  let prev = 0;   // before the first: the zone the track begins in
  g.ivs.forEach((iv, k) => {
    if (iv.enter !== iv.end) {
      let below = 0;
      for (let i = 0; i < m; i++) if (seps[2 * i + 1]! < iv.end) below++;
      prev = below;
      return;
    }
    let zmin = 0, zmax = 0;
    for (let i = 0; i < m; i++) { if (seps[2 * i]! < iv.enter) zmin++; if (seps[2 * i + 1]! <= iv.enter) zmax++; }
    prev = zmin > zmax ? -1 : zmin === zmax ? zmin : Math.min(zmax, Math.max(zmin, prev + (iv.after ? 1 : 0)));
    out.set(k, prev);
  });
  return out;
}
/** Interval iv's part in zone z of the merged separators: a point at a zone's
 *  bound belongs where the interval goes on; a point interval lies in its
 *  point zone (`pz`, when there are separators). */
function zonePart(iv: Iv, seps: ArrayLike<number>, z: number, pz?: number): Sp | null {
  const m = seps.length / 2;
  if (iv.enter === iv.end && m > 0) return pz === z ? { a: iv.enter, ao: false, b: iv.end, bo: false } : null;
  const lo = z === 0 ? -Infinity : seps[2 * z - 1]!, hi = z < m ? seps[2 * z]! : Infinity;
  const A = Math.max(iv.enter, lo), B = Math.min(iv.end, hi);
  if (A > B) return null;
  if (A === B && iv.enter < iv.end) {
    if (z > 0 && A === lo && iv.enter < lo) return null;
    if (z < m && B === hi && iv.end > hi) return null;
  }
  return { a: A, ao: false, b: B, bo: false };
}
function oracle(held: Plain, cur: Plain): Array<Sp & { z: number }> {
  const gens = [held, cur];
  const seps = sepsFlat(held, cur);
  const frags: Sp[] = [];
  for (const g of gens) for (const iv of g.ivs) {
    if (iv.freeAt === undefined || Number.isNaN(iv.freeAt)) continue;
    // the radius a confirmed point inside the stretch refutes beyond it (none: one on the sample)
    let r = (iv.freeR ?? 0) > 0 ? iv.freeR! : 0;
    const p = iv.freeAt, r0 = r;
    const inF = (x: number) => (r0 > 0 ? x > p - r0 && x < p + r0 : x === p);
    let onSample = false;
    for (const h of gens) for (const k of h.ivs) {
      const w = k.witness ?? (k.enter + k.end) / 2;
      const xs = [w, ...((k.ed ?? true) ? [k.enter] : []), ...((k.xd ?? true) && !k.open ? [k.end] : [])];
      for (const x of xs) if (inF(x)) { if (x === p) onSample = true; r = Math.min(r, Math.abs(x - p)); }
    }
    if (!onSample) frags.push(r > 0 ? { a: p - r, ao: true, b: p + r, bo: true } : { a: p, ao: false, b: p, bo: false });
  }
  const free = union(frags), out: Array<Sp & { z: number }> = [];
  const pzs = gens.map(g => pointZones(g, seps));
  for (let z = 0; z <= seps.length / 2; z++) {
    const parts: Sp[] = [];
    gens.forEach((g, gi) => g.ivs.forEach((iv, k) => { const x = zonePart(iv, seps, z, pzs[gi]!.get(k)); if (x) parts.push(x); }));
    let s = union(parts);
    for (const f of free) s = minus(s, f);
    for (const x of union(s)) out.push({ ...x, z });
  }
  return out;
}

describe("the union of two generations less the proven free stretches (plan 3.5)", () => {
  it("R142: a new free sample cuts the old cautious boundary on an undecidable answer; the old event keeps its identity by its witness", () => {
    // old: [0, 0.5] and [1.00037, 3] (its entry cautious, refined onto an undecidable answer; witness 2.5)
    const held: Plain = { ivs: [{ enter: 0, end: 0.5 }, { enter: 1.00037, end: 3, ed: false, witness: 2.5 }] };
    // new: [0, 0.5] proven apart up to 1.25 by its free sample at 0.875; [2, 3]
    const cur: Plain = { ivs: [{ enter: 0, end: 0.5, freeAt: 0.875, freeR: 0.375 }, { enter: 2, end: 3, witness: 2.2 }] };
    const sides = sidesOf(held, cur), p = pieces(sides);
    expect(spans(p)).toEqual([[0, 0.5], [1.25, 3]]);
    expect([p[1]!.startOpen, p[1]!.startKind, p[1]!.startSide, p[1]!.startIdx], "begun at the new free stretch's end, which is not free itself")
      .toEqual([false, 1, 1, 0]);
    expect([heir(sides, p[0]!), heir(sides, p[1]!)], "the old events by their witnesses").toEqual([0, 1]);
  });

  it("R140: two old contacts apart by a free sample, one coarse new one over both — two pieces, split at the free place, each its old identity", () => {
    const held: Plain = { ivs: [{ enter: 0, end: 1, freeAt: 1.0005, freeR: 0.0002, witness: 0.5 }, { enter: 1.001, end: 2, witness: 1.5 }] };
    const cur: Plain = { ivs: [{ enter: 0, end: 2, witness: 0.4 }] };
    const sides = sidesOf(held, cur), p = pieces(sides);
    expect(p.map(x => [r4(x.start), r4(x.end)])).toEqual([[0, 1.0003], [1.0007, 2]]);
    expect(p.map(x => heir(sides, x))).toEqual([0, 1]);
  });

  it("R141: reaching is no refutation — a narrow old contact stays where the new run passed without a hit; free stretches that do not reach it leave it", () => {
    const held: Plain = { ivs: [{ enter: 0, end: 1 }, { enter: 1.4, end: 1.6, witness: 1.5 }, { enter: 2, end: 3 }] };
    const cur: Plain = { ivs: [{ enter: 0, end: 1, freeAt: 1.125, freeR: 0.12 }, { enter: 2, end: 3 }] };
    const sides = sidesOf(held, cur), p = pieces(sides);
    expect(spans(p)).toEqual([[0, 1], [1.4, 1.6], [2, 3]]);
    expect(heir(sides, p[1]!)).toBe(1);
  });

  it("Codex R150 VP150-01: a confirmed point just inside a free stretch keeps the point and the free sample — the separation stays", () => {
    // the coarse new contact [0, 2]; the old one exits (decided) at 1.0001, 0.0001 inside its own free stretch (1, 1.001)
    const held: Plain = { ivs: [{ enter: 0, end: 1.0001, witness: 0.5, freeAt: 1.0005, freeR: 0.0005 }] };
    const cur: Plain = { ivs: [{ enter: 0, end: 2, witness: 1.5, ed: false, xd: false }] };
    const sides = sidesOf(held, cur), p = pieces(sides);
    expect(p.map(x => [r4(x.start), r4(x.end)]), "the radius cut back to the confirmed exit: (1.0001, 1.0009) free").toEqual([[0, 1.0001], [1.0009, 2]]);
    expect([p[0]!.endOpen, p[1]!.startOpen], "the confirmed exit is contact, the free stretch open").toEqual([false, false]);
    const wide: number[] = [];
    eachWideConflict(sides, x => wide.push(x));
    expect(wide, "within the tolerance: the plan's numerical conflict, not named").toEqual([]);
  });

  it("a confirmed touch deep inside a free stretch: the radius ends there, the contradiction is named; on the sample, no free stretch is left", () => {
    // the new run proves (1.3, 1.7) free around 1.5; the old one confirmed a touch at 1.4
    const held: Plain = { ivs: [{ enter: 1, end: 2, witness: 1.4, ed: false, xd: false }] };
    const cur: Plain = { ivs: [{ enter: 0, end: 0.5, freeAt: 1.5, freeR: 0.2 }] };
    const sides = sidesOf(held, cur), p = pieces(sides);
    expect(p.map(x => [r4(x.start), r4(x.end), x.startKind])).toEqual([[0, 0.5, START_ENTER], [1, 1.4, START_ENTER], [1.6, 2, START_FREE]]);
    expect(heir(sides, p[1]!), "the old event keeps its identity at its witness").toBe(0);
    const wide: number[] = [];
    eachWideConflict(sides, x => wide.push(x));
    expect(wide, "0.1 deep: named").toEqual([1.4]);
    // the touch ON the free sample: the stretch claims nothing
    const onSample = pieces(sidesOf({ ivs: [{ enter: 1, end: 2, witness: 1.5, ed: false, xd: false }] }, cur));
    expect(spans(onSample)).toEqual([[0, 0.5], [1, 2]]);
  });

  it("a point free sample (r = 0) splits at the point", () => {
    const p = pieces(sidesOf({ ivs: [{ enter: 0, end: 2, witness: 0.5 }] }, { ivs: [{ enter: 5, end: 6, freeAt: 1, freeR: 0 }] }));
    expect(spans(p)).toEqual([[0, 1], [1, 2], [5, 6]]);
    expect([p[0]!.endOpen, p[1]!.startOpen, p[1]!.startKind]).toEqual([true, true, START_FREE]);
  });

  it("Codex R151 VP-I114: a confirmed point deeper than the tolerance from both edges is named as soon as the radius exceeds it — below, at and above the threshold, on the free sample and beside it", () => {
    const named = (r: number, w: number) => {
      // the new run proves (1.5 − r, 1.5 + r) free; the old one confirmed a touch at w
      const sides = sidesOf({ ivs: [{ enter: 1, end: 2, witness: w, ed: false, xd: false }] }, { ivs: [{ enter: 0, end: 0.5, freeAt: 1.5, freeR: r }] });
      const wide: number[] = [], walked: number[] = [];
      eachWideConflict(sides, x => wide.push(x));
      eachPiece(sides, NO_SEPARATORS, () => {}, x => walked.push(x));
      expect(walked, "the walk names what eachWideConflict names").toEqual(wide);
      return wide.length;
    };
    expect(named(0.0009, 1.5), "below: no point can lie deeper than the radius").toBe(0);
    expect(named(PROTECT, 1.5), "at: the sample lies exactly the tolerance from both edges — not deeper").toBe(0);
    expect(named(0.0011, 1.5), "just above, on the sample").toBe(1);
    expect(named(0.0015, 1.5), "Codex's probe: 0.0015 on the sample").toBe(1);
    expect(named(0.0015, 1.5002), "beside the sample: 0.0013 from the nearer edge").toBe(1);
    expect(named(0.0015, 1.4996), "beside the sample: 0.0011 from the nearer edge").toBe(1);
    expect(named(0.0015, 1.4994), "0.0009 from the nearer edge: the plan's numerical conflict").toBe(0);
    expect(named(0.0015, 1.5008), "0.0007 from the right edge: the numerical conflict too").toBe(0);
  });

  it("Codex R151 VP-I113: a tool gap separates the events — two old contacts at a point gap stay two after an empty rerun, each its identity, both zones", () => {
    // before the unknown tool [0, 1] (ended at the gap, no exit claimed), after it [1, 2]
    const held: Plain = { ivs: [{ enter: 0, end: 1, witness: 0.5, xd: false }, { enter: 1, end: 2, witness: 1.5, after: true }], gaps: [[1, 1]] };
    const cur: Plain = { ivs: [] };
    const sides = sidesOf(held, cur), seps = sepsOf(held, cur), p = pieces(sides, seps);
    expect(p.map(x => [x.zone, x.start, x.end, x.startKind]), "two pieces, one per zone, each from its enter").toEqual([[0, 0, 1, START_ENTER], [1, 1, 2, START_ENTER]]);
    expect(p.map(x => heir(sides, x, seps)), "each the earlier event whose witness it holds").toEqual([0, 1]);
    // a wide gap: the same
    const wide: Plain = { ivs: [{ enter: 0, end: 1, witness: 0.5, xd: false }, { enter: 3, end: 4, witness: 3.5, after: true }], gaps: [[1, 3]] };
    expect(pieces(sidesOf(wide, cur), sepsOf(wide, cur)).map(x => [x.zone, x.start, x.end])).toEqual([[0, 0, 1], [1, 3, 4]]);
    // the current run's gap separates the earlier run's contacts too: one coarse contact over both
    const coarse: Plain = { ivs: [{ enter: 0, end: 2, witness: 0.25 }] };
    const both = pieces(sidesOf(coarse, { ivs: [], gaps: [[1, 1]] }), sepArray([1, 1]));
    expect(both.map(x => [x.zone, x.start, x.end, x.startKind]), "an interval reaching over a separator: its part after begins at the zone's start")
      .toEqual([[0, 0, 1, START_ENTER], [1, 1, 2, START_SEP]]);
  });

  /** Every piece's evidence names its zone and start, and asked again from it gives the piece. */
  const reasked = (sides: UnionSide[], seps: UnionSeps) => pieces(sides, seps).every(p => {
    const z = evidenceZone(sides, seps, p.startSide, p.startKind, p.startIdx), pos = evidencePos(sides, seps, p.startSide, p.startKind, p.startIdx);
    const q = pieceFrom(sides, seps, z, pos, true);
    return z === p.zone && pos === p.start && !!q && q.start === p.start && q.end === p.end && q.zone === p.zone;
  });

  it("a point interval on a point separator belongs after it when it began after the unknown tool, else before it — first of its side too", () => {
    const sides = (after: boolean) => sidesOf({ ivs: [{ enter: 1, end: 1, witness: 1, after }] }, { ivs: [] });
    const at = (after: boolean) => pieces(sides(after), sepArray([1, 1])).map(x => [x.zone, x.start, x.end]);
    expect(at(true)).toEqual([[1, 1, 1]]);
    expect(at(false)).toEqual([[0, 1, 1]]);
    expect([reasked(sides(true), sepArray([1, 1])), reasked(sides(false), sepArray([1, 1]))], "asked again from the start").toEqual([true, true]);
  });

  it("a point contact in a zone between separators, then a restart at a later point: the later contact one zone further (the side's order across both)", () => {
    // unknown [0.25, 0.5]; a point touch at 1 (known stretch, zone 1); unknown again at 2 for an instant; a point touch at 2 after it
    const held: Plain = { ivs: [{ enter: 0, end: 0.2, witness: 0.1, xd: false }, { enter: 1, end: 1, witness: 1, after: true, freeAt: 1.5, freeR: 0 },
                                { enter: 2, end: 2, witness: 2, after: true }], gaps: [[0.25, 0.5], [2, 2]] };
    const sides = sidesOf(held, { ivs: [] }), seps = sepsOf(held, { ivs: [] });
    expect(pieces(sides, seps).map(x => [x.zone, x.start, x.end]), "1 in the zone after [0.25, 0.5]; 2 after the point restart at 2")
      .toEqual([[0, 0, 0.2], [1, 1, 1], [2, 2, 2]]);
    expect(reasked(sides, seps), "asked again from the start: the zone of 2 from the touch at 1").toBe(true);
  });

  it("aligns separators: never two gaps of one generation; across generations the same gap — equal or overlapping — is one (Codex R152 VP-I113)", () => {
    // one generation: two restarts at one point and two touching gaps stay apart
    expect([...mergeSeps([[2, 2, 2, 2, 1, 2, 2, 3]]).seps]).toEqual([1, 2, 2, 2, 2, 2, 2, 3]);
    // the same sequence in both: one each, aligned in order
    const m = mergeSeps([[1, 2, 2, 2, 2, 3], [1, 2, 2, 2, 2, 3]]);
    expect([...m.seps]).toEqual([1, 2, 2, 2, 2, 3]);
    expect([[...m.first], [...m.last]], "the gaps each starts and ends with: the first generation's").toEqual([[0, 1, 2], [0, 1, 2]]);
    // the earlier generation cut at its coverage: overlapping, one separator to the later one's end
    expect([...mergeSeps([[1, 1.5], [1, 3]]).seps]).toEqual([1, 3]);
    // tables that disagree: a gap overlapping two of the other's joins them; a point strictly inside one joins it
    expect([...mergeSeps([[1, 2, 2.5, 3], [1.5, 2.75]]).seps]).toEqual([1, 3]);
    expect([...mergeSeps([[1, 3], [2, 2]]).seps]).toEqual([1, 3]);
    // touching across generations stays apart
    expect([...mergeSeps([[1, 2], [2, 3]]).seps]).toEqual([1, 2, 2, 3]);
  });

  it("several restarts at one point (a collapsed time axis): each known instant's contact its own zone, by the generation's order", () => {
    // unknown [0.5, 1], known at 1 (touch a), unknown [1, 1], known at 1 (touch b), unknown [1, 2], then [3, 4]
    const held: Plain = { ivs: [{ enter: 0, end: 0.5, witness: 0.25, xd: false }, { enter: 1, end: 1, witness: 1, after: true, xd: false },
                                { enter: 1, end: 1, witness: 1, after: true, xd: false }, { enter: 3, end: 4, witness: 3.5, after: true }],
                          gaps: [[0.5, 1], [1, 1], [1, 2]] };
    const sides = sidesOf(held, { ivs: [] }), seps = sepsOf(held, { ivs: [] }), p = pieces(sides, seps);
    expect(p.map(x => [x.zone, x.start, x.end]), "a in the zone after the first restart, b after the second").toEqual([[0, 0, 0.5], [1, 1, 1], [2, 1, 1], [3, 3, 4]]);
    expect(p.map(x => heir(sides, x, seps))).toEqual([0, 1, 2, 3]);
  });

  it("Codex R152 VP-I113: a known phase between two touching tool gaps keeps its contact — three events after an empty rerun", () => {
    // [0, 1] ended where the tool became unknown at 1; known at 2 only, a touch there, unknown again; [3, 4] after it
    const held: Plain = { ivs: [{ enter: 0, end: 1, witness: 0.5, xd: false }, { enter: 2, end: 2, witness: 2, after: true, xd: false },
                                { enter: 3, end: 4, witness: 3.5, after: true }], gaps: [[1, 2], [2, 3]] };
    const cur: Plain = { ivs: [] };
    const sides = sidesOf(held, cur), seps = sepsOf(held, cur), p = pieces(sides, seps);
    expect(p.map(x => [x.zone, x.start, x.end]), "the point between the gaps is a zone of its own").toEqual([[0, 0, 1], [1, 2, 2], [2, 3, 4]]);
    expect(p.map(x => heir(sides, x, seps)), "each the earlier event").toEqual([0, 1, 2]);
    // the rerun's identical gaps change nothing
    const again = pieces(sidesOf(held, { ivs: [], gaps: [[1, 2], [2, 3]] }), sepsOf(held, { ivs: [], gaps: [[1, 2], [2, 3]] }));
    expect(again.map(x => [x.zone, x.start, x.end])).toEqual([[0, 0, 1], [1, 2, 2], [2, 3, 4]]);
  });

  it("matches the brute force over random generations with tool gaps — piece by piece and zone by zone, its start's evidence, every later question from that start alone, the contradictions", { timeout: 120_000 }, () => {
    let total = 0, cases = 0;
    const kinds = [0, 0, 0];
    const scratch = unionScratch();
    for (const seed0 of [12345, 777, 31337, 4242, 99, 2026, 151]) {
      let seed = seed0;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const grid = (x: number) => Math.round(x * 8) / 8 + (rnd() < 0.1 ? (rnd() < 0.5 ? PROTECT : -PROTECT) * rnd() : 0);
      const gen = (): Plain => {
        const ivs: Iv[] = [], gaps: Array<[number, number]> = [];
        let x = grid(rnd() * 2);
        const n = Math.floor(rnd() * 6);
        for (let i = 0; i < n; i++) {
          let after = rnd() < 0.05;
          // a tool gap where the last contact ended: ended at the gap (no exit
          // claimed, no free sample), the next begins after it — at its end or later
          const last = ivs[ivs.length - 1];
          if (rnd() < 0.25 && (last || rnd() < 0.3)) {
            // the tool becomes unknown where the last contact ended (it ended at the gap), or later — after its free
            // sample, or before any contact
            let s0: number;
            if (last && rnd() < 0.5) { s0 = last.end; last.xd = false; delete last.freeAt; delete last.freeR; }
            else if (last) {
              const after0 = last.freeAt !== undefined ? last.freeAt + Math.max(0, last.freeR ?? 0) : last.end;
              s0 = Math.max(after0, x - 0.0625);
              if (s0 < last.end || s0 > x) { s0 = last.end; last.xd = false; delete last.freeAt; delete last.freeR; }
            } else s0 = x - 0.5;
            const e0 = rnd() < 0.4 ? s0 : s0 + Math.max(0.125, grid(rnd()));
            gaps.push([s0, e0]);
            x = rnd() < 0.5 ? e0 : e0 + Math.max(0.125, grid(rnd()));
            after = true;
            if (x === e0 && rnd() < 0.5) {
              // known for an instant only, once or several times at one point: a touch in some of the instants,
              // the tool unknown again from there (gaps that touch, point gaps at one coordinate)
              for (let r = 1 + Math.floor(rnd() * 3); r > 0; r--) {
                if (rnd() < 0.7) ivs.push({ enter: e0, end: e0, witness: e0, ed: rnd() < 0.5, xd: false, after: true });
                const e1 = r > 1 && rnd() < 0.6 ? e0 : e0 + Math.max(0.125, grid(rnd()));
                gaps.push([e0, e1]);
                if (e1 !== e0) { x = rnd() < 0.5 ? e1 : e1 + Math.max(0.125, grid(rnd())); break; }
              }
            }
          }
          const len = rnd() < 0.15 ? 0 : Math.max(0, grid(rnd() * 2));
          const enter = x, end = x + len;
          const iv: Iv = { enter, end, witness: enter + (end - enter) * (rnd() < 0.3 ? 0 : rnd() < 0.3 ? 1 : rnd()), ed: rnd() < 0.7, xd: rnd() < 0.7, after };
          x = end + grid(0.125 + rnd() * 2);
          if (rnd() < 0.6) {
            // a free sample after its exit; sometimes reaching past the next enter or before its own
            iv.freeAt = end + (x - end) * rnd();
            iv.freeR = rnd() < 0.2 ? 0 : rnd() < 0.15 ? 2 * rnd() : Math.min(iv.freeAt - end, x - iv.freeAt) * rnd();
          }
          ivs.push(iv);
        }
        if (ivs.length && rnd() < 0.3) ivs[ivs.length - 1]!.open = true;
        // a gap the other generation does not share, anywhere (an interval reaches over it)
        if (rnd() < 0.2) { const s0 = grid(rnd() * 8); gaps.push([s0, rnd() < 0.3 ? s0 : s0 + Math.max(0.125, grid(rnd()))]); }
        return { ivs, gaps };
      };
      for (let c = 0; c < 3000; c++) {
        const held = gen(), cur = gen();
        const sides = sidesOf(held, cur), seps = sepsOf(held, cur);
        const tag = `seed ${seed0} case ${c}: ${JSON.stringify({ held, cur })}`;
        const want = oracle(held, cur);
        const got = pieces(sides, seps);
        expect(got.map(p => ({ z: p.zone, a: p.start, ao: p.startOpen, b: p.end, bo: p.endOpen })), tag).toEqual(want);
        // a scratch shared group after group gives the same walk
        const again: UnionPiece[] = [];
        eachPiece(sides, seps, p => again.push({ ...p }), undefined, scratch);
        expect(again, `${tag}: the shared scratch`).toEqual(got);
        // the contradictions the walk names are eachWideConflict's
        const wide: number[] = [], walked: number[] = [];
        eachWideConflict(sides, x => wide.push(x));
        eachPiece(sides, seps, () => {}, x => walked.push(x));
        expect(walked.sort((a, b) => a - b), `${tag}: the contradictions`).toEqual(wide.sort((a, b) => a - b));
        for (const p of got) {
          expect(p.startKind, `${tag}: a start the build names`).toBeGreaterThanOrEqual(0);
          kinds[p.startKind]!++;
          expect(evidenceZone(sides, seps, p.startSide, p.startKind, p.startIdx), `${tag}: the evidence names the zone`).toBe(p.zone);
          const pos = evidencePos(sides, seps, p.startSide, p.startKind, p.startIdx);
          expect(pos, `${tag}: the evidence names the start`).toBe(p.start);
          const q = pieceFrom(sides, seps, p.zone, pos, true)!;
          expect([q.zone, q.start, q.startOpen, q.end, q.endOpen, q.from0, q.to0, q.from1, q.to1], `${tag}: asked again from its start ${JSON.stringify(p)}`)
            .toEqual([p.zone, p.start, p.startOpen, p.end, p.endOpen, p.from0, p.to0, p.from1, p.to1]);
          // what it holds: every interval whose zone part meets it, by brute force
          const holds: string[] = [];
          let leads = 0;
          pieceIntervals(sides, seps, p, (si, k, holdsStart) => { holds.push(`${si}:${k}`); if (holdsStart) leads++; });
          expect(leads, `${tag}: some interval holds the piece's start`).toBeGreaterThan(0);
          const brute: string[] = [];
          const span: Sp = { a: p.start, ao: p.startOpen, b: p.end, bo: p.endOpen };
          [held, cur].forEach((g, si) => g.ivs.forEach((iv, k) => {
            const x = zonePart(iv, sepsFlat(held, cur), p.zone, pointZones(g, sepsFlat(held, cur)).get(k));
            if (x && meets(x, span)) brute.push(`${si}:${k}`);
          }));
          expect(holds, `${tag}: what the piece holds ${JSON.stringify(p)}`).toEqual(brute);
        }
        total += got.length;
        if (got.length) cases++;
      }
    }
    console.log(`[B4 union] ${cases} cases with pieces, ${total} pieces; starts by kind (enter, free, separator): ${kinds.join(" ")}`);
    expect(kinds.every(k => k > 0), "an enter, a free stretch and a separator start pieces").toBe(true);
  });
});

function meets(x: Sp, y: Sp): boolean {
  return !(x.b < y.a || y.b < x.a || (x.b === y.a && (x.bo || y.ao)) || (y.b === x.a && (y.bo || x.ao)));
}
