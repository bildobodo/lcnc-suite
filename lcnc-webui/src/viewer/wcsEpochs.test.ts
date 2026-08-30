// Unit tests for viewer/wcsEpochs.ts — per-segment WCS epochs (review P2).
import { describe, expect, it } from "vitest";
import {
  boundsOf, epochWcsList, epochTermsFor, parseWcsFrames, previewWcsStaleFor,
  rebasePositions, usedWcsRowsKey,
  type WcsEpoch, type WcsTableRow,
} from "./wcsEpochs";
import { machineToProgram, programToMachine, wcsTerms, type PartFrameWcs } from "./partFrame";

const LIVE: PartFrameWcs = {
  g5x: [7, 8, 9, 0, 0, 0], g92: [0.5, 0, 0, 0, 0, 0], rotationDeg: 0, tool: [0, 0, 100],
};

function ev(over: Partial<WcsEpoch> = {}): WcsEpoch {
  return {
    seq: 0, idx: 1, rotationDeg: 0, rewritten: false,
    g5x: [10, 20, 30, 0, 0, 0], g92: [0, 0, 0, 0, 0, 0], ...over,
  };
}

describe("parseWcsFrames", () => {
  it("parses wire rows; absence or empty = legacy payload", () => {
    expect(parseWcsFrames(undefined)).toBeUndefined();
    expect(parseWcsFrames([])).toBeUndefined();
    const evs = parseWcsFrames(
      [[2, 6, 15, 1, 10, 20, 30, 0, 0, 0, 1, 2, 3, 0, 0, 0]])!;
    expect(evs).toEqual([{
      seq: 2, idx: 6, rotationDeg: 15, rewritten: true,
      g5x: [10, 20, 30, 0, 0, 0], g92: [1, 2, 3, 0, 0, 0],
    }]);
  });
});

describe("epochWcsList", () => {
  const TABLE: WcsTableRow[] = Array.from({ length: 9 }, (_, i) => ({
    name: `G5${4 + i}`, x: 0, y: 0, z: 0, a: 0, b: 0, c: 0, r: 0,
  }));
  TABLE[5] = { name: "G59", x: 40, y: -41, z: 42, a: 0, b: 0, c: 0, r: 12 };

  it("non-rewritten epoch re-adds ITS OWN fixture's live row + live g92/tool", () => {
    const [w] = epochWcsList([ev({ idx: 6 })], LIVE, TABLE);
    expect(w!.g5x).toEqual([40, -41, 42, 0, 0, 0]);
    expect(w!.rotationDeg).toBe(12);
    expect(w!.g92).toBe(LIVE.g92);
    expect(w!.tool).toBe(LIVE.tool);
  });

  it("rewritten epoch pins the PARSE snapshot (live row is not authoritative)", () => {
    const [w] = epochWcsList([ev({ idx: 6, rewritten: true })], LIVE, TABLE);
    expect(w!.g5x).toEqual([10, 20, 30, 0, 0, 0]);
    expect(w!.rotationDeg).toBe(0);
    expect(w!.tool).toBe(LIVE.tool);
  });

  it("missing table falls back to the snapshot — the only honest stand-in", () => {
    const [w] = epochWcsList([ev({ idx: 6 })], LIVE, undefined);
    expect(w!.g5x).toEqual([10, 20, 30, 0, 0, 0]);
  });
});

