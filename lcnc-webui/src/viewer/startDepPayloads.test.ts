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
import { beginSentence, bindBeginning, depTimeSentence, earlierTime, moveTime, runBeginOf, runBeginView } from "./startDep";
import ts from "typescript";
import { epochTermsFor } from "./wcsEpochs";

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
                                undefined, d.startBelieved, d.startUnbound)!;
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

  it("the base sweep's first pose is point K, never the assumed start", () => {
    // G0 X10 / G0 Y20 Z-5 / G0 Y0 Z0: the first point stands where the parse
    // ASSUMED the start (Y, Z still the start's), point K is the first known
    // one. A bar the head touches at rest and at that assumed point, but not
    // at K: taken at the first pose it would read as a mechanical neighbour
    // (touching at the first pose and at rest) and leave the sweep — and L4,
    // which really drives into it, would never be reported
    const { raw, track } = load("e_base_first");
    expect(track.depEnd).toBe(1);
    expect(pts(track)).toEqual([[10, 0, 0], [10, 20, -5], [10, 0, 0]]);
    const g = new THREE.BoxGeometry(14, 2, 2).toNonIndexed();
    const bar = new Float32Array(g.getAttribute("position").array);
    g.dispose();
    const m = buildCollisionModel(MACHINE, [{ id: "bar", group: "table", positions: bar, translate: [5, 0, 0] },
                                            { id: "head", group: "head", positions: cube() }]);
    const base = sweepCollisions(m, { ...track, wcs: track.wcsEpoch }, wcsOf(raw), { margin: 0.1 });
    expect(base.staticContacts).toHaveLength(0);
    expect(base.hits.some(h => h.line === 4)).toBe(true);
  });

  it("writes in a beginning the text cannot place are named, on the base and on the bound track", () => {
    // R132 point 8 (start_writes_untracked): such a write may place the
    // moves after the beginning too — the base's guarantee does not hold
    // (its note, the "*"), its beginning flagged; a bound track (a side
    // sweep) says the same in its notes (R133)
    const { raw, track, e } = entry("e_single", [0, 0, 0]);
    const opts = { margin: 0.1, startWritesUntracked: true };
    const base = sweepCollisions(model([500, 0, 0]), { ...track, wcs: track.wcsEpoch }, wcsOf(raw), opts);
    expect(base.startDependent).toEqual({ fromLine: 2, toLine: 4, whole: false, untracked: true });
    expect(base.uncertified).toMatch(/offsets and stored positions written from the position in subroutines, loops, called files or remapped codes are not tracked — they may keep where the machine stood at the start/);
    const side = sweepCollisions(model([500, 0, 0]), { ...e, wcs: e.wcsEpoch }, wcsOf(raw), opts);
    expect(side.uncertified).toMatch(/offsets and stored positions written from the position in subroutines, loops, called files or remapped codes are not tracked — they may keep where the machine stood at the start/);
    // without the flag: nothing of it
    const plain = sweepCollisions(model([500, 0, 0]), { ...track, wcs: track.wcsEpoch }, wcsOf(raw), { margin: 0.1 });
    expect(plain.startDependent?.untracked).toBeUndefined();
    expect(plain.uncertified).toBeNull();
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
    expect(none.depTime).toEqual({ line: 2, bound: false, unknownLine: 2 });
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

// Codex R133's counterexamples (VP-I83..VP-I89) on the native payloads, the
// client chain as the page runs it.
const sweepFlags = (t: any, at: [number, number, number], raw: Record<string, any>, extra: Record<string, unknown> = {}) =>
  sweepCollisions(model(at), { ...t, wcs: t.wcsEpoch }, wcsOf(raw),
                  { margin: 0.1, tloEvents: t.tloEvents, startWritesUntracked: !!raw.start_writes_untracked, ...extra });
/** A computed body of ScrubBar.vue, executed as written with its inputs —
 *  the bar's own decision, no copy (Codex R133's method). */
function barComputed(name: string, refs: Record<string, unknown>) {
  const src = fs.readFileSync(path.resolve(__dirname, "../ScrubBar.vue"), "utf8");
  const begin = src.indexOf(`const ${name} = computed`);
  expect(begin).toBeGreaterThan(0);
  const end = src.indexOf("\n});", begin) + 4;
  const body = ts.transpileModule(src.slice(begin, end) + `\nreturn ${name};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const all = { computed: (f: () => unknown) => f(), ...refs };
  return new Function(...Object.keys(all), body)(...Object.values(all));
}
const sweepView = (result: any, run: any) => barComputed("sweepView", {
  shownResult: { value: result }, props: { collisionBusy: false, collisionRunCheck: run }, hitTargets: { value: [] },
  sweepToolSentence: { value: "" }, verdictDetail: { value: "" }, sweepCaveat: { value: result.uncertified },
  boundaryDetail: { value: "" }, sweptFrac: { value: 1 }, pctOf: (x: number) => `${x * 100} %` });
const verdictDetail = (result: any, run: any, track: any) => barComputed("verdictDetail", {
  shownResult: { value: result }, props: { collisionBusy: false, collisionRunCheck: run }, track: { value: track },
  provisionalOnScreen: { value: false }, stoppedTitle: { value: "" }, hits: { value: result.hits },
  sweepCaveat: { value: result.uncertified }, pctOf: (x: number) => `${x * 100} %`, beginSentence, depTimeSentence });

describe("Codex R133", () => {
  it("VP-I83: a G43.1 before the first move — the start shifts in the assumed start's basis", () => {
    // G43.1 Z10 / G0 X10 / G0 Y0 Z0 from (100, 100, 100), no start offset:
    // X10 moves no Z, its program Z is 90 (it read 80)
    const { raw, e } = entry("r133_g43_before_first", [100, 100, 100]);
    expect(pts(e)[1]).toEqual([10, 100, 90]);
    // a cube on the machine's real X move at Z100 is met on L3
    const side = sweepFlags(sliceTrack(e, 0, 3), [50, 100, 100], raw);
    expect(side.hits.some(h => h.line === 3)).toBe(true);
    // a fixture switch before the first move: the same shift, the start
    // converted with the epochs' terms as the page does
    const g = load("r133_g55_before_first");
    const terms = epochTermsFor(g.track.wcsEvents!, wcsOf(g.raw), undefined);
    const g55 = buildEntryTrack(g.track, [100, 100, 100], ["X", "Y", "Z"], wcsOf(g.raw), undefined, terms, 0, rates(g.raw))!;
    expect(pts(g55)[0]).toEqual([95, 94, 93]);               // the start in G55
    expect(pts(g55)[1]).toEqual([10, 94, 93]);
  });

  it("VP-I84: X, Y or Z unknown at the first point — no entry move, the beginning not checkable", () => {
    const m6 = load("r133_m6_before_first");
    expect(m6.track.startUnbound).toEqual([0, 1, 2]);
    expect(buildEntryTrack(m6.track, [100, 100, 100], ["X", "Y", "Z"], wcsOf(m6.raw), undefined, undefined, 0,
                           rates(m6.raw))).toBeNull();
    const rot = load("e_rotated");
    expect(buildEntryTrack(rot.track, [100, 100, 100], ["X", "Y", "Z"], wcsOf(rot.raw), undefined, undefined, 0,
                           rates(rot.raw))).toBeNull();
    const base = sweep(rot.track, [500, 0, 0], rot.raw);
    expect(base.startDependent?.unbound).toBe(true);
    expect(beginSentence(base.startDependent!, null)).toMatch(/its first move starts from a position the preview cannot know, so it is not checked\.$/);
  });

  it("VP-I85: a first G1 X Y Z keeps its kind and F with no mask after it", () => {
    const { e } = entry("r133_first_g1_xyz", [100, 0, 0]);
    expect(e.rapid[1]).toBe(0);
    expect(e.cum[1]).toBeCloseTo(60, 4);                   // 100 mm at F100
  });

  it("VP-I87: the run merge keeps the base's range and its boundary contacts", () => {
    const { raw, track, e } = entry("r133_range_after_k", [100, 100, 0]);
    const K = track.depEnd!, from = K + 1;
    expect(from).toBeLessThan(track.count - 1);
    const at = pts(track)[from]! as [number, number, number];
    const base = sweepCollisions(model(at), { ...track, wcs: track.wcsEpoch }, wcsOf(raw), { margin: 0.1, range: { from } });
    expect(base.range?.fromCum).toBeDefined();
    expect(base.boundaryContacts?.length).toBeGreaterThan(0);
    const side = sweep(sliceTrack(e, 0, K + 2), [500, 0, 0], raw);
    const m = mergeBeginningOntoBase(side, base, e.cum[K + 1]!, track.cum[track.count - 1]!, e.cum[1]);
    expect(m.range).toEqual(base.range);
    expect(m.boundaryContacts).toEqual(base.boundaryContacts);
  });

  it("VP-I88: a stored position the canon does not see is named with no mask, and after a slice", () => {
    const store = load("r133_store_before_first_absolute");
    expect(store.raw.start_writes_untracked).toBe(true);
    expect(store.track.depEnd ?? 0).toBe(0);
    const r = sweepFlags(store.track, [500, 0, 0], store.raw);
    expect(r.uncertified).toMatch(/offsets and stored positions written from the position in subroutines, loops, called files or remapped codes are not tracked/);
    // the side sweep's slice of a bound track keeps the beginning's arrays and the flag's note
    const u = entry("r133_untracked_writes", [100, 100, 100]);
    const sl = sliceTrack(u.e, 0, (u.track.depEnd ?? 0) + 2);
    expect(sl.dep).toBeDefined();
    expect(sweepFlags(sl, [500, 0, 0], u.raw).uncertified).toMatch(/not tracked — they may keep where the machine stood at the start/);
  });

  it("VP-I89: the earliest time cause, and the help says it", () => {
    const { e } = entry("r133_g93_no_limits", [0, 0, 0]);
    expect(e.depTime).toEqual({ line: 2, bound: false, unknownLine: 2 });
    expect(depTimeSentence(e.depTime!)).toBe("The time from L2 on is not known: a feed with no known rate, and an INI velocity limit is missing.");
    expect(depTimeSentence({ line: 2, bound: true })).toMatch(/^The time from L2 on is a lower bound: /);
    expect(depTimeSentence({ line: 2, bound: false, unknownLine: 3 })).toMatch(/lower bound: .*; from L3 on it is not known: /);
    // in execution order: the earlier line, unknown from the later one
    expect(earlierTime({ line: 2, bound: true }, { line: 3, bound: false, unknownLine: 3 }))
      .toEqual({ line: 2, bound: false, unknownLine: 3 });
    expect(earlierTime({ line: 2, bound: false, unknownLine: 2 }, { line: 3, bound: true }))
      .toEqual({ line: 2, bound: false, unknownLine: 2 });
    // the bar's own "?" carries it
    const r = sweep(e, [500, 0, 0], load("r133_g93_no_limits").raw);
    expect(verdictDetail(r, null, e)).toMatch(/The time from L2 on is not known/);
  });

  it("VP-I86: a run check never calls an unchecked beginning checked in full", () => {
    const all = load("e_all_dep");
    const whole = sweep(all.track, [500, 0, 0], all.raw);
    expect(whole.startDependent?.whole).toBe(true);
    const run = (begin: string, beginWhy: string | null = null) =>
      ({ phase: "full", fromLine: null, fromCum: null, provisionalShown: false, begin, beginWhy });
    expect(sweepView(whole, run("nojoints")).verdict).toBe("Depends on the machine's position");
    expect(sweepView(whole, null).verdict).toBe("Depends on the machine's position");
    const rdp = load("e_g53_rdp");
    const part = sweep(rdp.track, [500, 0, 0], rdp.raw);
    expect(part.startDependent?.whole).toBe(false);
    expect(sweepView(part, run("nojoints")).verdict).toBe("Clear · start not checked");
    expect(sweepView(part, run("unbound")).verdict).toBe("Clear · start not checked");
    const pending = sweepView(part, run("checking"));
    expect([pending.state, pending.verdict]).toEqual(["checking", "No collision · start still checking"]);
    // the bound side result merged: no beginning left to name — in full
    const { e } = entry("e_g53_rdp", [100, 100, 0]);
    const K = rdp.track.depEnd!;
    const side = sweep(sliceTrack(e, 0, K + 2), [500, 0, 0], rdp.raw);
    const merged = mergeBeginningOntoBase(side, part, e.cum[K + 1]!, rdp.track.cum[rdp.track.count - 1]!, e.cum[1]);
    expect(sweepView(merged, run("checked")).verdict).toBe("Clear · checked in full");
    // the states the viewer hands the bar
    expect([runBeginOf(0, false, false), runBeginOf(2, true, false), runBeginOf(2, false, true), runBeginOf(2, false, false)])
      .toEqual(["none", "bound", "unbound", "nojoints"]);
    expect([runBeginView("bound", false), runBeginView("bound", true), runBeginView("nojoints", true)])
      .toEqual(["checking", "checked", "nojoints"]);
    // the "?" says why
    expect(verdictDetail(part, run("nojoints", "moving"), rdp.track))
      .toMatch(/The start of the program depends on where the machine stands \(L\d+–L\d+\): not checked: the run's start position was not read \(moving\)\./);
    expect(verdictDetail(part, null, rdp.track)).toMatch(/: checked from the machine's position in the simulation\./);
  });
});
