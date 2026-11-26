// The stock rule (stock-mute plan v2 + v3; Codex R484 / R488 / R490): the
// cutting state of a tool × stock pair through the REAL sweep and the contact
// view — the contract's cases, the own hole, open bodies and UNRESOLVED, the
// discontinuities, the range; the own hole's own checkpoint (counted asks, the
// model posed again after a yield) and the results' equality across yield
// patterns and shards, compared column by column.
import { describe, expect, it } from "vitest";
import { HOLE_ASKS_PER_YIELD, sweepCollisions, sweepCollisionsIter, type CollisionOptions, type HoleWork } from "./collision";
import { ContactStore, NONE } from "./contactStore";
import { assignPairs } from "./pairAssign";
import { runSweepSlice } from "./sweepPump";
import { BLOCK, MACHINE, MARGIN, Prog, WCS, box, digest, findings, modelOf, start, type Scene } from "./stockMuteHarness";
import { buildCollisionModel } from "./collision";
import { boxPositions } from "./collisionFixtures";
import type { ScrubTrack } from "../ws/bulkData";

const TOOLS = { tloEvents: [{ seq: 0, xyz: [0, 0, 0], tool: 1 }, { seq: 1, xyz: [0, 0, 0], tool: 2 }, { seq: 2, xyz: [0, 0, 4], tool: 1 }, { seq: 3, xyz: [0, 0, 0], tool: 9 }],
                toolDims: { 1: { diam: 6, len: 60 }, 2: { diam: 12, len: 60 } }, liveTool: 1 } as unknown as Partial<CollisionOptions>;
const rg = (from: number): Scene => ({ opts: { range: { from } } });
const g83 = (R: number, pecks: number, q = 3) => {
  const p = start().g0({ z: R });
  let z = 0;
  for (let k = 0; k < pecks; k++) { if (k) p.g0({ z: z + 0.5 }); z -= q; p.g1({ z }); p.g0({ z: R }); }
  return p.g0({ z: 15 });
};
const hw = (): HoleWork => ({ questions: 0, asks: 0, steps: 0, checks: [0, 0, 0, 0], sites: [0, 0, 0, 0], maxBetweenYields: 0 });
// pecks 0.05 deep, each re-entry by rapid 0.05 below the fed depth: the touch
// begins on the rapid and is first seen on the feed after it (a re-sample)
const fine = () => { const p = start().g0({ z: 1 }); let z = 0; for (let k = 0; k < 10; k++) { z -= 0.05; p.g1({ z }); p.g0({ z: 0.2 }); p.g0({ z: z - 0.05 }); z -= 0.05; } return p.g0({ z: 15 }); };
const list = (p: Prog | ScrubTrack, o: Scene = {}) => findings(p instanceof Prog ? p.track() : p, o).list;

