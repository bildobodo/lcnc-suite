// The program's START-DEPENDENT beginning (docs/reviews/parity-ef.plan.md E,
// Codex R122–R131) as the REAL parse worker writes it (native payloads,
// scripts/gen_start_dep_payloads.py) through the client's decode, the base
// track, the entry track bound to a start, and the collision sweep.
//
// X, Y, Z stand where the machine stands when the program starts. A base
// track draws and checks nothing of the beginning (breaks, no time); bound to
// a start every dependent axis moves by Δ = start − assumed start and each
// move is timed by its kind and basis.
//
// The machine: a head that moves in X, Y and Z over a fixed obstacle, both
// 2 mm cubes.
import * as fs from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";
import { decodePreviewStreams, normalizeToToolBasis } from "../previewDecode";
import { buildEntryTrack, buildScrubTrack, sliceTrack } from "./scrubTrack";
import { buildCollisionModel, sweepCollisions, type CollisionMachine } from "./collision";
import { mergeBeginningOntoBase, mergeEntryResult } from "./sweepMerge";
import { bindBeginning, moveTime } from "./startDep";

const DIR = path.resolve(__dirname, "../../../scripts/test_fixtures/start_dep_payloads");
const MACHINE: CollisionMachine = {
  groups: [{ id: "table", parent: "root" }, { id: "head", parent: "root" }],
  kinematics: [{ group: "head", joint: 0, type: "translate", direction: "x", sign: 1 },
               { group: "head", joint: 1, type: "translate", direction: "y", sign: 1 },
               { group: "head", joint: 2, type: "translate", direction: "z", sign: 1 }],
  workGroup: "table", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
};
const cube = () => {
  const g = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
  const p = new Float32Array(g.getAttribute("position").array);
  g.dispose();
  return p;
};
const model = (at: [number, number, number]) => buildCollisionModel(MACHINE, [
  { id: "obstacle", group: "table", positions: cube(), translate: at },
  { id: "head", group: "head", positions: cube() },
]);

function load(name: string) {
  const raw = msgpackDecode(fs.readFileSync(path.join(DIR, `${name}.msgpack`))) as Record<string, any>;
  const d = decodePreviewStreams(raw);
  const track = buildScrubTrack(d.feed, d.rapid, d.kinsFrames, d.wcsEvents, d.subNames, d.tloEvents,
                                undefined, d.startBelieved)!;
  return { raw, d, track };
}
const wcsOf = (raw: Record<string, any>) => ({ g5x: [], g92: [], rotationDeg: 0, tool: raw.tlo_start } as any);
const rates = (raw: Record<string, any>) => ({ linear: raw.rapid_rate, rotary: raw.rot_rapid_rate,
                                                axisVmax: raw.axis_vmax, trajVmax: raw.traj_vmax });
function entry(name: string, start: [number, number, number]) {
  const { raw, d, track } = load(name);
  const e = buildEntryTrack(track, start, ["X", "Y", "Z"], wcsOf(raw), undefined, undefined, 0, rates(raw));
  return { raw, d, track, e: e! };
}
const pts = (t: { pos: Float32Array; count: number }) =>
  Array.from({ length: t.count }, (_, i) => [0, 1, 2].map(k => Math.round(t.pos[i * 3 + k]! * 1e4) / 1e4));
const cums = (t: { cum: Float32Array; count: number }) => Array.from(t.cum.subarray(0, t.count)).map(c => Math.round(c * 1e4) / 1e4);
const sweep = (t: any, at: [number, number, number], raw: Record<string, any>) =>
  sweepCollisions(model(at), { ...t, wcs: t.wcsEpoch }, wcsOf(raw), { margin: 0.1 });

