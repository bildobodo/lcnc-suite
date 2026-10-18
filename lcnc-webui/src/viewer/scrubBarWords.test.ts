// The collision check's summary line and its "?" (step 4 plan, package 1a /
// 1d): ScrubBar.vue's own computed bodies, executed as written with their
// inputs — the bar's decision, no copy (the method of startDepPayloads.test).
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { wordsOfCounts, type FindingCounts } from "./sweepWords";
import { clashIndexOfList, clashTicks } from "./simWindow";
import { isNearMiss, type ClashTarget } from "./clashTargets";
import { partLabel } from "./simRows";
import { beginSentence, depTimeSentence } from "./startDep";
import type { CollisionResult } from "./collision";

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

/** The counts the view's index gives for these targets (contactView.viewCounts'
 *  kinds: a possible contact, a near miss, the entry move's collision, a start). */
const countsOf = (ts: ClashTarget[]): FindingCounts => {
  const c: FindingCounts = { collisions: 0, entryCollisions: 0, nearMisses: 0, possible: 0, startsIn: false };
  for (const t of ts) {
    if (t.possible) { c.possible++; continue; }
    if (isNearMiss(t)) { c.nearMisses++; continue; }
    if (t.entryMove) c.entryCollisions++; else c.collisions++;
    if (t.atStart && !t.entry) c.startsIn = true;
  }
  return c;
};
/** The bar's collision inputs from a list of targets (plan 4.4): the index,
 *  the counts and the start pairs — the bar's own filter, on that list. */
const clashRefs = (ts: ClashTarget[]) => ({
  clashIndex: { value: clashIndexOfList(ts) }, clashCounts: { value: countsOf(ts) }, clashTicks, bandCols: { value: 1000 }, shownView: { value: null },
  startPairNames: { value: barComputed("startPairNames", { shownView: { value: { view: ts, lineAt: null } },
    startTargets: (l: ClashTarget[]) => l.flatMap((t, i) => (t.atStart ? [i] : [])), targetAt: (l: ClashTarget[], i: number) => l[i],
    isNearMiss, partLabel }) },
});

const pctOf = (x: number) => `${Math.round(x * 100)} %`;
const result = (over: Partial<CollisionResult> = {}): CollisionResult => ({
  staticContacts: [], samples: 10, coarsened: false, uncertified: null, pairCount: 5,
  pairsPrescreened: 0, bvhMs: 0, sweepMs: 0, truncated: null, ...over });
/** A target as the contact view gives it (step 4 package 2): a near miss by
 *  the sweep's class (`near`), a touch interval otherwise. */
const tgt = (line: number, dist: number, over: Partial<ClashTarget> = {}): ClashTarget =>
  ({ line, cum: line, cumEnd: line, key: `C${line}|0|0`, a: "spindle_nose", b: `part_${line}`, dist, rapid: false, near: dist > 1e-3, ...over });
const view = (r: CollisionResult, targets: ClashTarget[] = [], o: { busy?: boolean; frac?: number; caveat?: string; entryChecking?: boolean } = {}) => barComputed("sweepView", {
  shownResult: { value: r },
  props: { collisionBusy: !!o.busy, collisionRunCheck: null, collisionStopped: null, collisionResumable: false, collisionProgress: 0,
           collisionEntryResult: o.entryChecking ? { checking: true, result: r } : null },
  ...clashRefs(targets), sweepToolSentence: { value: "" }, verdictDetail: { value: "" },
  sweepCaveat: { value: o.caveat ?? null }, boundaryDetail: { value: "" }, sweptFrac: { value: o.frac ?? 1 }, pctOf, wordsOfCounts,
}) as { verdict: string; tone: string; result: string; coverage: string; coverageShort: string; short: string; state: string };
const detail = (r: CollisionResult, targets: ClashTarget[] = []) => barComputed("verdictDetail", {
  shownResult: { value: r }, props: { collisionBusy: false, collisionRunCheck: null, collisionStopped: null, collisionResumable: false },
  track: { value: null }, provisionalOnScreen: { value: false }, stoppedTitle: { value: "" }, ...clashRefs(targets),
  sweepCaveat: { value: null }, pctOf, beginSentence, depTimeSentence, partLabel, isNearMiss }) as string;