describe("the contract (plan v2 §1.2, §2's guard cases)", { timeout: 120_000 }, () => {
  it.each([
    // a feed contact and a plain retract: machining
    ["continuous feed contact, rapid retract", start().g0({ z: 5 }).g1({ z: -5 }).g1({ x: 80 }).g0({ z: 15 }), []],
    ["fed out 3 free, fed back in, rapid retract", start().g0({ z: 5 }).g1({ z: -5 }).g1({ x: 116 }).g1({ x: 90 }).g0({ z: 15 }), []],
    // a proven separation, however small, and a rapid back in (fault b, c)
    ...[0.05, 0.2, 0.3, 1, 1.9].map(e => [`fed out ${e} free of the side, rapid back in`, start().g0({ z: 5 }).g1({ z: -5 }).g1({ x: 113 + e }).g0({ x: 90 }).g0({ z: 15 }),
                                          ["collision rapid L5"]] as const),
    // the slot 8 deep fed out 5 and 6.2 past the face (2 × margin never proved it)
    ...[5, 6.2].map(e => [`slot fed out ${e} past the face, rapid back in it`, new Prog().g0({ x: 60, y: 30, z: 15 }).g0({ z: 5 }).g1({ z: -8 }).g1({ x: 113 + e }).g0({ x: 90 }).g0({ z: 15 }),
                          ["collision rapid L5"]] as const),
    // a feed near the stock that never touched mutes nothing (fault a)
    ...[0.05, 0.5, 1.5].map(e => [`feed ${e} over the top, no touch, rapid down`, start().g0({ z: 5 }).g1({ z: e }).g0({ z: -3 }).g0({ z: 15 }), ["collision rapid L4"]] as const),
    // fault e: a second gouge after a proven separation is a finding of its own
    ["rapid gouge, feed on, out 1 free, gouge again beside", start().g0({ z: 5 }).g0({ z: -3 }).g1({ x: 114 }).g0({ y: 34 }).g0({ x: 100 }).g0({ z: 15 }),
     ["collision rapid L3", "collision rapid L6"]],
    // fault d: G81 at R 1 is a near miss of the rapid, nothing on the feed's line
    ["G81 at R 1, two holes", start().g0({ z: 1 }).g1({ z: -5 }).g0({ z: 1 }).g0({ x: 70 }).g1({ z: -5 }).g0({ z: 1 }).g0({ z: 15 }), ["near rapid L3"]],
    // the begin's kind is the move its entry lies on
    ["feed 0.118 over to 0.108 deep, rapid up", start().g0({ z: 5 }).g1({ z: 0.118 }).g1({ z: -0.108 }).g0({ z: 15 }), []],
    ["rapid to 0.118 over, rapid 0.108 deep, feed on, rapid up", start().g0({ z: 5 }).g0({ z: 0.118 }).g0({ z: -0.108 }).g1({ z: -3 }).g0({ z: 15 }), ["collision rapid L4"]],
    // a flicker below CUT_SEP is no separation
    ["fed 3 deep, rapid up to 0.0005 over the top, rapid across and down", start().g0({ z: 5 }).g1({ z: -3 }).g0({ z: 0.0005 }).g0({ x: 60, z: -3 }).g0({ z: 15 }), []],
    ...[0.0005, 0.0009].map(f => [`fed 3 deep, rapid up to ${f} over the top, across at it and down`, start().g0({ z: 5 }).g1({ z: -3 }).g0({ z: f }).g0({ x: 60 }).g0({ z: -3 }).g0({ z: 15 }), []] as const),
    ["  … 0.002 over the top: a separation", start().g0({ z: 5 }).g1({ z: -3 }).g0({ z: 0.002 }).g0({ x: 60 }).g0({ z: -3 }).g0({ z: 15 }), ["collision rapid L6"]],
    // R88: a contact begun by a rapid's near approach is re-sampled across a rapid too
    ["fed 0.05 in from R 1, rapid 0.05 below the fed depth, feed on", start().g0({ z: 1 }).g1({ z: -0.05 }).g0({ z: 0.2 }).g0({ z: -0.1 }).g1({ z: -0.5 }).g0({ z: 15 }),
     ["near rapid L3", "collision rapid L5"]],
    // the program's first pose in the stock (Q7)
    ["the program starts in the stock, a rapid first", new Prog().g0({ x: 50, y: 30, z: -5 }).g0({ z: 15 }), ["collision rapid L2"]],
    ["the program starts in the stock, a feed first", new Prog().g0({ x: 50, y: 30, z: -5 }).g1({ x: 60 }).g0({ z: 15 }), []],
  ] as const)("%s", (_n, p, want) => { expect(list(p)).toEqual(want); });
  it("pecks re-entered 0.05 below the fed depth: every re-entry a finding, its touch first seen on the feed after it", () => {
    expect(list(fine())).toEqual(["near rapid L3", ...[5, 8, 11, 14, 17, 20, 23, 26, 29, 32].map(l => `collision rapid L${l}`)]);
  });
});

