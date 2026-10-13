// Round B4: the fallback's union (plan 3.5) — Codex's sequences R140–R142 and
// the fast search against a brute force over plain sets of spans.
import { describe, expect, it } from "vitest";
import {
  eachPiece, eachWideConflict, evidencePos, pieceFrom, pieceIntervals, PROTECT, START_ENTER, START_FREE, unionReach, type UnionPiece,
  type UnionSide,
} from "./contactUnion";

interface Iv { enter: number; end: number; open?: boolean; witness?: number; ed?: boolean; xd?: boolean; freeAt?: number; freeR?: number }
interface Plain { ivs: Iv[] }

function side(p: Plain): UnionSide {
  const ivs = p.ivs;
  // the bounds over the whole "source" (here: this generation's one group)
  const r = unionReach(ivs.length, k => ivs[k]!.enter, k => ivs[k]!.freeAt ?? NaN, k => ivs[k]!.freeR ?? NaN, () => true);
  return {
    n: ivs.length,
    enter: k => ivs[k]!.enter, end: k => ivs[k]!.end, open: k => !!ivs[k]!.open,
    witness: k => ivs[k]!.witness ?? (ivs[k]!.enter + ivs[k]!.end) / 2,
    enterDecided: k => ivs[k]!.ed ?? true, exitDecided: k => ivs[k]!.xd ?? true,
    freeAt: k => ivs[k]!.freeAt ?? NaN, freeR: k => ivs[k]!.freeR ?? NaN,
    back: r.back, front: r.front,
  };
}
const sidesOf = (held: Plain, cur: Plain) => [side(held), side(cur)];

const pieces = (sides: UnionSide[]) => { const out: UnionPiece[] = []; eachPiece(sides, p => out.push(p)); return out; };
const spans = (ps: UnionPiece[]) => ps.map(p => [p.start, p.end]);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** The held interval whose witness the piece holds (the earliest), else −1. */
function heir(sides: UnionSide[], p: UnionPiece): number {
  let h = -1, w = Infinity;
  pieceIntervals(sides, p, (si, k) => {
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
function oracle(held: Plain, cur: Plain): Sp[] {
  const gens = [held, cur];
  const parts: Sp[] = [];
  for (const g of gens) for (const iv of g.ivs) parts.push({ a: iv.enter, ao: false, b: iv.end, bo: false });
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
  let s = union(parts);
  for (const f of union(frags)) s = minus(s, f);
  return union(s);
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

  it("a point free sample (r = 0) splits at the point; a gap is none of this module's business", () => {
    const p = pieces(sidesOf({ ivs: [{ enter: 0, end: 2, witness: 0.5 }] }, { ivs: [{ enter: 5, end: 6, freeAt: 1, freeR: 0 }] }));
    expect(spans(p)).toEqual([[0, 1], [1, 2], [5, 6]]);
    expect([p[0]!.endOpen, p[1]!.startOpen, p[1]!.startKind]).toEqual([true, true, START_FREE]);
  });

  it("matches the brute force over random generations — piece by piece, its start's evidence, and every later question from that start alone", () => {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const grid = (x: number) => Math.round(x * 8) / 8 + (rnd() < 0.1 ? (rnd() < 0.5 ? PROTECT : -PROTECT) * rnd() : 0);
    const gen = (): Plain => {
      const ivs: Iv[] = [];
      let x = grid(rnd() * 2);
      const n = Math.floor(rnd() * 6);
      for (let i = 0; i < n; i++) {
        const len = rnd() < 0.15 ? 0 : Math.max(0, grid(rnd() * 2));
        const enter = x, end = x + len;
        const iv: Iv = { enter, end, witness: enter + (end - enter) * (rnd() < 0.3 ? 0 : rnd() < 0.3 ? 1 : rnd()), ed: rnd() < 0.7, xd: rnd() < 0.7 };
        x = end + grid(0.125 + rnd() * 2);
        if (rnd() < 0.6) {
          // a free sample after its exit; sometimes reaching past the next enter or before its own
          iv.freeAt = end + (x - end) * rnd();
          iv.freeR = rnd() < 0.2 ? 0 : rnd() < 0.15 ? 2 * rnd() : Math.min(iv.freeAt - end, x - iv.freeAt) * rnd();
        }
        ivs.push(iv);
      }
      if (ivs.length && rnd() < 0.3) ivs[ivs.length - 1]!.open = true;
      return { ivs };
    };
    let cases = 0, total = 0;
    const kinds = [0, 0];
    for (let c = 0; c < 4000; c++) {
      const held = gen(), cur = gen();
      const sides = sidesOf(held, cur);
      const want = oracle(held, cur);
      const got = pieces(sides);
      expect(got.map(p => ({ a: p.start, ao: p.startOpen, b: p.end, bo: p.endOpen })), `case ${c}: ${JSON.stringify({ held, cur })}`).toEqual(want);
      for (const p of got) {
        expect(p.startKind, `case ${c}: a start the build names`).toBeGreaterThanOrEqual(0);
        kinds[p.startKind]!++;
        const pos = evidencePos(sides, p.startSide, p.startKind, p.startIdx);
        expect(pos, `case ${c}: the evidence names the start`).toBe(p.start);
        const again = pieceFrom(sides, pos, true)!;
        expect([again.start, again.startOpen, again.end, again.endOpen], `case ${c}: asked again from its start`).toEqual([p.start, p.startOpen, p.end, p.endOpen]);
        // what it holds: every interval whose own contact meets it, by brute force
        const holds: string[] = [];
        let leads = 0;
        pieceIntervals(sides, p, (si, k, holdsStart) => { holds.push(`${si}:${k}`); if (holdsStart) leads++; });
        expect(leads, `case ${c}: some interval holds the piece's start`).toBeGreaterThan(0);
        const brute: string[] = [];
        const span: Sp = { a: p.start, ao: p.startOpen, b: p.end, bo: p.endOpen };
        [held, cur].forEach((g, si) => g.ivs.forEach((iv, k) => {
          if (meets({ a: iv.enter, ao: false, b: iv.end, bo: false }, span)) brute.push(`${si}:${k}`);
        }));
        expect(holds, `case ${c}: what the piece holds ${JSON.stringify({ held, cur, p })}`).toEqual(brute);
      }
      total += got.length;
      if (got.length) cases++;
    }
    console.log(`[B4 union] ${cases} cases with pieces, ${total} pieces; starts by kind (enter, free): ${kinds.join(" ")}`);
    expect([kinds[START_ENTER]!, kinds[START_FREE]!].every(k => k > 0), "an enter and a free stretch start pieces").toBe(true);
  });
});

function meets(x: Sp, y: Sp): boolean {
  return !(x.b < y.a || y.b < x.a || (x.b === y.a && (x.bo || y.ao)) || (y.b === x.a && (y.bo || x.ao)));
}
