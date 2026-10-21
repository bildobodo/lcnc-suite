// The viewer's own wiring, run as written: a running sweep's metadata and
// its first touch interval through the worker handler (step 4 package 2,
// C2 — package 1's first-contact message is gone), the earlier preview's
// verdict in words (_colPreviousOf, 1a), the card's context taken at the
// request (_colContextFor, 1c). The functions come unchanged out of
// ThreeViewer.vue (the method of startDepPayloads.test's coordinator); only
// the refs around them are given.
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { CollisionResult } from "./collision";
import { wordsOfCounts } from "./sweepWords";
import { mergeBeginningOntoBase, mergeEntryResult } from "./sweepMerge";
import { captureCheckContext } from "./checkContext";
import { semanticKinsMode } from "./kins";
import { basisFromLive, type CheckBasis } from "./checkBasis";
import { ContactStore, NONE, type StoreDelta } from "./contactStore";
import { buildContactView, contactBands, lineMark, targetAt, tintAt, trackLineAt, viewCounts } from "./contactView";
import { shownContactView } from "./shownContacts";
import { ContactPublisher, contactOwners, type GenerationTables } from "./contactPublisher";

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

const result = (over: Partial<CollisionResult> = {}): CollisionResult => ({
  staticContacts: [], samples: 10, coarsened: false, uncertified: null, pairCount: 5,
  pairsPrescreened: 0, bvhMs: 0, sweepMs: 0, truncated: null, ...over });

/** The viewer's own worker handler (_colGetWorker's onmessage) and what it
 *  calls, as written, over the refs they read: `post` hands the handler a
 *  worker message; the publisher holds the request's tables (plan 3.6). */
function owner() {
  return viewerFns(["_colGetWorker", "_colOnMessage", "_colKick", "_colEmitMarks", "_intervalRows"], `
    let _colWorker = null, _colModelSent = null, _colSide = null, _colReqId = 12, _colKeepShown = false;
    let _colPartialReq = null;
    const contactViewFor = () => null, _lineRunsOf = () => null, colShown = { value: null };
    // the publisher as the viewer has it (plan 3.6): a request's messages are
    // taken in a pass and published with what is shown; the code panel's
    // marks follow the publication (the viewer's contactsVersion watcher). On
    // a clock that stands every pass is one slice, run at once.
    const CONTACTS_VIEW_MS = 500, _contactsLog = { messages: 0, acks: 0, maxDeltaRows: 0 };
    let _contactsTimer, publications = 0;
    const _contacts = new ContactPublisher({ tracks: () => [], specOf: () => null, *build() { return null; }, effect: m => _colOnMessage(m),
      stage: () => ({ result: null, track: null, partial: collisionPartial.value, partialTrack: collisionPartialTrack.value }),
      publish: s => { colShown.value = s; publications++; _colEmitMarks(); }, ack: () => {},
      owners: () => new Set([_colReqId, ...(_colSide ? [_colSide.id] : [])]), now: () => 0, schedule: f => f() });
    // passes that took their time: a kick that is not urgent waits for its timer
    const slow = () => { _contacts.lastPassMs = 50; };
    // a side run in flight, its handler a stub that notes what reaches it
    const sideCalls = [], _colOnSideMessage = m => sideCalls.push(m), setSide = id => { _colSide = { id }; };
    const TRACK = {};
    let _colPendingTrack = TRACK;
    const collisionPartial = { value: null }, collisionPartialTrack = { value: null }, collisionProgress = { value: 0 };
    const emitted = [], emit = (e, x) => emitted.push([e, x]), _colRetint = () => {};
    let _colNeedBodiesRetried = false, _colPendingRun = undefined;
    const collisionBusy = { value: true }, emitTelemetry = () => {}, _colFail = () => {};
    const runCollisionCheck = () => { _colReqId++; };
    class Worker { postMessage() {} }
    const posted = [];
    const post = (data) => { posted.push(data); _colGetWorker().onmessage({ data }); };
    const shown = () => collisionPartial.value;
    const keepShown = (on) => { _colKeepShown = on; };
    const pubs = () => publications;`,
    { ContactPublisher }, ["post", "posted", "shown", "keepShown", "pubs", "emitted", "slow", "sideCalls", "setSide"]);
}
/** Request `id`'s sweep side (generation 0): `add` appends a stay of pair 0
 *  — with a touch interval or a near miss — and gives its delta. */
