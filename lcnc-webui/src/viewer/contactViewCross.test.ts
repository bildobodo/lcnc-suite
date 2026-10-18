// Step 4 package 2: the views from the contact tables of real sweeps, on
// their own statements — the start targets are exactly the targets the view
// marks "at start" (plan 4.4), the index's counts are the targets' kinds
// (plan 4.1), every contact's start lights its column of the bands. Round B3
// compared these views with the records' views of the same sweep; the
// records are gone (C2): the contacts themselves are held to the truth by the
// oracles (collisionOracle, collisionRangeOracle, collisionHorizon).
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { sweepCollisions, type CollisionModel, type CollisionTrack } from "./collision";
import { ContactStore } from "./contactStore";
import { buildContactView, contactBands, startTargets, targetAt, targetKind, trackLineAt, T_AT_START, T_ENTRY_MOVE, T_NEAR, T_POSSIBLE, viewCounts } from "./contactView";
import { MARGIN, generatedCase, loadShippedModel, randomTrack, rng, shippedCases, type Case, type FixtureFiles } from "./collisionFixtures";

const ROOT = path.resolve(__dirname, "../../..");
const FILES: FixtureFiles = {
  text: rel => fs.readFileSync(path.join(ROOT, rel), "utf8"),
  bytes: rel => fs.readFileSync(path.join(ROOT, rel)),
};
const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 } as any;

interface Tally { checked: number; contacts: number; nears: number; startsIn: number }

function viewChecks(model: CollisionModel, track: CollisionTrack, where: string, t: Tally) {
  const store = new ContactStore(1, 0);
  const r = sweepCollisions(model, track, WCS0, { margin: MARGIN, contacts: { store } });
  if (r.truncated) return;
  t.checked++;
  const end = track.cum[track.count - 1]!;
  const names = model.pairs.map(([a, b]) => ({ a: model.bodies[a]!.id, b: model.bodies[b]!.id }));
  const v = buildContactView({ sources: [{ stores: [store], at: c => c }], pairName: p => names[p]!, coverage: end });
  const lineAt = trackLineAt(track);
  const kinds = Array.from({ length: v.n }, (_, i) => targetKind(v, i));
  const vt = Array.from({ length: v.n }, (_, i) => targetAt(v, i, lineAt));
  // the targets it starts in: found at the tables' first sample, the same as asking every target (plan 4.4)
  const starts = startTargets(v);
  expect(starts, `${where}: the start contacts`).toEqual(kinds.map((_, i) => i).filter(i => kinds[i]! & T_AT_START));
  t.startsIn += starts.length;
  // the words' counts: the index's are the targets' kinds
  const vc = viewCounts(v);
  const by = (f: (k: number) => boolean) => kinds.filter(f).length;
  expect([vc.collisions, vc.entryCollisions, vc.nearMisses, vc.possible], `${where}: the counts`).toEqual([
    by(k => !(k & T_POSSIBLE) && !(k & T_NEAR) && !(k & T_ENTRY_MOVE)), by(k => !(k & T_POSSIBLE) && !(k & T_NEAR) && !!(k & T_ENTRY_MOVE)),
    by(k => !(k & T_POSSIBLE) && !!(k & T_NEAR)), by(k => !!(k & T_POSSIBLE))]);
  // every contact's start lights its column of the bands
  const W = 400;
  const lit = new Set<number>();
  for (const [a, b] of contactBands(v, W, end)) for (let c = Math.round(a * W); c < Math.round(b * W); c++) lit.add(c);
  const col = (x: number) => Math.max(0, Math.min(W - 1, Math.floor((x / end) * W)));
  for (const x of vt.filter(y => !y.near)) {
    expect(lit.has(col(x.cum)), `${where} ${x.a}/${x.b}: the band at the contact's start`).toBe(true);
    t.contacts++;
  }
  t.nears += vt.filter(y => y.near).length;
}

describe("the views from the contact tables of real sweeps (step 4 package 2)", () => {
  const cases: Array<{ c: Case; load: () => { model: CollisionModel } }> = [
    ...shippedCases(FILES).map(c => ({ c, load: () => loadShippedModel(c, FILES) })),
    ...Array.from({ length: 10 }, (_, k) => { const g = generatedCase(20261013 + k); return { c: g.c, load: () => g }; }),
  ];
  const tally: Tally = { checked: 0, contacts: 0, nears: 0, startsIn: 0 };
  for (const { c, load } of cases) {
    it(`${c.name}: start targets, counts and bands from the view's own index`, { timeout: 600_000 }, () => {
      const { model } = load();
      const rand = rng(c.seed ?? 20261013);
      for (let k = 0; k < 2; k++) viewChecks(model, randomTrack(c, rand, 4, 0.5), `${c.name} track ${k}`, tally);
    });
  }
  it("the checks reach findings", () => {
    if (process.env.CONTACT_VIEW_CROSS_LOG) fs.appendFileSync(process.env.CONTACT_VIEW_CROSS_LOG, JSON.stringify(tally) + "\n");
    expect(tally.contacts, "contacts checked").toBeGreaterThan(5);
  });
});