describe("the own hole (plan v2 §3.4; operator Q484-1: the hole along the axis quiet, the slot sideways reported)", { timeout: 120_000 }, () => {
  it("a G83 re-entry above the fed depth is quiet, below it a finding", () => {
    for (const [b, want] of [[0, []], [0.4, []], [0.6, ["collision rapid L5"]], [3, ["collision rapid L5"]]] as const)
      expect(list(start().g0({ z: 3 }).g1({ z: -3 }).g0({ z: 3 }).g0({ z: -2.5 - b }).g1({ z: -8 }).g0({ z: 15 })), `${b} below`).toEqual(want);
  });
  it("on bit-identical poses only: any lateral offset is a finding", () => {
    for (const [dx, want] of [[0, []], [5e-5, ["collision rapid L6"]], [1.5e-3, ["collision rapid L6"]], [2.1e-3, ["collision rapid L6"]], [0.02, ["collision rapid L6"]]] as const)
      expect(list(start().g0({ z: 3 }).g1({ z: -6 }).g0({ z: 3 }).g0({ x: 50 + dx }).g0({ z: -5 }).g1({ z: -8 }).g0({ z: 15 })), `${dx}`).toEqual(want);
  });
  it.each([
    ["a whole G83, R 3 Q 3, 8 pecks", g83(3, 8), []],
    ["re-entry after another hole", start().g0({ z: 3 }).g1({ z: -3 }).g0({ z: 3 }).g0({ x: 70 }).g1({ z: -3 }).g0({ z: 3 }).g0({ x: 50 }).g0({ z: -2.5 }).g1({ z: -8 }).g0({ z: 15 }),
     ["collision rapid L9"]],
    ["down the hole by rapid, then sideways at depth", start().g0({ z: 3 }).g1({ z: -6 }).g0({ z: 3 }).g0({ z: -5 }).g0({ x: 70 }).g0({ z: 15 }), ["collision rapid L5"]],
    ["down the hole by rapid and up again", start().g0({ z: 3 }).g1({ z: -6 }).g0({ z: 3 }).g0({ z: -5 }).g0({ z: 3 }).g0({ x: 70 }).g0({ z: 15 }), []],
    ["a rapid back along a fed slot at depth (a slot, not a hole)", start().g0({ z: 3 }).g1({ z: -3 }).g1({ x: 80 }).g0({ z: 3 }).g0({ x: 60 }).g0({ z: -3 }).g0({ z: 15 }),
     ["collision rapid L7"]],
    // the fed path excuses this one (fed along X, back in and out on the line): the tool's axis refuses
    ...[5, 8].map(e => [`a slot fed ${e} past the face, a rapid back in along it and out: the tool's axis refuses`,
                        new Prog().g0({ x: 60, y: 30, z: 15 }).g0({ z: 5 }).g1({ z: -8 }).g1({ x: 113 + e }).g0({ x: 90 }).g0({ x: 113 + e }).g0({ z: 15 }), ["collision rapid L5"]] as const),
  ] as const)("%s", (_n, p, want) => { expect(list(p)).toEqual(want); });
  it("the fed union must reach the entry's FREE side: a feed from above it, not from the top or below", () => {
    // (the descent to z0 is a near miss or a touch of its own; the re-entry is line 6)
    for (const [z0, want] of [[0.5, ["near rapid L4"]], [0.0005, ["near rapid L4", "collision rapid L6"]], [0, ["collision rapid L4", "collision rapid L6"]],
                              [-0.0005, ["collision rapid L3", "collision rapid L6"]]] as const)
      expect(list(start().g0({ z: 3 }).g0({ z: z0 }).g1({ z: -6 }).g0({ z: 3 }).g0({ z: -5 }).g1({ z: -8 }).g0({ z: 15 })), `fed from ${z0}`).toEqual(want);
  });
  it("the first peck of a range reads the feed before it (the complete modelled execution)", () => {
    expect(list(start().g0({ z: 3 }).g1({ z: -3 }).g0({ z: 3 }).g0({ z: -2.5 }).g1({ z: -6 }).g0({ z: 15 }), rg(3))).toEqual([]);
  });
});