describe("the base track: the beginning is a break with no time", () => {
  it("names K, keeps the assumed start, breaks 1..K", () => {
    const { track } = load("e_g53_rdp");
    // G53 G0 Z0 / G0 X0 / G0 Y0 / G0 X10: masks 3, 2, 0, 0 — K = 2
    expect(track.depEnd).toBe(2);
    expect(track.startBelieved).toEqual([0, 0, 0]);
    expect(Array.from(track.brk!.subarray(0, 4))).toEqual([1, 1, 1, 0]);
    expect(cums(track)).toEqual([0, 0, 0, 1]);              // only X0 → X10 timed (10 mm at 10 mm/s)
  });

  it("a track dependent to its end has nothing else (K = n)", () => {
    const { track, raw } = load("e_all_dep");
    expect(track.depEnd).toBe(track.count);
    const r = sweep(track, [500, 500, 500], raw);
    expect(r.startDependent).toEqual({ fromLine: 2, toLine: 3, whole: true });
    expect(r.uncertified).toBeNull();                       // named apart from the guarantee
  });

  it("a program without a beginning is unchanged", () => {
    const { track } = load("e_read_dep");                   // every axis unknown after its read
    expect(track.depEnd ?? 0).toBeGreaterThanOrEqual(0);
    const bound = bindBeginning({ ...track, depEnd: 0 }, [1, 2, 3]);
    expect(bound!.pos).toBe(track.pos);
  });
});

describe("bound to a start (E10 Nr. 15: Codex's RDP counterexample over the whole chain)", () => {
  it("Δ = 0: the believed path", () => {
    const { e } = entry("e_g53_rdp", [0, 0, 0]);
    expect(pts(e)).toEqual([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [10, 0, 0]]);
    expect(e.depEnd).toBe(0);
  });

  it("Δ = (100, 100, 0): both corners, the path the machine runs", () => {
    const { e } = entry("e_g53_rdp", [100, 100, 0]);
    // the live pose, Z up (only Z: the machine never runs the diagonal),
    // X to 0 with Y still where it stood, Y to 0, X to 10
    expect(pts(e)).toEqual([[100, 100, 0], [100, 100, 0], [0, 100, 0], [0, 0, 0], [10, 0, 0]]);
    expect(cums(e)).toEqual([0, 0, 10, 20, 21]);            // 100 mm at 10 mm/s, twice
    expect(Array.from(e.brk!.subarray(0, 5))).toEqual([0, 0, 0, 0, 0]);
  });

  it("the bound point K is the base's point K (the merge's seam)", () => {
    // K is the first point with no dependent axis: Δ leaves it alone, so the
    // side sweep ends where the base's checked part begins
    const { track, e } = entry("e_g53_rdp", [100, 100, 0]);
    const K = track.depEnd!;
    expect(Array.from(e.pos.subarray((K + 1) * 3, (K + 2) * 3))).toEqual(Array.from(track.pos.subarray(K * 3, (K + 1) * 3)));
  });

  it("onto the base's axis (a run check): the beginning's findings at the start, the base's where they were", () => {
    const { raw, track, e } = entry("e_g53_rdp", [100, 100, 0]);
    const K = track.depEnd!;
    const side = sweep(sliceTrack(e, 0, K + 2), [50, 100, 0], raw);
    const base = sweep(track, [5, 0, 0], raw);                   // on X0 → X10, after K
    const m = mergeBeginningOntoBase(side, base, e.cum[K + 1]!, track.cum[track.count - 1]!, e.cum[1]);
    const begin = m.hits.find(h => h.line === 3)!, after = m.hits.find(h => h.line === 5)!;
    expect(begin.cum).toBe(0);
    expect(after.cum).toBeCloseTo(base.hits.find(h => h.line === 5)!.cum, 6);
    expect(m.startDependent).toBeUndefined();
  });

  it("the side sweep finds an obstacle on the real path, the base sweep never the believed one", () => {
    const { raw, track, e } = entry("e_g53_rdp", [100, 100, 0]);
    const K = track.depEnd!;
    const side = sweep(sliceTrack(e, 0, K + 2), [50, 100, 0], raw);   // on X0 with Y still at 100
    expect(side.hits.some(h => h.line === 3)).toBe(true);
    const base = sweep(track, [50, 100, 0], raw);
    expect(base.hits).toHaveLength(0);
    expect(base.startDependent).toEqual({ fromLine: 2, toLine: 4, whole: false });
    // merged on the entry axis: the beginning's finding keeps its line
    const merged = mergeEntryResult(side, base, e.cum[K + 1]!, track.cum[track.count - 1]!, e.cum[1]);
    const h = merged.hits.find(x => x.line === 3)!;
    expect([h.entry, h.entryMove]).toEqual([true, undefined]);
    expect(merged.startDependent).toBeUndefined();
    // the same obstacle on the believed path (Δ = 0) is never met
    const z = entry("e_g53_rdp", [0, 0, 0]);
    expect(sweep(sliceTrack(z.e, 0, K + 2), [50, 100, 0], raw).hits).toHaveLength(0);
  });

  it("a G43 and a fixture switch inside the beginning stay relabels, with no time", () => {
    const { track, e } = entry("e_g43_fixture", [7, 8, 9]);
    expect(Array.from(track.depBrk!.subarray(0, 3))).toEqual([1, 1, 0]);
    // entry point, then the track: its relabel (old index 1) is a break again
    expect(e.brk![2]).toBe(1);
    expect(e.cum[2]).toBe(e.cum[1]);
    // every point of the beginning moved by Δ on its dependent axes
    const d = [7, 8, 9];
    for (let i = 0; i < track.count; i++) {
      for (let k = 0; k < 3; k++) {
        const want = track.pos[i * 3 + k]! + ((track.dep![i]! >> k) & 1 ? d[k]! : 0);
        expect(e.pos[(i + 1) * 3 + k]).toBeCloseTo(want, 4);
      }
    }
  });

  it("the routine's return takes the start back (K = n)", () => {
    const { track, e } = entry("e_m600_return", [12, 34, -50]);
    expect(track.depEnd).toBe(track.count);
    // the last two points (the return, then G0 Z5): X, Y where the machine started
    const last = e.count - 1;
    expect([e.pos[last * 3], e.pos[last * 3 + 1]]).toEqual([12, 34]);
  });

  it("an older payload without the assumed start is never shifted", () => {
    const { track } = load("e_g53_rdp");
    expect(bindBeginning({ ...track, startBelieved: undefined }, [100, 100, 0])).toBeNull();
  });
});