describe("the summary line: result · coverage · caveat (step 4 plan 1a)", () => {
  it("'Clear' only for a check that has ended — never while it runs", () => {
    expect(view(result()).verdict).toBe("Clear · checked in full");
    expect(view(result(), [], { busy: true, frac: 0.4 }).verdict).toBe("No contact so far · 40 % checked");
    expect(view(result(), [tgt(7, 0)], { busy: true, frac: 0.4 }).verdict).toBe("1 collision so far · 40 % checked");
    expect(view(result(), [], { caveat: "a body was left out" }).verdict).toBe("Clear · checked to the end");
  });

  it("each kind in its words: a near miss is never a collision; a stay that touches is one, whatever its margin entry's distance", () => {
    const v = view(result(), [tgt(7, 0), tgt(9, 1.5)]);
    expect(v.verdict).toBe("1 collision · 1 near miss · checked in full");
    expect(v.tone).toBe("danger");
    const near = view(result(), [tgt(9, 1.5)]);
    expect(near.verdict).toBe("1 near miss · checked in full");
    expect(near.tone, "a near miss alone warns").toBe("warn");
    expect(view(result(), [tgt(9, 1.5, { near: false })]).verdict).toBe("1 collision · checked in full");
    expect(view(result(), [tgt(9, 0, { possible: true })]).verdict).toBe("1 possible contact · checked in full");
  });

  it("a start in contact is said where it is proven (atStart), never for a near miss at the start", () => {
    expect(view(result(), [tgt(1, 0, { atStart: true })]).verdict).toBe("1 collision · starts in contact · checked in full");
    expect(detail(result(), [tgt(1, 0, { atStart: true })])).toContain("The program starts in contact: Spindle nose ↔ Part 1.");
    expect(view(result(), [tgt(1, 1.5, { atStart: true })]).verdict).toBe("1 near miss · checked in full");
    expect(detail(result(), [tgt(1, 1.5, { atStart: true })])).not.toContain("starts in contact");
  });

  it("the parts apart (Codex R136 VP-I94): the result, the coverage, the result as a count", () => {
    const v = view(result(), [tgt(7, 0), tgt(9, 1.5)]);
    expect([v.result, v.coverage, v.short]).toEqual(["1 collision · 1 near miss", "checked in full", "2"]);
    expect(v.verdict).toBe(`${v.result} · ${v.coverage}`);
    expect(view(result(), [tgt(7, 0)], { busy: true, frac: 0.4 }).short, "while it runs").toBe("1…");
    const clear = view(result());
    expect([clear.result, clear.coverage, clear.short]).toEqual(["Clear", "checked in full", "Clear"]);
    // the fewest words (Codex R137 VP-I94): the state kept, the caveat's words left to the count's "+"
    expect(v.coverageShort).toBe("in full");
    expect(view(result(), [tgt(7, 0)], { busy: true, frac: 0.4 }).coverageShort).toBe("40 %");
    expect(view(result({ truncated: { covered: 0.6, reason: "samples" } }), [tgt(7, 0)]).coverageShort).toBe("stopped 60 %");
    expect(view(result(), [tgt(1, 0, { entry: true, entryMove: true })], { entryChecking: true }).coverageShort).toBe("entry checking");
    expect(view(result(), [], { caveat: "x" }).coverageShort).toBe("to the end");
  });

  it("the entry move's side sweep runs on after its first contact: shown, said still checking (Codex R136 VP-I93)", () => {
    const entry = [tgt(1, 0, { entry: true, entryMove: true })];
    const v = view(result(), entry, { entryChecking: true });
    expect([v.state, v.verdict]).toEqual(["checking", "1 collision on the entry move so far · entry move still checking"]);
    expect(view(result(), entry).verdict, "its result: done").toBe("1 collision on the entry move · checked in full");
  });

  it("a timeline mark is a near miss only where nothing touched — a stay that touched is a collision's", () => {
    const targets = [tgt(10, 0), tgt(40, 1.5), tgt(70, 1.5, { near: false })];
    const marks = barComputed("marks", { cumMax: { value: 100 }, toolTargets: { value: [] }, violationTargets: { value: [] }, isNearMiss,
      ...clashRefs(targets) }) as Array<{ pct: number; near: boolean }>;
    expect(marks.map(m => [m.pct, m.near])).toEqual([[10, false], [40, true], [70, false]]);
    // a target from the contact view says it itself, by the sweep's class (plan 4.1)
    const fromView = barComputed("marks", { cumMax: { value: 100 }, toolTargets: { value: [] }, violationTargets: { value: [] }, isNearMiss,
      ...clashRefs([{ cum: 20, cumEnd: 20, key: "C1|0|n", line: 3, a: "t", b: "w", dist: 5e-4, near: true },
                            { cum: 30, cumEnd: 31, key: "C2|0|0", line: 4, a: "t", b: "w", dist: 0, near: false }]) }) as Array<{ pct: number; near: boolean }>;
    expect(fromView.map(m => [m.pct, m.near]), "a stay at 0.5 µm without a touch is a near miss").toEqual([[20, true], [30, false]]);
  });

  it("the tools the \"?\" names are the check's — not the live tool a run's own M6 changed (step 4 plan 1c)", () => {
    const tools = (collisionContext: unknown, sweepTool: unknown) => barComputed("sweepToolSentence",
      { props: { collisionContext, sweepTool } }) as string;
    const basis = (toolNum: number, toolDiam: number) => ({ toolNum, toolDiam });
    const live = { num: 5, diam: 12, programTools: null };
    expect(tools({ basis: basis(3, 6), programTools: [] }, live)).toBe("Checked with the loaded T3 Ø6.0 throughout.");
    expect(tools({ basis: basis(0, 0), programTools: [] }, live)).toBe("No tool loaded: checked with a 6 mm stub.");
    expect(tools({ basis: basis(3, 6), programTools: [{ num: 1, len: 50, diam: 6, assumed: false, unknown: false },
      { num: 9, len: null, diam: null, assumed: false, unknown: true }] }, live)).toBe("Checked with the program's tools T1 Ø6.0.");
    // no check context: the live tool, as before
    expect(tools(null, live)).toBe("Checked with the loaded T5 Ø12.0 throughout.");
  });

  it("the pairs in contact at rest are excluded, counted in the \"?\"", () => {
    const r = result({ staticContacts: [{ a: "x_slide", b: "y_saddle", dist: 0 }, { a: "column", b: "base", dist: 1 }] });
    expect(detail(r)).toContain("2 pairs already in contact at rest — excluded.");
  });
});