describe("discontinuities, the range, the braking range", { timeout: 120_000 }, () => {
  const tc = (rapid: boolean, tlo: number) => { const p = start(); p.g0({ z: 5 }).g1({ z: -5 }); p.tlo = tlo; p.move(rapid, { z: -8 }); return p.g0({ z: 15 }); };
  const jump = (unknown: boolean) => {
    const p = start().g0({ z: 5 }).g1({ z: -5 }).g0({ x: unknown ? 80 : 50 });
    Object.assign(p.pts[p.pts.length - 1]!, { brk: true, ustart: unknown });
    return p.g0({ z: -8 }).g0({ z: 15 });
  };
  const band = (f: (p: Prog) => void) => { const p = start(); f(p); return p; };
  it.each([
    // a tool or offset change ends machining: a rapid of the new tool in the stock is found ON ITS OWN LINE
    ["T1 fed in, T2 rapid down in the stock", tc(true, 1), { opts: TOOLS }, ["collision rapid L4"]],
    ["T1 fed in, T2 fed down in the stock", tc(false, 1), { opts: TOOLS }, []],
    ["T1 fed in, the offset changes, rapid down", tc(true, 2), { opts: TOOLS }, ["collision rapid L4"]],
    ["T1 fed in, T9 unknown, T1 again by rapid", (() => { const p = start(); p.g0({ z: 5 }).g1({ z: -5 }); p.tlo = 3; p.g0({ z: -6 }); p.tlo = 0; return p.g0({ z: -8 }).g0({ z: 15 }); })(),
     { opts: { ...TOOLS, unknownTools: [9] } }, ["collision rapid L5"]],
    ["T2 re-enters T1's hole by rapid", (() => { const p = start(); p.g0({ z: 3 }).g1({ z: -6 }).g0({ z: 3 }); p.tlo = 1; return p.g0({ z: -5 }).g1({ z: -7 }).g0({ z: 15 }); })(),
     { opts: TOOLS }, ["collision rapid L5"]],
    ["fed in, an UNKNOWN START in the stock, rapid down", jump(true), {}, ["collision rapid L4"]],
    ["fed in, a stationary relabel, rapid down (the same contact)", jump(false), {}, []],
    // the range: its first sample touching is machining, near is not
    ["a range from inside a feed contact: retract, rapid in beside", start().g0({ z: 5 }).g1({ z: -5 }).g1({ x: 80 }).g0({ z: 5 }).g0({ y: 40 }).g0({ z: -5 }), rg(2), ["collision rapid L7"]],
    ["a range from a rapid inside the contact", start().g0({ z: 5 }).g1({ z: -5 }).g0({ z: -2 }).g0({ z: 5 }), rg(2), []],
    ["a range from near (a feed), then rapid down", start().g0({ z: 5 }).g1({ z: 1 }).g0({ z: -5 }).g0({ z: 15 }), rg(2), ["collision rapid L4"]],
    ["a range from near (a rapid), then rapid down", start().g0({ z: 5 }).g0({ z: 1 }).g0({ z: -5 }).g0({ z: 15 }), rg(2), ["collision rapid L4"]],
    ["a range inside a G83", g83(3, 4), rg(5), []],
    // the break takes effect at the first note past it: the old tool's rapid inside its contact, re-sampled after the change, is no begin
    ...[[1, "T2"], [2, "the offset"]].map(([tlo, what]) => [`a range from inside a feed contact, a rapid inside it, ${what} rapid up out`,
      (() => { const p = start(); p.g0({ z: 5 }).g1({ z: -5 }).g0({ z: -2 }); p.tlo = tlo as number; return p.g0({ z: 15 }); })(), { opts: { ...TOOLS, range: { from: 2 } } }, ["collision rapid L5"]] as const),
    // a braking range proves nothing — no separation and no begin (Codex R126)
    ["fed in, a band out of the stock, a rapid in elsewhere", band(p => { p.g0({ z: 5 }).g1({ z: -5 }); p.band = true; p.g1({ z: 3 }); p.band = false; p.g0({ x: 60, z: -5 }).g0({ z: 15 }); }), {},
     ["collision rapid L5"]],
    ["free, a band's feed touches, a rapid touches after it", band(p => { p.g0({ z: 5 }); p.band = true; p.g1({ z: -2 }); p.band = false; p.g0({ z: -5 }).g0({ z: 15 }); }), {},
     ["collision rapid L3"]],
    ["fed in, a band out and back in, rapid down from inside", band(p => { p.g0({ z: 5 }).g1({ z: -5 }); p.band = true; p.g1({ z: 3 }); p.g1({ z: -2 }); p.band = false; p.g0({ z: -8 }).g0({ z: 15 }); }), {}, []],
    ["fed in, a band to 0.1 over the top, rapid down", band(p => { p.g0({ z: 5 }).g1({ z: -5 }); p.band = true; p.g1({ z: 0.1 }); p.band = false; p.g0({ z: -8 }).g0({ z: 15 }); }), {}, []],
    ["  … its control without the band", band(p => { p.g0({ z: 5 }).g1({ z: -5 }).g1({ z: 0.1 }).g0({ z: -8 }).g0({ z: 15 }); }), {}, ["collision rapid L5"]],
  ] as const)("%s", (_n, p, o, want) => { expect(list(p, o as Scene)).toEqual(want); });
});