describe("usedWcsRowsKey (W2 P5 gate fix)", () => {
  const table: WcsTableRow[] = [
    { name: "G54", x: 1, y: 2, z: 3, r: 0 },
    { name: "G55", x: 9, y: 9, z: 9, r: 5 },
  ];

  it("empty for no events, and for rewritten-only payloads", () => {
    expect(usedWcsRowsKey(undefined, table)).toBe("");
    expect(usedWcsRowsKey([], table)).toBe("");
    expect(usedWcsRowsKey([ev({ rewritten: true })], table)).toBe("");
  });

  it("keys only the USED non-rewritten rows and ignores the rest of the table", () => {
    const k0 = usedWcsRowsKey([ev({ idx: 1 })], table);
    expect(k0).toContain("1:");
    expect(k0).not.toContain("9");           // G55's values never enter
    // Editing an UNUSED row (G55) does not change the key…
    const t2 = [table[0]!, { ...table[1]!, x: 42 }];
    expect(usedWcsRowsKey([ev({ idx: 1 })], t2)).toBe(k0);
    // …editing the USED row does.
    const t3 = [{ ...table[0]!, z: -7 }, table[1]!];
    expect(usedWcsRowsKey([ev({ idx: 1 })], t3)).not.toBe(k0);
  });

  it("a missing table row keys as absent (still changes when it appears)", () => {
    const kAbsent = usedWcsRowsKey([ev({ idx: 6 })], table);
    expect(kAbsent).toContain("6:");
    expect(usedWcsRowsKey([ev({ idx: 6 })], undefined)).toBe(kAbsent);
    const t6: WcsTableRow[] = [...table, {}, {}, {}, { x: 1 }];
    expect(usedWcsRowsKey([ev({ idx: 6 })], t6)).not.toBe(kAbsent);
  });

  it("dedupes repeated epochs of the same fixture", () => {
    const one = usedWcsRowsKey([ev({ idx: 1 })], table);
    const twice = usedWcsRowsKey([ev({ idx: 1 }), ev({ seq: 5, idx: 1 })], table);
    expect(twice).toBe(one);
  });
});

describe("rebasePositions", () => {
  const ACTIVE = wcsTerms({ g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 });

  it("returns the INPUT untouched when every epoch matches the active frame", () => {
    const pos = new Float32Array([1, 2, 3, 4, 5, 6]);
    const same = rebasePositions(pos, new Uint8Array([0, 0]), [ACTIVE], ACTIVE);
    expect(same).toBe(pos);
    expect(rebasePositions(pos, undefined, [ACTIVE], ACTIVE)).toBe(pos);
  });

  it("a relabel pair (one machine point, two epochs) lands on ONE display point", () => {
    // Machine point M = (10, 5, 0). Epoch 0 = active (G54 at origin);
    // epoch 1 = G59 at (100, -50, 25) → its program coords are (-90, 55, -25).
    const t1 = wcsTerms({ g5x: [100, -50, 25, 0, 0, 0], g92: [], rotationDeg: 0 });
    const pos = new Float32Array([10, 5, 0, -90, 55, -25]);
    const out = rebasePositions(pos, new Uint8Array([0, 1]), [ACTIVE, t1], ACTIVE);
    expect(out).not.toBe(pos);
    expect([out[0], out[1], out[2]]).toEqual([10, 5, 0]);
    expect(out[3]).toBeCloseTo(10, 5);
    expect(out[4]).toBeCloseTo(5, 5);
    expect(out[5]).toBeCloseTo(0, 5);
  });

  it("is exact under a rotation-bearing epoch (programToMachine round trip)", () => {
    const tRot = wcsTerms({ g5x: [3, -4, 1, 0, 0, 0], g92: [2, 0, 0, 0, 0, 0], rotationDeg: 30 });
    const tAct = wcsTerms({ g5x: [-7, 2, 5, 0, 0, 0], g92: [], rotationDeg: -15 });
    const pos = new Float32Array([12, -8, 4]);
    const out = rebasePositions(pos, new Uint8Array([0]), [tRot], tAct);
    const m: number[] = [0, 0, 0, 0, 0, 0];
    const p: number[] = [0, 0, 0, 0, 0, 0];
    programToMachine(12, -8, 4, 0, 0, 0, tRot, m);
    machineToProgram(m[0]!, m[1]!, m[2]!, 0, 0, 0, tAct, p);
    expect(out[0]).toBeCloseTo(p[0]!, 5);
    expect(out[1]).toBeCloseTo(p[1]!, 5);
    expect(out[2]).toBeCloseTo(p[2]!, 5);
  });

  it("TLO cancels — the same live tool on both sides never shifts the path", () => {
    const withTool = epochTermsFor(
      [ev({ idx: 1, rewritten: true, g5x: [50, 0, 0, 0, 0, 0] })], LIVE, undefined);
    const active = wcsTerms(LIVE);
    const out = rebasePositions(new Float32Array([0, 0, 0]), new Uint8Array([0]),
                                withTool, active);
    // Only the OFFSET delta survives (epoch z 0 vs active z 9): the ±100
    // tool z is added by the epoch terms and removed by the active terms.
    expect(out[2]).toBeCloseTo(-9, 5);
  });
});

