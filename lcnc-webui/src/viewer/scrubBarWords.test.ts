// The collision check's summary line and its "?" (step 4 plan, package 1a /
// 1d): ScrubBar.vue's own computed bodies, executed as written with their
// inputs — the bar's decision, no copy (the method of startDepPayloads.test).
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { findingWords } from "./sweepWords";
import { clashTargets } from "./clashTargets";
import { partLabel } from "./simRows";
import { beginSentence, depTimeSentence } from "./startDep";
import { MAX_HITS, type CollisionHit, type CollisionResult } from "./collision";

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
const view = (r: CollisionResult, o: { busy?: boolean; frac?: number; caveat?: string } = {}) => barComputed("sweepView", {
  shownResult: { value: r },
  props: { collisionBusy: !!o.busy, collisionRunCheck: null, collisionStopped: null, collisionResumable: false, collisionProgress: 0 },
  hitTargets: { value: clashTargets(r.hits) }, sweepToolSentence: { value: "" }, verdictDetail: { value: "" },
  sweepCaveat: { value: o.caveat ?? null }, boundaryDetail: { value: "" }, sweptFrac: { value: o.frac ?? 1 }, pctOf, findingWords,
}) as { verdict: string; tone: string };
const detail = (r: CollisionResult) => barComputed("verdictDetail", {
  shownResult: { value: r }, props: { collisionBusy: false, collisionRunCheck: null, collisionStopped: null, collisionResumable: false },
  track: { value: null }, provisionalOnScreen: { value: false }, stoppedTitle: { value: "" }, hits: { value: r.hits },
  sweepCaveat: { value: null }, pctOf, beginSentence, depTimeSentence, partLabel, MAX_HITS }) as string;

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

  it("the cap is said by what it cut: records of listed contacts, or contacts themselves", () => {
    const cut = result({ hits: [hit(7, 0)], capped: 62 });
    expect(view(cut).verdict).toBe("1 collision · checked in full · records cut");
    expect(detail(cut)).toContain("62 records left out of the list — the later lines of contacts it lists");
    const onsets = result({ hits: [hit(7, 0)], capped: 9, cappedOnsets: 5 });
    expect(view(onsets).verdict).toBe("1 collision · checked in full · more contacts not listed");
    expect(detail(onsets)).toContain(`9 records left out of the list, 5 of them where a contact begins — contacts past the first ${MAX_HITS} are not listed or counted.`);
    expect(detail(onsets)).not.toContain("later lines of contacts it lists");
    expect(view(result({ hits: [hit(7, 0)] })).verdict).not.toContain("cut");
  });

  it("a timeline mark is a near miss only where nothing touched — a margin entry that touched later is a collision's", () => {
    const hits = [hit(10, 0), hit(40, 1.5), hit(70, 1.5, { touches: true })];
    const marks = barComputed("marks", { cumMax: { value: 100 }, toolTargets: { value: [] }, violationTargets: { value: [] },
      hitTargets: { value: clashTargets(hits) } }) as Array<{ pct: number; near: boolean }>;
    expect(marks.map(m => [m.pct, m.near])).toEqual([[10, false], [40, true], [70, false]]);
  });

  it("the pairs in contact at rest are excluded, counted in the \"?\"", () => {
    const r = result({ staticContacts: [{ a: "x_slide", b: "y_saddle", dist: 0 }, { a: "column", b: "base", dist: 1 }] });
    expect(detail(r)).toContain("2 pairs already in contact at rest — excluded.");
  });
});