describe("open bodies and UNRESOLVED (plan v2 §3.1, v3 §B; Codex R484 MT484-01, R490)", { timeout: 120_000 }, () => {
  // an L-shaped block 120 × 80, a notch above Z-20 from X60: one closed solid,
  // the same with one facet missing, two boxes that share a face
  const at = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => box(x0, x1, y0, y1, z0, z1);
  const two = Float32Array.from([...at(-10, 60, -10, 70, -30, 0), ...at(60, 110, -10, 70, -30, -20)]);
  const L2 = [[-10, -30], [110, -30], [110, -20], [60, -20], [60, 0], [-10, 0]] as const;
  const ell = (() => {
    const o: number[] = [], v = (k: number, y: number) => [L2[k]![0] + 200, y + 150, L2[k]![1] - 100];
    const tri = (a: number[], b: number[], c: number[]) => o.push(...a, ...b, ...c);
    for (let k = 0; k < 6; k++) { const n = (k + 1) % 6; tri(v(k, -10), v(n, -10), v(n, 70)); tri(v(k, -10), v(n, 70), v(k, 70)); }
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3], [0, 3, 5], [3, 4, 5]] as const) { tri(v(a, -10), v(c, -10), v(b, -10)); tri(v(a, 70), v(b, 70), v(c, 70)); }
    return Float32Array.from(o);
  })();
  const notch = (clear: number) => new Prog().g0({ x: 30, y: 30, z: 15 }).g0({ z: 5 }).g1({ z: -8 }).g1({ x: 63 + clear }).g0({ y: 40 }).g0({ x: 40 }).g0({ z: 15 });
  const closed = (s: Float32Array) => buildCollisionModel(MACHINE, [{ id: "s", group: "table", positions: s, stock: true }]).bodies[0]!.insideClosed;

  it("fed out into the notch and back beside by rapid: a finding, closed or open (the mute kept was a loss against today)", () => {
    expect([closed(ell), closed(ell.slice(9)), closed(two)]).toEqual([true, false, false]);
    for (const stock of [ell, ell.slice(9), two]) for (const clear of [1, 3, 8, 20])
      expect(list(notch(clear), { stock }), `${closed(stock)} ${clear}`).toEqual(["collision rapid L6"]);
  });

  it("the own hole is never asked from UNRESOLVED (the step function in the sweep)", () => {
    // open: the notch is inside the whole box, the surfaces apart — UNRESOLVED; the rapid's touch from there asks nothing
    for (const stock of [ell.slice(9), two]) {
      const w = hw();
      findings(notch(8).track(), { stock, opts: { holeWork: w } });
      // the questions, not the fed-path asks: the open body's free-side test
      // would answer an ask from UNRESOLVED itself (R490: a second protection)
      expect([w.questions, w.asks], `${closed(stock)}`).toEqual([0, 0]);
    }
    // closed: the same course is APART in the notch — the touch asks (and the hole refuses: another line)
    const w = hw();
    findings(notch(8).track(), { stock: ell, opts: { holeWork: w } });
    expect(w.questions).toBeGreaterThan(0);
    expect(w.asks).toBeGreaterThan(0);
  });

  it("an open body: a short tool fed wholly inside, rapid out, is a finding (as today); a closed one machines", () => {
    const open = (() => { const b = box(...BLOCK); return b.slice(0, b.length - 9); })();
    const prog = () => start().g0({ z: 5 }).g1({ z: -15 }).g0({ x: 60 }).g0({ z: 15 });
    expect(list(prog(), { stock: open, toolL: 5 })).toEqual(["collision rapid L5"]);
    expect(list(prog(), { toolL: 5 })).toEqual([]);
    // a G83 in the open block: its free side above the whole box is APART — the hole holds
    expect(list(start().g0({ z: 3 }).g1({ z: -3 }).g0({ z: 3 }).g0({ z: -2.5 }).g1({ z: -8 }).g0({ z: 15 }), { stock: open })).toEqual([]);
    // and the open G81 crossing at 1 over the top, rapid in: a finding
    expect(list(start().g0({ z: 5 }).g1({ z: -5 }).g0({ z: 1 }).g0({ x: 70, z: -3 }).g0({ z: 15 }), { stock: open })).toEqual(["collision rapid L5"]);
  });

  it("an open body's free side inside the whole box: the hole refuses there (a peck into a shallow step)", () => {
    // two boxes, the right one 0.02 … 0.3 lower: the peck's free side lies
    // inside the whole box after the last APART sample (no sample between)
    for (const h of [0.02, 0.1, 0.3]) {
      const step = Float32Array.from([...box(-10, 60, -10, 70, -30, 0), ...box(60, 110, -10, 70, -30, -h)]);
      expect(list(new Prog().g0({ x: 85, y: 30, z: 15 }).g0({ z: 3 }).g1({ z: -6 }).g0({ z: 3 }).g0({ z: -2.5 }).g1({ z: -8 }).g0({ z: 15 }), { stock: step }), `${h}`)
        .toEqual(["collision rapid L5"]);
    }
  });

  it("whole boxes decide one answer in every facet order (Codex's tool through the opening, wholly above, touching)", () => {
    const tris = (p: Float32Array) => Array.from({ length: p.length / 9 }, (_, i) => Array.from(p.slice(i * 9, i * 9 + 9)));
    const openStock = tris(boxPositions(20, 20, 30, 0, 0, -15)).filter(t => !(t[2] === 0 && t[5] === 0 && t[8] === 0));
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
    // the tool's tip 5 deep through the opening (no exclusion: UNRESOLVED), 0.5
    // wholly above (APART), at the rim's plane (touching boxes: no exclusion);
    // then sideways over the wall: a touch from UNRESOLVED is a finding
    for (const [label, tip, want] of [["5 deep", -5, ["collision rapid L3"]], ["0.5 above", 0.5, ["near rapid L3"]], ["at the rim", 0, ["collision rapid L3"]]] as const) {
      const seen = new Set<string>();
      for (let k = 0; k < 40; k++) {
        const stock = Float32Array.from(shuffle(openStock.map(t => [...t])).flatMap(t => t.map((v, i) => v + [200, 150, -100][i % 3]!)));
        seen.add(JSON.stringify(list(new Prog().g0({ x: 0, y: 0, z: 30 }).g0({ z: tip }).g0({ x: 12 }).g0({ z: 30 }), { stock, toolR: 1, toolL: 60 })));
      }
      expect([...seen], label).toEqual([JSON.stringify(want)]);
    }
  });
});

