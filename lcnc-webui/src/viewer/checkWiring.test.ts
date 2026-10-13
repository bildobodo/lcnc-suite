// The viewer's own wiring of step 4 package 1, run as written: the first
// confirmed contact shown at once (_colShowFirst, 1b), the earlier preview's
// verdict in words (_colPreviousOf, 1a), the card's context taken at the
// request (_colContextFor, 1c). The functions come unchanged out of
// ThreeViewer.vue (the method of startDepPayloads.test's coordinator); only
// the refs around them are given.
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollisionHit, CollisionResult } from "./collision";
import { clashTargets } from "./clashTargets";
import { findingWords } from "./sweepWords";
import { firstOnly, holdsFirst, withFirstContact } from "./firstContact";
import { mergeBeginningOntoBase, mergeEntryResult } from "./sweepMerge";
import { captureCheckContext } from "./checkContext";
import { semanticKinsMode } from "./kins";
import { basisFromLive, type CheckBasis } from "./checkBasis";
import { ContactStore, NONE } from "./contactStore";
import { buildContactView, targetAt } from "./contactView";

function viewerFns(names: string[], prelude: string, refs: Record<string, unknown>, exports: string[] = []): Record<string, any> {
  const file = fs.readFileSync(path.resolve(__dirname, "../ThreeViewer.vue"), "utf8");
  const script = file.slice(file.indexOf('<script setup lang="ts">') + 24, file.indexOf("</script>"));
  const ast = ts.createSourceFile("ThreeViewer.ts", script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const texts = names.map(name => {
    const f = ast.statements.find(n => (ts.isFunctionDeclaration(n) && n.name?.text === name)
      || (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === name)));
    expect(f, name).toBeTruthy();
    return f!.getText(ast).replaceAll("import.meta.url", '"https://test.invalid/ThreeViewer.js"');
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

/** The viewer's own worker handler (_colGetWorker's onmessage) and
 *  _colShowFirst as written, over the refs they read: `post` hands the
 *  handler a worker message of request `_colReqId`; `nextRequest` is a new
 *  request (its id). */
function owner() {
  return viewerFns(["_colGetWorker", "_colShowFirst", "_colEmitMarks"], `
    let _colWorker = null, _colModelSent = null, _colSide = null, _colReqId = 12, _colKeepShown = false, _colFirstHeld = null;
    // the contact tables (round B3): none in this harness — the marks read them, so they say nothing here
    let _colPartialReq = null;
    const _contactsBump = () => {}, contactViewFor = () => null, _lineRunsOf = () => null;
    const collisionResult = { value: null }, collisionTrack = { value: null }, collisionPartialTrackShown = { value: null };
    const TRACK = {};
    let _colPendingTrack = TRACK;
    const collisionPartial = { value: null }, collisionPartialTrack = { value: null }, collisionProgress = { value: 0 };
    const emitted = [], emit = (e, x) => emitted.push([e, x]), _colRetint = () => {};
    const newTrack = () => { _colPendingTrack = {}; };
    // no result and no run check here: what is shown is the partial
    const collisionResultShown = { get value() { return null; } }, collisionPartialShown = { get value() { return collisionPartial.value; } };
    // the bodies retry: the same request again, under a new id
    let _colNeedBodiesRetried = false, _colPendingRun = undefined;
    const collisionBusy = { value: true }, emitTelemetry = () => {}, _colFail = () => {};
    const runCollisionCheck = () => { _colReqId++; };
    class Worker { postMessage() {} }
    const post = (data) => _colGetWorker().onmessage({ data });
    const shown = () => collisionPartial.value;
    const nextRequest = () => ++_colReqId;`,
    { holdsFirst, withFirstContact, firstOnly }, ["post", "shown", "nextRequest", "emitted", "newTrack"]);
}
const words = (r: CollisionResult | null) => findingWords(clashTargets(r?.hits ?? []));
const running = (hits: CollisionHit[], covered = 0.1) => result(hits, { truncated: { covered, reason: "running" } });

describe("the first confirmed contact at once, through the viewer's worker handler (step 4 plan 1b; Codex R136)", () => {
  const near = hit(7, 1.5);
  it("VP-I91: the first of an onset shown as a near miss replaces it — one contact, one target, one key", () => {
    const ui = owner();
    ui.post({ id: 12, progress: 0.1, partial: running([near]) });
    expect(words(ui.shown()).text).toBe("1 near miss");
    ui.post({ id: 12, progress: 0.2, first: { ...near, touches: true } });
    const t = clashTargets(ui.shown().hits);
    expect(t.map(x => x.key)).toHaveLength(1);
    expect(words(ui.shown()).text).toBe("1 collision");
    expect(ui.shown().truncated, "at the progress the first came with").toEqual({ covered: 0.2, reason: "running" });
    // the code panel is told at once (its marks read the contact tables since round B3)
    expect(ui.emitted.at(-1)?.[0]).toBe("collision-lines");
  });
  it("VP-I92: a partial built from older words keeps the shown contact until a partial carries it", () => {
    const ui = owner();
    ui.post({ id: 12, progress: 0.1, partial: running([near]) });
    ui.post({ id: 12, progress: 0.2, first: { ...near, touches: true } });
    // the pool's merged partial from a shard's older word: the near miss again
    ui.post({ id: 12, progress: 0.25, partial: running([near], 0.25) });
    expect(words(ui.shown()).text, "never back to a near miss").toBe("1 collision");
    expect(ui.shown().truncated).toEqual({ covered: 0.25, reason: "running" });
    // a newer word carries it: the partial as it is from then on
    ui.post({ id: 12, progress: 0.3, partial: running([{ ...near, touches: true }, hit(9, 0, { b: "column" })], 0.3) });
    expect(words(ui.shown()).text).toBe("2 collisions");
  });
  it("VP-I92 (R137): the shown partial keeps the held contact after an older partial (the code marks read the contact tables since round B3)", () => {
    const ui = owner();
    ui.post({ id: 12, progress: 0.1, partial: running([near]) });
    ui.post({ id: 12, progress: 0.2, first: { ...near, touches: true } });
    // the pool's merged partial with a shard not heard from yet: no record of the contact at all
    ui.post({ id: 12, progress: 0.25, partial: running([], 0.25) });
    expect(words(ui.shown()).text).toBe("1 collision");
    expect(ui.emitted.at(-1)?.[0], "the code panel told").toBe("collision-lines");
    expect(ui.shown().hits.some((h: CollisionHit) => h.touches)).toBe(true);
  });
  it("VP-I92 (R137): held for the whole request — a fall back to this core starts again after a partial carried it", () => {
    const ui = owner();
    ui.post({ id: 12, progress: 0.1, partial: running([near]) });
    ui.post({ id: 12, progress: 0.2, first: { ...near, touches: true } });
    // a pooled partial carries it ...
    ui.post({ id: 12, progress: 0.3, partial: running([{ ...near, touches: true, cumEnd: 30 }], 0.3) });
    expect(ui.shown().hits[0].cumEnd, "a partial that holds it keeps its own, newer record").toBe(30);
    // ... the pool fails, the sweep starts again here: its partial has the near miss only
    ui.post({ id: 12, progress: 0.05, partial: running([near], 0.05) });
    expect(words(ui.shown()).text, "never back to a near miss").toBe("1 collision");
  });
  it("a bodies retry is the same request: its first contact stays held under the new id", () => {
    const ui = owner();
    ui.post({ id: 12, progress: 0.1, partial: running([near]) });
    ui.post({ id: 12, progress: 0.2, first: { ...near, touches: true } });
    ui.post({ id: 12, needBodies: true });
    ui.post({ id: 13, progress: 0.05, partial: running([near], 0.05) });
    expect(words(ui.shown()).text).toBe("1 collision");
  });
  it("the first stays with its request: a new request's partials are its own", () => {
    const ui = owner();
    ui.post({ id: 12, progress: 0.2, first: hit(7, 0) });
    ui.nextRequest();
    ui.post({ id: 13, progress: 0.1, partial: running([]) });
    expect(ui.shown().hits).toEqual([]);
  });
  it("a partial that already holds the contact keeps its own, newer record — the first's older copy does not replace it", () => {
    const ui = owner();
    const newer = hit(7, 0, { cumEnd: 30 });
    ui.post({ id: 12, progress: 0.3, partial: running([newer], 0.3) });
    const before = ui.emitted.length;
    ui.post({ id: 12, progress: 0.2, first: hit(7, 0, { cumEnd: 7 }) });
    expect(ui.shown().hits).toEqual([newer]);
    expect(ui.emitted.length, "nothing redrawn").toBe(before);
  });
  it("positive controls: another onset's near miss stays beside it; progress and a stale request's partial change nothing", () => {
    const ui = owner();
    ui.post({ id: 12, progress: 0.1, partial: running([hit(9, 1.5, { b: "table" })]) });
    ui.post({ id: 12, progress: 0.2, first: hit(7, 0) });
    ui.post({ id: 12, progress: 0.3 });
    ui.post({ id: 11, progress: 0.4, partial: running([]) });
    expect(words(ui.shown()).text).toBe("1 collision · 1 near miss");
    expect(ui.shown().hits.map((h: CollisionHit) => h.line)).toEqual([7, 9]);
  });
  it("a partial of another track is not built upon (the request's track is new — another program)", () => {
    const ui = owner();
    ui.post({ id: 12, progress: 0.1, partial: running([hit(9, 1.5, { b: "table" })]) });
    ui.newTrack();
    ui.post({ id: 12, progress: 0.2, first: hit(4, 0) });
    expect(ui.shown().hits.map((h: CollisionHit) => h.line)).toEqual([4]);
  });
  it("with nothing on screen: a running partial of the contact alone, at the progress it came with", () => {
    const ui = owner();
    ui.post({ id: 12, progress: 0.15, first: hit(7, 0) });
    expect(ui.shown()).toMatchObject({ hits: [hit(7, 0)], truncated: { covered: 0.15, reason: "running" } });
  });
});

// The pooled sequence of Codex's R136 probe through the REAL coordinator and
// the viewer's handler: shard A's near miss, shard B's partial held by the
// cadence, A's first after it — the merged partial that follows must not
// take the contact back.
describe("the pool's whole message sequence into the viewer (Codex R136 VP-I92)", () => {
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("a known contact never reverts to a near miss", async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const sent: Record<string, any>[] = [], workers: { onmessage: ((e: { data: unknown }) => void) | null }[] = [];
    class FakeWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: unknown = null;
      constructor() { workers.push(this); }
      postMessage() {}
      terminate() {}
    }
    const scope = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage: (m: Record<string, any>) => sent.push(structuredClone(m)),
      navigator: { hardwareConcurrency: 4 }, location: { href: "https://test.invalid/collisionWorker.js" } };
    vi.stubGlobal("self", scope);
    vi.stubGlobal("Worker", FakeWorker);
    await import("./collisionWorker");
    const machine = { groups: [{ id: "fixed", parent: "root" }, { id: "moving", parent: "root" }],
      kinematics: [{ group: "moving", joint: 0, type: "translate", direction: "x", sign: 1 }],
      workGroup: "fixed", toolGroup: "moving", unitScale: 1, axes: ["X", "Y", "Z"] };
    const tri = () => new Float32Array([0, 0, 0, 0, 10, 0, 0, 0, 10]);
    scope.onmessage!({ data: { id: 12, side: false, modelKey: "simple", machine, tool: null, maxShards: 2,
      bodies: [{ id: "fixed", group: "fixed", positions: tri() }, { id: "moving", group: "moving", positions: tri() }],
      track: { pos: new Float32Array([10, 0, 0, 20, 0, 0]), abc: new Float32Array(6), cum: new Float32Array([0, 10]),
               rapid: new Uint8Array([1, 1]), lines: new Uint32Array([1, 2]), count: 2 },
      wcs: { g5x: [], g92: [], rotationDeg: 0 }, options: { margin: 2 } } });
    const emitFrom = (k: number, data: unknown) => workers[k]!.onmessage!({ data: structuredClone(data) });
    const near = hit(7, 1.5);
    emitFrom(0, { id: 12, progress: 0.1, partial: running([near]) });
    await vi.advanceTimersByTimeAsync(100);
    emitFrom(1, { id: 12, progress: 0.1, partial: running([]) });
    await vi.advanceTimersByTimeAsync(500);
    emitFrom(0, { id: 12, progress: 0.2, first: { ...near, touches: true } });
    // the coordinator does send a merged partial without it after the first
    expect(sent.findIndex(m => m.first)).toBeGreaterThanOrEqual(0);
    const ui = owner();
    const seen: string[] = [];
    let collided = false;
    for (const m of sent) {
      ui.post(m);
      const w = words(ui.shown());
      seen.push(w.text);
      if (w.collisions) collided = true;
      else if (collided) throw new Error(`a known contact went back: ${seen.join(" → ")}`);
    }
    expect(collided).toBe(true);
    expect(words(ui.shown()).collisions).toBe(1);
  });
});

