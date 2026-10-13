// The collision check's summary line and its "?" (step 4 plan, package 1a /
// 1d): ScrubBar.vue's own computed bodies, executed as written with their
// inputs — the bar's decision, no copy (the method of startDepPayloads.test).
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { findingWords } from "./sweepWords";
import { clashTargets, isNearMiss } from "./clashTargets";
import { partLabel } from "./simRows";
import { beginSentence, depTimeSentence } from "./startDep";
import type { CollisionHit, CollisionResult } from "./collision";

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

const pctOf = (x: number) => `${Math.round(x * 100)} %`;
const result = (over: Partial<CollisionResult> = {}): CollisionResult => ({
  hits: [], staticContacts: [], samples: 10, coarsened: false, uncertified: null, pairCount: 5,
  pairsPrescreened: 0, bvhMs: 0, sweepMs: 0, truncated: null, ...over });
const hit = (line: number, dist: number, over: Partial<CollisionHit> = {}): CollisionHit =>
  ({ line, cum: line, cumEnd: line, a: "spindle_nose", b: `part_${line}`, dist, rapid: false, ...over });
const view = (r: CollisionResult, o: { busy?: boolean; frac?: number; caveat?: string; entryChecking?: boolean } = {}) => barComputed("sweepView", {
  shownResult: { value: r },
  props: { collisionBusy: !!o.busy, collisionRunCheck: null, collisionStopped: null, collisionResumable: false, collisionProgress: 0,
           collisionEntryResult: o.entryChecking ? { checking: true, result: r } : null },
  hitTargets: { value: clashTargets(r.hits) }, sweepToolSentence: { value: "" }, verdictDetail: { value: "" },
  sweepCaveat: { value: o.caveat ?? null }, boundaryDetail: { value: "" }, sweptFrac: { value: o.frac ?? 1 }, pctOf, findingWords,
}) as { verdict: string; tone: string; result: string; coverage: string; coverageShort: string; short: string; state: string };
const detail = (r: CollisionResult) => barComputed("verdictDetail", {
  shownResult: { value: r }, props: { collisionBusy: false, collisionRunCheck: null, collisionStopped: null, collisionResumable: false },
  track: { value: null }, provisionalOnScreen: { value: false }, stoppedTitle: { value: "" }, hitTargets: { value: clashTargets(r.hits) },
  sweepCaveat: { value: null }, pctOf, beginSentence, depTimeSentence, partLabel, isNearMiss }) as string;