function sweepSide(id: number) {
  const st = new ContactStore(id, 0);
  return { add(touch: boolean): StoreDelta {
    const e = st.episodes.rows;
    const ep = st.episodes.append({ pair: 0, ordinal: e, flags: 0, onset: e, end: e + 0.5, closeAt: e, closeDist: touch ? 0 : 1, firstIv: NONE, ivCount: touch ? 1 : 0 });
    if (touch) st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: e, exit: e + 0.5, flags: 0, next: NONE, witness: e, freeAt: NaN }));
    const d = st.takeDelta(true)!;
    st.ack();
    return d;
  } };
}

describe("a running sweep's metadata and first touch through the viewer's worker handler (step 4 package 2, C2)", () => {
  it("the metadata partial is the request's shown partial at its progress — never another request's, never over a kept provisional result", () => {
    const ui = owner();
    ui.post({ id: 12, progress: 0.1, partial: result({ truncated: { covered: 0.1, reason: "running" }, notes: ["n"], uncertified: "n" }) });
    expect(ui.shown()).toMatchObject({ notes: ["n"], truncated: { covered: 0.1, reason: "running" } });
    expect("hits" in ui.shown(), "no records").toBe(false);
    ui.post({ id: 11, progress: 0.2, partial: result({ notes: ["stale"] }) });
    expect(ui.shown().notes, "a superseded request's partial changes nothing").toEqual(["n"]);
    ui.keepShown(true);
    ui.post({ id: 12, progress: 0.3, partial: result({ notes: ["later"] }) });
    expect(ui.shown().notes, "a provisional result kept on screen").toEqual(["n"]);
  });
  it("the delta that brings the request's first touch interval is marked and published at once; a near miss's delta before it is not marked", () => {
    const ui = owner();
    ui.post({ id: 12, progress: 0.1, partial: result() });
    const sw = sweepSide(12);
    ui.post({ id: 12, contacts: [sw.add(false)], contactPairs: [["tool", "part"]] });
    expect(ui.posted.at(-1)!.firstTouch, "a near miss is no touch").toBeUndefined();
    const before = ui.pubs();
    ui.slow();   // a delta that is not the first touch would wait for the publication's timer
    ui.post({ id: 12, contacts: [sw.add(true)] });
    expect(ui.posted.at(-1)!.firstTouch, "the first touch interval").toBe(true);
    expect(ui.pubs(), "published at once").toBeGreaterThan(before);
    // its tables are the request's: the next touch of the request is no first touch
    ui.post({ id: 12, contacts: [sw.add(true)] });
    expect(ui.posted.at(-1)!.firstTouch).toBeUndefined();
    expect(ui.shown(), "a delta alone leaves the metadata partial as it was").toMatchObject({ pairCount: 5 });
  });
});

describe("a side run's first touch through the viewer's worker handler (C2)", () => {
  it("its first touch interval, a delta alone, reaches the side's handler; a near miss's delta alone does not", () => {
    const ui = owner();
    ui.setSide(-1);
    const sw = sweepSide(-1);
    ui.post({ id: -1, contacts: [sw.add(false)], contactPairs: [["tool", "part"]] });
    expect(ui.sideCalls.length, "a near miss: nothing for the side's handler").toBe(0);
    ui.post({ id: -1, contacts: [sw.add(true)] });
    expect(ui.sideCalls.map((m: { firstTouch?: boolean }) => !!m.firstTouch), "its first touch").toEqual([true]);
    ui.post({ id: -1, contacts: [sw.add(true)] });
    expect(ui.sideCalls.length, "a later touch, a delta alone: nothing more").toBe(1);
  });
});