// The side sweep's first confirmed contact (Codex R136 VP-I93): the entry
// move — the start-dependent beginning with it — shows its contact before
// its result, said still checking; its end ends it.
describe("the side sweep's first contact on the entry track (Codex R136 VP-I93)", () => {
  const BASE = { cum: new Float64Array([0, 10, 20]), count: 3 };
  const ENTRY = { cum: new Float64Array([0, 5, 15, 25]), count: 4 };
  const side = () => viewerFns(["_colOnSideMessage", "_colBaseFor", "_colWithRunSide", "collisionEntryResult"], `
    const computed = (f) => ({ get value() { return f(); } });
    let _colSide = { id: -1, entry: ENTRY, base: BASE, slice: ENTRY, shift: 5, retried: false, startedAt: 0 }, _colModelSent = null;
    const collisionEntry = { value: null }, collisionSideFirst = { value: null }, collisionRun = { value: null };
    const collisionRunSide = { value: null }, collisionRunSideState = { value: null };
    const collisionResult = { value: BASE_RESULT }, collisionTrack = { value: BASE };
    const collisionPartial = { value: null }, collisionPartialTrack = { value: null };
    const emitTelemetry = () => {}, _colRetint = () => {}, _colPostSide = () => {}, _colRunSideFailed = () => {}, _colEmitMarks = () => {};
    let _colSideProgress = 0;
    const _contactsBump = () => {}, _sliceEnd = (t) => t.count ? t.cum[t.count - 1] : 0;
    const _colRunLog = [];
    const post = (data) => _colOnSideMessage({ id: -1, ...data });
    const entryShown = () => collisionEntryResult.value;`,
    { mergeEntryResult, mergeBeginningOntoBase, firstOnly, ENTRY, BASE, BASE_RESULT: result([]), console: { error: () => {} } },
    ["post", "entryShown"]);
  it("shows the contact while the side sweep runs, said still checking; the result takes over", () => {
    const f = side();
    expect(f.entryShown(), "nothing yet").toBeNull();
    f.post({ progress: 0.1, first: hit(0, 0, { cum: 2, cumEnd: 2 }) });
    const shown = f.entryShown()!;
    expect(shown.checking).toBe(true);
    expect(shown.result.hits.some((h: CollisionHit) => h.entry && h.dist === 0)).toBe(true);
    f.post({ result: result([hit(0, 0, { cum: 2, cumEnd: 3 })]) });
    expect(f.entryShown()!.checking).toBeUndefined();
    expect(f.entryShown()!.result.hits.some((h: CollisionHit) => h.entry)).toBe(true);
  });
  it("a side sweep that ends without a result takes its contact with it", () => {
    const f = side();
    f.post({ progress: 0.1, first: hit(0, 0, { cum: 2, cumEnd: 2 }) });
    f.post({ error: "boom" });
    expect(f.entryShown()).toBeNull();
  });
});

