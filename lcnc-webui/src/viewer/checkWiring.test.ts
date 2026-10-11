// The viewer's own wiring of step 4 package 1, run as written: the first
// confirmed contact shown at once (_colShowFirst, 1b), the earlier preview's
// verdict in words (_colPreviousOf, 1a), the card's context taken at the
// request (_colContextFor, 1c). The functions come unchanged out of
// ThreeViewer.vue (the method of startDepPayloads.test's coordinator); only
// the refs around them are given.
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { confirmedContact, type CollisionHit, type CollisionResult } from "./collision";
import { clashTargets } from "./clashTargets";
import { findingWords } from "./sweepWords";
import { collisionLineMarks } from "./collisionMarks";
import { captureCheckContext } from "./checkContext";
import { semanticKinsMode } from "./kins";
import { basisFromLive, type CheckBasis } from "./checkBasis";

function viewerFns(names: string[], prelude: string, refs: Record<string, unknown>, exports: string[] = []): Record<string, any> {
  const file = fs.readFileSync(path.resolve(__dirname, "../ThreeViewer.vue"), "utf8");
  const script = file.slice(file.indexOf('<script setup lang="ts">') + 24, file.indexOf("</script>"));
  const ast = ts.createSourceFile("ThreeViewer.ts", script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const texts = names.map(name => {
    const f = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    expect(f, name).toBeTruthy();
    return f!.getText(ast);
  });
  const body = ts.transpileModule(`${prelude}\n${texts.join("\n")}\nreturn { ${[...names, ...exports].join(", ")} };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return new Function(...Object.keys(refs), body)(...Object.values(refs));
}

const hit = (line: number, dist: number, over: Partial<CollisionHit> = {}): CollisionHit =>
  ({ line, cum: line, cumEnd: line, a: "spindle_nose", b: `part_${line}`, dist, rapid: false, ...over });
const result = (hits: CollisionHit[], over: Partial<CollisionResult> = {}): CollisionResult => ({
  hits, staticContacts: [], samples: 10, coarsened: false, uncertified: null, pairCount: 5,
  pairsPrescreened: 0, bvhMs: 0, sweepMs: 0, truncated: null, ...over });

describe("the first confirmed contact at once (step 4 plan 1b, _colShowFirst)", () => {
  /** _colShowFirst over a partial on screen (`start`, of `onTrack`) while the
   *  request's track is TRACK; `shown()` reads the partial it leaves. */
  const showFirst = (start: CollisionResult | null, onTrack: unknown, progress = 0.4) => {
    const TRACK = { id: "pending" };
    return viewerFns(["_colShowFirst"], `
      const collisionPartial = { value: START }, collisionPartialTrack = { value: ON === "pending" ? TRACK : ON };
      const collisionProgress = { value: PROGRESS };
      let _colPendingTrack = TRACK;
      const shown = () => collisionPartial.value;
      const emitted = [], counts = { retint: 0 };
      const emit = (e, x) => emitted.push([e, x]), _colRetint = () => { counts.retint++; };`,
      { confirmedContact, collisionLineMarks, TRACK, START: start, ON: onTrack, PROGRESS: progress }, ["shown", "emitted", "counts"]);
  };
  const lines = (r: CollisionResult) => r.hits.map(x => x.line);
  it("with nothing on screen: a running partial of the contact alone, at the progress it came with", () => {
    const f = showFirst(null, null);
    f._colShowFirst(hit(7, 0), 0.1);
    expect(lines(f.shown())).toEqual([7]);
    expect(f.shown().truncated).toEqual({ covered: 0.1, reason: "running" });
    // the code panel's marks and the tint follow at once, like any partial
    expect(f.emitted).toEqual([["collision-lines", collisionLineMarks([hit(7, 0)])]]);
    expect(f.counts.retint).toBe(1);
    f._colShowFirst(hit(3, 0));
    expect(lines(f.shown()), "a confirmed contact on screen: nothing added").toEqual([7]);
    expect(f.emitted).toHaveLength(1);
  });
  it("over a partial of the same track that holds only a near miss: the contact joins it, in track order", () => {
    const f = showFirst(result([hit(9, 1.5)]), "pending");
    f._colShowFirst(hit(4, 0));
    expect(lines(f.shown())).toEqual([4, 9]);
    expect(f.shown().truncated).toEqual({ covered: 0.4, reason: "running" });
  });
  it("a partial of another track is not built upon (a new program's request)", () => {
    const f = showFirst(result([hit(9, 1.5)]), { id: "old" });
    f._colShowFirst(hit(4, 0));
    expect(lines(f.shown())).toEqual([4]);
  });
  it("a margin entry that touched later counts as a confirmed contact on screen", () => {
    const f = showFirst(result([hit(9, 1.5, { touches: true })]), "pending");
    f._colShowFirst(hit(4, 0));
    expect(lines(f.shown())).toEqual([9]);
  });
});

describe("the earlier preview's verdict in words (step 4 plan 1a, _colPreviousOf)", () => {
  const { _colPreviousOf } = viewerFns(["_colPreviousOf"], "", { clashTargets, findingWords });
  it("its words are the summary's: kinds apart, a near miss never a collision", () => {
    expect(_colPreviousOf(result([hit(7, 0), hit(9, 1.5)]), 12)).toEqual(
      { collisions: 2, text: "1 collision · 1 near miss", complete: true, version: 12 });
    expect(_colPreviousOf(result([], { truncated: { covered: 0.5, reason: "time" } }), null))
      .toEqual({ collisions: 0, text: "", complete: false, version: null });
  });
});

describe("the card's context, taken at the request (step 4 plan 1c, _colContextFor)", () => {
  const live = (): CheckBasis => basisFromLive({ g5x: [0, 0, 0, 0, 0, 0, 0, 0, 0], g92: [0, 0, 0, 0, 0, 0, 0, 0, 0], rotationXy: 0,
    toolOffset: [0, 0, 0], wcsTable: null, toolNum: 0, toolDiam: null, toolLen: null, eoffsetZ: null, eoffsetEnabled: null }, null);
  const KINS = { type: "xyzac-trt", identity_first: true };
  const harness = (o: { status?: any; run?: any; fromLine?: number | null }) => viewerFns(["_colContextFor"], `
    const viewerInit = { value: { axes: ["X", "Y", "Z", "A", "C"], kins: KINS } };
    const vst = { value: STATUS };
    const viewerGcode = { value: { tloEvents: [], parse_tlos: [], toollen_table: [] } };
    const runBasis = { value: RUN };
    const collisionRun = { value: { fromLine: FROM } };
    const _unknownProgramTools = () => [];`, { KINS, STATUS: o.status ?? null, RUN: o.run ?? null, FROM: o.fromLine ?? null,
      captureCheckContext, semanticKinsMode })._colContextFor;
  it("idle: the fixture and the rotary axes from the status when the check begins", () => {
    const f = harness({ status: { g5x_index: 2, rotary_abc: [30, 0, 45], kins_type: 1 } });
    const ctx = f(live(), { mode: undefined });
    expect([ctx.fixture, ctx.rotary]).toEqual([2, [{ letter: "A", deg: 30 }, { letter: "C", deg: 45 }]]);
  });
  it("the kinematics are the track's labels — a track without labels is posed in the machine frame, whatever the status says", () => {
    const f = harness({ status: { kins_type: 1 } });
    expect(f(live(), { mode: undefined }).kins).toBe(0);
    const tcp = f(live(), { mode: new Uint8Array([1, 1, 1]) });
    expect([tcp.kins, tcp.kinsSwitches]).toEqual([1, false]);
    const sw = f(live(), { mode: new Uint8Array([0, 0, 1]) });
    expect([sw.kins, sw.kinsSwitches]).toEqual([0, true]);
  });
  it("in a run: the fixture of the run's start and the run's start joints, not the status now", () => {
    const run: CheckBasis = { ...live(), kind: "run", runId: 9, startJoints: [0, 0, 0, 20, 70] };
    const f = harness({ status: { g5x_index: 2, rotary_abc: [30, 0, 45] }, run: { start: { g5xIndex: 1 } }, fromLine: 7 });
    const ctx = f(run, { mode: undefined }, { basis: run, gen: 1, range: { from: 3 } });
    expect([ctx.fixture, ctx.rotary, ctx.fromLine]).toEqual([1, [{ letter: "A", deg: 20 }, { letter: "C", deg: 70 }], 7]);
    expect(f(run, { mode: undefined }, { basis: run, gen: 1 }).fromLine, "the full check: no start line").toBeNull();
  });
});
