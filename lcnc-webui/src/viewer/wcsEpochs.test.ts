// Unit tests for viewer/wcsEpochs.ts — per-segment WCS epochs (review P2).
import { describe, expect, it } from "vitest";
import {
  boundsOf, epochWcsList, epochTermsFor, parseWcsFrames, rebasePositions,
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