describe("the own hole's checkpoint (plan v3 §A; Codex R488 MT488-01, R490)", { timeout: 120_000 }, () => {
  const codex = () => { const p = start().g0({ z: 30 }); for (let i = 0; i < 1100; i++) p.g1({ z: 30 + (i % 2) }); return p.g0({ z: -6 }); };
  const run = (p: Prog, stocks: number, opts: Partial<CollisionOptions>) => { const w = hw(); findings(p.track(), { stocks, opts: { ...opts, holeWork: w } }); return w; };
  const CONST = { clock: () => 0 };

  it("asks at most 4 times between two yields, whatever the number of pairs — a frozen clock too", () => {
    for (const pairs of [1, 4, 16]) {
      const w = run(codex(), pairs, { ...CONST, yieldMs: 1e9 });
      expect(w.asks, `${pairs} pairs`).toBe(2 * pairs);
      expect(w.maxBetweenYields, `${pairs} pairs`).toBe(Math.min(4, 2 * pairs));
      expect(w.sites[0]).toBe(2 * pairs);
    }
  });
  it("at the re-sampling after a touch too (site 1)", () => {
    const w = run(fine(), 4, { ...CONST, yieldMs: 1e9 });
    expect(w.sites[1]).toBeGreaterThanOrEqual(20);
    expect(w.maxBetweenYields).toBeLessThanOrEqual(4);
  });
  it("a cancel raised by the first ask lands at the next checkpoint (the worker's pump), whatever the number of pairs", () => {
    for (const pairs of [1, 4, 16]) {
      const w = hw(), it = sweepCollisionsIter(modelOf({ stocks: pairs }), codex().track(), WCS as never,
                                               { margin: MARGIN, contacts: { store: new ContactStore(1, 0) }, holeWork: w,
                                                 yieldMs: 1e9, clock: () => 0 } as CollisionOptions);
      let s = runSweepSlice(it, 0, () => w.asks > 0, () => 0);
      for (let k = 0; !s.done && k < 1e6; k++) s = runSweepSlice(it, 0, () => w.asks > 0, () => 0);
      expect([s.done, s.cancelled], `${pairs} pairs`).toEqual([true, true]);
      expect(w.asks, `${pairs} pairs`).toBeGreaterThan(0);
      expect(w.asks, `${pairs} pairs`).toBeLessThanOrEqual(HOLE_ASKS_PER_YIELD);
    }
  });
  it("the search back and the boundary are reached, and never ask (no stretch begins there)", () => {
    // what the sweep's certificates guarantee: a touch or a stretch's first
    // note in the margin is the main loop's or the re-sampling's, and after
    // it the pair is in an episode or muted — a later near note asks nothing.
    // Reached: 400 random programs near and in the stock with tool and offset
    // changes, relabels and unknown starts (the boundary's note), and the
    // pecks; every note at the two sites counted (`checks`), none asked
    let seed = 11;
    const R = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const tot = hw();
    const add = (w: HoleWork) => { for (const k of [0, 1, 2, 3] as const) { tot.checks[k] += w.checks[k]; tot.sites[k] += w.sites[k]; } };
    for (const p of [codex(), fine(), g83(1, 8), g83(0.5, 8, 0.5), g83(6, 8)]) add(run(p, 2, { ...CONST, yieldMs: 0 }));
    for (let c = 0; c < 400; c++) {
      const p = new Prog().g0({ x: 50, y: 30, z: 15 });
      for (let i = 0, n = 6 + Math.floor(R() * 14); i < n; i++) {
        if (R() < 0.15) p.tlo = Math.floor(R() * 4);
        const z = [3, 1, 0.5, -2.5, -3, -6, 15, 2.5][Math.floor(R() * 8)]!;
        p.move(R() < 0.5, { x: R() < 0.7 ? p.cur.x : [50, 52, 70, 112, 115][Math.floor(R() * 5)]!, z });
        if (R() < 0.12) Object.assign(p.pts[p.pts.length - 1]!, { brk: true, ustart: R() < 0.3 });
      }
      add(run(p.g0({ z: 15 }), 2, { ...TOOLS, unknownTools: [9], ...CONST, yieldMs: 0 }));
    }
    expect(tot.sites[0] + tot.sites[1]).toBeGreaterThan(1000);
    expect([tot.checks[2] > 500, tot.checks[3] > 200]).toEqual([true, true]);
    expect([tot.sites[2], tot.sites[3]]).toEqual([0, 0]);
  });
});