describe("boundsOf", () => {
  it("computes xyz bounds and refuses to invent a box for no motion", () => {
    expect(boundsOf(new Float32Array(0))).toBeNull();
    const b = boundsOf(new Float32Array([1, 2, 3, -4, 5, -6]))!;
    expect(b.min).toEqual([-4, 2, -6]);
    expect(b.max).toEqual([1, 5, 3]);
  });
});

describe("previewWcsStaleFor — per-fixture, not per-active-slot", () => {
  // Parse-time: G54 = (1300,-200,-1400), G59 written by the program (rewritten).
  const G54 = [1300, -200, -1400, 0, 0, 0];
  const G59 = [1609.6, -854.9, -791.1, 0, 0, 0];
  const events: WcsEpoch[] = [
    ev({ seq: 0, idx: 1, g5x: G54 }),
    ev({ seq: 4, idx: 6, g5x: G59, rewritten: true }),
  ];
  const basis = { g5x: G54, g92: [0, 0, 0, 0, 0, 0], rotation: 0 };
  const row = (v: number[], r = 0): WcsTableRow =>
    ({ x: v[0], y: v[1], z: v[2], a: v[3], b: v[4], c: v[5], r });
  const table = (g54: number[], g59: number[]): WcsTableRow[] => {
    const t: WcsTableRow[] = [];
    for (let i = 0; i < 9; i++) t.push(row([0, 0, 0, 0, 0, 0]));
    t[0] = row(g54); t[5] = row(g59);
    return t;
  };
  const zero = [0, 0, 0, 0, 0, 0];

  it("a G54→G59 switch mid-run is NOT stale (the operator changed nothing)", () => {
    // Live ACTIVE offset is now the G59 row — the old check lit here.
    expect(previewWcsStaleFor(events, basis, table(G54, G59),
      { g5x: G59, g92: zero, rotationDeg: 0 })).toBe(false);
  });

  it("an idle touch-off on a USED fixture is stale", () => {
    expect(previewWcsStaleFor(events, basis, table([1310, -200, -1400, 0, 0, 0], G59),
      { g5x: G54, g92: zero, rotationDeg: 0 })).toBe(true);
  });

  it("a change to a fixture the PROGRAM rewrites is not stale", () => {
    expect(previewWcsStaleFor(events, basis, table(G54, [0, 0, 0, 0, 0, 0]),
      { g5x: G54, g92: zero, rotationDeg: 0 })).toBe(false);
  });

  it("rotation on a used fixture counts; sub-eps jitter does not", () => {
    const t = table(G54, G59);
    t[0] = row(G54, 5);
    expect(previewWcsStaleFor(events, basis, t, { g5x: G54, g92: zero, rotationDeg: 0 })).toBe(true);
    const t2 = table([1300.0005, -200, -1400, 0, 0, 0], G59);
    expect(previewWcsStaleFor(events, basis, t2, { g5x: G54, g92: zero, rotationDeg: 0 })).toBe(false);
  });

  it("legacy payload (no events) keeps the active-basis comparison", () => {
    expect(previewWcsStaleFor(undefined, basis, undefined,
      { g5x: G54, g92: zero, rotationDeg: 0 })).toBe(false);
    expect(previewWcsStaleFor(undefined, basis, undefined,
      { g5x: [1310, -200, -1400, 0, 0, 0], g92: zero, rotationDeg: 0 })).toBe(true);
    expect(previewWcsStaleFor(undefined, null, undefined,
      { g5x: G54, g92: zero, rotationDeg: 0 })).toBe(false);
  });

  it("makes no claim without a table or live status", () => {
    expect(previewWcsStaleFor(events, basis, undefined, { g5x: G59, g92: zero, rotationDeg: 0 })).toBe(false);
    expect(previewWcsStaleFor(events, basis, table(G54, G59), null)).toBe(false);
  });
});