describe("the summary line: result · coverage · caveat (step 4 plan 1a)", () => {
  it("'Clear' only for a check that has ended — never while it runs", () => {
    expect(view(result()).verdict).toBe("Clear · checked in full");
    expect(view(result(), { busy: true, frac: 0.4 }).verdict).toBe("No contact so far · 40 % checked");
    expect(view(result({ hits: [hit(7, 0)] }), { busy: true, frac: 0.4 }).verdict).toBe("1 collision so far · 40 % checked");
    expect(view(result(), { caveat: "a body was left out" }).verdict).toBe("Clear · checked to the end");
  });

  it("each kind in its words: a near miss is never a collision; a margin entry that touches later is one", () => {
    const v = view(result({ hits: [hit(7, 0), hit(9, 1.5)] }));
    expect(v.verdict).toBe("1 collision · 1 near miss · checked in full");
    expect(v.tone).toBe("danger");
    const near = view(result({ hits: [hit(9, 1.5)] }));
    expect(near.verdict).toBe("1 near miss · checked in full");
    expect(near.tone, "a near miss alone warns").toBe("warn");
    expect(view(result({ hits: [hit(9, 1.5, { touches: true })] })).verdict).toBe("1 collision · checked in full");
    expect(view(result({ hits: [hit(9, 0, { possible: true })] })).verdict).toBe("1 possible contact · checked in full");
  });

  it("a start in contact is said where it is proven (atStart), never for a near miss at the start", () => {
    expect(view(result({ hits: [hit(1, 0, { atStart: true })] })).verdict).toBe("1 collision · starts in contact · checked in full");
    expect(detail(result({ hits: [hit(1, 0, { atStart: true })] }))).toContain("The program starts in contact: Spindle nose ↔ Part 1.");
    expect(view(result({ hits: [hit(1, 1.5, { atStart: true })] })).verdict).toBe("1 near miss · checked in full");
    expect(detail(result({ hits: [hit(1, 1.5, { atStart: true })] }))).not.toContain("starts in contact");
  });

  it("the record list's cap changes no word: the views read the contact tables, which hold every contact (step 4 package 2, round B3)", () => {
    for (const cut of [{ capped: 62 }, { capped: 9, cappedOnsets: 5 }]) {
      const r = result({ hits: [hit(7, 0)], ...cut });
      expect(view(r).verdict).toBe("1 collision · checked in full");
      expect([view(r).short, view(r).coverageShort]).toEqual(["1", "in full"]);
      expect(detail(r)).not.toMatch(/left out of the list|not listed|records cut/);
    }
  });

  it("the parts apart (Codex R136 VP-I94): the result, the coverage, the result as a count", () => {
    const v = view(result({ hits: [hit(7, 0), hit(9, 1.5)] }));
    expect([v.result, v.coverage, v.short]).toEqual(["1 collision · 1 near miss", "checked in full", "2"]);
    expect(v.verdict).toBe(`${v.result} · ${v.coverage}`);
    expect(view(result({ hits: [hit(7, 0)] }), { busy: true, frac: 0.4 }).short, "while it runs").toBe("1…");
    const clear = view(result());
    expect([clear.result, clear.coverage, clear.short]).toEqual(["Clear", "checked in full", "Clear"]);
    // the fewest words (Codex R137 VP-I94): the state kept, the caveat's words left to the count's "+"
    expect(v.coverageShort).toBe("in full");
    expect(view(result({ hits: [hit(7, 0)] }), { busy: true, frac: 0.4 }).coverageShort).toBe("40 %");
    expect(view(result({ hits: [hit(7, 0)], truncated: { covered: 0.6, reason: "samples" } })).coverageShort).toBe("stopped 60 %");
    expect(view(result({ hits: [hit(1, 0, { entry: true, entryMove: true })] }), { entryChecking: true }).coverageShort).toBe("entry checking");
    expect(view(result(), { caveat: "x" }).coverageShort).toBe("to the end");
  });

  it("the entry move's side sweep runs on after its first contact: shown, said still checking (Codex R136 VP-I93)", () => {
    const r = result({ hits: [hit(1, 0, { entry: true, entryMove: true })] });
    const v = view(r, { entryChecking: true });
    expect([v.state, v.verdict]).toEqual(["checking", "1 collision on the entry move so far · entry move still checking"]);
    expect(view(r).verdict, "its result: done").toBe("1 collision on the entry move · checked in full");
  });

  it("a timeline mark is a near miss only where nothing touched — a margin entry that touched later is a collision's", () => {
    const hits = [hit(10, 0), hit(40, 1.5), hit(70, 1.5, { touches: true })];
    const marks = barComputed("marks", { cumMax: { value: 100 }, toolTargets: { value: [] }, violationTargets: { value: [] }, isNearMiss,
      hitTargets: { value: clashTargets(hits) } }) as Array<{ pct: number; near: boolean }>;
    expect(marks.map(m => [m.pct, m.near])).toEqual([[10, false], [40, true], [70, false]]);
    // a target from the contact view says it itself, by the sweep's class (plan 4.1)
    const fromView = barComputed("marks", { cumMax: { value: 100 }, toolTargets: { value: [] }, violationTargets: { value: [] }, isNearMiss,
      hitTargets: { value: [{ cum: 20, cumEnd: 20, key: "C1|0|n", line: 3, a: "t", b: "w", dist: 5e-4, near: true },
                            { cum: 30, cumEnd: 31, key: "C2|0|0", line: 4, a: "t", b: "w", dist: 0, near: false }] } }) as Array<{ pct: number; near: boolean }>;
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