describe("the time of the beginning (E10 Nr. 16, VP122-02)", () => {
  it("each move at its own F — the payloads differ only in F, the durations swap", () => {
    const a = entry("e_time_a", [100, 100, 0]).e, b = entry("e_time_b", [100, 100, 0]).e;
    // G1 X0 F100 / G1 Y0 F200 and the swap: 100 mm each
    expect(cums(a)).toEqual([0, 60, 90]);
    expect(cums(b)).toEqual([0, 30, 90]);
  });

  it("the first G1 feeds from the start (its F, its kind)", () => {
    const { e } = entry("e_first_g1", [100, 100, 0]);
    expect(cums(e)).toEqual([0, 60]);                        // 100 mm at F100
    expect(e.rapid[1]).toBe(0);                              // a feed, never a rapid by default
  });

  it("inverse time: the shortest duration the INI allows, named; none without a limit", () => {
    const lim = entry("e_g93_limits", [100, 100, 0]).e;
    // G93 G1 X10 from X100: 90 mm, at most 10 mm/s per axis and 20 mm/s along the path
    expect(cums(lim)).toEqual([0, 9]);
    expect(lim.depTime).toEqual({ line: 2, bound: true });
    const none = entry("e_g93", [100, 100, 0]).e;            // no [TRAJ] MAX_LINEAR_VELOCITY
    expect(cums(none)).toEqual([0, 0]);
    expect(none.depTime).toEqual({ line: 2, bound: false });
  });

  it("moveTime", () => {
    expect(moveTime(1, 0, 3, 4, 0, 0, true, { linear: 5 })).toEqual([1, 0]);
    expect(moveTime(2, 600, 30, 40, 0, 0, true, {})).toEqual([5, 0]);
    expect(moveTime(3, 0, 30, 40, 0, 0, true, { axisVmax: [10, 10, 10], trajVmax: 25 })).toEqual([4, 1]);
    expect(moveTime(3, 0, 30, 0, 0, 0, true, { axisVmax: [null, 10, 10], trajVmax: 25 })).toEqual([0, 2]);
    expect(moveTime(3, 0, 0, 0, 0, 0, true, {})).toEqual([0, 1]);
    expect(moveTime(2, 600, 30, 40, 0, 0, false, {})).toEqual([50, 0]);
  });
});

describe("the tool basis moves the assumed start with the points before the first row", () => {
  it("normalizeToToolBasis", () => {
    const raw = msgpackDecode(fs.readFileSync(path.join(DIR, "e_single.msgpack"))) as Record<string, any>;
    const d = decodePreviewStreams(raw);
    normalizeToToolBasis(d, [0, 0, 0], [0, 0, 7]);
    expect(d.startBelieved).toEqual([0, 0, -7]);
  });
});