// The side sweep's contact (Codex R136 VP-I93): the entry move — the
// start-dependent beginning with it — shows its contact before its result,
// from its tables, said still checking; its end ends it. The trigger is the
// side run's first touch interval (C2), never its start.
describe("the side sweep's contact on the entry track (Codex R136 VP-I93)", () => {
  const BASE = { cum: new Float64Array([0, 10, 20]), count: 3 };
  const ENTRY = { cum: new Float64Array([0, 5, 15, 25]), count: 4 };
  const side = () => viewerFns(["_colOnSideMessage", "_colBaseFor", "_colWithRunSide", "collisionEntryResult", "SIDE_RUNNING"], `
    const computed = (f) => ({ get value() { return f(); } });
    let _colSide = { id: -1, entry: ENTRY, base: BASE, slice: ENTRY, shift: 5, retried: false, startedAt: 0 }, _colModelSent = null;
    const collisionEntry = { value: null }, collisionSideFirst = { value: null }, collisionRun = { value: null };
    const collisionRunSide = { value: null }, collisionRunSideState = { value: null };
    const collisionResult = { value: BASE_RESULT }, collisionTrack = { value: BASE };
    const collisionPartial = { value: null }, collisionPartialTrack = { value: null };
    const emitTelemetry = () => {}, _colRetint = () => {}, _colPostSide = () => {}, _colRunSideFailed = () => {}, _colEmitMarks = () => {};
    const _intervalRows = () => 1;
    let _colSideProgress = 0;
    const _sliceEnd = (t) => t.count ? t.cum[t.count - 1] : 0;
    const _colRunLog = [];
    const post = (data) => _colOnSideMessage({ id: -1, ...data });
    const entryShown = () => collisionEntryResult.value;`,
    { mergeEntryResult, mergeBeginningOntoBase, ENTRY, BASE, BASE_RESULT: result(), console: { error: () => {} } },
    ["post", "entryShown"]);
  it("nothing at its start; shown from its first touch while it runs, said still checking; the result takes over", () => {
    const f = side();
    f.post({ progress: 0.1 });
    expect(f.entryShown(), "a side run's start shows nothing").toBeNull();
    f.post({ contacts: [], firstTouch: true });
    const shown = f.entryShown()!;
    expect(shown.checking).toBe(true);
    expect(shown.track).toBe(ENTRY);
    f.post({ result: result({ samples: 3 }) });
    expect(f.entryShown()!.checking).toBeUndefined();
    expect(f.entryShown()!.result.samples, "the entry's and the base's").toBe(13);
  });
  it("a side sweep that ends without a result takes its contact with it", () => {
    const f = side();
    f.post({ contacts: [], firstTouch: true });
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
  const warned: string[] = [];
  const fns = (view: unknown) => viewerFns(["_colPreviousOf"], "const collisionTrack = { value: {} };",
    { wordsOfCounts, viewCounts, contactViewFor: () => view, console: { warn: (m: string) => warned.push(m) } });
  it("its words are the summary's, from the shown contact view: kinds apart, a near miss never a collision", () => {
    expect(fns(VIEW)._colPreviousOf(result(), 12)).toEqual(
      { collisions: 2, text: "1 collision · 1 near miss", complete: true, version: 12 });
    expect(fns(VIEW)._colPreviousOf(result({ truncated: { covered: 0.5, reason: "time" } }), null))
      .toMatchObject({ complete: false, version: null });
  });
  it("without its view (its tables gone with their request): nothing named — said in the console, never guessed", () => {
    expect(fns(null)._colPreviousOf(result(), 12)).toBeNull();
    expect(warned.at(-1)).toMatch(/not named/);
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

// Codex R148 VP-I106 rest: a request cancelled with no result shown lets its
// tables and its waiting deltas go at once — not with a later message. The
// viewer's own cancelCollisionCheck, owner set and release, as written.
describe("a cancel releases what no one shows (Codex R148 VP-I106)", () => {
  const harness = () => viewerFns(["cancelCollisionCheck", "_colReleaseContacts", "_colContactOwners", "_colKick"], `
    let _colWorker = { postMessage() {} }, _colReqId = 7, _colSide = null, _colStopPending = false, _colSettleTimer, _colStartedAt = 0;
    let _colResultReq = null;
    const collisionBusy = { value: true }, collisionResumable = { value: false }, collisionProgress = { value: 0.3 };
    const collisionPartial = { value: null }, collisionStopped = { value: null }, collisionResult = { value: null };
    const collisionEntry = { value: null }, collisionRunSide = { value: null }, collisionSideFirst = { value: null };
    const emitTelemetry = () => {};
    const CONTACTS_VIEW_MS = 500, acks = [];
    let _contactsTimer;
    // the publisher as the viewer has it, its owners the viewer's; a pass runs at once
    const _contacts = new ContactPublisher({ tracks: () => [], specOf: () => null, *build() { return null; }, effect: () => {}, stage: () => ({}), publish: () => {},
      ack: a => acks.push(a), owners: () => _colContactOwners(), now: () => 0, schedule: f => f() });
    const show = (id) => { collisionResult.value = { hits: [] }; _colResultReq = id; };
    const reqId = () => _colReqId;`, { ContactPublisher, contactOwners }, ["_contacts", "acks", "show", "reqId"]);
  const sender = (id: number) => {
    const st = new ContactStore(id, 0);
    return () => { st.episodes.append({ pair: 0, ordinal: st.episodes.rows, onset: 1, end: 2, closeAt: 1, closeDist: 1, firstIv: NONE, ivCount: 0 });
                   const d = st.takeDelta()!; st.ack(); return d; };
  };
  it("a running request cancelled: its tables, its waiting deltas and their tickets go", () => {
    const f = harness(), next = sender(7);
    f._contacts.receive({ id: 7, contacts: [next()] });
    f._contacts.kick(true);
    expect([f._contacts.ids(), f.acks.length], "taken, caught up, acknowledged").toEqual([[7], 1]);
    f._contacts.receive({ id: 7, contacts: [next()] });   // waiting for the next pass
    f.cancelCollisionCheck();
    expect([f.reqId(), f._contacts.ids(), f._contacts.pending, f.acks.length], "its cancel went out: nothing acknowledged for it").toEqual([8, [], false, 1]);
  });
  it("a result still shown keeps its request's tables through the cancel", () => {
    const f = harness(), next = sender(7);
    f._contacts.receive({ id: 7, contacts: [next()] });
    f._contacts.kick(true);
    f.show(7);
    f.cancelCollisionCheck();
    expect(f._contacts.ids()).toEqual([7]);
    expect(f._contacts.tablesOf(7)!.pub!.stores[0]!.episodes.rows).toBe(1);
  });
});

// Plan 3.6: a pass's own effects never mark it again — while it takes and
// builds, its publication stages the state then; after it, a change of what
// the bar shows starts the next pass. The viewer's own rule, as written.
describe("what the bar shows changes outside a pass (plan 3.6, _colOnStageChange)", () => {
  const harness = (pub: { running: boolean; phase: number; shown: Record<string, unknown> | null }) => viewerFns(["_colOnStageChange", "_colKick"], `
    const CONTACTS_VIEW_MS = 500;
    let _contactsTimer;
    const log = [];
    const _contacts = { ...PUB, lastPassMs: 0, markDirty: () => log.push("dirty"), kick: () => log.push("kick") };`,
    { PUB: pub }, ["log"]);
  const A = { busy: true, progress: 0.2 }, B = { busy: true, progress: 0.3 };
  it("while a pass takes or builds: nothing — its publication stages the state then", () => {
    for (const phase of [1, 2]) {
      const f = harness({ running: true, phase, shown: A });
      f._colOnStageChange(B);
      expect(f.log, `phase ${phase}`).toEqual([]);
    }
  });
  it("after the publication (catching up) or between passes: a changed state starts the next pass; an unchanged one nothing", () => {
    for (const pub of [{ running: true, phase: 4 }, { running: false, phase: 0 }]) {
      const f = harness({ ...pub, shown: A });
      f._colOnStageChange(B);
      expect(f.log).toEqual(["dirty", "kick"]);
      const g = harness({ ...pub, shown: A });
      g._colOnStageChange({ ...A });
      expect(g.log, "every value the same").toEqual([]);
    }
    const first = harness({ running: false, phase: 0, shown: null });
    first._colOnStageChange(A);
    expect(first.log, "nothing published yet").toEqual(["dirty", "kick"]);
  });
});

/** The viewer's own spec selectors as written (Codex R149's probe): which
 *  tables a track shows, how far each is checked, and whether a side joins
 *  the base. `side` is the side run's own track; the run check's beginning
 *  folds onto `base` at 0 (shift = its own end). */
function specs(o: { run: boolean; done: boolean; progress: number }) {
  const base = { count: 2, cum: [0, 5], lines: [5, 5] };
  // own lines 21 (0..2), 22 (2..4), 23 (4..10); the base's line 5 after K at 10
  const side = { count: 5, cum: [0, 2, 4, 10, 15], lines: [21, 21, 22, 23, 5] };
  const result = { truncated: o.done && o.progress < 1 ? { covered: o.progress, reason: "budget" } : null };
  const f = viewerFns(["_sliceEnd", "_sideCovered", "_colBaseSpec", "_colRunSideSpec", "_colViewSpec"], `
    const collisionRun = { value: { gen: 1 } }, collisionRunSide = { value: null }, collisionSideFirst = { value: null }, collisionEntry = { value: null };
    const collisionResult = { value: { truncated: null } }, collisionTrack = { value: base };
    const collisionPartial = { value: null }, collisionPartialTrack = { value: null };
    let _colResultReq = 1, _colPartialReq = null, _colReqId = 1, _colSideProgress = o.progress;
    const _linesTrusted = () => true;
    const collisionProgress = { value: 1 };
    const _colRunSideBase = () => null;
    const shift = 10, sliceEnd = 10;
    if (o.run) {
      if (o.done) collisionRunSide.value = { id: -1, gen: 1, base, bound: side, result, shift, sliceEnd };
      else collisionSideFirst.value = { id: -1, run: { gen: 1 }, base, entry: side, shift, sliceEnd, first: {} };
    } else {
      if (o.done) collisionEntry.value = { id: -1, base, track: side, result, shift, sliceEnd };
      else collisionSideFirst.value = { id: -1, base, entry: side, shift, sliceEnd, first: {} };
    }`, { base, side, result, o });
  return { spec: f._colViewSpec(o.run ? base : side), base, side };
}
function tablesOf(id: number, ivs: Array<[number, number]>): GenerationTables {
  const st = new ContactStore(id, 0);
  ivs.forEach(([a, b], k) => {
    const e = st.episodes.append({ pair: 0, ordinal: k, onset: a, end: b, closeAt: a, closeDist: 0, firstIv: NONE, ivCount: 1, flags: 0 });
    st.episodes.set(e, "firstIv", st.intervals.append({ episode: e, enter: a, exit: b, witness: a, freeAt: NaN, next: NONE, flags: 0 }));
  });
  return { generation: 0, stores: [st], pairs: [["tool", "work"]], deltas: 1 };
}
/** The side's one contact, open from its own 1; the base's from `baseIvs`. */
function shown(o: { run: boolean; done: boolean; progress: number }, baseIvs: Array<[number, number]> = []) {
  const { spec, base, side } = specs(o);
  const T = new Map([[1, tablesOf(1, baseIvs)], [-1, tablesOf(-1, [[1, NaN]])]]);
  const v = shownContactView(id => T.get(id) ?? null, spec)!;
  const at = trackLineAt(o.run ? base : side);
  return { v, at, target: targetAt(v, 0, at), mark: (line: number, spans: Array<[number, number]> = []) => lineMark(v, line, spans, at) };
}

describe("how far a side is checked reaches the view (Codex R149 VP-I108, VP-I109)", () => {
  it("VP-I108: a run check's beginning folded onto 0 while it runs at 15 % — its own lines 22 and 23 are not checked yet: no mark, no reach", () => {
    const r = shown({ run: true, done: false, progress: 0.15 });
    expect(r.target.spanEndLine ?? r.target.line, "the contact is seen through its own 1.5, line 21").toBe(21);
    expect(r.mark(22), "own 2..4: not swept").toBeNull();
    expect(r.mark(23), "own 4..10: not swept").toBeNull();
    // its check stopped there (its budget): the same — the answer is no whole check
    const stopped = shown({ run: true, done: true, progress: 0.15 });
    expect(stopped.target.spanEndLine ?? stopped.target.line).toBe(21);
    expect([stopped.mark(22), stopped.mark(23)]).toEqual([null, null]);
    // the same beginning checked whole: its open contact reaches line 23
    const whole = shown({ run: true, done: true, progress: 1 });
    expect(whole.mark(23)).not.toBeNull();
  });

  it("VP-I109: a side stopped at 20 % (its budget) ends its open contact at its coverage — no tint, band or mark past it", () => {
    const r = shown({ run: false, done: true, progress: 0.2 });
    expect([...tintAt(r.v, 6)], "own 6 lies past the stop at 2").toEqual([]);
    expect(contactBands(r.v, 100, 10), "the band stops at the coverage").toEqual([[0.1, 0.2]]);
    expect(r.mark(23, [[4, 10]])).toBeNull();
    // running at 20 %: the same
    const running = shown({ run: false, done: false, progress: 0.2 });
    expect(contactBands(running.v, 100, 10)).toEqual([[0.1, 0.2]]);
  });

  it("VP-I109: a stopped side never joins the base — the rest up to the base is unchecked: two findings; a whole one joins: one", () => {
    expect(shown({ run: true, done: true, progress: 0.2 }, [[0, 3]]).v.n).toBe(2);
    expect(shown({ run: true, done: true, progress: 1 }, [[0, 3]]).v.n).toBe(1);
    // the simulation's entry move likewise
    expect(shown({ run: false, done: true, progress: 0.2 }, [[0, 3]]).v.n).toBe(2);
    expect(shown({ run: false, done: true, progress: 1 }, [[0, 3]]).v.n).toBe(1);
  });
});

describe("a running check's word is marked running, its result is not (operator 2026-10-20: an open near stay counted as a near miss while the check ran)", () => {
  const base = { count: 2, cum: [0, 5], lines: [5, 5] };
  const side = { count: 3, cum: [0, 2, 7], lines: [21, 21, 5] };
  const fns = (state: "result" | "partial" | "runBase" | "entryRunning" | "entryDone") => viewerFns(["_sliceEnd", "_sideCovered", "_colBaseSpec", "_colRunSideSpec", "_colViewSpec"], `
    const collisionRun = { value: null }, collisionRunSide = { value: null }, collisionSideFirst = { value: null }, collisionEntry = { value: null };
    const collisionResult = { value: state === "result" || state.startsWith("entry") ? { truncated: null } : null }, collisionTrack = { value: base };
    const collisionPartial = { value: state === "partial" ? { truncated: { covered: 0.3, reason: "running" } } : null }, collisionPartialTrack = { value: base };
    let _colResultReq = 1, _colPartialReq = 1, _colReqId = 1, _colSideProgress = 0.5;
    const _linesTrusted = () => true;
    const collisionProgress = { value: 0.3 };
    const _colRunSideBase = () => (state === "runBase" ? { trk: base } : null);
    if (state === "entryRunning") collisionSideFirst.value = { id: -1, base, entry: side, shift: 2, sliceEnd: 7, first: {} };
    if (state === "entryDone") collisionEntry.value = { id: -1, base, track: side, result: { truncated: null }, shift: 2, sliceEnd: 7 };`,
    { base, side, state });
  it("the base: a partial and a run check's beginning stand on a running word; the result is no running word", () => {
    expect(fns("partial")._colBaseSpec(base)).toMatchObject({ running: true });
    expect(fns("runBase")._colBaseSpec(base)).toMatchObject({ running: true });
    expect(fns("result")._colBaseSpec(base)?.running).toBeUndefined();
  });
  it("the entry move's side: running while its first touch is all there is, not once its result came", () => {
    expect(fns("entryRunning")._colViewSpec(side)?.side).toMatchObject({ running: true });
    expect(fns("entryDone")._colViewSpec(side)?.side?.running).toBeUndefined();
  });
});