describe("results equal across yield patterns and shards (Codex R490 MT490-01)", { timeout: 120_000 }, () => {
  const prog = () => { const p = g83(3, 6); p.g0({ x: 70 }).g0({ z: 1 }).g1({ z: -6 }).g0({ z: 3 }).g0({ z: -8 }).g0({ y: 45 }).g0({ z: 15 }); return p; };

  it("the comparison itself is red with unchanged row counts", () => {
    const st = new ContactStore(1, 0);
    sweepCollisions(modelOf({ stocks: 2 }), prog().track(), WCS as never, { margin: MARGIN, contacts: { store: st } });
    expect(st.episodes.rows * st.intervals.rows).toBeGreaterThan(0);
    const before = digest(st);
    for (const [t, row, name, v] of [[st.episodes, 0, "pair", 99], [st.intervals, 0, "enter", 123], [st.intervals, 0, "flags", 0]] as const) {
      const old = t.get(row, name);
      t.set(row, name, v);
      expect(digest(st), name).not.toBe(before);
      t.set(row, name, old);
    }
    st.gaps.append({ pair: 0, start: 1, end: 2, reason: 1 });
    const withGap = digest(st);
    st.gaps.set(0, "reason", 2);
    expect(digest(st)).not.toBe(withGap);
  });

  it("the same tables with yields at every ask, at 8 ms, with a frozen clock, and with another sweep posing the model between", () => {
    const model = modelOf({ stocks: 4 }), t = prog().track();
    const one = (o: Partial<CollisionOptions>, other?: Generator<unknown, unknown, boolean | undefined>) => {
      const st = new ContactStore(1, 0), it = sweepCollisionsIter(model, t, WCS as never, { margin: MARGIN, contacts: { store: st }, ...o } as CollisionOptions);
      for (let r = it.next(); !r.done; r = it.next()) other?.next();
      return digest(st);
    };
    const base = one({});
    expect(one({ yieldMs: 0, clock: () => 0 })).toBe(base);
    expect(one({ yieldMs: 8 })).toBe(base);
    expect(one({ yieldMs: 1e9, clock: () => 0 })).toBe(base);
    // a second sweep over the same model, a step between each of ours: it poses the model elsewhere
    const side = () => sweepCollisionsIter(model, codexTrack(), WCS as never, { margin: MARGIN, yieldMs: 0, clock: () => 0 } as CollisionOptions);
    expect(one({ yieldMs: 0, clock: () => 0 }, side())).toBe(base);
  });

  it("the shards' tables are the single sweep's, pair by pair", () => {
    const model = modelOf({ stocks: 4 }), t = prog().track();
    const pairsOf = (st: ContactStore) => {
      const m = new Map<number, string[]>();
      for (let e = 0; e < st.episodes.rows; e++) {
        const ivs: string[] = [];
        for (let iv = st.episodes.get(e, "firstIv"); iv !== NONE; iv = st.intervals.get(iv, "next"))
          ivs.push(`${st.intervals.get(iv, "flags")}:${st.intervals.get(iv, "enter").toFixed(2)}-${st.intervals.get(iv, "exit").toFixed(2)}`);
        const pair = st.episodes.get(e, "pair");
        m.set(pair, [...(m.get(pair) ?? []), `${st.episodes.get(e, "flags")} ${ivs.join(",")}`]);
      }
      return m;
    };
    const single = new ContactStore(1, 0);
    sweepCollisions(model, t, WCS as never, { margin: MARGIN, contacts: { store: single } });
    const want = pairsOf(single);
    expect(want.size).toBe(4);
    for (const of of [2, 3, 4]) {
      const merged = new Map<number, string[]>();
      for (const mask of assignPairs(new Float64Array(model.pairs.length).fill(1), of)) {
        const st = new ContactStore(1, 0);
        sweepCollisions(model, t, WCS as never, { margin: MARGIN, contacts: { store: st }, pairMask: mask });
        for (const [k, v] of pairsOf(st)) merged.set(k, v);
      }
      expect(new Map([...merged].sort((a, b) => a[0] - b[0])), `${of} shards`).toEqual(new Map([...want].sort((a, b) => a[0] - b[0])));
    }
  });
});

function codexTrack(): ScrubTrack {
  const p = start().g0({ z: 30 });
  for (let i = 0; i < 300; i++) p.g1({ x: 40 + (i % 7), z: 30 - (i % 3) });
  return p.g0({ z: -6 }).track();
}