describe("the earlier preview's verdict in words (step 4 plan 1a, _colPreviousOf)", () => {
  // the shown result's contact view (round B3): one contact, one near miss
  const st = new ContactStore(1, 0);
  st.episodes.append({ pair: 0, ordinal: 0, onset: 7, end: 8, closeAt: 7, closeDist: 0, firstIv: 0, ivCount: 1 });
  st.intervals.append({ episode: 0, enter: 7, exit: 8, flags: 0, next: NONE, witness: 7, freeAt: NaN });
  st.episodes.append({ pair: 1, ordinal: 0, onset: 9, end: 9.5, closeAt: 9.2, closeDist: 1.5, firstIv: NONE, ivCount: 0 });
  const VIEW = { view: buildContactView({ sources: [{ stores: [st], at: c => c }], pairName: p => ({ a: "spindle_nose", b: `part_${p}` }), coverage: 20 }),
                 lineAt: (pos: number) => Math.floor(pos) };
  const fns = (view: unknown) => viewerFns(["_colPreviousOf"], "const collisionTrack = { value: {} };",
    { clashTargets, findingWords, targetAt, contactViewFor: () => view, console: { warn: () => {} } });
  it("its words are the summary's, from the shown contact view: kinds apart, a near miss never a collision", () => {
    expect(fns(VIEW)._colPreviousOf(result([]), 12)).toEqual(
      { collisions: 2, text: "1 collision · 1 near miss", complete: true, version: 12 });
    expect(fns(VIEW)._colPreviousOf(result([], { truncated: { covered: 0.5, reason: "time" } }), null))
      .toMatchObject({ complete: false, version: null });
  });
  it("without the tables (gone with their request): from the records, said in the console", () => {
    expect(fns(null)._colPreviousOf(result([hit(7, 0), hit(9, 1.5)]), 12)).toEqual(
      { collisions: 2, text: "1 collision · 1 near miss", complete: true, version: 12 });
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
